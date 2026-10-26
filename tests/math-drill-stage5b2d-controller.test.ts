import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerQuestion, createScoreState, generateChallengeSession, generateSession } from '../src/features/math-drill/domain'
import { createSessionController, type SessionControllerOptions } from '../src/features/math-drill/persistence/sessionController'
import type { IndexedDbSessionStore, SessionExpectation } from '../src/features/math-drill/persistence/indexedDbSessionStore'
import type { AtomicCompletionResult, CompletionVerificationResult } from '../src/features/math-drill/persistence/completedSessionHistoryStore'
import type { CompletedSessionRecordV1 } from '../src/features/math-drill/persistence/completedSessionTypes'
import { validateSavedSession } from '../src/features/math-drill/persistence/sessionCodec'
import { compareCompletionContent } from '../src/features/math-drill/persistence/completedSessionCodec'
import { projectCompletedSession } from '../src/features/math-drill/persistence/completedSessionProjection'
import type { SavedSessionV1 } from '../src/features/math-drill/persistence/sessionTypes'

const id = '550e8400-e29b-41d4-a716-446655440000'
function fixture(challenge = false, points: 0 | 0.5 | 1 = 1, count = 1, level5 = false): SavedSessionV1 {
  const g = challenge
    ? generateChallengeSession({ selectedLevels: [1, 5], selectedLevel5Sublevels: ['dasar'], mode: 'mixed', count: 10, seed: 2026, roundSize: 10 })
    : generateSession({ level: level5 ? 5 : 1, ...(level5 ? { level5Sublevel: 'menengah' as const } : {}), mode: 'addition', count, seed: 2026, roundSize: count })
  if (!g.ok) throw Error(g.error.code)
  const session = g.session
  let score = createScoreState(session)
  for (const [n, q] of session.questions.entries()) {
    const p = challenge && n < session.questions.length - 1 ? (n % 2 ? 1 : 0.5) : points
    const wrong = q.choices.map((_, i) => i).filter(i => i !== q.correctChoiceIndex)
    for (const choice of p === 1 ? [q.correctChoiceIndex] : [wrong[0], p === 0 ? wrong[1] : q.correctChoiceIndex]) {
      const a = answerQuestion(score, session, q.key, choice)
      if (!a.ok) throw Error('fixture answer')
      score = a.state
    }
  }
  return { schemaVersion: 1, mode: challenge ? 'challenge' : 'regular', instanceId: id, sessionId: session.id, session, score, revision: 7, createdAt: 100, updatedAt: 200, cursor: { questionIndex: session.questions.length - 1, phase: points === 0 ? 'manual-advance' : 'auto-advance', pendingAdvanceAt: points === 0 ? null : 1700 } } as SavedSessionV1
}
function storage(base = fixture()) {
  let record = base
  const records = new Map<string, CompletedSessionRecordV1>()
  const save = vi.fn(async (s: SavedSessionV1, expected: SessionExpectation) => {
    expect(validateSavedSession(s).status).toBe('valid')
    if (record.revision !== expected.revision) return { status: 'conflict' as const, reason: 'revision-mismatch' as const }
    record = { ...s, revision: s.revision + 1, updatedAt: 2000 }; return { status: 'success' as const, value: record }
  })
  const commitResult = vi.fn(async (s: SavedSessionV1, expected: SessionExpectation, history: CompletedSessionRecordV1): Promise<AtomicCompletionResult> => {
    expect(validateSavedSession(s).status).toBe('valid')
    const projected = projectCompletedSession(s, history)
    expect(projected.status).toBe('valid')
    if (projected.status === 'valid') expect(compareCompletionContent(projected.value, history)).toBe('equivalent')
    const prior = records.get(s.instanceId)
    if (prior) return { status: 'already-exists-equivalent', snapshot: record, value: prior }
    if (expected.revision !== record.revision) return { status: 'active-session-conflict' }
    record = { ...s, revision: s.revision + 1, updatedAt: 2000 }; records.set(s.instanceId, history)
    return { status: 'inserted', snapshot: record, value: history }
  })
  const store = { load: vi.fn(async () => ({ status: 'valid' as const, value: record })), save, create: vi.fn(), replace: vi.fn(), close: vi.fn(), commitResult,
    verifyCommitted: vi.fn(async (): Promise<CompletionVerificationResult> => ({ status: records.size ? 'committed' : 'not-committed' })),
    get: vi.fn(async (key: string) => { const value = records.get(key); return value ? { status: 'found' as const, value } : { status: 'not-found' as const } }) }
  return { store, records, save, commitResult, get record() { return record }, set record(s: SavedSessionV1) { record = s } }
}
afterEach(() => vi.useRealTimers())
describe('Stage 5B.2D opt-in atomic controller', () => {
  it.each([0, 0.5, 1] as const)('preserves Regular %s-point final outcomes and uses the proper final path', async points => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const db = storage(fixture(false, points, 1, true))
    const c = createSessionController({ store: db.store, completionMode: 'atomic' } as SessionControllerOptions)
    await c.load('regular')
    if (points === 0) await Promise.all([c.advanceManual(), c.advanceManual()])
    else await vi.advanceTimersByTimeAsync(700)
    const args = db.commitResult.mock.calls[0] as unknown as [SavedSessionV1, unknown, { outcomes: { points: number; level5Sublevel: string }[]; provenance: string }]
    expect(args[2]).toMatchObject({ provenance: 'new-atomic', outcomes: [{ points, level5Sublevel: 'menengah' }] })
    expect(db.commitResult).toHaveBeenCalledTimes(1)
    expect(db.save).not.toHaveBeenCalled()
    expect(c.getState()).toMatchObject({ status: 'ready', snapshot: { score: db.record.score } })
    c.dispose()
  })

  it('keeps pending result blocked, retries identical facts/time and installs only the committed snapshot', async () => {
    const db = storage(fixture(false, 0))
    let release!: (r: unknown) => void
    db.commitResult.mockImplementationOnce(() => new Promise(resolve => { release = resolve as typeof release }))
    const c = createSessionController({ store: db.store, completionMode: 'atomic', now: () => 1000 } as SessionControllerOptions)
    await c.load('regular')
    const pending = c.advanceManual()
    expect(c.getState()).toMatchObject({ status: 'completion', stage: 'pending' })
    await c.replaceSession(db.record.session, id, { instanceId: id, sessionId: db.record.sessionId, revision: 7 })
    await c.advanceManual()
    expect(db.store.replace).not.toHaveBeenCalled()
    release({ status: 'storage-error', code: 'transaction-failed' }); await pending
    expect(c.getState()).toMatchObject({ status: 'completion', stage: 'failed' })
    const original = db.commitResult.mock.calls[0]
    await c.retryPendingSave()
    expect(db.commitResult.mock.calls[1]).toEqual(original)
    expect(c.getState()).toEqual({ status: 'ready', snapshot: db.record })
    c.dispose()
  })

  it('does not replace or discard a final candidate while unresolved, even after an exception', async () => {
    const db = storage(fixture(false, 0))
    db.commitResult.mockRejectedValueOnce(Error('lost response'))
    const c = createSessionController({ store: db.store, completionMode: 'atomic' } as SessionControllerOptions)
    await c.load('regular'); await c.advanceManual()
    expect(c.getState()).toMatchObject({ status: 'completion', stage: 'uncertain' })
    c.discardLocalChanges()
    expect(c.getState().status).toBe('completion')
    c.dispose()
  })

  it.each(['conflict', 'corrupt-existing', 'unsupported-version'] as const)('fails closed for %s', async status => {
    const db = storage(fixture(false, 0))
    db.commitResult.mockResolvedValueOnce({ status, version: 9 } as never)
    const c = createSessionController({ store: db.store, completionMode: 'atomic' } as SessionControllerOptions)
    await c.load('regular'); await c.advanceManual(); await c.retryPendingSave()
    expect(c.getState()).toMatchObject({ status: 'completion', stage: status === 'conflict' ? 'conflict' : 'invalid' })
    expect(db.commitResult).toHaveBeenCalledTimes(1)
    expect(db.save).not.toHaveBeenCalled()
    c.dispose()
  })

  it('keeps default v1 callers on the old final save path', async () => {
    const db = storage(fixture(false, 0))
    const c = createSessionController({ store: db.store })
    await c.load('regular'); await c.advanceManual()
    expect(db.save).toHaveBeenCalledTimes(1)
    expect(db.commitResult).not.toHaveBeenCalled()
    c.dispose()
  })

  it('fails closed when atomic mode explicitly requires absent capability', async () => {
    const db = storage(fixture(false, 0))
    const v1: IndexedDbSessionStore = { ...db.store }
    delete (v1 as Partial<typeof db.store>).commitResult
    const c = createSessionController({ store: v1, completionMode: 'atomic' } as SessionControllerOptions)
    await c.load('regular'); await c.advanceManual()
    expect(c.getState()).toMatchObject({ status: 'completion', stage: 'invalid' })
    expect(db.save).not.toHaveBeenCalled()
    c.dispose()
  })

  it('retains Challenge weighted points and ordered Level 5 metadata', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const db = storage(fixture(true, 0.5))
    const before = structuredClone(db.record.score)
    const c = createSessionController({ store: db.store, completionMode: 'atomic' } as SessionControllerOptions)
    await c.load('challenge'); await vi.advanceTimersByTimeAsync(700)
    expect(db.commitResult).toHaveBeenCalledTimes(1)
    const args = db.commitResult.mock.calls[0] as unknown as [SavedSessionV1, unknown, { outcomes: { points: number; level5Sublevel?: string }[] }]
    expect(args[0].score).toEqual(before)
    expect(args[2].outcomes.map(o => o.points)).toEqual(db.record.session.questions.map(q => before.responses[q.key].points))
    expect(args[2].outcomes.some(o => o.level5Sublevel === 'dasar')).toBe(true)
    c.dispose()
  })

  it('ignores a stale timer after disposal and duplicate callbacks', async () => {
    let cb!: () => void | Promise<void>
    let now = 1000
    const db = storage()
    const c = createSessionController({ store: db.store, completionMode: 'atomic', now: () => now, timers: { setTimeout(f) { cb = f; return 1 }, clearTimeout() {} } } as SessionControllerOptions)
    await c.load('regular'); c.dispose(); now = 1700; await cb()
    expect(db.commitResult).not.toHaveBeenCalled()
    const c2 = createSessionController({ store: db.store, completionMode: 'atomic', now: () => now, timers: { setTimeout(f) { cb = f; return 1 }, clearTimeout() {} } } as SessionControllerOptions)
    await c2.load('regular'); await Promise.all([cb(), cb()])
    expect(db.commitResult).toHaveBeenCalledTimes(1)
    c2.dispose()
  })

  it('verifies a lost response and installs the persisted result without another commit', async () => {
    const db = storage(fixture(false, 0))
    const original = db.commitResult.getMockImplementation()!
    db.commitResult.mockImplementationOnce(async (...args) => { await original(...args); throw Error('lost response') })
    const c = createSessionController({ store: db.store, completionMode: 'atomic' })
    await c.load('regular'); await c.advanceManual()
    expect(c.getState()).toMatchObject({ status: 'completion', stage: 'uncertain' })
    await c.verifyPendingCompletion()
    expect(db.store.verifyCommitted).toHaveBeenCalledTimes(1)
    expect(c.getState()).toEqual({ status: 'ready', snapshot: db.record })
    expect(db.commitResult).toHaveBeenCalledTimes(1)
    c.dispose()
  })

  it('verifies not committed before retrying the same logical completion', async () => {
    const db = storage(fixture(false, 0))
    db.commitResult.mockRejectedValueOnce(Error('unknown before tx'))
    const c = createSessionController({ store: db.store, completionMode: 'atomic' })
    await c.load('regular'); await c.advanceManual()
    const args = db.commitResult.mock.calls[0]
    await c.verifyPendingCompletion()
    expect(db.store.verifyCommitted).toHaveBeenCalledTimes(1)
    expect(db.commitResult.mock.calls[1]).toEqual(args)
    expect(c.getState().status).toBe('ready')
    c.dispose()
  })

  it('reconciles during a pending promise and ignores its late stale failure', async () => {
    const db = storage(fixture(false, 0))
    const original = db.commitResult.getMockImplementation()!
    let release!: (v: AtomicCompletionResult) => void
    db.commitResult.mockImplementationOnce(async (...args) => { await original(...args); return new Promise(resolve => { release = resolve }) })
    const c = createSessionController({ store: db.store, completionMode: 'atomic' })
    await c.load('regular'); const writing = c.advanceManual(); await Promise.resolve()
    await c.verifyPendingCompletion()
    expect(c.getState()).toEqual({ status: 'ready', snapshot: db.record })
    release({ status: 'storage-error', code: 'transaction-failed' }); await writing
    expect(c.getState().status).toBe('ready')
    c.dispose()
  })

  it('checks history on atomic result reload without backfilling a legacy result', async () => {
    const db = storage(fixture(false, 0))
    db.record = { ...db.record, cursor: { ...db.record.cursor, phase: 'result' } }
    const c = createSessionController({ store: db.store, completionMode: 'atomic' })
    await c.load('regular')
    expect(c.getState()).toMatchObject({ status: 'completion', stage: 'invalid', code: 'missing-history' })
    expect(db.commitResult).not.toHaveBeenCalled()
    c.dispose()
    const projection = projectCompletedSession(db.record, { completedAt: 900, recordedAt: 900, provenance: 'new-atomic' })
    if (projection.status !== 'valid') throw Error('projection')
    db.records.set(id, projection.value)
    const reopened = createSessionController({ store: db.store, completionMode: 'atomic' })
    await reopened.load('regular')
    expect(reopened.getState()).toEqual({ status: 'ready', snapshot: db.record })
    expect(db.commitResult).not.toHaveBeenCalled()
    reopened.dispose()
  })

  it('keeps non-final answer, retry, and round writes on ordinary save', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const base = fixture(false, 1, 3)
    const g = base.session
    const db = storage({ ...base, score: createScoreState(g), cursor: { questionIndex: 0, phase: 'answering', pendingAdvanceAt: null } })
    const c = createSessionController({ store: db.store, completionMode: 'atomic' })
    await c.load('regular')
    const q = g.questions[0], wrong = q.choices.findIndex((_, i) => i !== q.correctChoiceIndex)
    await c.submitAnswer(wrong); await c.enableRetry(); await c.submitAnswer(q.correctChoiceIndex)
    await vi.advanceTimersByTimeAsync(700)
    expect(db.save).toHaveBeenCalledTimes(4)
    expect(db.commitResult).not.toHaveBeenCalled()
    expect(c.getState()).toMatchObject({ status: 'ready', snapshot: { cursor: { questionIndex: 1, phase: 'answering' } } })
    c.dispose()
  })

  it('can retry a failed history read on result reload without writing history', async () => {
    const db = storage(fixture(false, 0))
    db.record = { ...db.record, cursor: { ...db.record.cursor, phase: 'result' } }
    db.store.get.mockResolvedValueOnce({ status: 'storage-error', code: 'unavailable' } as never)
    const c = createSessionController({ store: db.store, completionMode: 'atomic' })
    await c.load('regular')
    expect(c.getState()).toMatchObject({ status: 'completion', stage: 'failed' })
    await c.retryPendingSave()
    expect(db.store.get).toHaveBeenCalledTimes(2)
    expect(c.getState()).toMatchObject({ status: 'completion', stage: 'invalid', code: 'missing-history' })
    expect(db.commitResult).not.toHaveBeenCalled()
    c.dispose()
  })

  it('does not notify or install late completion results after disposal', async () => {
    const db = storage(fixture(false, 0))
    let release!: (v: AtomicCompletionResult) => void
    db.commitResult.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const c = createSessionController({ store: db.store, completionMode: 'atomic' })
    await c.load('regular'); const pending = c.advanceManual()
    const state = c.getState(), notify = vi.fn(); c.subscribe(notify); c.dispose()
    release({ status: 'storage-error', code: 'transaction-failed' }); await pending
    expect(c.getState()).toBe(state); expect(notify).not.toHaveBeenCalled()
  })

  it('allows verification of a hanging initial history read and ignores its superseded response', async () => {
    const db = storage(fixture(false, 0))
    db.record = { ...db.record, cursor: { ...db.record.cursor, phase: 'result' } }
    const projection = projectCompletedSession(db.record, { completedAt: 1000, recordedAt: 1000, provenance: 'new-atomic' })
    if (projection.status !== 'valid') throw Error('fixture projection')
    db.records.set(id, projection.value)
    let release!: (r: never) => void
    db.store.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const c = createSessionController({ store: db.store, completionMode: 'atomic' })
    const loading = c.load('regular'); await Promise.resolve()
    expect(c.getState()).toMatchObject({ status: 'completion', stage: 'pending' })
    await c.verifyPendingCompletion()
    expect(c.getState().status).toBe('ready')
    release({ status: 'corrupt-existing' } as never); await loading
    expect(c.getState().status).toBe('ready')
    c.dispose()
  })

  it('treats an unexpected completion outcome as uncertain rather than claiming an abort', async () => {
    const db = storage(fixture(false, 0))
    db.commitResult.mockResolvedValueOnce({ status: 'storage-error', code: 'unexpected' })
    const c = createSessionController({ store: db.store, completionMode: 'atomic' })
    await c.load('regular'); await c.advanceManual()
    expect(c.getState()).toMatchObject({ status: 'completion', stage: 'uncertain' })
    c.dispose()
  })

  it('accepts an equivalent completion and installs exactly the adapter snapshot', async () => {
    const db = storage(fixture(false, 0))
    const implementation = db.commitResult.getMockImplementation()!
    db.commitResult.mockImplementationOnce(async (...args) => { const result = await implementation(...args); return { ...result, status: 'already-exists-equivalent' } as AtomicCompletionResult })
    const c = createSessionController({ store: db.store, completionMode: 'atomic' })
    await c.load('regular'); await c.advanceManual()
    expect(c.getState()).toEqual({ status: 'ready', snapshot: db.record })
    expect(db.records.size).toBe(1); c.dispose()
  })

  it.each(['conflict', 'corrupt-existing', 'unsupported-version'] as const)('fails closed on uncertain reconciliation returning %s', async status => {
    const db = storage(fixture(false, 0))
    db.commitResult.mockRejectedValueOnce(Error('unknown outcome'))
    db.store.verifyCommitted.mockResolvedValueOnce({ status, version: 9 } as CompletionVerificationResult)
    const c = createSessionController({ store: db.store, completionMode: 'atomic' })
    await c.load('regular'); await c.advanceManual(); await c.verifyPendingCompletion()
    expect(c.getState()).toMatchObject({ status: 'completion', stage: status === 'conflict' ? 'conflict' : 'invalid' })
    expect(db.commitResult).toHaveBeenCalledTimes(1); c.dispose()
  })

  it('routes only final auto advancement through atomic commit and installs the returned snapshot', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const db = storage()
    const c = createSessionController({ store: db.store, completionMode: 'atomic' } as SessionControllerOptions)
    await c.load('regular')
    expect(db.commitResult).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(699)
    expect(db.commitResult).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(db.commitResult).toHaveBeenCalledTimes(1)
    expect(db.save).not.toHaveBeenCalled()
    expect(c.getState()).toEqual({ status: 'ready', snapshot: db.record })
    expect(db.record.cursor.phase).toBe('result')
    c.dispose()
  })
})
