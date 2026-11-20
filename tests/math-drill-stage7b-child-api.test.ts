// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const key = 'isolated-child-key'
const pin = '135790'
const running: Array<{ process: ChildProcess; dir: string }> = []
const earned = {
  historySchemaVersion: 1, instanceId: '550e8400-e29b-41d4-a716-446655440301',
  sessionId: '550e8400-e29b-41d4-a716-446655440302', mode: 'regular', operationMode: 'addition',
  completedAt: 1000, recordedAt: 1001, provenance: 'new-atomic',
  outcomes: [{ level: 1, operation: 'addition', points: 1 }, { level: 1, operation: 'addition', points: 1 }, { level: 1, operation: 'addition', points: 1 }],
}
function port() { return new Promise<number>((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
  })
}) }
async function start() {
  const dir = mkdtempSync(path.join(tmpdir(), 'math-child-api-'))
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ apiKey: key, allowedOrigins: [] }))
  const apiPort = await port()
  const child = spawn(process.execPath, ['server/api-server.js', '--data-dir', dir, '--host', '127.0.0.1', '--port', String(apiPort)], { cwd: process.cwd(), stdio: 'ignore' })
  running.push({ process: child, dir })
  const url = `http://127.0.0.1:${apiPort}`
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${url}/health`)).ok) return { url, dir } } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 75))
  }
  throw new Error('isolated API failed to start')
}
afterEach(async () => {
  for (const item of running.splice(0)) {
    item.process.kill()
    await new Promise(resolve => setTimeout(resolve, 100))
    rmSync(item.dir, { recursive: true, force: true })
  }
})

describe('child reward routes through isolated backend', () => {
  it('restricts the summary and accepts only a server-authoritative pending request', async () => {
    const { url } = await start()
    const device = { 'X-API-KEY': key, 'Content-Type': 'application/json' }
    expect((await fetch(`${url}/api/reward/child-summary`)).status).toBe(401)
    expect((await fetch(`${url}/api/reward/state`, { headers: device })).status).toBe(401)
    expect((await fetch(`${url}/api/sessions`, { method: 'POST', headers: device, body: JSON.stringify(earned) })).status).toBe(201)
    const get = () => fetch(`${url}/api/reward/child-summary`, { headers: device })
    const initial = await get()
    expect(initial.status).toBe(200)
    expect(await initial.json()).toMatchObject({ totalEarned: 3, pendingStars: 0, confirmedStars: 0, availableStars: 3, rupiahPerStar: 500, minStarsPerRedemption: 1, maxStarsPerRedemption: 100, recentTransactions: [] })
    const submit = (body: object) => fetch(`${url}/api/reward/child-requests`, { method: 'POST', headers: device, body: JSON.stringify(body) })
    expect((await fetch(`${url}/api/reward/child-requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ starsRedeemed: 2, requestKey: 'a'.repeat(32) }) })).status).toBe(401)
    expect((await submit({ starsRedeemed: 2, requestKey: 'a'.repeat(32), status: 'confirmed' })).status).toBe(400)
    expect((await submit({ starsRedeemed: 0, requestKey: 'a'.repeat(32) })).status).toBe(400)
    const first = await submit({ starsRedeemed: 2, requestKey: 'a'.repeat(32), rupiahValue: 1 })
    expect(first.status).toBe(400)
    const accepted = await submit({ starsRedeemed: 2, requestKey: 'a'.repeat(32) })
    expect(accepted.status).toBe(201)
    const transaction = (await accepted.json()).transaction as { transactionId: string; status: string; rupiahValue: number; ruleSnapshot: { rupiahPerStar: number } }
    expect(transaction).toMatchObject({ status: 'pending', rupiahValue: 1000, ruleSnapshot: { rupiahPerStar: 500 } })
    expect(transaction.transactionId).toBeTruthy()
    const repeated = await submit({ starsRedeemed: 2, requestKey: 'a'.repeat(32) })
    expect(repeated.status).toBe(200)
    expect((await repeated.json()).transaction.transactionId).toBe(transaction.transactionId)
    expect((await submit({ starsRedeemed: 1, requestKey: 'a'.repeat(32) })).status).toBe(409)
    expect((await submit({ starsRedeemed: 2, requestKey: 'b'.repeat(32) })).status).toBe(409)
    const pending = await (await get()).json() as any
    expect(pending).toMatchObject({ totalEarned: 3, pendingStars: 2, confirmedStars: 0, availableStars: 1 })
    expect(pending.recentTransactions).toHaveLength(1)
    expect(Object.keys(pending).sort()).toEqual(['availableStars', 'confirmedStars', 'maxStarsPerRedemption', 'minStarsPerRedemption', 'pendingStars', 'recentTransactions', 'rupiahPerStar', 'totalEarned'].sort())
    expect(Object.keys(pending.recentTransactions[0]).sort()).toEqual(['starsRedeemed', 'rupiahValue', 'status', 'requestedAt'].sort())
    expect((await fetch(`${url}/api/reward/transactions/${transaction.transactionId}/confirm`, { method: 'POST', headers: device })).status).toBe(401)
    expect((await fetch(`${url}/api/reward/transactions/${transaction.transactionId}/cancel`, { method: 'POST', headers: device })).status).toBe(401)
    expect((await fetch(`${url}/api/reward/config`, { method: 'PUT', headers: device, body: '{}' })).status).toBe(401)
    expect((await fetch(`${url}/api/reward/corrections`, { method: 'POST', headers: device, body: '{}' })).status).toBe(401)
    const setup = await fetch(`${url}/api/parent/setup`, { method: 'POST', headers: device, body: JSON.stringify({ pin, confirmPin: pin }) })
    const token = (await setup.json()).sessionToken as string
    const parent = { ...device, 'X-Parent-Session': token }
    expect((await fetch(`${url}/api/reward/transactions/${transaction.transactionId}/confirm`, { method: 'POST', headers: parent })).status).toBe(200)
    const confirmed = await (await get()).json() as any
    expect(confirmed).toMatchObject({ totalEarned: 3, pendingStars: 0, confirmedStars: 2, availableStars: 1 })
    expect(confirmed.recentTransactions[0]).toMatchObject({ status: 'confirmed', rupiahValue: 1000 })
    expect((await fetch(`${url}/api/reward/transactions/${transaction.transactionId}/cancel`, { method: 'POST', headers: parent })).status).toBe(409)
  })

  it('serializes concurrent submissions and exposes at most five sanitized recent transactions', async () => {
    const { url } = await start()
    const headers = { 'X-API-KEY': key, 'Content-Type': 'application/json' }
    for (let index = 0; index < 7; index++) {
      const record = { ...earned, instanceId: `550e8400-e29b-41d4-a716-44665544031${index}`, sessionId: `550e8400-e29b-41d4-a716-44665544032${index}` }
      expect((await fetch(`${url}/api/sessions`, { method: 'POST', headers, body: JSON.stringify(record) })).status).toBe(201)
    }
    const submit = (index: number, stars: number) => fetch(`${url}/api/reward/child-requests`, { method: 'POST', headers, body: JSON.stringify({ requestKey: String(index).padStart(32, '0'), starsRedeemed: stars }) })
    expect((await Promise.all([submit(1, 12), submit(2, 12)])).map(r => r.status).sort()).toEqual([201, 409])
    for (let index = 3; index <= 8; index++) expect((await submit(index, 1)).status).toBe(201)
    const summary = await (await fetch(`${url}/api/reward/child-summary`, { headers })).json() as any
    expect(summary.availableStars).toBe(3)
    expect(summary.recentTransactions).toHaveLength(5)
    expect(summary.recentTransactions.every((item: object) => !('transactionId' in item) && !('ruleSnapshot' in item))).toBe(true)
  })
})
