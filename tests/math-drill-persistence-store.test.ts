import { afterEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createScoreState, generateChallengeSession, generateSession } from '../src/features/math-drill/domain'
import type { SavedSessionDraft, SessionExpectation } from '../src/features/math-drill/persistence/indexedDbSessionStore'
import { createIndexedDbSessionStore } from '../src/features/math-drill/persistence/indexedDbSessionStore'

// Minimal in-memory IDBFactory injected via the store's existing options API.
// Keeps the suite hermetic (no live/real IndexedDB database is opened or modified).
const factory = new IDBFactory()
const regularInstance = '550e8400-e29b-41d4-a716-446655440000'
const secondInstance = '550e8400-e29b-41d4-a716-446655440001'
let sequence = 0
const openedStores: ReturnType<typeof createIndexedDbSessionStore>[] = []
const databaseNames: string[] = []

function databaseName() {
  sequence += 1
  const name = `math-adventure-store-test-${Date.now()}-${sequence}`
  databaseNames.push(name)
  return name
}

function makeDraft(mode: 'regular' | 'challenge', instanceId = regularInstance): SavedSessionDraft {
  const generated = mode === 'regular'
    ? generateSession({ level: 1, mode: 'addition', count: 2, seed: 101, roundSize: 1 })
    : generateChallengeSession({ selectedLevels: [1], selectedLevel5Sublevels: [], mode: 'mixed', count: 10, seed: 102, roundSize: 2 })
  if (!generated.ok) throw new Error(`Fixture generation failed: ${generated.error.code}`)
  return {
    schemaVersion: 1,
    mode,
    instanceId,
    sessionId: generated.session.id,
    session: generated.session,
    score: createScoreState(generated.session),
    cursor: { questionIndex: 0, phase: 'answering', pendingAdvanceAt: null },
  }
}

function store() {
  const instance = createIndexedDbSessionStore({ databaseName: databaseName(), indexedDB: factory })
  openedStores.push(instance)
  return instance
}

function expected(value: { instanceId: string; sessionId: string; revision: number }): SessionExpectation {
  return { instanceId: value.instanceId, sessionId: value.sessionId, revision: value.revision }
}

async function openRaw(name: string) {
  if (!factory) throw new Error('Native IndexedDB is unavailable in this test environment')
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('activeSessions')) request.result.createObjectStore('activeSessions', { keyPath: 'mode' })
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

async function rawPut(name: string, value: unknown) {
  const db = await openRaw(name)
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('activeSessions', 'readwrite')
    transaction.objectStore('activeSessions').put(value)
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
  db.close()
}

async function rawGet(name: string, mode: string): Promise<unknown> {
  const db = await openRaw(name)
  const result = await new Promise<unknown>((resolve, reject) => {
    const transaction = db.transaction('activeSessions', 'readonly')
    const request = transaction.objectStore('activeSessions').get(mode)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return result
}

async function deleteDatabase(name: string) {
  if (!factory) return
  await new Promise<void>(resolve => {
    const request = factory.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

afterEach(async () => {
  for (const item of openedStores.splice(0)) item.close()
  for (const name of databaseNames.splice(0)) await deleteDatabase(name)
})

describe('IndexedDB session store preflight', () => {
  it('reports unavailable storage distinctly', async () => {
    const unavailable = createIndexedDbSessionStore({ indexedDB: null, databaseName: databaseName() })
    expect(await unavailable.load('regular')).toMatchObject({ status: 'storage-error', code: 'unavailable' })
    unavailable.close()
  })

  it('rejects an invalid snapshot before trying to open storage', async () => {
    const invalid = { ...makeDraft('regular'), instanceId: 'invalid' } as SavedSessionDraft
    const unavailable = createIndexedDbSessionStore({ indexedDB: null, databaseName: databaseName() })
    expect(await unavailable.create(invalid)).toMatchObject({ status: 'corrupt' })
    unavailable.close()
  })
})

const nativeDescribe = describe.skipIf(!factory)

nativeDescribe('IndexedDB session store with native IndexedDB', () => {
  it('loads empty slots, creates both modes, and round-trips exact session and score', async () => {
    const adapter = store()
    expect(await adapter.load('regular')).toEqual({ status: 'empty' })
    const regular = await adapter.create(makeDraft('regular'))
    const challenge = await adapter.create(makeDraft('challenge', secondInstance))
    expect(regular.status).toBe('success')
    expect(challenge.status).toBe('success')
    if (regular.status !== 'success' || challenge.status !== 'success') return
    expect(regular.value).toMatchObject({ mode: 'regular', revision: 1 })
    expect(challenge.value).toMatchObject({ mode: 'challenge', revision: 1 })
    expect((await adapter.load('regular'))).toMatchObject({ status: 'valid', value: regular.value })
    expect((await adapter.load('challenge'))).toMatchObject({ status: 'valid', value: challenge.value })
    expect(regular.value.session).toEqual((await adapter.load('regular')).status === 'valid' ? (await adapter.load('regular')).value.session : null)
    expect(regular.value.score).toEqual((await adapter.load('regular')).status === 'valid' ? (await adapter.load('regular')).value.score : null)
  })

  it('does not let create overwrite a populated slot', async () => {
    const adapter = store()
    const created = await adapter.create(makeDraft('regular'))
    expect(created.status).toBe('success')
    expect(await adapter.create(makeDraft('regular', secondInstance))).toMatchObject({ status: 'conflict' })
    expect(await adapter.load('regular')).toMatchObject({ status: 'valid', value: created.status === 'success' ? created.value : undefined })
  })

  it('saves only the expected instance and revision, incrementing exactly once', async () => {
    const adapter = store()
    const created = await adapter.create(makeDraft('regular'))
    if (created.status !== 'success') throw new Error('Create fixture did not succeed')
    const saved = await adapter.save(created.value, expected(created.value))
    expect(saved).toMatchObject({ status: 'success', value: { revision: 2 } })
    expect(await adapter.save(created.value, expected(created.value))).toMatchObject({ status: 'conflict' })
    const wrongInstance = { ...created.value, instanceId: secondInstance }
    expect(await adapter.save(wrongInstance, expected(created.value))).toMatchObject({ status: 'conflict' })
  })

  it('replaces only the expected stored instance and retains monotonic slot revision', async () => {
    const adapter = store()
    const created = await adapter.create(makeDraft('regular'))
    if (created.status !== 'success') throw new Error('Create fixture did not succeed')
    const replacementDraft = makeDraft('regular', secondInstance)
    const replaced = await adapter.replace(replacementDraft, expected(created.value))
    expect(replaced).toMatchObject({ status: 'success', value: { instanceId: secondInstance, revision: 2 } })
    expect(await adapter.replace(makeDraft('regular', regularInstance), expected(created.value))).toMatchObject({ status: 'conflict' })
    expect(await adapter.load('regular')).toMatchObject({ status: 'valid', value: replaced.status === 'success' ? replaced.value : undefined })
  })

  it('preserves a record when replace uses stale expectations', async () => {
    const adapter = store()
    const created = await adapter.create(makeDraft('regular'))
    if (created.status !== 'success') throw new Error('Create fixture did not succeed')
    await adapter.save(created.value, expected(created.value))
    expect(await adapter.replace(makeDraft('regular', secondInstance), expected(created.value))).toMatchObject({ status: 'conflict' })
    const loaded = await adapter.load('regular')
    expect(loaded).toMatchObject({ status: 'valid', value: { instanceId: regularInstance, revision: 2 } })
  })

  it('does not remove corrupt or unsupported records while loading', async () => {
    const name = databaseName()
    const adapter = createIndexedDbSessionStore({ databaseName: name, indexedDB: factory })
    openedStores.push(adapter)
    const unsupported = { ...makeDraft('regular'), schemaVersion: 99, revision: 1, createdAt: 10, updatedAt: 10 }
    await rawPut(name, unsupported)
    expect(await adapter.load('regular')).toMatchObject({ status: 'unsupported-version' })
    expect(await adapter.create(makeDraft('regular', secondInstance))).toMatchObject({ status: 'unsupported-version' })
    expect(await adapter.replace(makeDraft('regular', secondInstance), {
      instanceId: regularInstance,
      sessionId: unsupported.sessionId,
      revision: 1,
    })).toMatchObject({ status: 'unsupported-version' })
    expect(await rawGet(name, 'regular')).toEqual(unsupported)

    await deleteDatabase(name)
    databaseNames.splice(databaseNames.indexOf(name), 1)
    const corruptName = databaseName()
    const corruptAdapter = createIndexedDbSessionStore({ databaseName: corruptName, indexedDB: factory })
    openedStores.push(corruptAdapter)
    const corrupt = { ...makeDraft('regular'), revision: -1, createdAt: 10, updatedAt: 10 }
    await rawPut(corruptName, corrupt)
    expect(await corruptAdapter.load('regular')).toMatchObject({ status: 'corrupt' })
    expect(await corruptAdapter.create(makeDraft('regular', secondInstance))).toMatchObject({ status: 'corrupt' })
    expect(await rawGet(corruptName, 'regular')).toEqual(corrupt)
  })

  it('allows only one of concurrent creates and same-revision saves to commit', async () => {
    const name = databaseName()
    const first = createIndexedDbSessionStore({ databaseName: name, indexedDB: factory })
    const second = createIndexedDbSessionStore({ databaseName: name, indexedDB: factory })
    openedStores.push(first, second)
    const [leftCreate, rightCreate] = await Promise.all([
      first.create(makeDraft('regular', regularInstance)),
      second.create(makeDraft('regular', secondInstance)),
    ])
    expect([leftCreate.status, rightCreate.status].filter(status => status === 'success')).toHaveLength(1)
    expect([leftCreate.status, rightCreate.status].filter(status => status === 'conflict')).toHaveLength(1)
    const winner = leftCreate.status === 'success' ? leftCreate.value : rightCreate.status === 'success' ? rightCreate.value : null
    if (!winner) throw new Error('Concurrent create had no winner')
    const [leftSave, rightSave] = await Promise.all([
      first.save(winner, expected(winner)),
      second.save(winner, expected(winner)),
    ])
    expect([leftSave.status, rightSave.status].filter(status => status === 'success')).toHaveLength(1)
    expect([leftSave.status, rightSave.status].filter(status => status === 'conflict')).toHaveLength(1)
    expect(await first.load('regular')).toMatchObject({ status: 'valid', value: { revision: 2 } })
  })
})
