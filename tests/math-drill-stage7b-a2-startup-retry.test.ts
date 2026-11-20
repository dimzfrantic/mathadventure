import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answerQuestion, createScoreState, generateSession } from '../src/features/math-drill/domain'
import { projectCompletedSession } from '../src/features/math-drill/persistence/completedSessionProjection'
import type { CompletedSessionRecord } from '../src/features/math-drill/persistence/completedSessionTypes'
import type { SavedSession } from '../src/features/math-drill/persistence/sessionTypes'

/**
 * Stage 7B-A2 limited remediation — finding B: the pending session upload queue
 * is retried when the app boots.
 *
 * These tests exercise the REAL live composition (fake IndexedDB + the real
 * `recordCompletedSession` fetch contract) so that a passing result means the
 * behaviour works, not merely that a function was called.
 */

const PENDING_KEY = 'math-adventure:pending-session-uploads:v1'

// One distinct identity and one distinct seed per scenario: the live history
// store keeps records for the whole file, and re-inserting the same instanceId
// with different content is a genuine conflict (not something to work around).
const uuidBacklog = '550e8400-e29b-41d4-a716-4466554400b1'
const uuidOffline = '550e8400-e29b-41d4-a716-4466554400b2'
const uuidRecover = '550e8400-e29b-41d4-a716-4466554400b3'
const uuidFlight = '550e8400-e29b-41d4-a716-4466554400b4'
const uuidDuplicate = '550e8400-e29b-41d4-a716-4466554400b5'
const uuidQueueError = '550e8400-e29b-41d4-a716-4466554400b6'
const uuidReconnect = '550e8400-e29b-41d4-a716-4466554400b7'
const uuidReconnectTwo = '550e8400-e29b-41d4-a716-4466554400b8'
const uuidLiveStore = '550e8400-e29b-41d4-a716-4466554400b9'
const uuidSharedQueue = '550e8400-e29b-41d4-a716-4466554400ba'
const uuidNeverStored = '550e8400-e29b-41d4-a716-4466554400ff'

/** A genuine completed record produced by the same projection the app uses. */
function completedRecord(id: string, seed = 4242, completedAt = 1_000): CompletedSessionRecord {
  const generated = generateSession({ level: 1, mode: 'addition', count: 1, seed, roundSize: 1 })
  if (!generated.ok) throw new Error(generated.error.code)
  const session = generated.session
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
  const snapshot = {
    ...base,
    score: answered.state,
    cursor: { questionIndex: 0, phase: 'result', pendingAdvanceAt: null },
  } as unknown as SavedSession
  const projected = projectCompletedSession(snapshot, { completedAt, recordedAt: completedAt, provenance: 'new-atomic' })
  if (projected.status !== 'valid') throw new Error(projected.status)
  return projected.value
}

/**
 * Fresh module graph per test: the retry module keeps page-lifetime singletons
 * (queue + "already started" flag), exactly like a real page load.
 */
async function loadModules() {
  vi.resetModules()
  const retry = await import('../src/features/math-drill/persistence/sessionUploadRetry')
  const activation = await import('../src/features/math-drill/persistence/historyActivation')
  return { retry, activation }
}

/** Puts the id into the durable queue, as a previous page load would have. */
function seedBacklog(ids: readonly string[], attempts = 0): void {
  window.localStorage.setItem(PENDING_KEY, JSON.stringify(ids.map(instanceId => ({
    instanceId,
    attempts,
    lastReason: attempts > 0 ? 'Backend unavailable' : null,
    permanent: false,
  }))))
}

function readBacklog(): Array<{ instanceId: string; attempts: number; permanent: boolean }> {
  const raw = window.localStorage.getItem(PENDING_KEY)
  return raw ? JSON.parse(raw) as Array<{ instanceId: string; attempts: number; permanent: boolean }> : []
}

/** Persists the payload in the live database (what the queue re-reads at send time). */
async function seedLocalRecord(record: CompletedSessionRecord): Promise<void> {
  const { createLiveUnifiedIndexedDbSessionStore } = await import('../src/features/math-drill/persistence/completedSessionHistoryStore')
  const store = createLiveUnifiedIndexedDbSessionStore()
  const result = await store.insert(record)
  store.close()
  if (result.status !== 'inserted' && result.status !== 'already-exists-equivalent') {
    throw new Error(`could not seed record: ${result.status}`)
  }
}

interface FetchCall { readonly url: string; readonly method: string; readonly body: string }

function stubFetch(handler: (call: FetchCall) => Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = []
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const call: FetchCall = {
      url: String(input),
      method: String(init?.method ?? 'GET'),
      body: typeof init?.body === 'string' ? init.body : '',
    }
    calls.push(call)
    return handler(call)
  })
  return calls
}

function jsonResponse(status: number, payload: unknown = {}): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.localStorage.clear()
})

describe('Stage 7B-A2 finding B — backlog delivery at startup', () => {
  it('delivers a backlog that already existed when the app loaded', async () => {
    await seedLocalRecord(completedRecord(uuidBacklog, 4242))
    seedBacklog([uuidBacklog])
    const calls = stubFetch(async () => jsonResponse(201, { status: 'inserted' }))

    const { retry } = await loadModules()
    const summary = await retry.retryPendingSessionUploads()

    expect(summary).toEqual({ attempted: 1, recorded: 1, duplicates: 0, rejected: 0, pending: 0 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toContain('/sessions')
    expect(calls[0]?.method).toBe('POST')
    // The payload is the record re-read from IndexedDB, with its stable identity.
    expect(JSON.parse(calls[0]?.body ?? '{}').instanceId).toBe(uuidBacklog)
    expect(readBacklog()).toHaveLength(0)
  })

  it('keeps the backlog — and the local record — when the backend is unavailable at startup', async () => {
    await seedLocalRecord(completedRecord(uuidOffline, 4243))
    seedBacklog([uuidOffline])
    stubFetch(async () => { throw new TypeError('Failed to fetch') })

    const { retry } = await loadModules()
    const summary = await retry.retryPendingSessionUploads()

    expect(summary.attempted).toBe(1)
    expect(summary.recorded).toBe(0)
    expect(summary.pending).toBe(1)
    // Nothing was deleted: neither the queue entry nor the local history.
    expect(readBacklog()).toHaveLength(1)
    expect(readBacklog()[0]?.instanceId).toBe(uuidOffline)
    expect(readBacklog()[0]?.attempts).toBe(1)

    const { createLiveUnifiedIndexedDbSessionStore } = await import('../src/features/math-drill/persistence/completedSessionHistoryStore')
    const store = createLiveUnifiedIndexedDbSessionStore()
    const stored = await store.get(uuidOffline)
    store.close()
    expect(stored.status).toBe('found')
  })

  it('delivers the same backlog once the backend is reachable again', async () => {
    await seedLocalRecord(completedRecord(uuidRecover, 4244))
    seedBacklog([uuidRecover])

    let backendUp = false
    const calls = stubFetch(async () => {
      if (!backendUp) throw new TypeError('Failed to fetch')
      return jsonResponse(201, { status: 'inserted' })
    })

    const { retry } = await loadModules()
    const first = await retry.retryPendingSessionUploads()
    expect(first.pending).toBe(1)

    backendUp = true
    const second = await retry.retryPendingSessionUploads()

    expect(second.recorded).toBe(1)
    expect(second.pending).toBe(0)
    expect(readBacklog()).toHaveLength(0)
    // Two attempts, one identity: the retry re-sends the SAME instanceId.
    expect(calls).toHaveLength(2)
    expect(JSON.parse(calls[1]?.body ?? '{}').instanceId).toBe(uuidRecover)
  })

  it('coalesces two flush triggers that overlap (single flight, no parallel posts)', async () => {
    await seedLocalRecord(completedRecord(uuidFlight, 4245))
    seedBacklog([uuidFlight])

    let release: (() => void) | null = null
    const gate = new Promise<void>(resolve => { release = resolve })
    const calls = stubFetch(async () => {
      await gate
      return jsonResponse(201, { status: 'inserted' })
    })

    const { retry } = await loadModules()
    const first = retry.retryPendingSessionUploads()
    const second = retry.retryPendingSessionUploads()
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0))
    release?.()
    const [a, b] = await Promise.all([first, second])

    expect(calls).toHaveLength(1)
    expect(a.recorded).toBe(1)
    expect(b.recorded).toBe(1)
    expect(readBacklog()).toHaveLength(0)
  })

  it('treats an identical resend as an existing session and does not double-credit', async () => {
    await seedLocalRecord(completedRecord(uuidDuplicate, 4246))
    seedBacklog([uuidDuplicate])
    const calls = stubFetch(async () => jsonResponse(409, { error: 'already-exists-equivalent' }))

    const { retry } = await loadModules()
    const summary = await retry.retryPendingSessionUploads()

    expect(calls).toHaveLength(1)
    expect(summary.duplicates).toBe(1)
    expect(summary.recorded).toBe(0)
    expect(summary.pending).toBe(0)
    expect(readBacklog()).toHaveLength(0)
  })

  it('drops an id whose payload no longer exists instead of inventing one', async () => {
    seedBacklog([uuidNeverStored])
    const calls = stubFetch(async () => jsonResponse(201, { status: 'inserted' }))

    const { retry } = await loadModules()
    const summary = await retry.retryPendingSessionUploads()

    expect(calls).toHaveLength(0)
    expect(summary.attempted).toBe(0)
    expect(summary.pending).toBe(0)
    expect(readBacklog()).toHaveLength(0)
  })

  it('keeps the backlog when the payload cannot be read yet, and retries on the next opportunity', async () => {
    // IndexedDB not ready / unreadable is an `error` lookup, never a `missing`
    // one: the backlog must survive and be retried later.
    const { createSessionUploadQueue } = await import('../src/features/math-drill/persistence/backendSessionRecorder')
    const record = completedRecord(uuidQueueError, 4247)
    const storage = new Map<string, string>()
    let readable = false
    const posted: string[] = []

    const queue = createSessionUploadQueue({
      storage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => { storage.set(key, value) },
        removeItem: key => { storage.delete(key) },
      },
      load: async () => (readable ? { status: 'found', value: record } : { status: 'error' }),
      post: async (value) => {
        posted.push(value.instanceId)
        return { status: 'recorded', httpStatus: 201 }
      },
    })

    queue.enqueue(record.instanceId)
    const blocked = await queue.flush()
    expect(blocked.attempted).toBe(0)
    expect(queue.pending()).toHaveLength(1)
    expect(posted).toHaveLength(0)

    readable = true
    const delivered = await queue.flush()
    expect(delivered.recorded).toBe(1)
    expect(posted).toEqual([record.instanceId])
    expect(queue.pending()).toHaveLength(0)
  })

  it('does nothing when there is no backlog', async () => {
    const calls = stubFetch(async () => jsonResponse(201, { status: 'inserted' }))

    const { retry } = await loadModules()
    const summary = await retry.retryPendingSessionUploads()

    expect(summary).toEqual({ attempted: 0, recorded: 0, duplicates: 0, rejected: 0, pending: 0 })
    expect(calls).toHaveLength(0)
    expect(retry.pendingSessionUploadCount()).toBe(0)
  })

  it('starts the startup retry once and retries again on reconnect, without looping', async () => {
    await seedLocalRecord(completedRecord(uuidReconnect, 4248))
    seedBacklog([uuidReconnect])
    const calls = stubFetch(async () => jsonResponse(201, { status: 'inserted' }))

    const { retry } = await loadModules()
    retry.startStartupSessionUploadRetry()
    retry.startStartupSessionUploadRetry()
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(readBacklog()).toHaveLength(0)

    // A reconnect re-tries; an empty queue therefore produces no extra request.
    window.dispatchEvent(new Event('online'))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(calls).toHaveLength(1)

    // A later reconnect with a new pending session delivers exactly that one.
    await seedLocalRecord(completedRecord(uuidReconnectTwo, 4249))
    retry.liveSessionUploadQueue().enqueue(uuidReconnectTwo)
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(readBacklog()).toHaveLength(0)
  })
})

describe('Stage 7B-A2 finding B — the live composition uses the boot queue', () => {
  it('delivers a session recorded through the live store via the startup retry', async () => {
    let backendUp = false
    const calls = stubFetch(async () => {
      if (!backendUp) throw new TypeError('Failed to fetch')
      return jsonResponse(201, { status: 'inserted' })
    })

    const { retry, activation } = await loadModules()
    const options = activation.selectMathDrillPersistence({ mode: 'live' })
    expect(options).toBeTypeOf('function')
    const store = options!().store
    const record = completedRecord(uuidLiveStore, 4250)

    const inserted = await store.insert(record)
    expect(inserted.status).toBe('inserted')
    // The failed upload left exactly one durable queue entry.
    await vi.waitFor(() => expect(readBacklog()).toHaveLength(1))
    expect(readBacklog()[0]?.instanceId).toBe(uuidLiveStore)
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    // Backend returns; the boot retry — not a Math Drill mount — delivers it.
    backendUp = true
    const summary = await retry.retryPendingSessionUploads()

    expect(summary.recorded).toBe(1)
    expect(summary.pending).toBe(0)
    expect(readBacklog()).toHaveLength(0)
    expect(calls).toHaveLength(2)
    expect(JSON.parse(calls[1]?.body ?? '{}').instanceId).toBe(uuidLiveStore)

    // Local history is untouched by the delivery.
    const stored = await store.get(uuidLiveStore)
    expect(stored.status).toBe('found')
    store.close()
  })

  it('shares ONE queue between the boot retry and every live store', async () => {
    const calls = stubFetch(async () => { throw new TypeError('Failed to fetch') })

    const { retry, activation } = await loadModules()
    const first = activation.selectMathDrillPersistence({ mode: 'live' })!().store
    const second = activation.selectMathDrillPersistence({ mode: 'live' })!().store
    expect(retry.liveSessionUploadQueue()).toBe(retry.liveSessionUploadQueue())

    const record = completedRecord(uuidSharedQueue, 4251)
    await first.insert(record)
    await vi.waitFor(() => expect(readBacklog()).toHaveLength(1))
    // A second mounted store must not enqueue a second, competing delivery of
    // the same identity.
    await second.insert(record)
    await new Promise(resolve => setTimeout(resolve, 30))
    // One durable entry, and every attempt carries the same identity: mounting
    // a second store may trigger another sequential attempt, never a second
    // delivery of a different id or a parallel one.
    expect(readBacklog()).toHaveLength(1)
    expect(calls.length).toBeGreaterThanOrEqual(1)
    for (const call of calls) {
      expect(JSON.parse(call.body || '{}').instanceId).toBe(uuidSharedQueue)
    }

    first.close()
    second.close()
  })
})
