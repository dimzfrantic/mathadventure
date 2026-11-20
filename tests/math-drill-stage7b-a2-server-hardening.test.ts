// @vitest-environment node
/**
 * Stage 7B-A2 blocker remediation — server-side hardening.
 *
 * Every test drives the REAL `server/api-server.js` process against an isolated
 * `--data-dir` in the OS temp directory. Nothing here touches `server/data`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { answerQuestion, createScoreState, generateSession } from '../src/features/math-drill/domain'
import { projectCompletedSession } from '../src/features/math-drill/persistence/completedSessionProjection'
import type { CompletedSessionRecord } from '../src/features/math-drill/persistence/completedSessionTypes'

const API_KEY = 'a2-test-device-key'
const ALLOWED_ORIGIN = 'http://localhost:5173'
const PIN = '135790'

let sequence = 0
const running: Array<{ readonly process: ChildProcess; readonly dir: string }> = []

interface Harness {
  readonly url: string
  readonly dir: string
  readonly stop: () => Promise<void>
}

function makeDir(seedFiles: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), `a2-server-${Date.now()}-${++sequence}-`))
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    apiKey: API_KEY,
    allowedOrigins: [ALLOWED_ORIGIN],
  }))
  for (const [name, content] of Object.entries(seedFiles)) writeFileSync(path.join(dir, name), content)
  return dir
}

async function startServer(dir: string): Promise<Harness> {
  const port = 41_000 + Math.floor(Math.random() * 4_000)
  const child = spawn(process.execPath, ['server/api-server.js', '--port', String(port), '--host', '127.0.0.1', '--data-dir', dir], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const url = `http://127.0.0.1:${port}`
  const entry = { process: child, dir }
  running.push(entry)

  const deadline = Date.now() + 15_000
  for (;;) {
    if (Date.now() > deadline) throw new Error('server did not become ready')
    try {
      const response = await fetch(`${url}/health`)
      if (response.ok) break
    } catch { /* not listening yet */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  return {
    url,
    dir,
    stop: async () => {
      const index = running.indexOf(entry)
      if (index >= 0) running.splice(index, 1)
      if (!child.killed) child.kill()
      await new Promise(resolve => setTimeout(resolve, 150))
    },
  }
}

function completedRecord(instanceId: string, seed = 4242, completedAt = 1_000_000): CompletedSessionRecord {
  const generated = generateSession({ level: 1, mode: 'addition', count: 1, seed, roundSize: 1 })
  if (!generated.ok) throw new Error(generated.error.code)
  const session = generated.session
  const question = session.questions[0]
  const base = {
    schemaVersion: 1,
    mode: 'regular',
    instanceId,
    sessionId: session.id,
    revision: 1,
    createdAt: 1,
    updatedAt: 2,
    session,
    score: createScoreState(session),
    cursor: { questionIndex: 0, phase: 'answering', pendingAdvanceAt: null },
  }
  const answered = answerQuestion(base.score, session, question.key, question.correctChoiceIndex)
  if (!answered.ok) throw new Error(answered.error.code)
  const snapshot = { ...base, score: answered.state, cursor: { questionIndex: 0, phase: 'result', pendingAdvanceAt: null } }
  const projected = projectCompletedSession(snapshot as never, { completedAt, recordedAt: completedAt, provenance: 'new-atomic' })
  if (projected.status !== 'valid') throw new Error(projected.status)
  return projected.value
}

async function parentToken(harness: Harness): Promise<string> {
  const response = await fetch(`${harness.url}/api/parent/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY },
    body: JSON.stringify({ pin: PIN, confirmPin: PIN }),
  })
  const payload = await response.json() as { sessionToken?: string }
  if (!payload.sessionToken) throw new Error(`parent setup failed: ${response.status}`)
  return payload.sessionToken
}

async function rewardState(harness: Harness, token: string) {
  const response = await fetch(`${harness.url}/api/reward/state`, {
    headers: { 'X-API-KEY': API_KEY, 'X-Parent-Session': token },
  })
  const payload = await response.json() as { balance?: { totalCollectibleStarsEarned: number }; sessions?: unknown[] }
  return { status: response.status, payload }
}

function sessionsOnDisk(dir: string): unknown[] {
  try {
    return JSON.parse(readFileSync(path.join(dir, 'sessions.json'), 'utf8')).sessions as unknown[]
  } catch {
    return []
  }
}

afterEach(async () => {
  while (running.length > 0) {
    const entry = running.pop()!
    if (!entry.process.killed) entry.process.kill()
    await new Promise(resolve => setTimeout(resolve, 100))
    rmSync(entry.dir, { recursive: true, force: true })
  }
})

describe('Stage 7B-A2 — POST /api/sessions access control', () => {
  it('rejects an anonymous write and accepts an authenticated one', async () => {
    const harness = await startServer(makeDir())
    const token = await parentToken(harness)
    const record = completedRecord('11111111-1111-4111-8111-111111111111')

    const anonymous = await fetch(`${harness.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    })
    expect(anonymous.status).toBe(401)
    expect(sessionsOnDisk(harness.dir)).toHaveLength(0)

    const before = await rewardState(harness, token)
    expect(before.payload.balance?.totalCollectibleStarsEarned).toBe(0)

    const authorized = await fetch(`${harness.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY },
      body: JSON.stringify(record),
    })
    expect(authorized.status).toBe(201)

    const after = await rewardState(harness, token)
    expect(after.payload.balance!.totalCollectibleStarsEarned).toBeGreaterThan(0)
    expect(sessionsOnDisk(harness.dir)).toHaveLength(1)
    await harness.stop()
  })

  it('fails closed for every non-health route when no device key is configured', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), `a2-server-nokey-${Date.now()}-`))
    writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ allowedOrigins: [ALLOWED_ORIGIN] }))
    const harness = await startServer(dir)

    // No apiKey configured → the global gate denies ALL non-health routes,
    // including parent bootstrap. The server cannot be used without a key.
    const getSession = await fetch(`${harness.url}/api/sessions`)
    expect(getSession.status).toBe(401)

    const postSession = await fetch(`${harness.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(completedRecord('22222222-2222-4222-8222-222222222222')),
    })
    expect(postSession.status).toBe(401)

    // Even a parent session cannot bootstrap, because setup itself is gated.
    const parentSetup = await fetch(`${harness.url}/api/parent/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN, confirmPin: PIN }),
    })
    expect(parentSetup.status).toBe(401)

    expect(sessionsOnDisk(dir)).toHaveLength(0)
    await harness.stop()
  })

  it('rejects a wrong device key', async () => {
    const harness = await startServer(makeDir())
    await parentToken(harness)
    const response = await fetch(`${harness.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': 'wrong-key' },
      body: JSON.stringify(completedRecord('33333333-3333-4333-8333-333333333333')),
    })
    expect(response.status).toBe(401)
    expect(sessionsOnDisk(harness.dir)).toHaveLength(0)
    await harness.stop()
  })

  it('fails closed when no device key is configured', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), `a2-server-nokey-${Date.now()}-`))
    writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ allowedOrigins: [ALLOWED_ORIGIN] }))
    const harness = await startServer(dir)
    const response = await fetch(`${harness.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(completedRecord('44444444-4444-4444-8444-444444444444')),
    })
    expect(response.status).toBe(401)
    expect(sessionsOnDisk(dir)).toHaveLength(0)
    await harness.stop()
  })

  it('rejects an invalid or fabricated payload without touching the balance', async () => {
    const harness = await startServer(makeDir())
    const token = await parentToken(harness)
    const fabricated = { ...completedRecord('55555555-5555-4555-8555-555555555555'), outcomes: [{ level: 1, operation: 'addition', points: 999_999 }] }

    for (const body of [
      fabricated,
      { instanceId: 'not-a-uuid', historySchemaVersion: 1 },
      { historySchemaVersion: 1, instanceId: '66666666-6666-4666-8666-666666666666', sessionId: 'not-a-uuid' },
    ]) {
      const response = await fetch(`${harness.url}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY },
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(400)
    }

    const state = await rewardState(harness, token)
    expect(state.payload.balance?.totalCollectibleStarsEarned).toBe(0)
    expect(sessionsOnDisk(harness.dir)).toHaveLength(0)
    await harness.stop()
  })

  it('answers malformed JSON with 400 and stays alive', async () => {
    const harness = await startServer(makeDir())
    await parentToken(harness)
    const response = await fetch(`${harness.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY },
      body: '{"instanceId": ',
    })
    expect(response.status).toBe(400)
    expect((await response.json() as { error?: string }).error).toBeTruthy()

    const health = await fetch(`${harness.url}/health`)
    expect(health.status).toBe(200)
    expect((await health.json() as { status?: string }).status).toBe('ok')
    await harness.stop()
  })
})

describe('Stage 7B-A2 — GET /api/sessions access control', () => {
  it('returns the session list with a valid device key', async () => {
    const harness = await startServer(makeDir())
    const record = completedRecord('a1a1a1a1-b2b2-4c3c-8d4d-a5a5a5a5a5a5')
    const post = await fetch(`${harness.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY },
      body: JSON.stringify(record),
    })
    expect(post.status).toBe(201)

    const res = await fetch(`${harness.url}/api/sessions`, {
      headers: { 'X-API-KEY': API_KEY },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { sessions: unknown[]; total: number }
    expect(body.total).toBe(1)
    expect(body.sessions).toHaveLength(1)
    await harness.stop()
  })

  it('does not require a parent session — history is a device-credential read by design', async () => {
    const harness = await startServer(makeDir())
    await fetch(`${harness.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY },
      body: JSON.stringify(completedRecord('b1b1b1b1-c2c2-4d3d-8e4e-b5b5b5b5b5b5')),
    })
    // GET with the device key only — no X-Parent-Session header.
    const res = await fetch(`${harness.url}/api/sessions`, {
      headers: { 'X-API-KEY': API_KEY },
    })
    expect(res.status).toBe(200)
    expect((await res.json() as { total: number }).total).toBe(1)
    await harness.stop()
  })

  it('rejects a request without a device key', async () => {
    const harness = await startServer(makeDir())
    const res = await fetch(`${harness.url}/api/sessions`)
    expect(res.status).toBe(401)
    await harness.stop()
  })

  it('rejects a wrong device key', async () => {
    const harness = await startServer(makeDir())
    const res = await fetch(`${harness.url}/api/sessions`, {
      headers: { 'X-API-KEY': 'wrong-key' },
    })
    expect(res.status).toBe(401)
    await harness.stop()
  })

  it('returns a single session by id with a valid device key', async () => {
    const harness = await startServer(makeDir())
    const id = 'c1c1c1c1-d2d2-4e3e-8f4f-c5c5c5c5c5c5'
    await fetch(`${harness.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY },
      body: JSON.stringify(completedRecord(id)),
    })
    const res = await fetch(`${harness.url}/api/sessions/${id}`, {
      headers: { 'X-API-KEY': API_KEY },
    })
    expect(res.status).toBe(200)
    expect((await res.json() as { instanceId: string }).instanceId).toBe(id)
    await harness.stop()
  })

  it('answers 404 for a missing id without leaking other session data', async () => {
    const harness = await startServer(makeDir())
    const realId = 'd1d1d1d1-e2e2-4f3e-8a4f-d5d5d5d5d5d5'
    const record = completedRecord(realId)
    await fetch(`${harness.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY },
      body: JSON.stringify(record),
    })
    const missing = await fetch(`${harness.url}/api/sessions/nonexistent-id`, {
      headers: { 'X-API-KEY': API_KEY },
    })
    expect(missing.status).toBe(404)
    const missingBody = await missing.text()
    expect(missingBody).not.toContain(realId)
    expect(missingBody).not.toContain(record.sessionId)
    await harness.stop()
  })

  it('fails closed for GET when no device key is configured', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), `a2-server-get-nokey-${Date.now()}-`))
    writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ allowedOrigins: [ALLOWED_ORIGIN] }))
    const harness = await startServer(dir)
    const res = await fetch(`${harness.url}/api/sessions`)
    expect(res.status).toBe(401)
    await harness.stop()
  })
})

describe('Stage 7B-A2 — idempotency and concurrency', () => {
  it('does not double-credit a repeated session', async () => {
    const harness = await startServer(makeDir())
    const token = await parentToken(harness)
    const record = completedRecord('77777777-7777-4777-8777-777777777777')
    const send = () => fetch(`${harness.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY },
      body: JSON.stringify(record),
    })

    expect((await send()).status).toBe(201)
    const first = await rewardState(harness, token)
    expect((await send()).status).toBe(409)
    const second = await rewardState(harness, token)

    expect(second.payload.balance!.totalCollectibleStarsEarned).toBe(first.payload.balance!.totalCollectibleStarsEarned)
    expect(sessionsOnDisk(harness.dir)).toHaveLength(1)
    await harness.stop()
  })

  it('loses no session when many are submitted concurrently', async () => {
    const harness = await startServer(makeDir())
    const ids = Array.from({ length: 10 }, (_value, index) => `88888888-8888-4888-8888-88888888888${index}`)
    const responses = await Promise.all(ids.map((id, index) => fetch(`${harness.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY },
      body: JSON.stringify(completedRecord(id, 5000 + index, 2_000_000 + index)),
    })))

    expect(responses.map(response => response.status)).toEqual(Array.from({ length: 10 }, () => 201))
    const stored = sessionsOnDisk(harness.dir) as Array<{ instanceId: string }>
    expect(stored).toHaveLength(10)
    expect(new Set(stored.map(entry => entry.instanceId)).size).toBe(10)
    await harness.stop()
  })
})

describe('Stage 7B-A2 — storage integrity and protected reads', () => {
  it('never reports a corrupt sessions file as an empty collection', async () => {
    const dir = makeDir({ 'sessions.json': '{ this is not json' })
    const harness = await startServer(dir)
    const token = await parentToken(harness)

    const health = await fetch(`${harness.url}/health`)
    expect(health.status).toBe(200)
    const healthBody = await health.json() as { status: string; sessions: number | null; storage: string }
    expect(healthBody).toMatchObject({ status: 'degraded', sessions: null, storage: 'corrupt' })

    const state = await rewardState(harness, token)
    expect(state.status).toBe(500)
    expect(state.payload.balance).toBeUndefined()

    // The damaged file is left untouched for inspection, not silently rewritten.
    expect(readFileSync(path.join(dir, 'sessions.json'), 'utf8')).toBe('{ this is not json')

    // ...and the process is still serving.
    expect((await fetch(`${harness.url}/health`)).status).toBe(200)
    await harness.stop()
  })

  it('keeps reward reads behind parent authorization', async () => {
    const harness = await startServer(makeDir())
    const token = await parentToken(harness)
    const deviceOnly = { 'X-API-KEY': API_KEY }
    expect((await fetch(`${harness.url}/api/reward/state`)).status).toBe(401)
    expect((await fetch(`${harness.url}/api/reward/state`, { headers: deviceOnly })).status).toBe(401)
    expect((await fetch(`${harness.url}/api/reward/completed-sessions`, { headers: deviceOnly })).status).toBe(401)
    expect((await rewardState(harness, token)).status).toBe(200)
    await harness.stop()
  })

  it('only exposes CORS headers for configured origins', async () => {
    const harness = await startServer(makeDir())
    const allowed = await fetch(`${harness.url}/health`, { headers: { Origin: ALLOWED_ORIGIN } })
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN)

    const blocked = await fetch(`${harness.url}/health`, { headers: { Origin: 'http://evil.example' } })
    expect(blocked.headers.get('access-control-allow-origin')).toBeNull()
    await harness.stop()
  })
})
