import { afterEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { answerQuestion, createScoreState, generateSession } from '../src/features/math-drill/domain'
import { projectCompletedSession } from '../src/features/math-drill/persistence/completedSessionProjection'
import { createCompletedSessionHistoryStore } from '../src/features/math-drill/persistence/completedSessionHistoryStore'
import type { CompletedSessionRecordV1 } from '../src/features/math-drill/persistence/completedSessionTypes'

// Minimal in-memory IDBFactory injected via the store's existing options API.
const nativeFactory = new IDBFactory()
const names: string[] = []
const stores: ReturnType<typeof createCompletedSessionHistoryStore>[] = []
let id = 0
function name() { const value = `math-adventure-stage5b2c-history-${Date.now()}-${++id}`; names.push(value); return value }
function record(instanceId = '550e8400-e29b-41d4-a716-446655440000'): CompletedSessionRecordV1 {
  const result = generateSession({ level: 1, mode: 'addition', count: 1, seed: 201, roundSize: 1 })
  if (!result.ok) throw new Error(result.error.code)
  const question = result.session.questions[0]
  const score = createScoreState(result.session)
  const snapshot = { schemaVersion: 1 as const, mode: 'regular' as const, instanceId, sessionId: result.session.id,
    revision: 1, createdAt: 1, updatedAt: 2, session: result.session, score,
    cursor: { questionIndex: 0, phase: 'answering' as const, pendingAdvanceAt: null } }
  // Build a validated result using the actual domain scoring transition.
  const answered = answerQuestion(score, result.session, question.key, question.correctChoiceIndex)
  if (!answered.ok) throw new Error(answered.error.code)
  const completed = { ...snapshot, score: answered.state,
    cursor: { questionIndex: 0, phase: 'result' as const, pendingAdvanceAt: null } }
  const projected = projectCompletedSession(completed, { completedAt: 3, recordedAt: 3, provenance: 'new-atomic' })
  if (projected.status !== 'valid') throw new Error(projected.status)
  return projected.value
}
function adapter(db = name()) { const value = createCompletedSessionHistoryStore({ databaseName: db, indexedDB: nativeFactory }); stores.push(value); return value }
async function cleanup() {
  for (const item of stores.splice(0)) item.close()
  if (!nativeFactory) return
  for (const dbName of names.splice(0)) await new Promise<void>(resolve => {
    const request = nativeFactory.deleteDatabase(dbName)
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })
}
afterEach(cleanup)

describe('completed-session history storage preflight', () => {
  it('rejects an unsafe live database name and reports unavailable storage', async () => {
    expect(await createCompletedSessionHistoryStore({ databaseName: 'math-adventure', indexedDB: null }).list()).toMatchObject({ status: 'storage-error', code: 'unsafe-database-name' })
    expect(await createCompletedSessionHistoryStore({ databaseName: name(), indexedDB: null }).list()).toMatchObject({ status: 'storage-error', code: 'unavailable' })
    const unavailable = createCompletedSessionHistoryStore({ databaseName: name(), indexedDB: null })
    const valid = record()
    expect(await unavailable.insert({ ...valid, instanceId: 'invalid' })).toMatchObject({ status: 'invalid-record' })
    expect(await unavailable.insert({ ...valid, historySchemaVersion: 3 })).toMatchObject({ status: 'unsupported-version', version: 3 })
  })
})

describe.skipIf(!nativeFactory)('completed-session history with native IndexedDB', () => {
  it('inserts, reads, lists, and preserves the first equivalent record across reopen', async () => {
    const db = name()
    const first = adapter(db)
    const value = record()
    expect(await first.insert(value)).toMatchObject({ status: 'inserted' })
    expect(await first.get(value.instanceId)).toEqual({ status: 'found', value })
    expect((await first.list()).status).toBe('success')
    first.close()
    stores.pop()
    const reopened = adapter(db)
    const retry = { ...value, recordedAt: 99 }
    expect(await reopened.insert(retry)).toEqual({ status: 'already-exists-equivalent', value })
    expect(await reopened.get(value.instanceId)).toEqual({ status: 'found', value })
  })

  it('rejects conflicts and invalid records without replacing existing content', async () => {
    const store = adapter()
    const existing = record()
    expect(await store.insert(existing)).toMatchObject({ status: 'inserted' })
    expect(await store.insert({ ...existing, outcomes: [{ ...existing.outcomes[0], points: 0 }] })).toMatchObject({ status: 'conflict' })
    expect(await store.insert({ ...existing, instanceId: 'invalid' })).toMatchObject({ status: 'invalid-record' })
    expect(await store.get(existing.instanceId)).toEqual({ status: 'found', value: existing })
  })

  it('keeps separate instances that share a sessionId and returns stable ordered lists', async () => {
    const store = adapter()
    const first = record('550e8400-e29b-41d4-a716-446655440000')
    const second = { ...record('550e8400-e29b-41d4-a716-446655440001'), recordedAt: 4 }
    expect(second.sessionId).toBe(first.sessionId)
    expect((await store.insert(second)).status).toBe('inserted')
    expect((await store.insert(first)).status).toBe('inserted')
    const listed = await store.list({ limit: 1 })
    expect(listed.status).toBe('success')
    if (listed.status === 'success') {
      expect(listed.records).toHaveLength(1)
      expect(listed.nextCursor).toBeDefined()
      expect(listed.records[0].instanceId).toBe(first.instanceId)
    }
  })

  it('classifies malformed stored bytes and fails closed without overwriting them', async () => {
    const dbName = name()
    const store = adapter(dbName)
    await store.open()
    const rawDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = nativeFactory!.open(dbName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = rawDb.transaction('completedSessions', 'readwrite')
      tx.objectStore('completedSessions').put({ ...record(), outcomes: 'corrupt' })
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error)
    })
    rawDb.close()
    // A new candidate that never existed: invalid input must be rejected as invalid-record,
    // not 'corrupt-existing' (that status is reserved for bytes already stored).
    const malformed = { ...record(), outcomes: [] }
    expect(await store.insert(malformed)).toMatchObject({ status: 'invalid-record' })
    // get() still finds the corrupt bytes previously stored under this same instanceId
    expect(await store.get(malformed.instanceId)).toMatchObject({ status: 'corrupt-existing' })
  })

  it('serializes equivalent and conflicting concurrent inserts across connections', async () => {
    const db = name()
    const left = adapter(db), right = adapter(db)
    const base = record()
    const [a, b] = await Promise.all([left.insert(base), right.insert({ ...base, recordedAt: 40 })])
    expect([a.status, b.status].sort()).toEqual(['already-exists-equivalent', 'inserted'])
    const otherIdConflict = { ...base, outcomes: [{ ...base.outcomes[0], points: 0 }] }
    const [c, d] = await Promise.all([left.insert(otherIdConflict), right.insert({ ...base, outcomes: [{ ...base.outcomes[0], points: 0.5 }] })])
    expect([c.status, d.status].sort()).toEqual(['conflict', 'conflict'])
    expect(await left.get(base.instanceId)).toMatchObject({ status: 'found', value: base })
  })
})
