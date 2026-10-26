import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateChallengeSession, generateSession } from '../src/features/math-drill/domain'
import type { IndexedDbSessionStore, SessionExpectation } from '../src/features/math-drill/persistence/indexedDbSessionStore'
import { createSessionController } from '../src/features/math-drill/persistence/sessionController'
import { compareCompletionContent, validateCompletedSession } from '../src/features/math-drill/persistence/completedSessionCodec'
import { projectCompletedSession } from '../src/features/math-drill/persistence/completedSessionProjection'
import type { CompletedSessionRecord } from '../src/features/math-drill/persistence/completedSessionTypes'
import type { SavedSession } from '../src/features/math-drill/persistence/sessionTypes'
import { saveSessionDurationPreference } from '../src/features/math-drill/persistence/sessionTimer'

const id = '550e8400-e29b-41d4-a716-446655440020'
const uuid = '550e8400-e29b-41d4-a716-446655440021'
function makeSession(challenge: boolean) {
  const generated = challenge
    ? generateChallengeSession({ selectedLevels: [1], selectedLevel5Sublevels: [], mode: 'mixed', count: 10, seed: 6201, roundSize: 5 })
    : generateSession({ level: 1, mode: 'addition', count: 4, seed: 6202, roundSize: 2 })
  if (!generated.ok) throw new Error(generated.error.code)
  return generated.session
}
function memoryStore() {
  const active = new Map<string, SavedSession>()
  const history = new Map<string, CompletedSessionRecord>()
  let nextSaveBarrier: { readonly entered: () => void; readonly release: () => void; readonly promise: Promise<void> } | null = null
  const holdNextSave = () => {
    let entered!: () => void, release!: () => void
    const enteredPromise = new Promise<void>(resolve => { entered = resolve })
    const promise = new Promise<void>(resolve => { release = resolve })
    nextSaveBarrier = { entered, release, promise }
    return { entered: enteredPromise, release }
  }
  const store = {
    async load(mode: string) { const value = active.get(mode); return value ? { status: 'valid' as const, value } : { status: 'empty' as const } },
    async create(draft: Record<string, unknown>) {
      const mode = String(draft.mode)
      if (active.has(mode)) return { status: 'conflict' as const, reason: 'slot-exists' as const }
      const now = Date.now(), value = { ...draft, revision: 1, createdAt: now, updatedAt: now } as unknown as SavedSession
      active.set(mode, value)
      return { status: 'success' as const, value }
    },
    async save(snapshot: SavedSession, expected: SessionExpectation) {
      const barrier = nextSaveBarrier
      nextSaveBarrier = null
      if (barrier) { barrier.entered(); await barrier.promise }
      const current = active.get(snapshot.mode)
      if (!current || current.revision !== expected.revision) return { status: 'conflict' as const, reason: 'revision-mismatch' as const }
      const value = { ...snapshot, revision: current.revision + 1, createdAt: current.createdAt, updatedAt: Date.now() }
      active.set(value.mode, value)
      return { status: 'success' as const, value }
    },
    async replace(draft: Record<string, unknown>) { return store.create(draft) },
    async commitResult(snapshot: SavedSession, expected: SessionExpectation, record: CompletedSessionRecord) {
      const projected = projectCompletedSession(snapshot, record.historySchemaVersion === 2 ? { recordedAt: record.recordedAt } : record)
      if (projected.status !== 'valid' || compareCompletionContent(projected.value, record) !== 'equivalent') return { status: 'invalid-history' as const }
      const current = active.get(snapshot.mode)
      if (!current || current.instanceId !== expected.instanceId || current.revision !== expected.revision) return { status: 'active-session-conflict' as const }
      const value = { ...snapshot, revision: current.revision + 1, createdAt: current.createdAt, updatedAt: Date.now() }
      active.set(value.mode, value)
      history.set(record.instanceId, record)
      return { status: 'inserted' as const, value: record, snapshot: value }
    },
    async verifyCommitted(_snapshot: SavedSession, record: CompletedSessionRecord) { return history.has(record.instanceId) ? { status: 'committed' as const } : { status: 'not-committed' as const } },
    async get(instanceId: string) { const value = history.get(instanceId); return value ? { status: 'found' as const, value } : { status: 'not-found' as const } },
    close() {},
  }
  return { store: store as unknown as IndexedDbSessionStore & { commitResult: typeof store.commitResult; verifyCommitted: typeof store.verifyCommitted; get: typeof store.get }, active, history, holdNextSave }
}
afterEach(() => vi.useRealTimers())

describe('Stage 6 timeout controller', () => {
  it('atomically archives a zero-answer timeout without fabricating outcomes', async () => {
    vi.useFakeTimers(); vi.setSystemTime(10_000)
    const db = memoryStore(), controller = createSessionController({ store: db.store, completionMode: 'atomic' })
    const session = makeSession(false)
    await controller.startSession(session, id, 300_000)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(controller.getState()).toMatchObject({ status: 'ready', snapshot: { schemaVersion: 2, cursor: { phase: 'timeout' } } })
    const record = db.history.get(id)
    expect(record).toMatchObject({ historySchemaVersion: 2, endReason: 'timeout', plannedCount: 4, completedCount: 0, outcomes: [] })
    expect(validateCompletedSession(record).status).toBe('valid')
    controller.dispose()
  })

  it('keeps an active custom deadline unchanged when the parent preference changes, then archives the actual duration after resume', async () => {
    vi.useFakeTimers(); vi.setSystemTime(15_000); localStorage.clear()
    const db = memoryStore(), first = createSessionController({ store: db.store, completionMode: 'atomic' })
    await first.startSession(makeSession(false), uuid, 7 * 60_000)
    const activeTiming = (db.active.get('regular') as unknown as { timing: { durationMs: number; deadlineAt: number } }).timing
    expect(activeTiming).toMatchObject({ durationMs: 420_000, deadlineAt: 435_000 })
    expect(saveSessionDurationPreference(25 * 60_000)).toBe(true)
    expect((db.active.get('regular') as unknown as { timing: { durationMs: number; deadlineAt: number } }).timing).toEqual(activeTiming)
    first.dispose()

    const resumed = createSessionController({ store: db.store, completionMode: 'atomic' })
    await resumed.load('regular')
    expect(resumed.getState()).toMatchObject({ status: 'ready', snapshot: { schemaVersion: 2, timing: { durationMs: 420_000, deadlineAt: 435_000 } } })
    await vi.advanceTimersByTimeAsync(420_000)
    const record = db.history.get(uuid)
    expect(record).toMatchObject({ historySchemaVersion: 2, endReason: 'timeout', durationMs: 420_000, startedAt: 15_000, deadlineAt: 435_000, remainingMs: 0 })
    expect(validateCompletedSession(record).status).toBe('valid')
    resumed.dispose()
  })

  it('retains only durably completed answers when deadline interrupts the 700 ms feedback phase', async () => {
    vi.useFakeTimers(); vi.setSystemTime(20_000)
    const db = memoryStore(), controller = createSessionController({ store: db.store, completionMode: 'atomic' })
    const session = makeSession(false)
    await controller.startSession(session, uuid, 300_000)
    await vi.advanceTimersByTimeAsync(299_999)
    const question = session.questions[0]
    await controller.submitAnswer(question.correctChoiceIndex)
    await vi.advanceTimersByTimeAsync(1)
    const record = db.history.get(uuid)
    expect(record).toMatchObject({ endReason: 'timeout', plannedCount: 4, completedCount: 1, outcomes: [{ points: 1 }] })
    expect(controller.getState()).toMatchObject({ status: 'ready', snapshot: { cursor: { phase: 'timeout' } } })
    controller.dispose()
  })

  it('finalizes a Challenge timeout with its full planned count and partial earned score', async () => {
    vi.useFakeTimers(); vi.setSystemTime(30_000)
    const db = memoryStore(), controller = createSessionController({ store: db.store, completionMode: 'atomic' })
    const session = makeSession(true)
    await controller.startSession(session, id, 300_000)
    const question = session.questions[0]
    await controller.submitAnswer(question.correctChoiceIndex)
    await vi.advanceTimersByTimeAsync(700)
    await vi.advanceTimersByTimeAsync(299_300)
    const record = db.history.get(id)
    expect(record).toMatchObject({ mode: 'challenge', endReason: 'timeout', plannedCount: 10, completedCount: 1 })
    expect(record?.outcomes).toHaveLength(1)
    expect(validateCompletedSession(record).status).toBe('valid')
    controller.dispose()
  })

  it('finalizes an overdue resumed session on visibility wake even if the timer was throttled', async () => {
    vi.useFakeTimers(); vi.setSystemTime(40_000)
    const db = memoryStore(), controller = createSessionController({ store: db.store, completionMode: 'atomic' })
    await controller.startSession(makeSession(false), id, 300_000)
    vi.setSystemTime(340_000)
    document.dispatchEvent(new Event('visibilitychange'))
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve(); await Promise.resolve()
    expect(db.history.get(id)).toMatchObject({ endReason: 'timeout', completedCount: 0, outcomes: [] })
    expect(controller.getState()).toMatchObject({ status: 'ready', snapshot: { cursor: { phase: 'timeout' } } })
    expect(vi.getTimerCount()).toBe(0)
    controller.dispose()
  })

  it('finalizes an overdue persisted session immediately when a new controller resumes it', async () => {
    vi.useFakeTimers(); vi.setSystemTime(70_000)
    const db = memoryStore(), first = createSessionController({ store: db.store, completionMode: 'atomic' })
    await first.startSession(makeSession(false), id, 300_000)
    first.dispose()
    vi.setSystemTime(370_000)
    const resumed = createSessionController({ store: db.store, completionMode: 'atomic' })
    await resumed.load('regular')
    await vi.advanceTimersByTimeAsync(0)
    expect(db.history.get(id)).toMatchObject({ endReason: 'timeout', plannedCount: 4, completedCount: 0, outcomes: [] })
    expect(resumed.getState()).toMatchObject({ status: 'ready', snapshot: { cursor: { phase: 'timeout' } } })
    resumed.dispose()
  })

  it('keeps a new mode session isolated from the previous mode deadline', async () => {
    vi.useFakeTimers(); vi.setSystemTime(80_000)
    const db = memoryStore(), controller = createSessionController({ store: db.store, completionMode: 'atomic' })
    await controller.startSession(makeSession(false), id, 300_000)
    await vi.advanceTimersByTimeAsync(100_000)
    await controller.load('challenge')
    const challenge = makeSession(true)
    await controller.startSession(challenge, uuid, 300_000)
    await vi.advanceTimersByTimeAsync(200_000)
    expect(controller.getState()).toMatchObject({ status: 'ready', snapshot: { mode: 'challenge', cursor: { phase: 'answering' } } })
    expect(db.history.size).toBe(0)
    await vi.advanceTimersByTimeAsync(100_000)
    expect(controller.getState()).toMatchObject({ status: 'ready', snapshot: { mode: 'challenge', cursor: { phase: 'timeout' } } })
    expect(db.history.get(uuid)).toMatchObject({ mode: 'challenge', endReason: 'timeout', plannedCount: 10, completedCount: 0 })
    expect(db.history.size).toBe(1)
    controller.dispose()
  })

  it('times out in the retry-prompt phase without recording an unanswered question as wrong', async () => {
    vi.useFakeTimers(); vi.setSystemTime(90_000)
    const db = memoryStore(), controller = createSessionController({ store: db.store, completionMode: 'atomic' })
    const session = makeSession(false), question = session.questions[0]
    await controller.startSession(session, id, 300_000)
    const wrong = question.choices.findIndex((_choice, index) => index !== question.correctChoiceIndex)
    await controller.submitAnswer(wrong)
    expect(controller.getState()).toMatchObject({ status: 'ready', snapshot: { cursor: { phase: 'retry-prompt' } } })
    await vi.advanceTimersByTimeAsync(300_000)
    expect(db.history.get(id)).toMatchObject({ endReason: 'timeout', completedCount: 0, outcomes: [] })
    controller.dispose()
  })

  it('rejects an answer submitted exactly at the deadline and writes one zero-outcome timeout', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000)
    const db = memoryStore(), controller = createSessionController({ store: db.store, completionMode: 'atomic' })
    const session = makeSession(false)
    await controller.startSession(session, uuid, 300_000)
    vi.setSystemTime(400_000)
    await controller.submitAnswer(session.questions[0].correctChoiceIndex)
    await vi.advanceTimersByTimeAsync(0)
    expect(db.history.get(uuid)).toMatchObject({ endReason: 'timeout', completedCount: 0, outcomes: [] })
    expect(db.history.size).toBe(1)
    controller.dispose()
  })

  it('waits for an in-flight answer write and then times out from the durable latest snapshot', async () => {
    vi.useFakeTimers(); vi.setSystemTime(50_000)
    const db = memoryStore(), controller = createSessionController({ store: db.store, completionMode: 'atomic' })
    const session = makeSession(false)
    await controller.startSession(session, uuid, 300_000)
    await vi.advanceTimersByTimeAsync(299_999)
    const barrier = db.holdNextSave()
    const pending = controller.submitAnswer(session.questions[0].correctChoiceIndex)
    await barrier.entered
    await vi.advanceTimersByTimeAsync(1)
    expect(controller.getState().status).toBe('saving')
    expect(db.history.has(uuid)).toBe(false)
    barrier.release()
    await pending
    await vi.advanceTimersByTimeAsync(0)
    expect(db.history.get(uuid)).toMatchObject({ endReason: 'timeout', plannedCount: 4, completedCount: 1, outcomes: [{ points: 1 }] })
    expect(controller.getState()).toMatchObject({ status: 'ready', snapshot: { cursor: { phase: 'timeout' } } })
    controller.dispose()
  })

  it('does not arm a timeout timer for an unlimited session', async () => {
    vi.useFakeTimers(); vi.setSystemTime(60_000)
    const db = memoryStore(), controller = createSessionController({ store: db.store, completionMode: 'atomic' })
    await controller.startSession(makeSession(false), id, null)
    expect(vi.getTimerCount()).toBe(0)
    controller.dispose()
  })
})
