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
import { RewardLedger, loadRewardCore, statusForResult } from './reward-ledger.js';
import { SessionStore, isSessionStorageError } from './session-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Stage 7B-A2: `--data-dir` lets tests run against an isolated directory
// (never the real user data in server/data).
let DATA_DIR = path.join(__dirname, 'data');

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
  } else if (args[i] === '--data-dir' && args[i + 1]) {
    DATA_DIR = path.resolve(args[i + 1]);
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
const REWARD_LEDGER_FILE = path.join(DATA_DIR, 'reward-ledger.json');

// Stage 7B-A2 blocker remediation: ONE reader/writer object for sessions.json.
// It performs strict reads (a corrupt file throws instead of pretending to be
// empty) and serialized atomic writes (no lost update, no truncated file).
const sessionStore = new SessionStore({ filePath: SESSIONS_FILE });

// Stage 7B-A2: the single authoritative reward ledger writer for this process.
// It reads completed sessions through the same SessionStore, so there is one
// strict-read policy for the data that produces the balance.
const rewardLedger = new RewardLedger({
  ledgerFilePath: REWARD_LEDGER_FILE,
  sessionsFilePath: SESSIONS_FILE,
  sessionStore,
});

// Initialize data files if they don't exist. `initialize()` only creates a
// missing file: an existing (even corrupt) sessions.json is never rewritten at
// startup, so no user data can be lost by booting the server.
sessionStore.initialize();
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
//
// Fail-closed: when no API key is configured the server denies every non-health
// route rather than serving requests openly. The reverse proxy refuses to start
// without a key, so in the deployed model a key always exists; this guard
// ensures a directly-started or misconfigured backend can never expose session
// history or accept writes without a credential.
function isAuthenticated(req) {
  if (!API_KEY) return false; // no key configured → deny (fail-closed)
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

/**
 * Reads a JSON body, answering 400 itself when the payload is malformed.
 * Returns `null` when a response was already sent, so callers can bail out with
 * `if (body === null) return;`. Without this, a malformed body rejected inside
 * an awaited handler and surfaced as a generic 500 (or, before `return await`,
 * as an unhandled rejection that could take the process down).
 */
async function readJsonBody(req, res) {
  try {
    return await parseBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return null;
  }
}

// Helper: Send JSON response.
//
// Guarded against double-send: a handler that has already answered must not
// write a second status line (which would corrupt/truncate the response), and a
// late error after a successful write must not throw `ERR_HTTP_HEADERS_SENT`
// inside the router.
function sendJson(res, statusCode, data) {
  if (res.headersSent || res.writableEnded) {
    console.error(`[api] suppressed duplicate response (status ${statusCode})`);
    return;
  }
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
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
  // Strict read: a corrupt sessions.json answers 500 (see the router), never an
  // empty list that would look like "no history".
  const stored = sessionStore.list();
  
  // Support filtering
  const url = new URL(req.url, `http://${req.headers.host}`);
  const mode = url.searchParams.get('mode');
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  
  let sessions = [...stored];
  
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
  const session = sessionStore.find(instanceId);
  
  if (!session) {
    sendJson(res, 404, { error: 'Session not found' });
    return;
  }
  
  sendJson(res, 200, session);
}

// POST /api/sessions - Create new session
//
// This endpoint is a reward input: a record accepted here immediately increases
// the balance the parent can redeem. Authorization is enforced by the router
// (`requireSessionWrite`), so the handler assumes an authorized caller.
async function handleCreateSession(req, res) {
  const body = await readJsonBody(req, res);
  if (body === null) return;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(res, 400, { error: 'Validation failed', issues: ['body must be a JSON object'] });
    return;
  }

  // Stage 7B-A2: a completed-session record that will feed reward computation
  // is validated with the canonical codec before it is persisted, so an
  // invalid record can never silently become a reward input.
  if (body.historySchemaVersion !== undefined) {
    const core = await loadRewardCore();
    const historyValidation = core.validateCompletedSession(body);
    if (historyValidation.status !== 'valid') {
      sendJson(res, 400, {
        error: 'Validation failed',
        issues: historyValidation.status === 'corrupt'
          ? historyValidation.issues
          : ['unsupported historySchemaVersion: ' + historyValidation.version],
      });
      return;
    }
  }

  const validation = validateSessionRecord(body);
  if (!validation.valid) {
    sendJson(res, 400, { error: 'Validation failed', issues: validation.issues });
    return;
  }
  
  // Add recordedAt if not present
  if (!body.recordedAt) {
    body.recordedAt = Date.now();
  }
  
  // Append through the serialized store: the duplicate check and the write are
  // one locked step, so two concurrent submissions of the same session cannot
  // both be accepted, and two concurrent submissions of different sessions
  // cannot lose one another.
  const result = await sessionStore.append(body);
  
  if (result.status === 'duplicate') {
    sendJson(res, 409, { error: 'Session already exists', instanceId: body.instanceId });
    return;
  }
  if (result.status !== 'created') {
    sendJson(res, 500, { error: 'Failed to save session', reason: 'storage-error' });
    return;
  }
  
  sendJson(res, 201, { success: true, instanceId: body.instanceId, recordedAt: body.recordedAt });
}

// PUT /api/sessions/:instanceId - Update session
async function handleUpdateSession(req, res, instanceId) {
  const body = await readJsonBody(req, res);
  if (body === null) return;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(res, 400, { error: 'Validation failed', issues: ['body must be a JSON object'] });
    return;
  }
  
  const result = await sessionStore.mutate((sessions) => {
    const index = sessions.findIndex(s => s.instanceId === instanceId);
    if (index === -1) return { status: 'not-found' };

    const merged = { ...sessions[index], ...body };
    const validation = validateSessionRecord(merged);
    if (!validation.valid) return { status: 'invalid', issues: validation.issues };

    sessions[index] = merged;
    return { status: 'ok', sessions };
  });
  
  if (result.status === 'not-found') {
    sendJson(res, 404, { error: 'Session not found' });
    return;
  }
  if (result.status === 'invalid') {
    sendJson(res, 400, { error: 'Validation failed', issues: result.issues });
    return;
  }
  if (result.status !== 'ok') {
    sendJson(res, 500, { error: 'Failed to update session', reason: 'storage-error' });
    return;
  }
  
  sendJson(res, 200, { success: true, instanceId });
}

// DELETE /api/sessions/:instanceId - Delete session
async function handleDeleteSession(req, res, instanceId) {
  const result = await sessionStore.mutate((sessions) => {
    const index = sessions.findIndex(s => s.instanceId === instanceId);
    if (index === -1) return { status: 'not-found' };
    sessions.splice(index, 1);
    return { status: 'ok', sessions };
  });
  
  if (result.status === 'not-found') {
    sendJson(res, 404, { error: 'Session not found' });
    return;
  }
  if (result.status !== 'ok') {
    sendJson(res, 500, { error: 'Failed to delete session', reason: 'storage-error' });
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
  const body = await readJsonBody(req, res);
  if (body === null) return;
  
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
//
// Liveness must stay 200 even when the data file is damaged, but it must never
// report a corrupt file as "0 sessions": `sessions: null` + `storage: 'corrupt'`
// makes the difference between an empty history and unreadable storage visible.
async function handleHealth(req, res) {
  let sessions = null;
  let storage = 'ok';
  try {
    sessions = sessionStore.list().length;
  } catch (error) {
    storage = isSessionStorageError(error) ? 'corrupt' : 'unavailable';
  }
  sendJson(res, 200, { 
    status: storage === 'ok' ? 'ok' : 'degraded', 
    sessions,
    storage,
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

  const body = await readJsonBody(req, res);
  if (body === null) return;
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

  const body = await readJsonBody(req, res);
  if (body === null) return;
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


// ---------------------------------------------------------------------------
// Stage 7B-A2 - Authoritative reward endpoints
//
// The ledger and the balance are computed here, from server-side data only.
// Client-supplied balances are never accepted. Every endpoint (including the
// reads) requires a valid parent session: reward data is parent/child
// financial data and mutations must never be reachable anonymously.
// ---------------------------------------------------------------------------

function requireParentSession(req, res) {
  if (!isParentAuthenticated(req)) {
    sendJson(res, 401, { error: 'Parent authorization required' });
    return false;
  }
  return true;
}

/**
 * Authorization for POST /api/sessions (Stage 7B-A2 blocker remediation).
 *
 * Trust boundary: a completed session is a REWARD INPUT. Whoever can append one
 * can mint redeemable rupiah, so an anonymous request must never be able to
 * write one — the server binds 0.0.0.0 and is reachable from the LAN/ZeroTier.
 *
 * Two credentials are accepted, both of which already exist in this
 * architecture, so no new auth mechanism is introduced:
 *
 *   1. `X-API-KEY` — the shared device credential. It is the credential the app
 *      actually holds (the Vite dev proxy injects it from `server/data/config.json`
 *      into same-origin `/api` calls), and it is the same credential that already
 *      guards every non-health route when `apiKey` is configured.
 *   2. `X-Parent-Session` — an authenticated parent, for tooling/repair paths.
 *
 * How the two gates compose (documented because it is easy to misread):
 *
 *   - With `apiKey` configured, the global `isAuthenticated` gate in
 *     `handleRequest` has ALREADY required `X-API-KEY` before any route runs, so
 *     a device credential is the effective requirement for this route and the
 *     parent branch is redundant-but-harmless defence in depth.
 *   - With NO `apiKey`, that global gate fails closed (`isAuthenticated`
 *     returns `false`), so every non-health route — including this one — is
 *     denied at the gate before any handler runs. The server is unusable
 *     without a configured key.
 *
 * Fail-closed rule: a missing device credential can never silently re-open
 * anonymous reward injection. When no key is configured the global gate blocks
 * everything; when a key is configured the gate already demanded it, and this
 * function additionally refuses a write that lacks BOTH a device credential and
 * a parent session.
 */
function requireSessionWrite(req, res) {
  if (isParentAuthenticated(req)) return true;
  if (API_KEY && req.headers['x-api-key'] === API_KEY) return true;

  sendJson(res, 401, {
    error: 'Session write authorization required',
    reason: API_KEY ? 'invalid-device-credential' : 'device-credential-not-configured',
  });
  return false;
}

// GET /api/reward/state - authoritative balance + ledger view
async function handleGetRewardState(req, res) {
  const state = await rewardLedger.getState();
  sendJson(res, 200, {
    config: state.config,
    configValid: state.configValid,
    transactions: state.transactions,
    corrections: state.corrections,
    balance: state.balance,
    completedSessionsCount: state.sessions.length,
  });
}

// GET /api/reward/completed-sessions - the session records that feed rewards
async function handleGetRewardSessions(req, res) {
  const core = await loadRewardCore();
  const records = rewardLedger.sessions(core);
  const sessions = [];
  let invalidCount = 0;
  for (const record of records) {
    if (core.validateCompletedSession(record).status === 'valid') sessions.push(record);
    else invalidCount += 1;
  }
  sendJson(res, 200, { sessions, total: sessions.length, invalidCount });
}

// GET /api/reward/child-summary - minimal device-credentialed projection.
// The global API-key gate applies; a device key is NOT an individual child identity.
async function handleGetChildRewardSummary(req, res) {
  const state = await rewardLedger.getState();
  if (!state.configValid || !state.balance.isLedgerConsistent) {
    return sendJson(res, 500, { error: 'Reward data unavailable' });
  }
  const { balance, config } = state;
  const recentTransactions = [...state.transactions]
    .sort((a, b) => b.requestedAt - a.requestedAt || b.transactionId.localeCompare(a.transactionId))
    .slice(0, 5)
    .map(({ status, starsRedeemed, rupiahValue, requestedAt }) => ({ status, starsRedeemed, rupiahValue, requestedAt }));
  sendJson(res, 200, {
    totalEarned: balance.totalCollectibleStarsEarned,
    pendingStars: balance.totalPendingStars,
    confirmedStars: balance.totalConfirmedRedeemedStars,
    availableStars: balance.availableBalance,
    rupiahPerStar: config.rupiahPerStar,
    minStarsPerRedemption: config.minStarsPerRedemption,
    maxStarsPerRedemption: config.maxStarsPerRedemption,
    recentTransactions,
  });
}

// POST /api/reward/child-requests - strictly scoped request, never a transition.
async function handleChildRewardRequest(req, res) {
  const body = await readJsonBody(req, res);
  if (body === null) return;
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).sort().join(',') !== 'requestKey,starsRedeemed'
      || typeof body.requestKey !== 'string' || !/^[a-f0-9]{32}$/.test(body.requestKey)
      || !Number.isSafeInteger(body.starsRedeemed) || body.starsRedeemed <= 0) {
    return sendJson(res, 400, { error: 'Invalid child redemption request' });
  }
  // A browser chooses only a retry nonce, never the stored transaction ID.
  // HMAC prevents callers from directly choosing an existing parent ID.
  const transactionId = 'child-' + crypto.createHmac('sha256', API_KEY).update(body.requestKey).digest('hex');
  const result = await rewardLedger.submitTransaction(
    { transactionId, starsRedeemed: body.starsRedeemed }, { childRequest: true },
  );
  sendJson(res, result.status === 'success' && !result.idempotent ? 201 : statusForResult(result), result);
}

// POST /api/reward/transactions - parent request (pending)
async function handleSubmitRewardTransaction(req, res) {
  const body = await readJsonBody(req, res);
  if (body === null) return;
  const issues = [];
  const transactionId = typeof body?.transactionId === 'string' ? body.transactionId.trim() : '';
  if (!transactionId) issues.push('transactionId required');
  if (!Number.isSafeInteger(body?.starsRedeemed) || body.starsRedeemed <= 0) {
    issues.push('starsRedeemed must be a positive integer');
  }
  if (issues.length > 0) {
    sendJson(res, 400, { error: 'Validation failed', issues });
    return;
  }

  const result = await rewardLedger.submitTransaction({ transactionId, starsRedeemed: body.starsRedeemed });
  sendJson(res, statusForResult(result), result);
}

// POST /api/reward/transactions/:id/confirm | /cancel
async function handleTransitionRewardTransaction(req, res, transactionId, target) {
  const result = target === 'confirm'
    ? await rewardLedger.confirmTransaction(transactionId)
    : await rewardLedger.cancelTransaction(transactionId);
  sendJson(res, statusForResult(result), result);
}

// PUT /api/reward/config - update reward rules (parent only)
async function handleUpdateRewardConfig(req, res) {
  const body = await readJsonBody(req, res);
  if (body === null) return;
  const updates = {};
  const issues = [];
  for (const key of ['rupiahPerStar', 'minStarsPerRedemption', 'maxStarsPerRedemption']) {
    if (body?.[key] === undefined) continue;
    if (!Number.isSafeInteger(body[key]) || body[key] <= 0) {
      issues.push(key + ' must be a positive integer');
      continue;
    }
    updates[key] = body[key];
  }
  if (issues.length === 0 && Object.keys(updates).length === 0) {
    issues.push('no supported fields supplied');
  }
  if (issues.length > 0) {
    sendJson(res, 400, { error: 'Validation failed', issues });
    return;
  }

  const result = await rewardLedger.saveConfig(updates);
  sendJson(res, statusForResult(result), result);
}

// POST /api/reward/corrections - audited balance correction
async function handleCreateRewardCorrection(req, res) {
  const body = await readJsonBody(req, res);
  if (body === null) return;
  const issues = [];
  if (typeof body?.correctionId !== 'string' || !body.correctionId.trim()) issues.push('correctionId required');
  if (typeof body?.originalTransactionId !== 'string' || !body.originalTransactionId.trim()) {
    issues.push('originalTransactionId required');
  }
  if (!Number.isSafeInteger(body?.starsDelta) || body.starsDelta === 0) {
    issues.push('starsDelta must be a non-zero integer');
  }
  if (typeof body?.reason !== 'string' || !body.reason.trim()) issues.push('reason required');
  if (issues.length > 0) {
    sendJson(res, 400, { error: 'Validation failed', issues });
    return;
  }

  const result = await rewardLedger.applyCorrection({
    correctionId: body.correctionId,
    originalTransactionId: body.originalTransactionId,
    ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
    starsDelta: body.starsDelta,
    reason: body.reason,
  });
  sendJson(res, statusForResult(result), result);
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
      return await handleGetParentStatus(req, res);
    }
    if (pathname === '/api/parent/setup' && req.method === 'POST') {
      return await handleParentSetup(req, res);
    }
    if (pathname === '/api/parent/verify' && req.method === 'POST') {
      return await handleParentVerify(req, res);
    }
    if (pathname === '/api/parent/lock' && req.method === 'POST') {
      return await handleParentLock(req, res);
    }
    if (pathname === '/api/parent/session' && req.method === 'GET') {
      return await handleParentSessionCheck(req, res);
    }

    // Route: /api/sessions
    // Route: /api/reward/* (Stage 7B-A2 - authoritative reward ledger)
    // The two child routes are device-scoped and deliberately return no ledger.
    if (pathname === '/api/reward/child-summary' && req.method === 'GET') {
      return await handleGetChildRewardSummary(req, res);
    }
    if (pathname === '/api/reward/child-requests' && req.method === 'POST') {
      return await handleChildRewardRequest(req, res);
    }
    if (pathname === '/api/reward/state' && req.method === 'GET') {
      if (!requireParentSession(req, res)) return;
      return await handleGetRewardState(req, res);
    }
    if (pathname === '/api/reward/completed-sessions' && req.method === 'GET') {
      if (!requireParentSession(req, res)) return;
      return await handleGetRewardSessions(req, res);
    }
    if (pathname === '/api/reward/transactions' && req.method === 'POST') {
      if (!requireParentSession(req, res)) return;
      return await handleSubmitRewardTransaction(req, res);
    }
    const rewardTransitionMatch = pathname.match(/^\/api\/reward\/transactions\/([^/]+)\/(confirm|cancel)$/);
    if (rewardTransitionMatch && req.method === 'POST') {
      if (!requireParentSession(req, res)) return;
      return await handleTransitionRewardTransaction(
        req,
        res,
        decodeURIComponent(rewardTransitionMatch[1]),
        rewardTransitionMatch[2],
      );
    }
    if (pathname === '/api/reward/config' && req.method === 'PUT') {
      if (!requireParentSession(req, res)) return;
      return await handleUpdateRewardConfig(req, res);
    }
    if (pathname === '/api/reward/corrections' && req.method === 'POST') {
      if (!requireParentSession(req, res)) return;
      return await handleCreateRewardCorrection(req, res);
    }

    if (pathname === '/api/sessions' && req.method === 'GET') {
      return await handleGetSessions(req, res);
    }
    if (pathname === '/api/sessions' && req.method === 'POST') {
      // A session write is a reward input, so it must never be anonymous.
      if (!requireSessionWrite(req, res)) return;
      return await handleCreateSession(req, res);
    }

    // Route: /api/sessions/:instanceId
    const sessionMatch = pathname.match(/^\/api\/sessions\/(.+)$/);
    if (sessionMatch) {
      const instanceId = decodeURIComponent(sessionMatch[1]);
      if (req.method === 'GET') {
        return await handleGetSession(req, res, instanceId);
      }
      if (req.method === 'PUT') {
        if (!isParentAuthenticated(req)) {
          return sendJson(res, 401, { error: 'Parent authorization required' });
        }
        return await handleUpdateSession(req, res, instanceId);
      }
      if (req.method === 'DELETE') {
        if (!isParentAuthenticated(req)) {
          return sendJson(res, 401, { error: 'Parent authorization required' });
        }
        return await handleDeleteSession(req, res, instanceId);
      }
    }

    // Route: /api/config
    if (pathname === '/api/config' && req.method === 'GET') {
      return await handleGetConfig(req, res);
    }
    if (pathname === '/api/config' && req.method === 'PUT') {
      if (!isParentAuthenticated(req)) {
        return sendJson(res, 401, { error: 'Parent authorization required' });
      }
      return await handleUpdateConfig(req, res);
    }

    // Route: /health
    if (pathname === '/health' && req.method === 'GET') {
      return await handleHealth(req, res);
    }

    // 404 Not Found
    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    // Every handler is awaited above, so an async failure lands here instead of
    // escaping as an unhandled rejection that would kill the process.
    console.error('Request error:', error);
    if (isSessionStorageError(error)) {
      // Corrupt/unreadable storage is a server-side condition, never an empty
      // data set: report it explicitly so the client cannot render a fake zero.
      sendJson(res, 500, { error: 'Session storage unavailable', reason: error.message });
      return;
    }
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

// Last-resort safety net (Stage 7B-A2 blocker remediation).
//
// Every request handler is awaited inside the router's try/catch, so a failing
// handler answers 500 and never escapes. This net only catches what is left —
// a rejected promise outside a request path — and keeps the process alive
// instead of taking the whole backend down while a child is mid-session. It
// logs loudly on purpose: a silent swallow would hide real defects.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal-guard] unhandled promise rejection:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[fatal-guard] uncaught exception:', error);
});