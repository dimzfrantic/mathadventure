#!/usr/bin/env node
/**
 * Stage 7B-A2 — minimal same-origin reverse proxy.
 *
 * WHY THIS EXISTS
 * ---------------
 * The API server requires the shared device credential (`X-API-KEY`) on every
 * non-health route, and `POST /api/sessions` is additionally guarded by
 * `requireSessionWrite()`. The Vite dev server injects that credential from
 * `server.proxy.configure` — but only in dev, and `vite preview`/a static host
 * has no proxy at all. This file is the missing piece for running the built
 * application: it serves `dist/` and forwards `/api/*` + `/health` to the API
 * server while adding `X-API-KEY` **server-side**.
 *
 * DESIGN CONSTRAINTS (deliberate)
 * -------------------------------
 * 1. The key is NEVER sent to the browser and NEVER enters the bundle. It is
 *    read from the process environment of this proxy only.
 * 2. A client-supplied `x-api-key` is stripped and replaced, so a browser (or
 *    anything else) cannot smuggle a different credential through.
 * 3. `x-parent-session` is forwarded untouched: reward endpoints keep their own
 *    parent authorization, exactly as implemented.
 * 4. The API server is expected to bind loopback (`--host 127.0.0.1`) so that
 *    LAN clients cannot reach it around this proxy. The key remains the real
 *    control even for local processes.
 * 5. Nothing here logs the key; only method, path and status are logged.
 *
 * USAGE
 *   MATH_DRILL_API_KEY=... node server/reverse-proxy.js \
 *     [--port 4180] [--host 127.0.0.1] \
 *     [--api-port 3001] [--api-host 127.0.0.1] \
 *     [--dist dist] [--api-key-env MATH_DRILL_API_KEY]
 *
 * Optional: `--api-key-file <path>` reads `apiKey` from a JSON config file
 * (e.g. a temporary data dir) instead of the environment.
 */
import { createServer, request as httpRequest } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

function readArgs(argv) {
  const parsed = {
    port: 4180,
    host: '127.0.0.1',
    apiPort: 3001,
    apiHost: '127.0.0.1',
    dist: path.join(REPO_ROOT, 'dist'),
    apiKeyEnv: 'MATH_DRILL_API_KEY',
    apiKeyFile: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--port' && value) { parsed.port = Number(value); i += 1 }
    else if (flag === '--host' && value) { parsed.host = value; i += 1 }
    else if (flag === '--api-port' && value) { parsed.apiPort = Number(value); i += 1 }
    else if (flag === '--api-host' && value) { parsed.apiHost = value; i += 1 }
    else if (flag === '--dist' && value) { parsed.dist = path.resolve(value); i += 1 }
    else if (flag === '--api-key-env' && value) { parsed.apiKeyEnv = value; i += 1 }
    else if (flag === '--api-key-file' && value) { parsed.apiKeyFile = path.resolve(value); i += 1 }
  }
  return parsed
}

const config = readArgs(process.argv.slice(2))

async function resolveApiKey() {
  if (config.apiKeyFile) {
    const raw = await readFile(config.apiKeyFile, 'utf8')
    const parsed = JSON.parse(raw)
    return typeof parsed.apiKey === 'string' && parsed.apiKey.length > 0 ? parsed.apiKey : null
  }
  const fromEnv = process.env[config.apiKeyEnv]
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : null
}

const MIME = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}))

function isProxied(url) {
  return url === '/health' || url.startsWith('/health?') || url.startsWith('/api/') || url === '/api'
}

function sendJson(res, statusCode, payload) {
  if (res.headersSent) return
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/** Headers named by a `Connection:` value are hop-by-hop for that message only. */
function connectionListedHeaders(headers) {
  const raw = headers.connection
  if (typeof raw !== 'string') return new Set()
  return new Set(raw.split(',').map(value => value.trim().toLowerCase()).filter(Boolean))
}

/**
 * Request headers as they may be forwarded upstream: hop-by-hop headers removed,
 * the client's device credential replaced by the proxy's own, and `host`
 * rewritten to the API server. Anything else (including `x-parent-session`) is
 * forwarded verbatim.
 */
function forwardableRequestHeaders(req, apiKey) {
  const listed = connectionListedHeaders(req.headers)
  const headers = {}
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase()
    if (value === undefined) continue
    if (HOP_BY_HOP.has(lower) || listed.has(lower)) continue
    // Never let a client-supplied device credential through: the proxy decides.
    if (lower === 'x-api-key' || lower === 'x-forwarded-for') continue
    headers[lower] = value
  }
  headers['x-api-key'] = apiKey
  headers.host = `${config.apiHost}:${config.apiPort}`
  return headers
}

/**
 * Response headers as they may be relayed to the browser. Hop-by-hop headers
 * belong to the upstream connection and must not be replayed on a new one; the
 * HTTP layer of this server re-applies framing itself.
 */
function forwardableResponseHeaders(upstreamHeaders) {
  const listed = connectionListedHeaders(upstreamHeaders)
  const headers = {}
  for (const [name, value] of Object.entries(upstreamHeaders)) {
    const lower = name.toLowerCase()
    if (value === undefined) continue
    if (HOP_BY_HOP.has(lower) || listed.has(lower)) continue
    headers[lower] = value
  }
  return headers
}

function proxyToApi(req, res, apiKey) {
  const headers = forwardableRequestHeaders(req, apiKey)

  const upstream = httpRequest({
    host: config.apiHost,
    port: config.apiPort,
    method: req.method,
    path: req.url,
    headers,
  }, (upstreamRes) => {
    if (res.headersSent) { upstreamRes.resume(); return }
    res.writeHead(upstreamRes.statusCode ?? 502, forwardableResponseHeaders(upstreamRes.headers))
    upstreamRes.pipe(res)
  })

  upstream.on('error', (error) => {
    // Backend down: answer with a clear, non-zero-shaped failure. The app must
    // never mistake this for a confirmed balance of zero.
    if (res.headersSent) { res.destroy(); return }
    sendJson(res, 502, { error: 'Backend unavailable', reason: String(error?.code ?? 'proxy-error') })
  })

  req.on('aborted', () => upstream.destroy())
  req.pipe(upstream)
  return true
}

function serveStatic(req, res, distDir) {
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  const rawPath = (req.url ?? '/').split('?')[0].split('#')[0]
  let decoded
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    sendJson(res, 400, { error: 'Bad path' })
    return
  }

  const candidate = path.resolve(distDir, `.${decoded}`)
  const insideDist = candidate === distDir || candidate.startsWith(distDir + path.sep)
  let filePath = insideDist && existsSync(candidate) && statSync(candidate).isFile() ? candidate : null

  // SPA fallback: unknown non-asset paths render the app shell.
  if (!filePath && !path.extname(decoded)) filePath = path.join(distDir, 'index.html')
  if (!filePath || !existsSync(filePath)) {
    sendJson(res, 404, { error: 'Not found' })
    return
  }

  const ext = path.extname(filePath).toLowerCase()
  const isShell = filePath.endsWith('index.html')
  res.writeHead(200, {
    'Content-Type': MIME.get(ext) ?? 'application/octet-stream',
    'Content-Length': statSync(filePath).size,
    'Cache-Control': isShell ? 'no-store' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  })
  if (method === 'HEAD') { res.end(); return }
  createReadStream(filePath).pipe(res)
}

const apiKey = await resolveApiKey()
if (!apiKey) {
  console.error(`[proxy] Missing API key. Set ${config.apiKeyEnv} (or pass --api-key-file). Refusing to start without it.`)
  process.exit(1)
}
if (!existsSync(path.join(config.dist, 'index.html'))) {
  console.error(`[proxy] No built frontend at ${config.dist}. Run "npm run build" first.`)
  process.exit(1)
}

const server = createServer((req, res) => {
  try {
    if (isProxied(req.url ?? '/')) {
      proxyToApi(req, res, apiKey)
      return
    }
    serveStatic(req, res, config.dist)
  } catch (error) {
    console.error('[proxy] handler failure:', error instanceof Error ? error.message : error)
    sendJson(res, 500, { error: 'Proxy failure' })
  }
})

server.on('clientError', (_error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})

server.listen(config.port, config.host, () => {
  console.log(`[proxy] http://${config.host}:${config.port} -> static ${config.dist}`)
  console.log(`[proxy] /api/* and /health -> http://${config.apiHost}:${config.apiPort} (X-API-KEY injected server-side)`)
})

process.on('uncaughtException', (error) => {
  console.error('[proxy][fatal-guard] uncaught exception:', error)
})
process.on('unhandledRejection', (reason) => {
  console.error('[proxy][fatal-guard] unhandled rejection:', reason)
})
