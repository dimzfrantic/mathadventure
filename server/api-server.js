/**
 * Math Adventure Local Backend Server
 * 
 * Minimal backend for shared session history persistence across
 * localhost, LAN, and ZeroTier access paths.
 * 
 * Uses Node.js built-in modules (http, fs, path, crypto).
 * No external dependencies required.
 * 
 * Usage: node server/api-server.js [--port PORT] [--host HOST]
 * Default: http://0.0.0.0:3001
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

// Configuration
const DEFAULT_PORT = 3001;
const DEFAULT_HOST = '0.0.0.0';

// Parse CLI arguments
const args = process.argv.slice(2);
let port = DEFAULT_PORT;
let host = DEFAULT_HOST;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--host' && args[i + 1]) {
    host = args[i + 1];
    i++;
  }
}

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const PARENT_AUTH_FILE = path.join(DATA_DIR, 'parent-auth.json');

// Initialize data files if they don't exist
if (!fs.existsSync(SESSIONS_FILE)) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify({ sessions: [], lastUpdated: Date.now() }, null, 2));
}
if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ 
    rupiahPerStar: 500, 
    minStarsPerRedemption: 1, 
    maxStarsPerRedemption: 100 
  }, null, 2));
}

// Helper: Read JSON file safely
function readJsonFile(filePath, defaultValue = null) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return defaultValue;
  }
}

// Helper: Write JSON file safely
function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error.message);
    return false;
  }
}

// Load server config (may contain apiKey, allowedOrigins, rateLimit)
const SERVER_CONFIG = readJsonFile(CONFIG_FILE, {});
const API_KEY = SERVER_CONFIG.apiKey || null;
const ALLOWED_ORIGINS = SERVER_CONFIG.allowedOrigins || [];
const RATE_LIMIT = SERVER_CONFIG.rateLimit || { maxRequests: 30, windowMs: 60000 };

// Simple in‑memory rate limiter per IP
const rateLimiter = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimiter.get(ip) || { count: 0, start: now };
  if (now - record.start > RATE_LIMIT.windowMs) {
    // reset window
    record.count = 1;
    record.start = now;
  } else {
    record.count += 1;
  }
  rateLimiter.set(ip, record);
  return record.count <= RATE_LIMIT.maxRequests;
}

// Helper: CORS handling with whitelist
function handleCors(req, res) {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  
  // Check if origin is in whitelist
  let isAllowed = origin && ALLOWED_ORIGINS.includes(origin);
  
  // Fallback: check referer for development (handles proxy cases)
  if (!isAllowed && referer) {
    isAllowed = ALLOWED_ORIGINS.some(allowed => referer.startsWith(allowed.replace(/\/$/, '')));
  }
  
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary', 'Origin');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY, X-Parent-Session');
}

// Helper: Authenticate request (except health & OPTIONS)
function isAuthenticated(req) {
  if (!API_KEY) return true; // no key configured → open
  const provided = req.headers['x-api-key'];
  return provided === API_KEY;
}

// --- Parent PIN & Session Authentication ---
const PARENT_SESSION_TTL_MS = 15 * 60 * 1000; // 15 menit
const PIN_MAX_ATTEMPTS = 5;
const PIN_INITIAL_LOCKOUT_MS = 30 * 1000; // 30 detik
const PIN_LOCKOUT_MULTIPLIER = 2;
const PIN_MAX_LOCKOUT_MS = 15 * 60 * 1000; // 15 menit

// In-memory parent sessions map: token -> { token, createdAt, expiresAt }
const parentSessions = new Map();

function createParentSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const session = {
    token,
    createdAt: now,
    expiresAt: now + PARENT_SESSION_TTL_MS,
  };
  parentSessions.set(token, session);
  return session;
}

function isValidParentSession(token) {
  if (!token || typeof token !== 'string') return false;
  const session = parentSessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    parentSessions.delete(token);
    return false;
  }
  // Slide expiration window on activity
  session.expiresAt = Date.now() + PARENT_SESSION_TTL_MS;
  return true;
}

function revokeParentSession(token) {
  if (token && parentSessions.has(token)) {
    parentSessions.delete(token);
    return true;
  }
  return false;
}

function isParentAuthenticated(req) {
  const token = req.headers['x-parent-session'];
  return isValidParentSession(token);
}

// Parent PIN attempt tracking for rate limiting / lockout
let pinAttempts = {
  failedAttempts: 0,
  lastFailedAttempt: null,
  lockUntil: null,
};

function getPinLockoutState() {
  const now = Date.now();
  if (pinAttempts.lockUntil && now < pinAttempts.lockUntil) {
    return {
      locked: true,
      remainingMs: pinAttempts.lockUntil - now,
      failedAttempts: pinAttempts.failedAttempts,
    };
  }
  return {
    locked: false,
    remainingMs: null,
    failedAttempts: pinAttempts.failedAttempts,
  };
}

function recordFailedPinAttempt() {
  const now = Date.now();
  pinAttempts.failedAttempts += 1;
  pinAttempts.lastFailedAttempt = now;

  if (pinAttempts.failedAttempts >= PIN_MAX_ATTEMPTS) {
    const exponent = pinAttempts.failedAttempts - PIN_MAX_ATTEMPTS;
    const duration = Math.min(
      PIN_INITIAL_LOCKOUT_MS * Math.pow(PIN_LOCKOUT_MULTIPLIER, exponent),
      PIN_MAX_LOCKOUT_MS
    );
    pinAttempts.lockUntil = now + duration;
  }
  return getPinLockoutState();
}

function resetPinAttemptState() {
  pinAttempts = {
    failedAttempts: 0,
    lastFailedAttempt: null,
    lockUntil: null,
  };
}

function formatLockoutMessage(remainingMs) {
  const seconds = Math.ceil(remainingMs / 1000);
  if (seconds >= 60) {
    const minutes = Math.ceil(seconds / 60);
    return `Terlalu banyak percobaan. Coba lagi dalam ${minutes} menit.`;
  }
  return `Terlalu banyak percobaan. Coba lagi dalam ${seconds} detik.`;
}

function hashPin(pin, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.pbkdf2Sync(pin, salt, 100000, 32, 'sha256').toString('hex');
}

// Helper: Parse JSON request body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Helper: Send JSON response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json'
  });
  res.end(JSON.stringify(data));
}

// Helper: Validate session record
function validateSessionRecord(data) {
  const issues = [];
  
  if (!data.instanceId || typeof data.instanceId !== 'string') {
    issues.push('instanceId required');
  }
  if (!data.sessionId || typeof data.sessionId !== 'string') {
    issues.push('sessionId required');
  }
  if (!data.mode || !['regular', 'challenge'].includes(data.mode)) {
    issues.push('mode must be regular or challenge');
  }
  if (!Array.isArray(data.outcomes)) {
    issues.push('outcomes must be an array');
  }
  
  // Validate outcomes if present
  if (Array.isArray(data.outcomes)) {
    for (let i = 0; i < data.outcomes.length; i++) {
      const outcome = data.outcomes[i];
      if (![0, 0.5, 1].includes(outcome.points)) {
        issues.push(`outcome[${i}].points must be 0, 0.5, or 1`);
      }
    }
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}

// API Routes

// GET /api/sessions - List all sessions
async function handleGetSessions(req, res) {
  const data = readJsonFile(SESSIONS_FILE, { sessions: [] });
  
  // Support filtering
  const url = new URL(req.url, `http://${req.headers.host}`);
  const mode = url.searchParams.get('mode');
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  
  let sessions = data.sessions || [];
  
  // Filter by mode if specified
  if (mode) {
    sessions = sessions.filter(s => s.mode === mode);
  }
  
  // Sort by recordedAt descending (newest first)
  sessions.sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0));
  
  // Paginate
  const total = sessions.length;
  const paged = sessions.slice(offset, offset + limit);
  
  sendJson(res, 200, {
    sessions: paged,
    total,
    offset,
    limit
  });
}

// GET /api/sessions/:instanceId - Get single session
async function handleGetSession(req, res, instanceId) {
  const data = readJsonFile(SESSIONS_FILE, { sessions: [] });
  const session = data.sessions.find(s => s.instanceId === instanceId);
  
  if (!session) {
    sendJson(res, 404, { error: 'Session not found' });
    return;
  }
  
  sendJson(res, 200, session);
}

// POST /api/sessions - Create new session
async function handleCreateSession(req, res) {
  const body = await parseBody(req);
  
  // Validate
  const validation = validateSessionRecord(body);
  if (!validation.valid) {
    sendJson(res, 400, { error: 'Validation failed', issues: validation.issues });
    return;
  }
  
  const data = readJsonFile(SESSIONS_FILE, { sessions: [] });
  
  // Check for duplicate
  const existing = data.sessions.find(s => s.instanceId === body.instanceId);
  if (existing) {
    sendJson(res, 409, { error: 'Session already exists', instanceId: body.instanceId });
    return;
  }
  
  // Add recordedAt if not present
  if (!body.recordedAt) {
    body.recordedAt = Date.now();
  }
  
  // Add to collection
  data.sessions.push(body);
  data.lastUpdated = Date.now();
  
  if (!writeJsonFile(SESSIONS_FILE, data)) {
    sendJson(res, 500, { error: 'Failed to save session' });
    return;
  }
  
  sendJson(res, 201, { success: true, instanceId: body.instanceId });
}

// PUT /api/sessions/:instanceId - Update session
async function handleUpdateSession(req, res, instanceId) {
  const body = await parseBody(req);
  
  const data = readJsonFile(SESSIONS_FILE, { sessions: [] });
  const index = data.sessions.findIndex(s => s.instanceId === instanceId);
  
  if (index === -1) {
    sendJson(res, 404, { error: 'Session not found' });
    return;
  }
  
  // Validate the update data
  const validation = validateSessionRecord({ ...data.sessions[index], ...body });
  if (!validation.valid) {
    sendJson(res, 400, { error: 'Validation failed', issues: validation.issues });
    return;
  }
  
  // Update
  data.sessions[index] = { ...data.sessions[index], ...body };
  data.lastUpdated = Date.now();
  
  if (!writeJsonFile(SESSIONS_FILE, data)) {
    sendJson(res, 500, { error: 'Failed to update session' });
    return;
  }
  
  sendJson(res, 200, { success: true, instanceId });
}

// DELETE /api/sessions/:instanceId - Delete session
async function handleDeleteSession(req, res, instanceId) {
  const data = readJsonFile(SESSIONS_FILE, { sessions: [] });
  const index = data.sessions.findIndex(s => s.instanceId === instanceId);
  
  if (index === -1) {
    sendJson(res, 404, { error: 'Session not found' });
    return;
  }
  
  data.sessions.splice(index, 1);
  data.lastUpdated = Date.now();
  
  if (!writeJsonFile(SESSIONS_FILE, data)) {
    sendJson(res, 500, { error: 'Failed to delete session' });
    return;
  }
  
  sendJson(res, 200, { success: true });
}

// GET /api/config - Get reward config (public fields only, no secrets)
async function handleGetConfig(req, res) {
  const config = readJsonFile(CONFIG_FILE, { 
    rupiahPerStar: 500, 
    minStarsPerRedemption: 1, 
    maxStarsPerRedemption: 100 
  });
  // Strip server-side secrets before sending to client
  const { apiKey: _apiKey, allowedOrigins: _origins, rateLimit: _rl, ...publicConfig } = config;
  sendJson(res, 200, publicConfig);
}

// PUT /api/config - Update reward config
async function handleUpdateConfig(req, res) {
  const body = await parseBody(req);
  
  // Validate
  if (body.rupiahPerStar !== undefined && (typeof body.rupiahPerStar !== 'number' || body.rupiahPerStar <= 0)) {
    sendJson(res, 400, { error: 'rupiahPerStar must be a positive number' });
    return;
  }
  if (body.minStarsPerRedemption !== undefined && (typeof body.minStarsPerRedemption !== 'number' || body.minStarsPerRedemption < 1)) {
    sendJson(res, 400, { error: 'minStarsPerRedemption must be at least 1' });
    return;
  }
  if (body.maxStarsPerRedemption !== undefined && (typeof body.maxStarsPerRedemption !== 'number' || body.maxStarsPerRedemption < 1)) {
    sendJson(res, 400, { error: 'maxStarsPerRedemption must be at least 1' });
    return;
  }
  
  const config = readJsonFile(CONFIG_FILE, {});
  const updated = { ...config, ...body };
  
  if (!writeJsonFile(CONFIG_FILE, updated)) {
    sendJson(res, 500, { error: 'Failed to save config' });
    return;
  }
  
  // Strip server-side secrets before sending response
  const { apiKey: _apiKey, allowedOrigins: _origins, rateLimit: _rl, ...publicConfig } = updated;
  sendJson(res, 200, publicConfig);
}

// Health check
async function handleHealth(req, res) {
  const data = readJsonFile(SESSIONS_FILE, { sessions: [] });
  sendJson(res, 200, { 
    status: 'ok', 
    sessions: data.sessions.length,
    timestamp: Date.now()
  });
}

// --- Parent Auth Handlers ---

// GET /api/parent/status
async function handleGetParentStatus(req, res) {
  const authData = readJsonFile(PARENT_AUTH_FILE, null);
  const hasPin = Boolean(authData && authData.hasPin && authData.verifier && authData.salt);
  const lockout = getPinLockoutState();

  sendJson(res, 200, {
    hasPin,
    isLockedOut: lockout.locked,
    lockoutMessage: lockout.locked ? formatLockoutMessage(lockout.remainingMs) : null,
    remainingMs: lockout.remainingMs,
  });
}

// POST /api/parent/setup
async function handleParentSetup(req, res) {
  const authData = readJsonFile(PARENT_AUTH_FILE, null);
  if (authData && authData.hasPin) {
    sendJson(res, 400, { error: 'PIN orang tua sudah diatur' });
    return;
  }

  const body = await parseBody(req);
  if (!body.pin || typeof body.pin !== 'string' || !/^\d{6}$/.test(body.pin)) {
    sendJson(res, 400, { error: 'PIN harus tepat 6 digit angka' });
    return;
  }
  if (body.pin !== body.confirmPin) {
    sendJson(res, 400, { error: 'Konfirmasi PIN tidak cocok' });
    return;
  }

  const saltHex = crypto.randomBytes(16).toString('hex');
  const verifierHex = hashPin(body.pin, saltHex);
  const newAuthData = {
    hasPin: true,
    salt: saltHex,
    verifier: verifierHex,
    iterations: 100000,
    updatedAt: Date.now(),
  };

  if (!writeJsonFile(PARENT_AUTH_FILE, newAuthData)) {
    sendJson(res, 500, { error: 'Gagal menyimpan konfigurasi PIN' });
    return;
  }

  resetPinAttemptState();
  const session = createParentSession();
  sendJson(res, 201, {
    success: true,
    sessionToken: session.token,
    expiresAt: session.expiresAt,
  });
}

// POST /api/parent/verify
async function handleParentVerify(req, res) {
  const lockout = getPinLockoutState();
  if (lockout.locked) {
    sendJson(res, 429, {
      error: formatLockoutMessage(lockout.remainingMs),
      isLockedOut: true,
      remainingMs: lockout.remainingMs,
    });
    return;
  }

  const authData = readJsonFile(PARENT_AUTH_FILE, null);
  if (!authData || !authData.hasPin) {
    sendJson(res, 400, { error: 'PIN belum diatur' });
    return;
  }

  const body = await parseBody(req);
  if (!body.pin || typeof body.pin !== 'string' || !/^\d{6}$/.test(body.pin)) {
    sendJson(res, 400, { error: 'PIN harus tepat 6 digit angka' });
    return;
  }

  const computedHex = hashPin(body.pin, authData.salt);
  const computedBuf = Buffer.from(computedHex, 'hex');
  const expectedBuf = Buffer.from(authData.verifier, 'hex');
  const isValid = computedBuf.length === expectedBuf.length && crypto.timingSafeEqual(computedBuf, expectedBuf);

  if (isValid) {
    resetPinAttemptState();
    const session = createParentSession();
    sendJson(res, 200, {
      success: true,
      sessionToken: session.token,
      expiresAt: session.expiresAt,
    });
  } else {
    const newLockout = recordFailedPinAttempt();
    if (newLockout.locked) {
      sendJson(res, 429, {
        error: formatLockoutMessage(newLockout.remainingMs),
        isLockedOut: true,
        remainingMs: newLockout.remainingMs,
      });
    } else {
      sendJson(res, 401, {
        error: 'PIN salah. Silakan coba lagi.',
        failedAttempts: newLockout.failedAttempts,
      });
    }
  }
}

// POST /api/parent/lock
async function handleParentLock(req, res) {
  const token = req.headers['x-parent-session'];
  revokeParentSession(token);
  sendJson(res, 200, { success: true });
}

// GET /api/parent/session
async function handleParentSessionCheck(req, res) {
  const token = req.headers['x-parent-session'];
  if (isParentAuthenticated(req)) {
    const session = parentSessions.get(token);
    sendJson(res, 200, { valid: true, expiresAt: session.expiresAt });
  } else {
    sendJson(res, 401, { valid: false, error: 'Sesi orang tua tidak valid atau telah kedaluwarsa' });
  }
}

// Main request handler
async function handleRequest(req, res) {
  // Apply CORS whitelist (if configured)
  handleCors(req, res);

  // Rate limiting per IP
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (!checkRateLimit(clientIp)) {
    sendJson(res, 429, { error: 'Too many requests' });
    return;
  }

  // Authentication (except health endpoint and preflight)
  if (req.method !== 'OPTIONS' && req.url !== '/health') {
    if (!isAuthenticated(req)) {
      sendJson(res, 401, { error: 'Invalid API key' });
      return;
    }
  }

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse URL
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  console.log(`${new Date().toISOString()} ${req.method} ${pathname}`);

  try {
    // Route: /api/parent/*
    if (pathname === '/api/parent/status' && req.method === 'GET') {
      return handleGetParentStatus(req, res);
    }
    if (pathname === '/api/parent/setup' && req.method === 'POST') {
      return handleParentSetup(req, res);
    }
    if (pathname === '/api/parent/verify' && req.method === 'POST') {
      return handleParentVerify(req, res);
    }
    if (pathname === '/api/parent/lock' && req.method === 'POST') {
      return handleParentLock(req, res);
    }
    if (pathname === '/api/parent/session' && req.method === 'GET') {
      return handleParentSessionCheck(req, res);
    }

    // Route: /api/sessions
    if (pathname === '/api/sessions' && req.method === 'GET') {
      return handleGetSessions(req, res);
    }
    if (pathname === '/api/sessions' && req.method === 'POST') {
      return handleCreateSession(req, res);
    }

    // Route: /api/sessions/:instanceId
    const sessionMatch = pathname.match(/^\/api\/sessions\/(.+)$/);
    if (sessionMatch) {
      const instanceId = decodeURIComponent(sessionMatch[1]);
      if (req.method === 'GET') {
        return handleGetSession(req, res, instanceId);
      }
      if (req.method === 'PUT') {
        if (!isParentAuthenticated(req)) {
          return sendJson(res, 401, { error: 'Parent authorization required' });
        }
        return handleUpdateSession(req, res, instanceId);
      }
      if (req.method === 'DELETE') {
        if (!isParentAuthenticated(req)) {
          return sendJson(res, 401, { error: 'Parent authorization required' });
        }
        return handleDeleteSession(req, res, instanceId);
      }
    }

    // Route: /api/config
    if (pathname === '/api/config' && req.method === 'GET') {
      return handleGetConfig(req, res);
    }
    if (pathname === '/api/config' && req.method === 'PUT') {
      if (!isParentAuthenticated(req)) {
        return sendJson(res, 401, { error: 'Parent authorization required' });
      }
      return handleUpdateConfig(req, res);
    }

    // Route: /health
    if (pathname === '/health' && req.method === 'GET') {
      return handleHealth(req, res);
    }

    // 404 Not Found
    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('Request error:', error);
    sendJson(res, 500, { error: 'Internal server error' });
  }
}

// Create and start server
const server = http.createServer(handleRequest);

server.listen(port, host, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           Math Adventure Backend Server                   ║
╠═══════════════════════════════════════════════════════════╣
║  Server running at: http://${host}:${port}                    ║
║                                                           ║
║  API Endpoints:                                           ║
║  - GET    /api/sessions          List all sessions        ║
║  - GET    /api/sessions/:id      Get single session       ║
║  - POST   /api/sessions          Create new session       ║
║  - PUT    /api/sessions/:id      Update session           ║
║  - DELETE /api/sessions/:id      Delete session           ║
║  - GET    /api/config            Get reward config        ║
║  - PUT    /api/config            Update reward config     ║
║  - GET    /health                Health check             ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(() => {
    console.log('Server stopped.');
    process.exit(0);
  });
});