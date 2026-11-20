// @vitest-environment node
/**
 * Stage 7B-A2 limited remediation — finding C: automated tests for
 * `server/reverse-proxy.js`.
 *
 * Every test runs against a throwaway mock backend and a throwaway `dist/`
 * directory created under the OS temp dir. Nothing reads `server/data/`, no
 * user data is touched, and the key used here is a synthetic test value (never
 * printed, never a real credential).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROXY_SCRIPT = path.join(REPO_ROOT, 'server', 'reverse-proxy.js')
const API_SERVER_SCRIPT = path.join(REPO_ROOT, 'server', 'api-server.js')

/** Synthetic credential used by these tests. Not a real key. */
const TEST_KEY = 'test-device-key-not-a-real-credential'
const TEST_KEY_ENV = 'MATH_DRILL_PROXY_TEST_KEY'
const UNSET_KEY_ENV = 'MATH_DRILL_PROXY_TEST_KEY_DEFINITELY_UNSET'
const SHELL_MARKER = 'PROXY_SHELL_MARKER'

const cleanup: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanup.length > 0) {
    const fn = cleanup.pop()
    if (!fn) continue
    try {
      await fn()
    } catch {
      // best effort cleanup
    }
  }
})

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error('no port'))))
    })
  })
}

function canConnect(port: number, host = '127.0.0.1', timeoutMs = 750): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ port, host })
    const done = (ok: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

async function waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await canConnect(port, '127.0.0.1', 250)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`port ${port} did not open within ${timeoutMs}ms`)
}

interface HttpResult {
  readonly status: number
  readonly headers: IncomingMessage['headers']
  readonly body: string
}

function call(options: {
  port: number
  path: string
  method?: string
  headers?: Record<string, string>
  body?: string
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: options.port,
      method: options.method ?? 'GET',
      path: options.path,
      headers: options.headers,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(Buffer.from(chunk)))
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.setTimeout(15_000, () => req.destroy(new Error('client timeout')))
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

interface ReceivedRequest {
  readonly method: string
  readonly url: string
  readonly headers: IncomingMessage['headers']
  readonly body: string
}

interface MockBackend {
  readonly port: number
  readonly received: ReceivedRequest[]
  close(): Promise<void>
}

async function startMockBackend(
  respond?: (req: IncomingMessage, res: ServerResponse) => boolean,
): Promise<MockBackend> {
  const received: ReceivedRequest[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      if (respond && respond(req, res)) return
      const body = JSON.stringify({ ok: true, path: req.url })
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
      res.end(body)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const handle: MockBackend = {
    port,
    received,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()) }),
  }
  cleanup.push(() => handle.close())
  return handle
}

interface ProxyHandle {
  readonly port: number
  logs(): string
  stop(): Promise<void>
}

async function startProxy(options: {
  apiPort: number
  key?: string | null
  keyEnvName?: string
  apiKeyFile?: string
  dist?: string
  host?: string
  port?: number
}): Promise<ProxyHandle> {
  const port = options.port ?? await freePort()
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env[SHELL_MARKER]
  const keyEnvName = options.keyEnvName ?? TEST_KEY_ENV
  delete env[UNSET_KEY_ENV]
  if (options.key) env[keyEnvName] = options.key
  else delete env[keyEnvName]

  const args = [
    PROXY_SCRIPT,
    '--port', String(port),
    '--api-port', String(options.apiPort),
    '--api-host', '127.0.0.1',
    '--api-key-env', keyEnvName,
  ]
  if (options.host) args.push('--host', options.host)
  if (options.dist) args.push('--dist', options.dist)
  if (options.apiKeyFile) args.push('--api-key-file', options.apiKeyFile)

  const child: ChildProcess = spawn(process.execPath, args, { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', chunk => { stdout += String(chunk) })
  child.stderr?.on('data', chunk => { stderr += String(chunk) })

  const exited = new Promise<number | null>(resolve => { child.once('exit', code => resolve(code)) })
  cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
  })

  try {
    await waitForPort(port)
  } catch (error) {
    child.kill('SIGKILL')
    throw new Error(`proxy failed to start: ${(error as Error).message}\nstdout: ${stdout}\nstderr: ${stderr}`)
  }

  return {
    port,
    logs: () => `${stdout}${stderr}`,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await exited
    },
  }
}

async function runProxyExpectingExit(options: {
  apiPort: number
  key?: string | null
  dist?: string
  keyEnvName?: string
  extraArgs?: string[]
}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const port = await freePort()
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env[UNSET_KEY_ENV]
  delete env[TEST_KEY_ENV]
  const keyEnvName = options.keyEnvName ?? UNSET_KEY_ENV
  if (options.key) env[keyEnvName] = options.key

  const args = [
    PROXY_SCRIPT,
    '--port', String(port),
    '--api-port', String(options.apiPort),
    '--api-key-env', keyEnvName,
    ...(options.dist ? ['--dist', options.dist] : []),
    ...(options.extraArgs ?? []),
  ]
  const child = spawn(process.execPath, args, { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', chunk => { stdout += String(chunk) })
  child.stderr?.on('data', chunk => { stderr += String(chunk) })

  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`proxy did not exit; stdout: ${stdout} stderr: ${stderr}`))
    }, 15_000)
    child.once('exit', exitCode => { clearTimeout(timer); resolve(exitCode) })
  })

  // A refusal must not leave a listener behind.
  expect(await canConnect(port, '127.0.0.1', 250)).toBe(false)
  return { code, stdout, stderr }
}

interface DistFixture {
  readonly dir: string
  readonly shellMarker: string
}

async function makeDist(): Promise<DistFixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'proxy-dist-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const dist = path.join(root, 'dist')
  await mkdir(path.join(dist, 'assets'), { recursive: true })
  const shellMarker = '<!doctype html><title>math-adventure-test-shell</title>'
  await writeFile(path.join(dist, 'index.html'), shellMarker, 'utf8')
  await writeFile(path.join(dist, 'assets', 'app.js'), 'console.log("bundle")\n', 'utf8')
  await writeFile(path.join(dist, 'assets', 'app.css'), 'body{color:#000}\n', 'utf8')
  // Sits OUTSIDE dist: must never be reachable through the static handler.
  await writeFile(path.join(root, 'outside.txt'), 'OUTSIDE_MARKER', 'utf8')
  return { dir: dist, shellMarker }
}

describe('reverse proxy — startup guards', () => {
  it('refuses to start when no API key is configured', async () => {
    const dist = await makeDist()
    const backend = await startMockBackend()
    const result = await runProxyExpectingExit({ apiPort: backend.port, key: null, dist: dist.dir })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Missing API key')
    expect(result.stdout).not.toContain('http://127.0.0.1')
  }, 30_000)

  it('refuses to start when the built frontend is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'proxy-nodist-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const backend = await startMockBackend()
    const result = await runProxyExpectingExit({
      apiPort: backend.port,
      key: TEST_KEY,
      keyEnvName: TEST_KEY_ENV,
      dist: path.join(root, 'does-not-exist'),
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('No built frontend')
  }, 30_000)
})

describe('reverse proxy — static delivery', () => {
  it('serves the app shell at / with no-store caching', async () => {
    const dist = await makeDist()
    const backend = await startMockBackend()
    const proxy = await startProxy({ apiPort: backend.port, key: TEST_KEY, dist: dist.dir })

    const res = await call({ port: proxy.port, path: '/' })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.body).toContain('math-adventure-test-shell')
    expect(backend.received).toHaveLength(0)
  }, 30_000)

  it('serves built assets with immutable caching and the right content type', async () => {
    const dist = await makeDist()
    const backend = await startMockBackend()
    const proxy = await startProxy({ apiPort: backend.port, key: TEST_KEY, dist: dist.dir })

    const js = await call({ port: proxy.port, path: '/assets/app.js' })
    expect(js.status).toBe(200)
    expect(js.headers['content-type']).toContain('text/javascript')
    expect(String(js.headers['cache-control'])).toContain('immutable')
    expect(js.body).toContain('console.log')

    const css = await call({ port: proxy.port, path: '/assets/app.css' })
    expect(css.status).toBe(200)
    expect(css.headers['content-type']).toContain('text/css')
  }, 30_000)

  it('falls back to the shell for client-side routes', async () => {
    const dist = await makeDist()
    const backend = await startMockBackend()
    const proxy = await startProxy({ apiPort: backend.port, key: TEST_KEY, dist: dist.dir })

    const res = await call({ port: proxy.port, path: '/dashboard/orang-tua' })
    expect(res.status).toBe(200)
    expect(res.body).toContain('math-adventure-test-shell')
  }, 30_000)

  it('answers 404 for a missing asset instead of returning the shell', async () => {
    const dist = await makeDist()
    const backend = await startMockBackend()
    const proxy = await startProxy({ apiPort: backend.port, key: TEST_KEY, dist: dist.dir })

    const res = await call({ port: proxy.port, path: '/assets/missing.js' })
    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.body).not.toContain('math-adventure-test-shell')
  }, 30_000)

  it('never serves files outside the dist directory', async () => {
    const dist = await makeDist()
    const backend = await startMockBackend()
    const proxy = await startProxy({ apiPort: backend.port, key: TEST_KEY, dist: dist.dir })

    for (const attempt of ['/../outside.txt', '/%2e%2e/outside.txt', '/assets/../../outside.txt']) {
      const res = await call({ port: proxy.port, path: attempt })
      expect(res.status).toBe(404)
      expect(res.body).not.toContain('OUTSIDE_MARKER')
    }
  }, 30_000)
})

describe('reverse proxy — API forwarding and credential handling', () => {
  it('forwards /health and injects the server-side X-API-Key', async () => {
    const dist = await makeDist()
    const backend = await startMockBackend()
    const proxy = await startProxy({ apiPort: backend.port, key: TEST_KEY, dist: dist.dir })

    const res = await call({ port: proxy.port, path: '/health' })
    expect(res.status).toBe(200)
    expect(backend.received).toHaveLength(1)
    expect(backend.received[0]?.headers['x-api-key']).toBe(TEST_KEY)
    expect(backend.received[0]?.headers.host).toBe(`127.0.0.1:${backend.port}`)
    // The credential is injected upstream only; it must not be echoed back.
    expect(res.headers['x-api-key']).toBeUndefined()
    expect(res.body).not.toContain(TEST_KEY)
  }, 30_000)

  it('forwards method, path, query string and body for POST /api/sessions', async () => {
    const dist = await makeDist()
    const backend = await startMockBackend()
    const proxy = await startProxy({ apiPort: backend.port, key: TEST_KEY, dist: dist.dir })
    const payload = JSON.stringify({ instanceId: 'abc-123', completedCount: 1 })

    const res = await call({
      port: proxy.port,
      path: '/api/sessions?source=proxy-test',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) },
      body: payload,
    })

    expect(res.status).toBe(200)
    expect(backend.received).toHaveLength(1)
    expect(backend.received[0]?.method).toBe('POST')
    expect(backend.received[0]?.url).toBe('/api/sessions?source=proxy-test')
    expect(backend.received[0]?.body).toBe(payload)
    expect(backend.received[0]?.headers['content-type']).toContain('application/json')
  }, 30_000)

  it('ignores a client-supplied X-API-Key', async () => {
    const dist = await makeDist()
    const backend = await startMockBackend()
    const proxy = await startProxy({ apiPort: backend.port, key: TEST_KEY, dist: dist.dir })

    const res = await call({
      port: proxy.port,
      path: '/api/config',
      headers: { 'X-API-Key': 'attacker-supplied-key' },
    })

    expect(res.status).toBe(200)
    expect(backend.received[0]?.headers['x-api-key']).toBe(TEST_KEY)
    expect(JSON.stringify(backend.received[0]?.headers)).not.toContain('attacker-supplied-key')
  }, 30_000)

  it('injects the device key for GET /api/sessions without authenticating the client individually', async () => {
    // The proxy is the device: it injects X-API-KEY server-side for every /api/
    // request. A client with NO credential of its own still reaches the backend.
    // This is device-level auth, NOT per-client auth — the proxy does not
    // fabricate a parent session or any individual credential.
    const dist = await makeDist()
    const backend = await startMockBackend()
    const proxy = await startProxy({ apiPort: backend.port, key: TEST_KEY, dist: dist.dir })

    const res = await call({ port: proxy.port, path: '/api/sessions?limit=10' })
    expect(res.status).toBe(200)
    expect(backend.received).toHaveLength(1)
    expect(backend.received[0]?.method).toBe('GET')
    expect(backend.received[0]?.url).toBe('/api/sessions?limit=10')
    // The device key was injected server-side by the proxy.
    expect(backend.received[0]?.headers['x-api-key']).toBe(TEST_KEY)
    // The key is never echoed back to the client.
    expect(res.headers['x-api-key']).toBeUndefined()
    expect(res.body).not.toContain(TEST_KEY)
    // The proxy does NOT fabricate a parent session — no per-client auth.
    expect(backend.received[0]?.headers['x-parent-session']).toBeUndefined()
  }, 30_000)

  it('forwards X-Parent-Session unchanged', async () => {
    const dist = await makeDist()
    const backend = await startMockBackend()
    const proxy = await startProxy({ apiPort: backend.port, key: TEST_KEY, dist: dist.dir })
    const parentSession = 'a'.repeat(64)

    const res = await call({
      port: proxy.port,
      path: '/api/reward/state',
      headers: { 'X-Parent-Session': parentSession },
    })

    expect(res.status).toBe(200)
    expect(backend.received[0]?.headers['x-parent-session']).toBe(parentSession)
  }, 30_000)

  it('strips hop-by-hop request headers and headers named by Connection', async () => {
    const dist = await makeDist()
    const backend = await startMockBackend()
    const proxy = await startProxy({ apiPort: backend.port, key: TEST_KEY, dist: dist.dir })

    const res = await call({
      port: proxy.port,
      path: '/api/config',
      headers: {
        Connection: 'x-hop-secret',
        'X-Hop-Secret': 'must-not-arrive',
        'Proxy-Authorization': 'Basic Zm9vOmJhcg==',
        TE: 'trailers',
        'X-Keep-Me': 'forwarded',
      },
    })

    expect(res.status).toBe(200)
    const seen = backend.received[0]?.headers ?? {}
    expect(seen['x-hop-secret']).toBeUndefined()
    expect(seen['proxy-authorization']).toBeUndefined()
    expect(seen.te).toBeUndefined()
    expect(seen['x-keep-me']).toBe('forwarded')
  }, 30_000)

  it('does not relay hop-by-hop response headers from the backend', async () => {
    const dist = await makeDist()
    const backend = await startMockBackend((_req, res) => {
      const body = JSON.stringify({ ok: true })
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        Connection: 'x-upstream-only',
        'X-Upstream-Only': 'must-not-reach-browser',
        'Keep-Alive': 'timeout=99',
        'X-Upstream-Keep': 'relayed',
      })
      res.end(body)
      return true
    })
    const proxy = await startProxy({ apiPort: backend.port, key: TEST_KEY, dist: dist.dir })

    const res = await call({ port: proxy.port, path: '/api/config' })
    expect(res.status).toBe(200)
    expect(res.headers['x-upstream-only']).toBeUndefined()
    // This proxy's own HTTP layer may add its own Keep-Alive; what must not
    // happen is relaying the upstream connection's hop-by-hop value.
    expect(res.headers['keep-alive']).not.toBe('timeout=99')
    expect(String(res.headers.connection ?? '')).not.toContain('x-upstream-only')
    expect(res.headers['x-upstream-keep']).toBe('relayed')
    expect(res.body).toBe('{"ok":true}')
  }, 30_000)

  it('answers 502 — not a fake success — when the backend is unreachable', async () => {
    const dist = await makeDist()
    const closedPort = await freePort()
    const proxy = await startProxy({ apiPort: closedPort, key: TEST_KEY, dist: dist.dir })

    const res = await call({ port: proxy.port, path: '/health' })
    expect(res.status).toBe(502)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.body).toContain('Backend unavailable')
    expect(res.status).not.toBe(200)

    const apiRes = await call({ port: proxy.port, path: '/api/reward/state' })
    expect(apiRes.status).toBe(502)
    // A degraded answer must not look like a valid empty balance.
    expect(apiRes.body).not.toMatch(/"balance"\s*:/)
    expect(apiRes.body).not.toMatch(/"stars"\s*:\s*0/)
  }, 30_000)
})

describe('reverse proxy — binding and shutdown', () => {
  it('binds loopback by default', async () => {
    const dist = await makeDist()
    const backend = await startMockBackend()
    const proxy = await startProxy({ apiPort: backend.port, key: TEST_KEY, dist: dist.dir })

    expect(proxy.logs()).toContain(`http://127.0.0.1:${proxy.port}`)

    const lan = Object.values((await import('node:os')).networkInterfaces())
      .flat()
      .find(entry => entry && entry.family === 'IPv4' && !entry.internal)
    if (lan) {
      // A LAN address must not reach the proxy when it listens on loopback only.
      expect(await canConnect(proxy.port, lan.address, 750)).toBe(false)
    }
  }, 30_000)

  it('closes the listener when the process stops', async () => {
    const dist = await makeDist()
    const backend = await startMockBackend()
    const proxy = await startProxy({ apiPort: backend.port, key: TEST_KEY, dist: dist.dir })

    expect(await canConnect(proxy.port)).toBe(true)
    await proxy.stop()
    const deadline = Date.now() + 5_000
    let stillOpen = true
    while (Date.now() < deadline) {
      stillOpen = await canConnect(proxy.port, '127.0.0.1', 200)
      if (!stillOpen) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    expect(stillOpen).toBe(false)
  }, 30_000)

  it('never writes the API key to its own logs', async () => {
    const dist = await makeDist()
    const backend = await startMockBackend()
    const proxy = await startProxy({ apiPort: backend.port, key: TEST_KEY, dist: dist.dir })

    await call({ port: proxy.port, path: '/health' })
    await call({ port: proxy.port, path: '/api/config' })
    await call({ port: proxy.port, path: '/' })
    await proxy.stop()

    const logs = proxy.logs()
    expect(logs).not.toContain(TEST_KEY)
    expect(logs.toLowerCase()).not.toContain('x-api-key:')
  }, 30_000)
})

describe('reverse proxy against the real API server', () => {
  it('keeps device and parent authentication intact', async () => {
    const dist = await makeDist()
    const dataDir = await mkdtemp(path.join(tmpdir(), 'proxy-apidata-'))
    cleanup.push(() => rm(dataDir, { recursive: true, force: true }))
    const apiPort = await freePort()

    // A device credential must be configured for the API to enforce it; with no
    // `apiKey` the API server is open (pre-existing behaviour, unchanged here).
    // This mirrors the documented deployment: the key lives in config.json.
    const realKey = randomBytes(24).toString('hex')
    await writeFile(path.join(dataDir, 'config.json'), JSON.stringify({ apiKey: realKey }), 'utf8')

    const api = spawn(process.execPath, [
      API_SERVER_SCRIPT,
      '--port', String(apiPort),
      '--host', '127.0.0.1',
      '--data-dir', dataDir,
    ], { cwd: REPO_ROOT, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let apiLogs = ''
    api.stdout?.on('data', chunk => { apiLogs += String(chunk) })
    api.stderr?.on('data', chunk => { apiLogs += String(chunk) })
    const apiExited = new Promise<void>(resolve => { api.once('exit', () => resolve()) })
    cleanup.push(async () => {
      if (api.exitCode === null && api.signalCode === null) api.kill('SIGKILL')
      await apiExited
    })

    await waitForPort(apiPort)

    const proxy = await startProxy({ apiPort, key: null, apiKeyFile: path.join(dataDir, 'config.json'), dist: dist.dir })

    // 1. Direct access to the API without the device key is refused.
    const direct = await call({ port: apiPort, path: '/api/config' })
    expect(direct.status).toBe(401)

    // 2. A wrong device key is refused too.
    const wrong = await call({ port: apiPort, path: '/api/config', headers: { 'X-API-Key': 'wrong-key' } })
    expect(wrong.status).toBe(401)

    // 3. Through the proxy the device key is supplied server-side.
    const viaProxy = await call({ port: proxy.port, path: '/api/config' })
    expect(viaProxy.status).toBe(200)
    expect(viaProxy.body).not.toContain(realKey ?? '')

    // 4. The proxy does not weaken parent authorization: the device key alone
    //    does not open reward state.
    const rewardState = await call({ port: proxy.port, path: '/api/reward/state' })
    expect(rewardState.status).toBe(401)

    // 5. Health stays reachable through the proxy.
    const health = await call({ port: proxy.port, path: '/health' })
    expect(health.status).toBe(200)

    // 6. The proxy never logs the real key.
    expect(proxy.logs()).not.toContain(realKey ?? '')
    expect(apiLogs).not.toContain(realKey ?? '')
  }, 60_000)
})
