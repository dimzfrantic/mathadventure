import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerQuestion, createScoreState, generateSession } from '../src/features/math-drill/domain'
import { createSessionController } from '../src/features/math-drill/persistence/sessionController'
import { createUnifiedIndexedDbSessionStore } from '../src/features/math-drill/persistence/completedSessionHistoryStore'
import { selectMathDrillPersistence } from '../src/features/math-drill/persistence/historyActivation'
import {
  PENDING_UPLOAD_STORAGE_KEY,
  createSessionUploadQueue,
  withBackendSessionRecording,
} from '../src/features/math-drill/persistence/backendSessionRecorder'
import type { PendingUploadStorage } from '../src/features/math-drill/persistence/backendSessionRecorder'
import { validateCompletedSession } from '../src/features/math-drill/persistence/completedSessionCodec'
import { projectCompletedSession } from '../src/features/math-drill/persistence/completedSessionProjection'
import { computeAvailableBalance } from '../src/features/math-drill/reward/redemption/balanceComputation'
import type { RecordSessionOutcome } from '../src/features/math-drill/api/sessionApi'
import type { CompletedSessionRecord } from '../src/features/math-drill/persistence/completedSessionTypes'
import type { SavedSession } from '../src/features/math-drill/persistence/sessionTypes'
import type { UnifiedIndexedDbSessionStore } from '../src/features/math-drill/persistence/completedSessionHistoryStore'

const uuid = '550e8400-e29b-41d4-a716-4466554400a1'
const uuidTwo = '550e8400-e29b-41d4-a716-4466554400a2'
const uuidLegacy = '550e8400-e29b-41d4-a716-4466554400a3'
const uuidLegacyTwo = '550e8400-e29b-41d4-a716-4466554400a4'

function makeSession(seed = 9101) {
  const generated = generateSession({ level: 1, mode: 'addition', count: 2, seed, roundSize: 2 })
  if (!generated.ok) throw new Error(generated.error.code)
  return generated.session
}

/** Single-question session: answering it finishes the session, so the
 *  projection below yields a genuine completed record. */
function makeCompletedSession(seed = 9101) {
  const generated = generateSession({ level: 1, mode: 'addition', count: 1, seed, roundSize: 1 })
  if (!generated.ok) throw new Error(generated.error.code)
  return generated.session
}

/** In-memory twin of the unified store, with the full method surface. */
function memoryStore(seedHistory: readonly CompletedSessionRecord[] = []) {
  const active = new Map<string, SavedSession>()
  const history = new Map<string, CompletedSessionRecord>()
  for (const record of seedHistory) history.set(record.instanceId, record)
  const store = {
    async load(mode: string) {
      const value = active.get(mode)
      return value ? { status: 'valid' as const, value } : { status: 'empty' as const }
    },
    async create(draft: Record<string, unknown>) {
      const mode = String(draft.mode)
      if (active.has(mode)) return { status: 'conflict' as const, reason: 'slot-exists' as const }
      const now = Date.now()
      const value = { ...draft, revision: 1, createdAt: now, updatedAt: now } as unknown as SavedSession
      active.set(mode, value)
      return { status: 'success' as const, value }
    },
    async save(snapshot: SavedSession, expected: { readonly revision: number }) {
      const current = active.get(snapshot.mode)
      if (!current || current.revision !== expected.revision) return { status: 'conflict' as const, reason: 'revision-mismatch' as const }
      const value = { ...snapshot, revision: current.revision + 1, createdAt: current.createdAt, updatedAt: Date.now() }
      active.set(value.mode, value)
      return { status: 'success' as const, value }
    },
    async replace(draft: Record<string, unknown>) { return store.create(draft) },
    async open() { return { status: 'opened' as const } },
    async insert(value: unknown) {
      const candidate = value as CompletedSessionRecord
      const existing = history.get(candidate.instanceId)
      if (existing) return { status: 'already-exists-equivalent' as const, value: existing }
      history.set(candidate.instanceId, candidate)
      return { status: 'inserted' as const, value: candidate }
    },
    async get(instanceId: string) {
      const value = history.get(instanceId)
      return value ? { status: 'found' as const, value } : { status: 'not-found' as const }
    },
    async list() { return { status: 'success' as const, records: [...history.values()], invalidCount: 0 } },
    async commitResult(snapshot: SavedSession, expected: { readonly instanceId: string; readonly revision: number }, record: CompletedSessionRecord) {
      const current = active.get(snapshot.mode)
      if (!current || current.instanceId !== expected.instanceId || current.revision !== expected.revision) {
        return { status: 'active-session-conflict' as const }
      }
      const value = { ...snapshot, revision: current.revision + 1, createdAt: current.createdAt, updatedAt: Date.now() }
      active.set(value.mode, value)
      history.set(record.instanceId, record)
      return { status: 'inserted' as const, value: record, snapshot: value }
    },
    async verifyCommitted(_snapshot: SavedSession, record: CompletedSessionRecord) {
      return history.has(record.instanceId) ? { status: 'committed' as const } : { status: 'not-committed' as const }
    },
    close() {},
  }
  return { store: store as unknown as UnifiedIndexedDbSessionStore, active, history }
}

function memoryStorage(): PendingUploadStorage & { readonly raw: Map<string, string> } {
  const raw = new Map<string, string>()
  return {
    raw,
    getItem: key => raw.get(key) ?? null,
    setItem: (key, value) => { raw.set(key, value) },
    removeItem: key => { raw.delete(key) },
  }
}

/** A completed record produced by the same projection the live store uses. */
function completedRecord(id = uuid, seed = 9101, completedAt = 1_000): CompletedSessionRecord {
  const session = makeCompletedSession(seed)
  const question = session.questions[0]
  const base: SavedSession = {
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
  } as unknown as SavedSession
  const answered = answerQuestion(base.score, session, question.key, question.correctChoiceIndex)
  if (!answered.ok) throw new Error(answered.error.code)
  const snapshot = { ...base, score: answered.state, cursor: { questionIndex: 0, phase: 'result', pendingAdvanceAt: null } } as unknown as SavedSession
  const projected = projectCompletedSession(snapshot, { completedAt, recordedAt: completedAt, provenance: 'new-atomic' })
  if (projected.status !== 'valid') throw new Error(projected.status)
  return projected.value
}

function recorderOutcome(status: 'recorded' | 'duplicate' | 'unavailable' | 'rejected'): RecordSessionOutcome {
  if (status === 'recorded') return { status: 'recorded', httpStatus: 201 }
  if (status === 'duplicate') return { status: 'duplicate', httpStatus: 409 }
  if (status === 'unavailable') return { status: 'unavailable', httpStatus: 0, reason: 'network-error' }
  return { status: 'rejected', httpStatus: 400, reason: 'invalid-session-record' }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('Stage 7B-A2 — real session flow records to the backend', () => {
  it('sends a session completed through the session controller and yields a backend reward', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const posted: CompletedSessionRecord[] = []
    const memory = memoryStore()
    const store = withBackendSessionRecording(memory.store, {
      storage: memoryStorage(),
      post: async (record) => { posted.push(record); return recorderOutcome('recorded') },
    })
    const controller = createSessionController({ store, completionMode: 'atomic' })
    const session = makeSession()

    await controller.startSession(session, uuid, 300_000)
    for (let step = 0; step < 20; step += 1) {
      const state = controller.getState()
      if (state.status !== 'ready' || memory.history.has(uuid)) break
      if (state.snapshot.cursor.phase === 'answering') {
        const index = state.snapshot.cursor.questionIndex
        await controller.submitAnswer(session.questions[index].correctChoiceIndex)
      }
      await vi.advanceTimersByTimeAsync(800)
    }
    await vi.advanceTimersByTimeAsync(5_000)
    controller.dispose()

    // 1. The local commit still happened (history is authoritative for history).
    const committed = memory.history.get(uuid)
    expect(committed).toBeDefined()

    // 2. Exactly one backend offer, carrying the committed identity verbatim.
    expect(posted).toHaveLength(1)
    expect(posted[0].instanceId).toBe(uuid)
    expect(validateCompletedSession(posted[0]).status).toBe('valid')

    // 3. The payload the app sent is a valid reward input for the backend engine.
    const balance = computeAvailableBalance(posted, [], [])
    expect(balance.totalCollectibleStarsEarned).toBeGreaterThan(0)
    expect(balance.availableBalance).toBe(balance.totalCollectibleStarsEarned)
  })

  it('does not replay sessions that already exist in IndexedDB', async () => {
    const posted: CompletedSessionRecord[] = []
    const memory = memoryStore([completedRecord(uuidLegacy, 9201, 500), completedRecord(uuidLegacyTwo, 9202, 600)])
    const store = withBackendSessionRecording(memory.store, {
      storage: memoryStorage(),
      post: async (record) => { posted.push(record); return recorderOutcome('recorded') },
    })

    await store.open()
    await store.list()
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(posted).toHaveLength(0)
    expect(memory.history.size).toBe(2)
  })

  it('keeps the local record and the pending id when the backend is unavailable', async () => {
    const storage = memoryStorage()
    const posted: CompletedSessionRecord[] = []
    const memory = memoryStore()
    const store = withBackendSessionRecording(memory.store, {
      storage,
      post: async (record) => { posted.push(record); return recorderOutcome('unavailable') },
    })

    const record = completedRecord()
    const result = await store.insert(record)
    expect(result.status).toBe('inserted')
    await new Promise(resolve => setTimeout(resolve, 20))

    // Requirement 7: a failed send must not delete local history.
    expect(memory.history.get(uuid)).toBeDefined()
    expect(posted).toHaveLength(1)

    // Requirement 6/8: the backlog is delivery metadata, never a balance.
    const queued = JSON.parse(storage.raw.get(PENDING_UPLOAD_STORAGE_KEY) ?? '[]') as Array<Record<string, unknown>>
    expect(queued).toHaveLength(1)
    expect(queued[0].instanceId).toBe(uuid)
    expect(Object.keys(queued[0]).sort()).toEqual(['attempts', 'instanceId', 'lastReason', 'permanent'])
  })

  it('retries with the same stable identity and never records twice', async () => {
    const storage = memoryStorage()
    const posted: CompletedSessionRecord[] = []
    const memory = memoryStore()
    let attempt = 0
    const store = withBackendSessionRecording(memory.store, {
      storage,
      post: async (record) => {
        posted.push(record)
        attempt += 1
        return attempt === 1 ? recorderOutcome('unavailable') : recorderOutcome('recorded')
      },
    })

    await store.insert(completedRecord())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(posted).toHaveLength(1)

    // A retry is triggered by the browser coming back online.
    window.dispatchEvent(new Event('online'))
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(posted).toHaveLength(2)
    expect(posted[0].instanceId).toBe(posted[1].instanceId)
    expect(JSON.parse(storage.raw.get(PENDING_UPLOAD_STORAGE_KEY) ?? '[]')).toEqual([])

    // Nothing left to send: further triggers are inert.
    window.dispatchEvent(new Event('online'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(posted).toHaveLength(2)
    expect(memory.history.size).toBe(1)
  })

  it('treats a duplicate response as delivered instead of resending forever', async () => {
    const storage = memoryStorage()
    const memory = memoryStore()
    const queue = createSessionUploadQueue({
      storage,
      post: async () => recorderOutcome('duplicate'),
      load: async () => ({ status: 'found', value: completedRecord() }),
    })
    queue.enqueue(uuid)
    const summary = await queue.flush()
    expect(summary).toMatchObject({ attempted: 1, duplicates: 1, recorded: 0, pending: 0 })
    expect(queue.pending()).toHaveLength(0)
    expect(memory.history.size).toBe(0)
  })

  it('marks a payload the backend refuses as permanent and stops retrying it', async () => {
    const storage = memoryStorage()
    const posted: CompletedSessionRecord[] = []
    const memory = memoryStore()
    const store = withBackendSessionRecording(memory.store, {
      storage,
      post: async (record) => { posted.push(record); return recorderOutcome('rejected') },
    })

    await store.insert(completedRecord())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(posted).toHaveLength(1)

    window.dispatchEvent(new Event('online'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(posted).toHaveLength(1)

    // The record itself is untouched: only the delivery attempt is abandoned.
    expect(memory.history.get(uuid)).toBeDefined()
  })

  it('never lets a transport failure break the local commit', async () => {
    const memory = memoryStore()
    const store = withBackendSessionRecording(memory.store, {
      storage: memoryStorage(),
      post: async () => { throw new Error('socket hang up') },
    })

    const record = completedRecord()
    const result = await store.insert(record)
    expect(result).toEqual({ status: 'inserted', value: record })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(memory.history.get(uuid)).toBeDefined()
  })

  it('drops a queued id whose local record is gone without inventing a payload', async () => {
    const posted: CompletedSessionRecord[] = []
    const storage = memoryStorage()
    const queue = createSessionUploadQueue({
      storage,
      post: async (record) => { posted.push(record); return recorderOutcome('recorded') },
      load: async () => ({ status: 'missing' }),
    })
    queue.enqueue(uuid)
    const summary = await queue.flush()
    expect(summary).toMatchObject({ attempted: 0, recorded: 0, pending: 0 })
    expect(posted).toHaveLength(0)
    expect(JSON.parse(storage.raw.get(PENDING_UPLOAD_STORAGE_KEY) ?? '[]')).toEqual([])
  })
})

describe('Stage 7B-A2 — live composition is the one that talks to the backend', () => {
  const databaseNames: string[] = []

  afterEach(() => {
    for (const name of databaseNames.splice(0)) indexedDB.deleteDatabase(name)
  })

  it('wires the recorder into the store selected by historyActivation', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: String(init?.method ?? 'GET'), body: JSON.parse(String(init?.body ?? 'null')) })
      return new Response(JSON.stringify({ success: true }), { status: 201, headers: { 'Content-Type': 'application/json' } })
    })

    const factory = selectMathDrillPersistence({ mode: 'live' })
    expect(factory).toBeDefined()
    const store = factory!()
    expect(store.store).toBeDefined()

    // A real history insert through the live store — the same call the app's
    // commit path makes — must reach the backend exactly once.
    const record = completedRecord()
    await store.store.open()
    const inserted = await store.store.insert(record)
    expect(inserted.status).toBe('inserted')
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/sessions')
    expect(calls[0].method).toBe('POST')
    expect((calls[0].body as CompletedSessionRecord).instanceId).toBe(uuid)
    expect(validateCompletedSession(calls[0].body).status).toBe('valid')

    store.store.close()
  })

  it('keeps the disposable composition fully offline', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => { calls.push(String(url)); return new Response('{}', { status: 201 }) })
    const name = `math-adventure-a2-recording-disposable-${Date.now()}`
    databaseNames.push(name)
    const factory = selectMathDrillPersistence({ mode: 'disposable', databaseName: name })
    const store = factory!()
    await store.store.open()
    await store.store.insert(completedRecord())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(calls).toHaveLength(0)
    store.store.close()
  })

  it('does not post twice when the same session is committed again', async () => {
    const calls: Array<{ body: unknown }> = []
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body ?? 'null')) })
      return new Response(JSON.stringify({ success: true }), { status: 201, headers: { 'Content-Type': 'application/json' } })
    })

    const factory = selectMathDrillPersistence({ mode: 'live' })
    const store = factory!().store
    await store.open()
    const record = completedRecord(uuidTwo, 9301, 700)

    const first = await store.insert(record)
    expect(first.status).toBe('inserted')
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(calls).toHaveLength(1)

    // Re-committing the identical record is an idempotent local no-op, so the
    // backend is not asked again.
    const second = await store.insert(record)
    expect(second.status).toBe('already-exists-equivalent')
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(calls).toHaveLength(1)
    store.close()
  })
})
