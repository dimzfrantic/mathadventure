import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerQuestion, createScoreState, generateChallengeSession, generateSession } from '../src/features/math-drill/domain'
import { projectCompletedSession } from '../src/features/math-drill/persistence/completedSessionProjection'
import { createIndexedDbSessionStore, SESSION_DATABASE_VERSION, UNIFIED_DATABASE_VERSION } from '../src/features/math-drill/persistence/indexedDbSessionStore'
import { createUnifiedIndexedDbSessionStore } from '../src/features/math-drill/persistence/completedSessionHistoryStore'
import type { CompletedSessionRecordV1 } from '../src/features/math-drill/persistence/completedSessionTypes'
import type { SavedSessionV1 } from '../src/features/math-drill/persistence/sessionTypes'

const factory = typeof indexedDB === 'undefined' ? null : indexedDB
const databaseNames: string[] = []
const stores: Array<{ close(): void }> = []
let sequence = 0
const instanceId = '550e8400-e29b-41d4-a716-446655440000'

function databaseName() {
  const name = `math-adventure-stage5b2c-integrity-${Date.now()}-${++sequence}`
  databaseNames.push(name)
  return name
}

function fixtures(seed = 811, id = instanceId) {
  const generated = generateSession({ level: 1, mode: 'addition', count: 1, seed, roundSize: 1 })
  if (!generated.ok) throw new Error(generated.error.code)
  const session = generated.session
  const question = session.questions[0]
  const base: SavedSessionV1 = {
    schemaVersion: 1,
    mode: 'regular',
    instanceId: id,
    sessionId: session.id,
    revision: 1,
    createdAt: 1,
    updatedAt: 2,
    session,
    score: createScoreState(session),
    cursor: { questionIndex: 0, phase: 'answering', pendingAdvanceAt: null },
  }
  const answer = (indices: readonly number[]) => {
    let score = base.score
    for (const index of indices) {
      const result = answerQuestion(score, session, question.key, index)
      if (!result.ok) throw new Error(result.error.code)
      score = result.state
    }
    return score
  }
  const resultSnapshot = (score: SavedSessionV1['score']): SavedSessionV1 => ({
    ...base,
    score,
    cursor: { questionIndex: 0, phase: 'result', pendingAdvanceAt: null },
  })
  const correct = resultSnapshot(answer([question.correctChoiceIndex]))
  const wrongChoices = question.choices.map((_value, index) => index).filter(index => index !== question.correctChoiceIndex)
  const wrong = resultSnapshot(answer(wrongChoices.slice(0, 2)))
  const projected = projectCompletedSession(correct, { completedAt: 3, recordedAt: 3, provenance: 'new-atomic' })
  if (projected.status !== 'valid') throw new Error(projected.status)
  return { base, correct, wrong, history: projected.value as CompletedSessionRecordV1 }
}

function challengeSnapshots(seed = 821) {
  const generated = generateChallengeSession({ selectedLevels: [1], selectedLevel5Sublevels: [], mode: 'mixed', count: 10, seed, roundSize: 2 })
  if (!generated.ok) throw new Error(generated.error.code)
  const session = generated.session
  const base: SavedSessionV1 = {
    schemaVersion: 1,
    mode: 'challenge',
    instanceId: '650e8400-e29b-41d4-a716-446655440000',
    sessionId: session.id,
    revision: 1,
    createdAt: 4,
    updatedAt: 5,
    session,
    score: createScoreState(session),
    cursor: { questionIndex: 0, phase: 'answering', pendingAdvanceAt: null },
  }
  let score = base.score
  for (const question of session.questions) {
    const answer = answerQuestion(score, session, question.key, question.correctChoiceIndex)
    if (!answer.ok) throw new Error(answer.error.code)
    score = answer.state
  }
  const result: SavedSessionV1 = {
    ...base,
    score,
    cursor: { questionIndex: session.questions.length - 1, phase: 'result', pendingAdvanceAt: null },
  }
  return { base, result }
}

async function createVersion1Database(name: string, snapshots: readonly SavedSessionV1[]) {
  if (!factory) throw new Error('Native IndexedDB is unavailable')
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('activeSessions', { keyPath: 'mode' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('activeSessions', 'readwrite')
    for (const snapshot of snapshots) tx.objectStore('activeSessions').put(snapshot)
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  db.close()
}

function adapter(name = databaseName()) {
  const store = createUnifiedIndexedDbSessionStore({ databaseName: name, indexedDB: factory })
  stores.push(store)
  return { name, store }
}

async function rawDatabase(name: string): Promise<IDBDatabase> {
  if (!factory) throw new Error('Native IndexedDB is unavailable')
  return new Promise((resolve, reject) => {
    const request = factory.open(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function putActive(name: string, snapshot: SavedSessionV1) {
  const db = await rawDatabase(name)
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('activeSessions', 'readwrite')
    tx.objectStore('activeSessions').put(snapshot)
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  db.close()
}

async function readActive(name: string, mode: string): Promise<unknown> {
  const db = await rawDatabase(name)
  const result = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction('activeSessions', 'readonly')
    const request = tx.objectStore('activeSessions').get(mode)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return result
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  if (!factory) return
  for (const name of databaseNames.splice(0)) await new Promise<void>(resolve => {
    const request = factory.deleteDatabase(name)
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })
})

describe('Stage 5B.2C database safety boundary', () => {
  it('refuses the live database through every unified v2 entry point', async () => {
    const open = vi.fn()
    const fakeFactory = { open } as unknown as IDBFactory
    const store = createUnifiedIndexedDbSessionStore({ databaseName: 'math-adventure', indexedDB: fakeFactory })
    expect(await store.open()).toMatchObject({ status: 'storage-error', code: 'unsafe-database-name' })
    expect(await store.load('regular')).toMatchObject({ status: 'storage-error', code: 'unsafe-database-name' })
    expect(open).not.toHaveBeenCalled()
    store.close()
  })

  it('distinguishes invalid snapshots from invalid history before opening storage', async () => {
    const { base, correct, history } = fixtures()
    const store = createUnifiedIndexedDbSessionStore({ databaseName: databaseName(), indexedDB: null })
    const expected = { instanceId, sessionId: base.sessionId, revision: 1 }
    expect(await store.commitResult(base, expected, history)).toEqual({ status: 'invalid-snapshot' })
    expect(await store.commitResult(correct, expected, { ...history, outcomes: 'corrupt' })).toEqual({ status: 'invalid-history' })
    expect(await store.verifyCommitted(base, history)).toEqual({ status: 'invalid-snapshot' })
    expect(await store.verifyCommitted(correct, { ...history, outcomes: 'corrupt' })).toEqual({ status: 'invalid-history' })
    const future = { ...correct, schemaVersion: 3 }
    expect(await store.commitResult(future, expected, history)).toEqual({ status: 'unsupported-snapshot-version', version: 3, versionKind: 'schema' })
    expect(await store.verifyCommitted(future, history)).toEqual({ status: 'unsupported-snapshot-version', versionKind: 'schema', version: 3 })
    store.close()
  })

  it('keeps the default application factory on v1 while the explicit unified provider is v2', async () => {
    expect(SESSION_DATABASE_VERSION).toBe(1)
    expect(UNIFIED_DATABASE_VERSION).toBe(2)
    if (!factory) return
    const name = databaseName()
    const store = createIndexedDbSessionStore({ databaseName: name, indexedDB: factory })
    stores.push(store)
    expect(await store.load('regular')).toEqual({ status: 'empty' })
    const db = await rawDatabase(name)
    expect(db.version).toBe(1)
    expect([...db.objectStoreNames]).toEqual(['activeSessions'])
    db.close()
  })
})

describe.skipIf(!factory)('Stage 5B.2C completion integrity on native IndexedDB', () => {
  it('creates one fresh v2 schema and preserves Stage 3 active-session CAS behavior', async () => {
    const { name, store } = adapter()
    expect(await store.open()).toEqual({ status: 'opened' })
    expect(await store.open()).toEqual({ status: 'opened' })
    const db = await rawDatabase(name)
    expect(db.version).toBe(UNIFIED_DATABASE_VERSION)
    expect([...db.objectStoreNames].sort()).toEqual(['activeSessions', 'completedSessions'])
    const active = db.transaction('activeSessions', 'readonly').objectStore('activeSessions')
    const history = db.transaction('completedSessions', 'readonly').objectStore('completedSessions')
    expect(active.keyPath).toBe('mode')
    expect(history.keyPath).toBe('instanceId')
    expect(history.index('recordedAt')).toMatchObject({ keyPath: 'recordedAt', unique: false })
    expect(history.index('sessionId')).toMatchObject({ keyPath: 'sessionId', unique: false })
    db.close()

    const { revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = fixtures().base
    const created = await store.create(draft)
    expect(created).toMatchObject({ status: 'success', value: { revision: 1 } })
    if (created.status !== 'success') return
    expect(await store.save(created.value, { instanceId, sessionId: created.value.sessionId, revision: 1 })).toMatchObject({ status: 'success', value: { revision: 2 } })
  })

  it('upgrades v1 additively and preserves both mode slots without history backfill', async () => {
    const running = fixtures()
    const challenge = challengeSnapshots()
    const activeName = databaseName()
    await createVersion1Database(activeName, [running.base, challenge.base])
    const activeStore = adapter(activeName).store
    expect(await activeStore.open()).toEqual({ status: 'opened' })
    expect(await activeStore.load('regular')).toEqual({ status: 'valid', value: running.base })
    expect(await activeStore.load('challenge')).toEqual({ status: 'valid', value: challenge.base })
    expect(await activeStore.list()).toMatchObject({ status: 'success', records: [], invalidCount: 0 })
    activeStore.close()
    stores.splice(stores.indexOf(activeStore), 1)

    const resultsName = databaseName()
    await createVersion1Database(resultsName, [running.correct, challenge.result])
    const resultStore = adapter(resultsName).store
    expect(await resultStore.open()).toEqual({ status: 'opened' })
    expect(await resultStore.load('regular')).toEqual({ status: 'valid', value: running.correct })
    expect(await resultStore.load('challenge')).toEqual({ status: 'valid', value: challenge.result })
    expect(await resultStore.list()).toMatchObject({ status: 'success', records: [], invalidCount: 0 })
  })

  it('commits result and history together, verifies readback, and preserves first timestamps on retry', async () => {
    const { base, correct, history } = fixtures()
    const { name, store } = adapter()
    expect(await store.open()).toEqual({ status: 'opened' })
    await putActive(name, base)
    expect(await store.verifyCommitted(correct, history)).toEqual({ status: 'not-committed' })
    expect(await store.commitResult(correct, { instanceId, sessionId: base.sessionId, revision: 1 }, history)).toMatchObject({ status: 'inserted', value: history, snapshot: { revision: 2, cursor: correct.cursor } })
    expect(await store.load('regular')).toMatchObject({ status: 'valid', value: { revision: 2, cursor: { phase: 'result' } } })
    expect(await store.get(history.instanceId)).toEqual({ status: 'found', value: history })
    expect(await store.verifyCommitted(correct, history)).toEqual({ status: 'committed' })
    expect(await store.commitResult(correct, { instanceId, sessionId: base.sessionId, revision: 1 }, { ...history, recordedAt: 99 })).toMatchObject({ status: 'already-exists-equivalent', value: history, snapshot: { revision: 2, cursor: correct.cursor } })
    expect(await store.get(history.instanceId)).toEqual({ status: 'found', value: history })
  })

  it('rolls back an active-store write when a history add request aborts the shared transaction', async () => {
    const { base, correct, history } = fixtures()
    const { name, store } = adapter()
    expect(await store.open()).toEqual({ status: 'opened' })
    await putActive(name, base)
    expect(await store.insert(history)).toMatchObject({ status: 'inserted' })
    const db = await rawDatabase(name)
    const result = await new Promise<'aborted' | 'completed'>(resolve => {
      const tx = db.transaction(['activeSessions', 'completedSessions'], 'readwrite')
      tx.objectStore('activeSessions').put(correct)
      tx.objectStore('completedSessions').add(history)
      tx.oncomplete = () => resolve('completed')
      tx.onabort = () => resolve('aborted')
      tx.onerror = () => undefined
    })
    db.close()
    expect(result).toBe('aborted')
    expect(await readActive(name, 'regular')).toEqual(base)
    expect(await store.get(history.instanceId)).toEqual({ status: 'found', value: history })
  })

  it('reports a blocked upgrade, then opens after the disposable v1 connection closes', async () => {
    const name = databaseName()
    await createVersion1Database(name, [])
    const blocker = await rawDatabase(name)
    const store = adapter(name).store
    expect(await store.open()).toMatchObject({ status: 'storage-error', code: 'blocked' })
    blocker.close()
    expect(await store.open()).toEqual({ status: 'opened' })
  })

  it('closes on versionchange and refuses a higher database version without fallback', async () => {
    const { name, store } = adapter()
    expect(await store.open()).toEqual({ status: 'opened' })
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory!.open(name, UNIFIED_DATABASE_VERSION + 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    expect(await store.load('regular')).toMatchObject({ status: 'storage-error', code: 'unsupported-database-version' })
  })

  it('rejects an incompatible v1 key path and leaves the database at version 1', async () => {
    const name = databaseName()
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory!.open(name, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('activeSessions', { keyPath: 'wrong' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    const store = adapter(name).store
    expect(await store.open()).toMatchObject({ status: 'storage-error', code: 'incompatible-database' })
    const unchanged = await rawDatabase(name)
    expect(unchanged.version).toBe(1)
    expect(unchanged.transaction('activeSessions', 'readonly').objectStore('activeSessions').keyPath).toBe('wrong')
    unchanged.close()
  })

  it('rejects malformed v2 indexes during open-time schema validation', async () => {
    const name = databaseName()
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory!.open(name, UNIFIED_DATABASE_VERSION)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('activeSessions', { keyPath: 'mode' })
        const history = request.result.createObjectStore('completedSessions', { keyPath: 'instanceId' })
        history.createIndex('recordedAt', 'wrongKeyPath', { unique: false })
        history.createIndex('sessionId', 'sessionId', { unique: true })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    const store = adapter(name).store
    expect(await store.open()).toMatchObject({ status: 'storage-error', code: 'incompatible-database' })
    const unchanged = await rawDatabase(name)
    const history = unchanged.transaction('completedSessions', 'readonly').objectStore('completedSessions')
    expect(history.index('recordedAt').keyPath).toBe('wrongKeyPath')
    expect(history.index('sessionId').unique).toBe(true)
    unchanged.close()
  })

  it('rejects a result snapshot whose revision differs from the expected durable revision', async () => {
    const { base, correct, history } = fixtures()
    const { name, store } = adapter()
    expect((await store.open()).status).toBe('opened')
    await putActive(name, base)

    const result = await store.commitResult({ ...correct, revision: 2 }, { instanceId, sessionId: base.sessionId, revision: 1 }, history)

    expect(result).toEqual({ status: 'active-session-conflict' })
    expect(await readActive(name, 'regular')).toEqual(base)
    expect(await store.get(history.instanceId)).toEqual({ status: 'not-found' })
  })

  it('rejects when the durable active revision advanced before the completion transaction', async () => {
    const { base, correct, history } = fixtures()
    const { name, store } = adapter()
    expect((await store.open()).status).toBe('opened')
    const advanced = { ...base, revision: 2, updatedAt: 3 }
    await putActive(name, advanced)

    const result = await store.commitResult(correct, { instanceId, sessionId: base.sessionId, revision: 1 }, history)

    expect(result).toEqual({ status: 'active-session-conflict' })
    expect(await readActive(name, 'regular')).toEqual(advanced)
    expect(await store.get(history.instanceId)).toEqual({ status: 'not-found' })
  })

  it('rejects an existing history retry when active result outcomes differ', async () => {
    const { base, correct, wrong, history } = fixtures()
    const { name, store } = adapter()
    expect((await store.open()).status).toBe('opened')
    expect((await store.insert(history)).status).toBe('inserted')
    await putActive(name, wrong)

    const result = await store.commitResult(correct, { instanceId, sessionId: base.sessionId, revision: 1 }, history)

    expect(result).toEqual({ status: 'conflict' })
    expect(await readActive(name, 'regular')).toEqual(wrong)
    expect(await store.get(history.instanceId)).toEqual({ status: 'found', value: history })
  })

  it.each([
    { label: 'another instance', id: '650e8400-e29b-41d4-a716-446655440000', seed: 811 },
    { label: 'another session', id: instanceId, seed: 812 },
  ])('does not verify a completion when the active slot points to $label', async ({ id, seed }) => {
    const intended = fixtures()
    const current = fixtures(seed, id)
    const { name, store } = adapter()
    expect((await store.open()).status).toBe('opened')
    expect((await store.insert(intended.history)).status).toBe('inserted')
    await putActive(name, current.correct)

    expect(await store.verifyCommitted(intended.correct, intended.history)).toEqual({ status: 'conflict' })
  })
})
