import { answerQuestion, createScoreState } from '../domain'
import type { ChallengeSession, DrillSession } from '../domain'
import type { SavedSession } from './sessionTypes'
import type { IndexedDbSessionStore, SavedSessionDraft, SessionConflictReason, SessionExpectation } from './indexedDbSessionStore'
import type { SavedSessionMode } from './sessionTypes'
import type { CompletedSessionHistoryStore } from './completedSessionHistoryStore'
import type { CompletedSessionRecord } from './completedSessionTypes'
import { createSessionTiming, finishSessionTiming } from './sessionTimer'
import type { SessionDurationMs } from './sessionTimer'
import { projectCompletedSession } from './completedSessionProjection'
import { compareCompletionContent } from './completedSessionCodec'

type CompletionCapability = Pick<CompletedSessionHistoryStore, 'commitResult' | 'verifyCommitted' | 'get'>
interface CompletionAttempt {
  readonly snapshot: SavedSession
  readonly expected: SessionExpectation
  readonly history: CompletedSessionRecord
}
export type CompletionStage = 'pending' | 'failed' | 'uncertain' | 'conflict' | 'invalid'

export const AUTO_ADVANCE_DELAY_MS = 700

export interface SessionControllerOptions {
  readonly store: IndexedDbSessionStore
  /** Explicit opt-in only; ordinary Stage 3 callers remain snapshot-only. */
  readonly completionMode?: 'atomic'
  readonly now?: () => number
  readonly timers?: SessionControllerTimers
}

export interface SessionControllerTimers {
  setTimeout(callback: () => void | Promise<void>, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export type SessionControllerState =
  | { readonly status: 'empty' }
  | { readonly status: 'loading'; readonly mode: SavedSessionMode }
  | { readonly status: 'ready'; readonly snapshot: SavedSession }
  | { readonly status: 'completion'; readonly snapshot: SavedSession; readonly stage: CompletionStage; readonly code?: string }
  | { readonly status: 'saving'; readonly snapshot: SavedSessionDraft | SavedSession; readonly operation: 'create' | 'save' | 'replace' }
  | { readonly status: 'failed'; readonly operation: 'load'; readonly mode: SavedSessionMode; readonly code: string }
  | { readonly status: 'failed'; readonly snapshot: SavedSessionDraft | SavedSession; readonly operation: 'create' | 'save' | 'replace'; readonly code: string; readonly expected?: SessionExpectation }
  | { readonly status: 'conflict'; readonly snapshot: SavedSessionDraft | SavedSession; readonly operation: 'create' | 'save' | 'replace'; readonly reason: SessionConflictReason }
  | { readonly status: 'unrecoverable'; readonly mode: SavedSessionMode; readonly result: Extract<import('./indexedDbSessionStore').SessionLoadResult, { status: 'corrupt' | 'unsupported-version' }> }

export interface SessionController {
  getState(): SessionControllerState
  subscribe(listener: () => void): () => void
  load(mode: SavedSessionMode): Promise<SessionControllerState>
  reloadFromStorage(mode: SavedSessionMode): Promise<SessionControllerState>
  startSession(session: DrillSession | ChallengeSession, instanceId: string, durationMs?: SessionDurationMs): Promise<SessionControllerState>
  replaceSession(session: DrillSession | ChallengeSession, instanceId: string, expected: SessionExpectation, durationMs?: SessionDurationMs): Promise<SessionControllerState>
  submitAnswer(choiceIndex: number): Promise<SessionControllerState>
  enableRetry(): Promise<SessionControllerState>
  retryPendingSave(): Promise<SessionControllerState>
  verifyPendingCompletion(): Promise<SessionControllerState>
  dismissInvalidCompletion(): SessionControllerState
  discardLocalChanges(): void
  advanceManual(): Promise<SessionControllerState>
  continueRound(): Promise<SessionControllerState>
  dispose(): void
}

interface AdvanceToken {
  readonly instanceId: string
  readonly revision: number
  readonly questionIndex: number
  readonly phase: 'auto-advance'
}

const defaultTimers: SessionControllerTimers = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(() => { void callback() }, delayMs),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
}

export function createSessionController(options: SessionControllerOptions): SessionController {
  let state: SessionControllerState = { status: 'empty' }
  let disposed = false
  const listeners = new Set<() => void>()
  const clock = options.now ?? Date.now
  const timers = options.timers ?? defaultTimers
  let timerHandle: unknown = null
  let timeoutHandle: unknown = null
  let completion: CompletionAttempt | null = null
  let invalidCompletion: SavedSession | null = null
  let completionEpoch = 0
  let reconciling = false
  const candidate = options.store as IndexedDbSessionStore & Partial<CompletionCapability>
  const atomic = typeof candidate.commitResult === 'function' && typeof candidate.verifyCommitted === 'function' && typeof candidate.get === 'function'
    ? candidate as IndexedDbSessionStore & CompletionCapability : null

  const setState = (next: SessionControllerState) => {
    if (disposed || next === state) return
    state = next
    for (const listener of [...listeners]) {
      if (disposed) break
      if (!listeners.has(listener)) continue
      try { listener() } catch { /* Listener failures must not affect controller operations. */ }
    }
  }

  const clearTimer = () => {
    if (timerHandle !== null) timers.clearTimeout(timerHandle)
    if (timeoutHandle !== null) timers.clearTimeout(timeoutHandle)
    timerHandle = null
    timeoutHandle = null
  }

  const clearAdvanceTimer = () => {
    if (timerHandle !== null) timers.clearTimeout(timerHandle)
    timerHandle = null
  }

  const scheduleAutoAdvance = (snapshot: SavedSession) => {
    clearAdvanceTimer()
    if (disposed) return
    if (state.status === 'ready') scheduleDeadline(snapshot)
    if (state.status !== 'ready' || snapshot.cursor.phase !== 'auto-advance' || snapshot.cursor.pendingAdvanceAt === null) return
    const token: AdvanceToken = {
      instanceId: snapshot.instanceId,
      revision: snapshot.revision,
      questionIndex: snapshot.cursor.questionIndex,
      phase: 'auto-advance',
    }
    const delay = Math.max(0, snapshot.cursor.pendingAdvanceAt - clock())
    let handle: unknown
    handle = timers.setTimeout(() => {
      if (timerHandle === handle) timerHandle = null
      return advanceAuto(token)
    }, delay)
    timerHandle = handle
  }

  const scheduleDeadline = (snapshot: SavedSession) => {
    if (timeoutHandle !== null) timers.clearTimeout(timeoutHandle)
    timeoutHandle = null
    if (disposed || snapshot.schemaVersion !== 2 || snapshot.timing.deadlineAt === null || snapshot.cursor.phase === 'result' || snapshot.cursor.phase === 'timeout') return
    const deadlineAt = snapshot.timing.deadlineAt
    const delay = Math.max(0, deadlineAt - clock())
    let handle: unknown
    handle = timers.setTimeout(() => {
      if (timeoutHandle === handle) timeoutHandle = null
      return checkDeadline(snapshot)
    }, delay)
    timeoutHandle = handle
  }

  const nextAfterCompleted = (snapshot: SavedSession): SavedSession | null => {
    const questionIndex = snapshot.cursor.questionIndex
    const question = snapshot.session.questions[questionIndex]
    if (!question || snapshot.score.responses[question.key]?.status !== 'completed') return null
    if (questionIndex + 1 >= snapshot.session.questions.length) return {
      ...snapshot,
      cursor: { questionIndex, phase: 'result', pendingAdvanceAt: null },
    }
    if ((questionIndex + 1) % snapshot.session.roundSize === 0) return {
      ...snapshot,
      cursor: { questionIndex, phase: 'round', pendingAdvanceAt: null },
    }
    return { ...snapshot, cursor: { questionIndex: questionIndex + 1, phase: 'answering', pendingAdvanceAt: null } }
  }

  async function advanceAuto(token: AdvanceToken): Promise<void> {
    if (disposed || state.status !== 'ready') return
    const current = state.snapshot
    if (current.instanceId !== token.instanceId || current.revision !== token.revision
      || current.cursor.questionIndex !== token.questionIndex || current.cursor.phase !== token.phase) return
    const deadline = current.cursor.pendingAdvanceAt
    if (deadline === null) return
    if (clock() < deadline) { scheduleAutoAdvance(current); return }
    const snapshot = nextAfterCompleted(current)
    if (snapshot) await saveSnapshot(current, snapshot)
  }

  const commitCompletion = async (attempt: CompletionAttempt): Promise<SessionControllerState> => {
    const epoch = ++completionEpoch
    clearTimer()
    setState({ status: 'completion', snapshot: attempt.snapshot, stage: 'pending' })
    if (disposed) return state
    if (!atomic) { setState({ status: 'completion', snapshot: attempt.snapshot, stage: 'invalid', code: 'atomic-capability-unavailable' }); return state }
    try {
      const result = await atomic.commitResult(attempt.snapshot, attempt.expected, attempt.history)
      if (disposed || epoch !== completionEpoch) return state
      if (result.status === 'inserted' || result.status === 'already-exists-equivalent') setState({ status: 'ready', snapshot: result.snapshot })
      else setState({ status: 'completion', snapshot: attempt.snapshot,
        stage: result.status === 'active-session-conflict' || result.status === 'conflict' ? 'conflict' : result.status === 'storage-error' ? result.code === 'unexpected' ? 'uncertain' : 'failed' : 'invalid',
        code: result.status === 'storage-error' ? result.code : result.status })
    } catch { if (!disposed && epoch === completionEpoch) setState({ status: 'completion', snapshot: attempt.snapshot, stage: 'uncertain', code: 'unconfirmed' }) }
    return state
  }

  // Readback never rescoring: install only the actual stored snapshot, checked
  // against the original canonical completion after the pair was verified.
  const reconcileCompletion = async (attempt: CompletionAttempt): Promise<SessionControllerState> => {
    if (disposed || reconciling || !atomic) return state
    reconciling = true
    const epoch = ++completionEpoch
    setState({ status: 'completion', snapshot: attempt.snapshot, stage: 'pending' })
    try {
      if (disposed) return state
      const verified = await atomic.verifyCommitted(attempt.snapshot, attempt.history)
      if (disposed || epoch !== completionEpoch) return state
      if (verified.status === 'not-committed') return await commitCompletion(attempt)
      if (verified.status !== 'committed') {
        setState({ status: 'completion', snapshot: attempt.snapshot, stage: verified.status === 'conflict' ? 'conflict' : verified.status === 'storage-error' ? 'uncertain' : 'invalid', code: verified.status === 'storage-error' ? verified.code : verified.status })
        return state
      }
      const persisted = await options.store.load(attempt.snapshot.mode)
      if (disposed || epoch !== completionEpoch) return state
      if (persisted.status === 'valid') {
        const projected = projectCompletedSession(persisted.value, attempt.history)
        if (projected.status === 'valid' && compareCompletionContent(projected.value, attempt.history) === 'equivalent') {
          setState({ status: 'ready', snapshot: persisted.value }); return state
        }
      }
      setState({ status: 'completion', snapshot: attempt.snapshot, stage: persisted.status === 'storage-error' ? 'uncertain' : persisted.status === 'corrupt' || persisted.status === 'unsupported-version' ? 'invalid' : 'conflict', code: persisted.status })
    } catch { if (!disposed && epoch === completionEpoch) setState({ status: 'completion', snapshot: attempt.snapshot, stage: 'uncertain', code: 'unconfirmed' }) }
    finally { reconciling = false }
    return state
  }

  const saveSnapshot = async (current: SavedSession, snapshot: SavedSession): Promise<SessionControllerState> => {
    let candidateSnapshot = snapshot
    if (options.completionMode === 'atomic' && snapshot.schemaVersion === 2) {
      const deadlineAt = snapshot.timing.deadlineAt
      const expired = deadlineAt !== null && clock() >= deadlineAt
      const terminal = snapshot.cursor.phase === 'result' || snapshot.cursor.phase === 'timeout' || expired
      if (terminal) {
        const endReason = snapshot.cursor.phase === 'timeout' || expired ? 'timeout' : 'completed'
        const endedAt = endReason === 'timeout' ? Math.max(clock(), deadlineAt ?? clock()) : clock()
        candidateSnapshot = {
          ...snapshot,
          timing: snapshot.timing.endReason === null ? finishSessionTiming(snapshot.timing, endReason, endedAt) : snapshot.timing,
          cursor: { ...snapshot.cursor, phase: endReason === 'timeout' ? 'timeout' : 'result', pendingAdvanceAt: null },
        }
      }
      if (candidateSnapshot.schemaVersion === 2 && (candidateSnapshot.cursor.phase === 'result' || candidateSnapshot.cursor.phase === 'timeout')) {
        const projected = projectCompletedSession(candidateSnapshot, { recordedAt: Math.max(clock(), candidateSnapshot.timing.endedAt ?? clock()) })
        if (projected.status !== 'valid') { setState({ status: 'completion', snapshot: candidateSnapshot, stage: 'invalid', code: projected.status }); return state }
        const attempt: CompletionAttempt = { snapshot: candidateSnapshot, expected: { instanceId: current.instanceId, sessionId: current.sessionId, revision: current.revision }, history: projected.value }
        completion = attempt
        return commitCompletion(attempt)
      }
    }
    if (options.completionMode === 'atomic' && snapshot.schemaVersion === 1 && snapshot.cursor.phase === 'result') {
      const at = clock()
      const projected = projectCompletedSession(snapshot, { completedAt: at, recordedAt: at, provenance: 'new-atomic' })
      if (projected.status !== 'valid') { setState({ status: 'completion', snapshot, stage: 'invalid', code: projected.status }); return state }
      const attempt: CompletionAttempt = { snapshot, expected: { instanceId: current.instanceId, sessionId: current.sessionId, revision: current.revision }, history: projected.value }
      completion = attempt
      return commitCompletion(attempt)
    }
    setState({ status: 'saving', snapshot: candidateSnapshot, operation: 'save' })
    if (disposed) return state
    try {
      const result = await options.store.save(candidateSnapshot, {
        instanceId: current.instanceId,
        sessionId: current.sessionId,
        revision: current.revision,
      })
      if (result.status === 'success') {
        setState({ status: 'ready', snapshot: result.value })
        scheduleAutoAdvance(result.value)
      }
      else if (result.status === 'conflict') setState({ status: 'conflict', snapshot: candidateSnapshot, operation: 'save', reason: result.reason })
      else if (result.status === 'corrupt' || result.status === 'unsupported-version') setState({ status: 'unrecoverable', mode: candidateSnapshot.mode, result })
      else setState({ status: 'failed', snapshot: candidateSnapshot, operation: 'save', code: result.code })
    } catch {
      setState({ status: 'failed', snapshot: candidateSnapshot, operation: 'save', code: 'unexpected' })
    }
    return state
  }

  const checkDeadline = async (scheduled: SavedSession): Promise<void> => {
    if (disposed) return
    if (state.status === 'saving' || state.status === 'loading') {
      if (timeoutHandle === null) {
        let handle: unknown
        handle = timers.setTimeout(() => {
          if (timeoutHandle === handle) timeoutHandle = null
          void checkDeadline(scheduled)
        }, 50)
        timeoutHandle = handle
      }
      return
    }
    if (state.status !== 'ready') return
    const current = state.snapshot
    if (current.mode !== scheduled.mode || current.instanceId !== scheduled.instanceId || current.sessionId !== scheduled.sessionId
      || current.schemaVersion !== 2 || scheduled.schemaVersion !== 2
      || current.timing.deadlineAt === null || current.timing.deadlineAt !== scheduled.timing.deadlineAt
      || current.cursor.phase === 'result' || current.cursor.phase === 'timeout') return
    if (clock() < current.timing.deadlineAt) { scheduleDeadline(current); return }
    const endedAt = Math.max(clock(), current.timing.deadlineAt)
    await saveSnapshot(current, {
      ...current,
      timing: finishSessionTiming(current.timing, 'timeout', endedAt),
      cursor: { questionIndex: current.cursor.questionIndex, phase: 'timeout', pendingAdvanceAt: null },
    })
  }

  const onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible' && state.status === 'ready') void checkDeadline(state.snapshot)
  }

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)

  const makeDraft = (session: DrillSession | ChallengeSession, instanceId: string, durationMs?: SessionDurationMs): SavedSessionDraft => {
    const copy = structuredClone(session)
    const mode = 'kind' in copy && copy.kind === 'challenge' ? 'challenge' : 'regular'
    const base = {
      instanceId,
      sessionId: copy.id,
      score: createScoreState(copy),
      cursor: { questionIndex: 0, phase: 'answering' as const, pendingAdvanceAt: null },
    }
    if (options.completionMode === 'atomic') {
      const timedBase = { ...base, schemaVersion: 2 as const, timing: createSessionTiming(durationMs ?? null, clock()) }
      return mode === 'challenge' ? { ...timedBase, mode, session: copy as ChallengeSession } : { ...timedBase, mode, session: copy as DrillSession }
    }
    const legacyBase = { ...base, schemaVersion: 1 as const }
    return mode === 'challenge'
      ? { ...legacyBase, mode, session: copy as ChallengeSession }
      : { ...legacyBase, mode, session: copy as DrillSession }
  }

  const loadFromStorage = async (mode: SavedSessionMode, recheck = false): Promise<SessionControllerState> => {
    if (disposed || state.status === 'saving' || state.status === 'loading' || (!recheck && state.status === 'completion' && (state.stage === 'pending' || state.stage === 'uncertain'))) return state
    clearTimer()
    const loadEpoch = ++completionEpoch
    completion = null
    setState({ status: 'loading', mode })
    if (disposed) return state
    try {
      const result = await options.store.load(mode)
      if (disposed || loadEpoch !== completionEpoch) return state
      if (result.status === 'valid') {
        if (options.completionMode === 'atomic' && (result.value.cursor.phase === 'result' || result.value.cursor.phase === 'timeout')) {
          const snapshot = result.value
          setState({ status: 'completion', snapshot, stage: 'pending' })
          if (disposed) return state
          if (!atomic) { setState({ status: 'completion', snapshot, stage: 'invalid', code: 'atomic-capability-unavailable' }); return state }
          const history = await atomic.get(snapshot.instanceId)
          if (disposed || loadEpoch !== completionEpoch) return state
          if (history.status !== 'found') {
            setState({ status: 'completion', snapshot, stage: history.status === 'storage-error' ? 'failed' : 'invalid', code: history.status === 'not-found' ? 'missing-history' : history.status })
            return state
          }
          completion = { snapshot, history: history.value, expected: { instanceId: snapshot.instanceId, sessionId: snapshot.sessionId, revision: snapshot.revision } }
          return reconcileCompletion(completion)
        }
        setState({ status: 'ready', snapshot: result.value })
        scheduleAutoAdvance(result.value)
      } else if (result.status === 'empty') setState({ status: 'empty' })
      else if (result.status === 'corrupt' || result.status === 'unsupported-version') setState({ status: 'unrecoverable', mode, result })
      else setState({ status: 'failed', operation: 'load', mode, code: result.code })
    } catch {
      if (!disposed && loadEpoch === completionEpoch) setState({ status: 'failed', operation: 'load', mode, code: 'unexpected' })
    }
    return state
  }

  return {
    getState: () => state,
    subscribe(listener) {
      if (disposed) return () => undefined
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    load: loadFromStorage,
    reloadFromStorage: loadFromStorage,
    async startSession(session, instanceId, durationMs) {
      if (disposed || state.status !== 'empty') return state
      const snapshot = makeDraft(session, instanceId, durationMs)
      const replaceTarget = invalidCompletion
      invalidCompletion = null
      const operation = replaceTarget ? 'replace' as const : 'create' as const
      const expected = replaceTarget ? { instanceId: replaceTarget.instanceId, sessionId: replaceTarget.sessionId, revision: replaceTarget.revision } : undefined
      setState({ status: 'saving', snapshot, operation })
      if (disposed) return state
      let result
      try {
        result = replaceTarget
          ? await options.store.replace(snapshot, expected!)
          : await options.store.create(snapshot)
      } catch {
        setState(expected
          ? { status: 'failed', snapshot, operation: 'replace', code: 'unexpected', expected }
          : { status: 'failed', snapshot, operation: 'create', code: 'unexpected' })
        return state
      }
      if (result.status === 'success') { setState({ status: 'ready', snapshot: result.value }); scheduleAutoAdvance(result.value) }
      else if (result.status === 'storage-error') setState(expected
        ? { status: 'failed', snapshot, operation: 'replace', code: result.code, expected }
        : { status: 'failed', snapshot, operation: 'create', code: result.code })
      else if (result.status === 'conflict') setState({ status: 'conflict', snapshot, operation, reason: result.reason })
      else setState({ status: 'unrecoverable', mode: snapshot.mode, result })
      return state
    },
    async replaceSession(session, instanceId, expected, durationMs) {
      if (disposed || state.status === 'saving' || state.status === 'loading' || state.status === 'completion') return state
      const snapshot = makeDraft(session, instanceId, durationMs)
      clearTimer()
      setState({ status: 'saving', snapshot, operation: 'replace' })
      if (disposed) return state
      try {
        const result = await options.store.replace(snapshot, expected)
        if (result.status === 'success') {
          setState({ status: 'ready', snapshot: result.value })
          scheduleAutoAdvance(result.value)
        } else if (result.status === 'conflict') setState({ status: 'conflict', snapshot, operation: 'replace', reason: result.reason })
        else if (result.status === 'storage-error') setState({ status: 'failed', snapshot, operation: 'replace', code: result.code, expected })
        else setState({ status: 'unrecoverable', mode: snapshot.mode, result })
      } catch {
        setState({ status: 'failed', snapshot, operation: 'replace', code: 'unexpected', expected })
      }
      return state
    },
    verifyPendingCompletion: async () => {
      if (!disposed && state.status === 'completion' && state.stage === 'pending' && !completion) return loadFromStorage(state.snapshot.mode, true)
      if (disposed || state.status !== 'completion' || !completion || (state.stage !== 'pending' && state.stage !== 'uncertain')) return state
      return reconcileCompletion(completion)
    },
    async retryPendingSave() {
      if (!disposed && state.status === 'completion' && state.stage === 'uncertain' && completion) return reconcileCompletion(completion)
      if (!disposed && state.status === 'completion' && state.stage === 'failed') return completion ? commitCompletion(completion) : loadFromStorage(state.snapshot.mode)
      if (disposed || state.status !== 'failed' || state.operation === 'load') return state
      const failed = state
      if (failed.operation === 'save') return saveSnapshot(failed.snapshot as SavedSession, failed.snapshot as SavedSession)
      if (failed.operation === 'create') {
        setState({ status: 'saving', snapshot: failed.snapshot, operation: 'create' })
        if (disposed) return state
        try {
          const result = await options.store.create(failed.snapshot as SavedSessionDraft)
          if (result.status === 'success') { setState({ status: 'ready', snapshot: result.value }); scheduleAutoAdvance(result.value) }
          else if (result.status === 'conflict') setState({ status: 'conflict', snapshot: failed.snapshot, operation: 'create', reason: result.reason })
          else if (result.status === 'storage-error') setState({ status: 'failed', snapshot: failed.snapshot, operation: 'create', code: result.code })
          else setState({ status: 'unrecoverable', mode: failed.snapshot.mode, result })
        } catch { setState({ status: 'failed', snapshot: failed.snapshot, operation: 'create', code: 'unexpected' }) }
        return state
      }
      if (!failed.expected) return state
      setState({ status: 'saving', snapshot: failed.snapshot, operation: 'replace' })
      if (disposed) return state
      try {
        const result = await options.store.replace(failed.snapshot as SavedSessionDraft, failed.expected)
        if (result.status === 'success') { setState({ status: 'ready', snapshot: result.value }); scheduleAutoAdvance(result.value) }
        else if (result.status === 'conflict') setState({ status: 'conflict', snapshot: failed.snapshot, operation: 'replace', reason: result.reason })
        else if (result.status === 'storage-error') setState({ status: 'failed', snapshot: failed.snapshot, operation: 'replace', code: result.code, expected: failed.expected })
        else setState({ status: 'unrecoverable', mode: failed.snapshot.mode, result })
      } catch { setState({ status: 'failed', snapshot: failed.snapshot, operation: 'replace', code: 'unexpected', expected: failed.expected }) }
      return state
    },
    dismissInvalidCompletion() {
      if (disposed || state.status !== 'completion' || state.stage !== 'invalid') return state
      invalidCompletion = state.snapshot
      clearTimer()
      completion = null
      setState({ status: 'empty' })
      return state
    },
    discardLocalChanges() {
      if (disposed || state.status === 'saving' || state.status === 'loading' || state.status === 'completion') return
      clearTimer()
      setState({ status: 'empty' })
    },
    async submitAnswer(choiceIndex) {
      if (disposed || state.status !== 'ready' || state.snapshot.cursor.phase !== 'answering') return state
      const current = state.snapshot
      if (current.schemaVersion === 2 && current.timing.deadlineAt !== null && clock() >= current.timing.deadlineAt) {
        const endedAt = Math.max(clock(), current.timing.deadlineAt)
        return saveSnapshot(current, { ...current, timing: finishSessionTiming(current.timing, 'timeout', endedAt), cursor: { ...current.cursor, phase: 'timeout', pendingAdvanceAt: null } })
      }
      const question = current.session.questions[current.cursor.questionIndex]
      if (!question) return state
      const answer = answerQuestion(current.score, current.session, question.key, choiceIndex)
      if (!answer.ok) return state
      const response = answer.state.responses[question.key]
      const phase = response.status === 'awaiting-second-attempt'
        ? 'retry-prompt'
        : response.points > 0 ? 'auto-advance' : 'manual-advance'
      const snapshot: SavedSession = {
        ...current,
        score: answer.state,
        cursor: {
          questionIndex: current.cursor.questionIndex,
          phase,
          pendingAdvanceAt: phase === 'auto-advance' ? clock() + AUTO_ADVANCE_DELAY_MS : null,
        },
      }
      return saveSnapshot(current, snapshot)
    },
    async enableRetry() {
      if (disposed || state.status !== 'ready' || state.snapshot.cursor.phase !== 'retry-prompt') return state
      const current = state.snapshot
      const snapshot: SavedSession = {
        ...current,
        cursor: { questionIndex: current.cursor.questionIndex, phase: 'answering', pendingAdvanceAt: null },
      }
      return saveSnapshot(current, snapshot)
    },
    async advanceManual() {
      if (disposed || state.status !== 'ready' || state.snapshot.cursor.phase !== 'manual-advance') return state
      const current = state.snapshot
      const question = current.session.questions[current.cursor.questionIndex]
      if (!question || current.score.responses[question.key]?.status !== 'completed') return state
      const nextIndex = current.cursor.questionIndex + 1
      const phase = nextIndex >= current.session.questions.length
        ? 'result'
        : nextIndex % current.session.roundSize === 0 ? 'round' : 'answering'
      const questionIndex = phase === 'answering' ? nextIndex : current.cursor.questionIndex
      return saveSnapshot(current, {
        ...current,
        cursor: { questionIndex, phase, pendingAdvanceAt: null },
      })
    },
    async continueRound() {
      if (disposed || state.status !== 'ready' || state.snapshot.cursor.phase !== 'round') return state
      const current = state.snapshot
      const nextIndex = current.cursor.questionIndex + 1
      if (nextIndex >= current.session.questions.length) return state
      return saveSnapshot(current, {
        ...current,
        cursor: { questionIndex: nextIndex, phase: 'answering', pendingAdvanceAt: null },
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      clearTimer()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
      listeners.clear()
    },
  }
}
