// @vitest-environment node
/**
 * Isolated end-to-end reward lifecycle against the real API server.
 * All writes are confined to a throwaway OS temp directory via --data-dir.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { answerQuestion, createScoreState, generateSession } from '../src/features/math-drill/domain'
import { projectCompletedSession } from '../src/features/math-drill/persistence/completedSessionProjection'
import type { CompletedSessionRecord } from '../src/features/math-drill/persistence/completedSessionTypes'

const API_KEY = 'reward-lifecycle-isolated-test-key'
const PARENT_PIN = '246810'
const running: Array<{ child: ChildProcess; dir: string }> = []

function makeCompletedRecord(instanceId: string): CompletedSessionRecord {
  const generated = generateSession({ level: 1, mode: 'addition', count: 1, seed: 41027, roundSize: 1 })
  if (!generated.ok) throw new Error(generated.error.code)
  const session = generated.session
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
  const question = session.questions[0]
  const scored = answerQuestion(base.score, session, question.key, question.correctChoiceIndex)
  if (!scored.ok) throw new Error(scored.error.code)
  const projected = projectCompletedSession({
    ...base,
    score: scored.state,
    cursor: { questionIndex: 0, phase: 'result', pendingAdvanceAt: null },
  } as never, { completedAt: 1000, recordedAt: 1000, provenance: 'new-atomic' })
  if (projected.status !== 'valid') throw new Error(projected.status)
  return projected.value
}

async function startIsolatedServer() {
  const dir = mkdtempSync(path.join(tmpdir(), 'math-adventure-reward-e2e-'))
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ apiKey: API_KEY, allowedOrigins: ['http://127.0.0.1'] }))
  const portProbe = await import('node:net').then(({ default: net }) => new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => port ? resolve(port) : reject(new Error('no free port')))
    })
  }))
  const child = spawn(process.execPath, ['server/api-server.js', '--port', String(portProbe), '--host', '127.0.0.1', '--data-dir', dir], {
    cwd: process.cwd(), stdio: 'ignore',
  })
  const url = `http://127.0.0.1:${portProbe}`
  running.push({ child, dir })
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try { if ((await fetch(`${url}/health`)).ok) return { dir, url } } catch { /* wait for startup */ }
    await new Promise(resolve => setTimeout(resolve, 75))
  }
  throw new Error('isolated API did not start')
}

afterEach(async () => {
  for (const { child, dir } of running.splice(0)) {
    if (!child.killed) child.kill()
    await new Promise(resolve => setTimeout(resolve, 100))
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Stage 7B isolated HTTP reward lifecycle', () => {
  it('earns, reserves, confirms, and snapshots a redemption without touching user storage', async () => {
    const server = await startIsolatedServer()
    const deviceHeaders = { 'X-API-KEY': API_KEY, 'Content-Type': 'application/json' }
    const setup = await fetch(`${server.url}/api/parent/setup`, {
      method: 'POST', headers: deviceHeaders,
      body: JSON.stringify({ pin: PARENT_PIN, confirmPin: PARENT_PIN }),
    })
    expect(setup.status).toBe(201)
    const { sessionToken } = await setup.json() as { sessionToken: string }
    const auth = { 'X-API-KEY': API_KEY, 'X-Parent-Session': sessionToken }

    const session = await fetch(`${server.url}/api/sessions`, {
      method: 'POST', headers: deviceHeaders,
      body: JSON.stringify(makeCompletedRecord('550e8400-e29b-41d4-a716-446655440001')),
    })
    expect(session.status).toBe(201)
    const stateBefore = await fetch(`${server.url}/api/reward/state`, { headers: auth }).then(r => r.json()) as any
    expect(stateBefore.balance.totalCollectibleStarsEarned).toBe(3)
    expect(stateBefore.balance.availableBalance).toBe(3)
    expect(stateBefore.balance.isLedgerConsistent).toBe(true)
    expect(stateBefore.completedSessionsCount).toBe(1)

    const unauthenticated = await fetch(`${server.url}/api/reward/transactions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: 'unauth-transaction', starsRedeemed: 1 }),
    })
    expect(unauthenticated.status).toBe(401)

    const config = await fetch(`${server.url}/api/reward/config`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ minStarsPerRedemption: 2, maxStarsPerRedemption: 3, rupiahPerStar: 700 }),
    })
    expect(config.status).toBe(200)

    const submit = (transactionId: string, starsRedeemed: number) => fetch(`${server.url}/api/reward/transactions`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId, starsRedeemed }),
    })
    expect((await submit('below-min', 1)).status).toBe(400)
    expect((await submit('above-max', 4)).status).toBe(400)
    expect((await submit('pending-main', 2)).status).toBe(200)
    expect((await submit('over-available', 2)).status).toBe(409)

    const pendingLedgerPath = path.join(server.dir, 'reward-ledger.json')
    const pendingLedger = JSON.parse(readFileSync(pendingLedgerPath, 'utf8'))
    expect(pendingLedger.transactions).toHaveLength(1)
    expect(pendingLedger.transactions[0]).toMatchObject({ status: 'pending', starsRedeemed: 2, rupiahValue: 1400 })
    // Age the isolated pending request by years: reads must not auto-expire it.
    pendingLedger.transactions[0].requestedAt = 1
    writeFileSync(pendingLedgerPath, JSON.stringify(pendingLedger))

    await fetch(`${server.url}/api/reward/config`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rupiahPerStar: 900 }),
    }).then(response => expect(response.status).toBe(200))
    const statePending = await fetch(`${server.url}/api/reward/state`, { headers: auth }).then(r => r.json()) as any
    expect(statePending.transactions[0]).toMatchObject({ status: 'pending', rupiahValue: 1400, requestedAt: 1 })
    expect(statePending.balance).toMatchObject({ availableBalance: 1, totalPendingStars: 2, isLedgerConsistent: true })

    const confirm = await fetch(`${server.url}/api/reward/transactions/pending-main/confirm`, { method: 'POST', headers: auth })
    expect(confirm.status).toBe(200)
    const stateConfirmed = await fetch(`${server.url}/api/reward/state`, { headers: auth }).then(r => r.json()) as any
    expect(stateConfirmed.transactions[0]).toMatchObject({ status: 'confirmed', starsRedeemed: 2, rupiahValue: 1400 })
    expect(stateConfirmed.balance).toMatchObject({ availableBalance: 1, totalConfirmedRedeemedStars: 2, totalPendingStars: 0, isLedgerConsistent: true })
    expect((await fetch(`${server.url}/api/reward/transactions/pending-main/cancel`, { method: 'POST', headers: auth })).status).toBe(409)

    const replay = await submit('pending-main', 2)
    expect(replay.status).toBe(200)
    const finalState = await fetch(`${server.url}/api/reward/state`, { headers: auth }).then(r => r.json()) as any
    expect(finalState.transactions).toHaveLength(1)
    expect(finalState.balance.rawAvailableBalance).toBe(1)
    expect(finalState.balance.isLedgerConsistent).toBe(true)
    expect(readFileSync(path.join(server.dir, 'sessions.json'), 'utf8')).toContain('550e8400-e29b-41d4-a716-446655440001')
  })

  it('serializes concurrent redemption requests so the same stars cannot be spent twice', async () => {
    const server = await startIsolatedServer()
    const deviceHeaders = { 'X-API-KEY': API_KEY, 'Content-Type': 'application/json' }
    const setup = await fetch(`${server.url}/api/parent/setup`, {
      method: 'POST', headers: deviceHeaders,
      body: JSON.stringify({ pin: PARENT_PIN, confirmPin: PARENT_PIN }),
    })
    const { sessionToken } = await setup.json() as { sessionToken: string }
    const auth = { ...deviceHeaders, 'X-Parent-Session': sessionToken }
    await fetch(`${server.url}/api/sessions`, {
      method: 'POST', headers: deviceHeaders,
      body: JSON.stringify(makeCompletedRecord('550e8400-e29b-41d4-a716-446655440002')),
    }).then(response => expect(response.status).toBe(201))
    const requests = await Promise.all(['race-a', 'race-b'].map(transactionId => fetch(`${server.url}/api/reward/transactions`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ transactionId, starsRedeemed: 2 }),
    })))
    expect(requests.map(response => response.status).sort()).toEqual([200, 409])
    const state = await fetch(`${server.url}/api/reward/state`, { headers: auth }).then(r => r.json()) as any
    expect(state.transactions).toHaveLength(1)
    expect(state.balance).toMatchObject({ availableBalance: 1, rawAvailableBalance: 1, isLedgerConsistent: true })
  })
})
