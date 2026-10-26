import { describe, expect, it, vi } from 'vitest'
import { answerQuestion, createScoreState, generateChallengeSession, generateSession } from '../src/features/math-drill/domain'
import type { IndexedDbSessionStore, SessionLoadResult, SessionWriteResult } from '../src/features/math-drill/persistence/indexedDbSessionStore'
import type { SavedSessionDraft, SavedSessionV1 } from '../src/features/math-drill/persistence/sessionTypes'
import { createSessionController } from '../src/features/math-drill/persistence/sessionController'
import { validateSavedSession } from '../src/features/math-drill/persistence/sessionCodec'

const instanceId = '550e8400-e29b-41d4-a716-446655440000'

function regularSession() {
  const generated = generateSession({ level: 1, mode: 'addition', count: 3, seed: 501, roundSize: 2 })
  if (!generated.ok) throw new Error(`Fixture generation failed: ${generated.error.code}`)
  return generated.session
}

function challengeSession() {
  const generated = generateChallengeSession({ selectedLevels: [1], selectedLevel5Sublevels: [], mode: 'mixed', count: 10, seed: 502, roundSize: 2 })
  if (!generated.ok) throw new Error(`Fixture generation failed: ${generated.error.code}`)
  return generated.session
}

function wrongChoiceIndex(question: { readonly choices: readonly number[]; readonly correctChoiceIndex: number }) {
  return question.choices.findIndex((_choice, index) => index !== question.correctChoiceIndex)
}

function anotherWrongChoiceIndex(question: { readonly choices: readonly number[]; readonly correctChoiceIndex: number }, previous: number) {
  return question.choices.findIndex((_choice, index) => index !== question.correctChoiceIndex && index !== previous)
}

function fakeTimers(start = 1000) {
  let currentTime = start
  let nextId = 0
  const tasks = new Map<number, { readonly callback: () => void | Promise<void>; readonly dueAt: number }>()
  return {
    now: () => currentTime,
    pendingCount: () => tasks.size,
    setTimeout(callback: () => void | Promise<void>, delayMs: number) {
      const id = ++nextId
      tasks.set(id, { callback, dueAt: currentTime + delayMs })
      return id
    },
    clearTimeout(handle: unknown) { tasks.delete(handle as number) },
    async advanceBy(deltaMs: number) {
      const target = currentTime + deltaMs
      while (true) {
        const due = [...tasks.entries()].filter(([, task]) => task.dueAt <= target).sort((a, b) => a[1].dueAt - b[1].dueAt)[0]
        if (!due) break
        tasks.delete(due[0])
        currentTime = due[1].dueAt
        await due[1].callback()
      }
      currentTime = target
    },
    async fireNextTwice() {
      const next = tasks.entries().next().value as [number, { readonly callback: () => void | Promise<void>; readonly dueAt: number }] | undefined
      if (!next) throw new Error('No timer is pending')
      tasks.delete(next[0])
      currentTime = Math.max(currentTime, next[1].dueAt)
      await Promise.all([next[1].callback(), next[1].callback()])
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function snapshotForPhase(phase: SavedSessionV1['cursor']['phase'], pendingAdvanceAt: number | null = null, cursorQuestionIndex = 0): SavedSessionV1 {
  const session = regularSession()
  let score = createScoreState(session)
  const complete = (index: number) => {
    const answer = answerQuestion(score, session, session.questions[index].key, session.questions[index].correctChoiceIndex)
    if (!answer.ok) throw new Error('Fixture answer rejected')
    score = answer.state
  }
  let questionIndex = cursorQuestionIndex
  if (phase === 'retry-prompt') {
    const question = session.questions[0]
    const answer = answerQuestion(score, session, question.key, wrongChoiceIndex(question))
    if (!answer.ok) throw new Error('Fixture answer rejected')
    score = answer.state
  } else if (phase === 'manual-advance') {
    const question = session.questions[0]
    const firstWrong = wrongChoiceIndex(question)
    const first = answerQuestion(score, session, question.key, firstWrong)
    if (!first.ok) throw new Error('Fixture answer rejected')
    const second = answerQuestion(first.state, session, question.key, anotherWrongChoiceIndex(question, firstWrong))
    if (!second.ok) throw new Error('Fixture second answer rejected')
    score = second.state
  } else if (phase === 'auto-advance') {
    for (let index = 0; index <= cursorQuestionIndex; index += 1) complete(index)
  } else if (phase === 'round') { complete(0); complete(1); questionIndex = 1 }
  else if (phase === 'result') {
    session.questions.forEach((_question, index) => complete(index))
    questionIndex = session.questions.length - 1
  }
  const candidate: SavedSessionV1 = {
    schemaVersion: 1,
    mode: 'regular',
    instanceId,
    sessionId: session.id,
    revision: 4,
    createdAt: 100,
    updatedAt: 400,
    session,
    score,
    cursor: { questionIndex, phase, pendingAdvanceAt: phase === 'auto-advance' ? pendingAdvanceAt ?? 1700 : null },
  }
  const validation = validateSavedSession(candidate)
  if (validation.status !== 'valid') throw new Error(`Invalid ${phase} fixture: ${validation.status}`)
  return validation.value
}

interface TestStore extends IndexedDbSessionStore {
  readonly records: Map<string, SavedSessionV1>
  readonly writes: Array<{ readonly kind: 'create' | 'save' | 'replace'; readonly snapshot: SavedSessionDraft | SavedSessionV1 }>
  nextWriteResult: SessionWriteResult | null
  loadOverride: SessionLoadResult | null
  beforeNextWrite: (() => Promise<void>) | null
}

function storage(now: () => number = () => 1000): TestStore {
  const records = new Map<string, SavedSessionV1>()
  const fake: TestStore = {
    records,
    writes: [],
    nextWriteResult: null,
    loadOverride: null,
    beforeNextWrite: null,
    load: vi.fn(async mode => {
      if (fake.loadOverride) {
        const result = fake.loadOverride
        fake.loadOverride = null
        return result
      }
      const value = records.get(mode)
      return value ? { status: 'valid' as const, value } : { status: 'empty' as const }
    }),
    create: vi.fn(async snapshot => {
      fake.writes.push({ kind: 'create', snapshot })
      if (fake.beforeNextWrite) { const wait = fake.beforeNextWrite; fake.beforeNextWrite = null; await wait() }
      if (fake.nextWriteResult) { const result = fake.nextWriteResult; fake.nextWriteResult = null; return result }
      if (records.has(snapshot.mode)) return { status: 'conflict' as const, reason: 'slot-exists' as const }
      const createdAt = now()
      const updatedAt = now()
      const checked = validateSavedSession({ ...snapshot, revision: 1, createdAt, updatedAt })
      if (checked.status !== 'valid') return checked.status === 'corrupt'
        ? { status: 'corrupt' as const, issues: checked.issues }
        : { status: 'unsupported-version' as const, versionKind: checked.versionKind, version: checked.version }
      const value = checked.value
      records.set(value.mode, value)
      return { status: 'success' as const, value }
    }),
    save: vi.fn(async (snapshot, expected) => {
      fake.writes.push({ kind: 'save', snapshot })
      if (fake.beforeNextWrite) { const wait = fake.beforeNextWrite; fake.beforeNextWrite = null; await wait() }
      if (fake.nextWriteResult) { const result = fake.nextWriteResult; fake.nextWriteResult = null; return result }
      const checked = validateSavedSession(snapshot)
      if (checked.status !== 'valid') return checked.status === 'corrupt'
        ? { status: 'corrupt' as const, issues: checked.issues }
        : { status: 'unsupported-version' as const, versionKind: checked.versionKind, version: checked.version }
      const current = records.get(snapshot.mode)
      if (!current || current.instanceId !== expected.instanceId || current.sessionId !== expected.sessionId || current.revision !== expected.revision) {
        return { status: 'conflict' as const, reason: 'revision-mismatch' as const }
      }
      const next = validateSavedSession({ ...snapshot, revision: current.revision + 1, createdAt: current.createdAt, updatedAt: Math.max(now(), current.updatedAt) })
      if (next.status !== 'valid') return next.status === 'corrupt'
        ? { status: 'corrupt' as const, issues: next.issues }
        : { status: 'unsupported-version' as const, versionKind: next.versionKind, version: next.version }
      const value = next.value
      records.set(value.mode, value)
      return { status: 'success' as const, value }
    }),
    replace: vi.fn(async (snapshot, expected) => {
      fake.writes.push({ kind: 'replace', snapshot })
      if (fake.beforeNextWrite) { const wait = fake.beforeNextWrite; fake.beforeNextWrite = null; await wait() }
      if (fake.nextWriteResult) { const result = fake.nextWriteResult; fake.nextWriteResult = null; return result }
      const current = records.get(snapshot.mode)
      if (!current || current.instanceId !== expected.instanceId || current.sessionId !== expected.sessionId || current.revision !== expected.revision) {
        return { status: 'conflict' as const, reason: 'revision-mismatch' as const }
      }
      const timestamp = now()
      const checked = validateSavedSession({ ...snapshot, revision: current.revision + 1, createdAt: timestamp, updatedAt: timestamp })
      if (checked.status !== 'valid') return checked.status === 'corrupt'
        ? { status: 'corrupt' as const, issues: checked.issues }
        : { status: 'unsupported-version' as const, versionKind: checked.versionKind, version: checked.version }
      const value = checked.value
      records.set(value.mode, value)
      return { status: 'success' as const, value }
    }),
    close: vi.fn(),
  }
  return fake
}

describe('session state controller', () => {
  it('notifies subscribers on state changes and returns stable state references between changes', async () => {
    const controller = createSessionController({ store: storage(), now: () => 1000 })
    const notifications: string[] = []
    const listener = vi.fn(() => notifications.push(controller.getState().status))
    const unsubscribe = controller.subscribe(listener)
    const initial = controller.getState()
    expect(controller.getState()).toBe(initial)
    expect(listener).not.toHaveBeenCalled()

    const pending = controller.startSession(regularSession(), instanceId)
    const saving = controller.getState()
    expect(saving).not.toBe(initial)
    expect(controller.getState()).toBe(saving)
    expect(listener).toHaveBeenCalledTimes(1)

    await pending
    const ready = controller.getState()
    expect(ready).not.toBe(saving)
    expect(controller.getState()).toBe(ready)
    expect(saving.status).toBe('saving')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(notifications).toEqual(['saving', 'ready'])
    unsubscribe()
    controller.dispose()
  })

  it('supports multiple subscribers and stops notifying an unsubscribed listener', async () => {
    const controller = createSessionController({ store: storage(), now: () => 1000 })
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = controller.subscribe(first)
    const unsubscribeSecond = controller.subscribe(second)
    await controller.startSession(regularSession(), instanceId)
    expect(first).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenCalledTimes(2)

    unsubscribeFirst()
    await controller.reloadFromStorage('regular')
    expect(first).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenCalledTimes(4)
    unsubscribeSecond()
    controller.dispose()
  })

  it('allows a listener to unsubscribe during dispatch without disrupting other listeners', async () => {
    const controller = createSessionController({ store: storage(), now: () => 1000 })
    const first = vi.fn()
    const second = vi.fn()
    let unsubscribeFirst = () => undefined
    unsubscribeFirst = controller.subscribe(() => {
      first()
      unsubscribeFirst()
    })
    controller.subscribe(second)

    await controller.startSession(regularSession(), instanceId)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('isolates listener exceptions from controller state and other listeners', async () => {
    const controller = createSessionController({ store: storage(), now: () => 1000 })
    const throwing = vi.fn(() => { throw new Error('subscriber failure') })
    const observer = vi.fn()
    controller.subscribe(throwing)
    controller.subscribe(observer)

    const state = await controller.startSession(regularSession(), instanceId)

    expect(state.status).toBe('ready')
    expect(controller.getState()).toBe(state)
    expect(throwing).toHaveBeenCalledTimes(2)
    expect(observer).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('notifies subscribers after timer-driven auto-advance', async () => {
    const runtime = fakeTimers()
    const controller = createSessionController({ store: storage(runtime.now), now: runtime.now, timers: runtime })
    const session = regularSession()
    const statuses: string[] = []
    controller.subscribe(() => statuses.push(controller.getState().status))
    await controller.startSession(session, instanceId)
    statuses.length = 0
    await controller.submitAnswer(session.questions[0].correctChoiceIndex)
    statuses.length = 0

    await runtime.advanceBy(700)

    expect(statuses).toEqual(['saving', 'ready'])
    expect(controller.getState()).toMatchObject({ status: 'ready', snapshot: { cursor: { questionIndex: 1, phase: 'answering' } } })
    controller.dispose()
  })

  it('does not begin a write if a subscriber disposes synchronously on the saving notification', async () => {
    const runtime = fakeTimers()
    const store = storage(runtime.now)
    const controller = createSessionController({ store, now: runtime.now, timers: runtime })
    const session = regularSession()
    await controller.startSession(session, instanceId)
    controller.subscribe(() => {
      if (controller.getState().status === 'saving') controller.dispose()
    })

    const state = await controller.submitAnswer(session.questions[0].correctChoiceIndex)

    expect(state.status).toBe('saving')
    expect(store.save).not.toHaveBeenCalled()
    expect(runtime.pendingCount()).toBe(0)
    expect(controller.getState()).toBe(state)
  })

  it('does not begin a load if a subscriber disposes synchronously on the loading notification', async () => {
    const store = storage()
    const controller = createSessionController({ store, now: () => 1000 })
    controller.subscribe(() => {
      if (controller.getState().status === 'loading') controller.dispose()
    })

    const state = await controller.load('regular')

    expect(state.status).toBe('loading')
    expect(store.load).not.toHaveBeenCalled()
    expect(controller.getState()).toBe(state)
  })

  it('does not publish or mutate a pending save result after disposal', async () => {
    const runtime = fakeTimers()
    const store = storage(runtime.now)
    const controller = createSessionController({ store, now: runtime.now, timers: runtime })
    const session = regularSession()
    const statuses: string[] = []
    controller.subscribe(() => statuses.push(controller.getState().status))
    await controller.startSession(session, instanceId)
    statuses.length = 0
    const gate = deferred<void>()
    store.beforeNextWrite = () => gate.promise

    const pendingSave = controller.submitAnswer(session.questions[0].correctChoiceIndex)
    const disposedState = controller.getState()
    expect(disposedState.status).toBe('saving')
    const notificationsBeforeDispose = statuses.length
    controller.dispose()
    expect(runtime.pendingCount()).toBe(0)

    expect(await controller.submitAnswer(session.questions[0].correctChoiceIndex)).toBe(disposedState)
    controller.discardLocalChanges()
    expect(controller.getState()).toBe(disposedState)
    gate.resolve()
    await pendingSave

    expect(controller.getState()).toBe(disposedState)
    expect(statuses).toHaveLength(notificationsBeforeDispose)
    expect(runtime.pendingCount()).toBe(0)
    expect(store.writes.filter(write => write.kind === 'save')).toHaveLength(1)
    expect(store.records.get('regular')?.cursor.phase).toBe('auto-advance')
  })

  it('does not publish, change state, or schedule a timer when a load resolves after disposal', async () => {
    const runtime = fakeTimers()
    const store = storage(runtime.now)
    const snapshot = snapshotForPhase('auto-advance')
    const gate = deferred<void>()
    store.load = vi.fn(async () => {
      await gate.promise
      return { status: 'valid' as const, value: snapshot }
    })
    const controller = createSessionController({ store, now: runtime.now, timers: runtime })
    const listener = vi.fn()
    controller.subscribe(listener)

    const pendingLoad = controller.load('regular')
    const disposedState = controller.getState()
    expect(disposedState.status).toBe('loading')
    expect(listener).toHaveBeenCalledTimes(1)
    controller.dispose()
    const notificationsAtDispose = listener.mock.calls.length
    gate.resolve()
    await pendingLoad

    expect(controller.getState()).toBe(disposedState)
    expect(listener).toHaveBeenCalledTimes(notificationsAtDispose)
    expect(runtime.pendingCount()).toBe(0)
    const lateSubscriber = vi.fn()
    const unsubscribeLateSubscriber = controller.subscribe(lateSubscriber)
    expect(await controller.load('regular')).toBe(disposedState)
    expect(await controller.startSession(regularSession(), instanceId)).toBe(disposedState)
    expect(lateSubscriber).not.toHaveBeenCalled()
    expect(store.create).not.toHaveBeenCalled()
    unsubscribeLateSubscriber()
  })

  it.each(['answering', 'retry-prompt', 'auto-advance', 'manual-advance', 'round', 'result'] as const)(
    'resumes an existing %s phase without replaying scoring', async phase => {
      const store = storage()
      const snapshot = snapshotForPhase(phase)
      store.records.set('regular', snapshot)
      const controller = createSessionController({ store, now: () => 1000, timers: fakeTimers() })

      const state = await controller.load('regular')

      expect(state).toMatchObject({ status: 'ready', snapshot: { cursor: { phase } } })
      if (state.status === 'ready') expect(state.snapshot.score).toEqual(snapshot.score)
      expect(store.save).not.toHaveBeenCalled()
      controller.dispose()
    },
  )

  it('saves an overdue auto-advance once on resume without re-scoring the answer', async () => {
    const runtime = fakeTimers(2000)
    const store = storage(runtime.now)
    const snapshot = snapshotForPhase('auto-advance', 1700)
    store.records.set('regular', snapshot)
    const controller = createSessionController({ store, now: runtime.now, timers: runtime })

    await controller.load('regular')
    await runtime.advanceBy(0)

    const state = controller.getState()
    expect(state).toMatchObject({ status: 'ready', snapshot: { cursor: { questionIndex: 1, phase: 'answering' } } })
    expect(store.save).toHaveBeenCalledTimes(1)
    if (state.status === 'ready') expect(state.snapshot.score).toEqual(snapshot.score)
    controller.dispose()
  })

  it.each([
    { questionIndex: 1, expectedPhase: 'round' },
    { questionIndex: 2, expectedPhase: 'result' },
  ] as const)('routes an auto-advance at the boundary to $expectedPhase', async ({ questionIndex, expectedPhase }) => {
    const runtime = fakeTimers(1700)
    const store = storage(runtime.now)
    const snapshot = snapshotForPhase('auto-advance', 1700, questionIndex)
    store.records.set('regular', snapshot)
    const controller = createSessionController({ store, now: runtime.now, timers: runtime })

    await controller.load('regular')
    await runtime.advanceBy(0)

    const state = controller.getState()
    expect(state).toMatchObject({ status: 'ready', snapshot: { cursor: { questionIndex, phase: expectedPhase, pendingAdvanceAt: null } } })
    expect(store.save).toHaveBeenCalledTimes(1)
    if (state.status === 'ready') expect(state.snapshot.score).toEqual(snapshot.score)
    controller.dispose()
  })

  it('creates a Regular session with one canonical initial snapshot', async () => {
    const store = storage()
    const controller = createSessionController({ store, now: () => 1000 })
    const session = regularSession()

    const state = await controller.startSession(session, instanceId)

    expect(state.status).toBe('ready')
    if (state.status !== 'ready') return
    expect(state.snapshot).toMatchObject({
      mode: 'regular',
      instanceId,
      sessionId: session.id,
      revision: 1,
      score: createScoreState(session),
      cursor: { questionIndex: 0, phase: 'answering', pendingAdvanceAt: null },
    })
    expect(store.create).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('creates a Challenge session without changing its domain session identity', async () => {
    const store = storage()
    const controller = createSessionController({ store, now: () => 1000 })
    const session = challengeSession()

    const state = await controller.startSession(session, instanceId)

    expect(state.status).toBe('ready')
    if (state.status !== 'ready') return
    expect(state.snapshot).toMatchObject({ mode: 'challenge', sessionId: session.id, session })
    expect(state.snapshot.score.sessionId).toBe(session.id)
    controller.dispose()
  })

  it('scores a first-attempt correct answer once and persists its auto-advance deadline', async () => {
    const store = storage()
    const controller = createSessionController({ store, now: () => 1000 })
    const session = regularSession()
    const started = await controller.startSession(session, instanceId)
    if (started.status !== 'ready') throw new Error('Session did not start')

    const state = await controller.submitAnswer(session.questions[0].correctChoiceIndex)

    expect(state.status).toBe('ready')
    if (state.status !== 'ready') return
    expect(state.snapshot.score.responses[session.questions[0].key]).toEqual({
      status: 'completed',
      attempts: [session.questions[0].correctChoiceIndex],
      points: 1,
    })
    expect(state.snapshot.cursor).toEqual({ questionIndex: 0, phase: 'auto-advance', pendingAdvanceAt: 1700 })
    expect(store.save).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('auto-advances only at the persisted 700 ms deadline', async () => {
    const runtime = fakeTimers()
    const store = storage(runtime.now)
    const controller = createSessionController({ store, now: runtime.now, timers: runtime })
    const session = regularSession()
    const started = await controller.startSession(session, instanceId)
    if (started.status !== 'ready') throw new Error('Session did not start')

    const answered = await controller.submitAnswer(session.questions[0].correctChoiceIndex)
    expect(answered.status).toBe('ready')
    expect(runtime.pendingCount()).toBe(1)
    await runtime.advanceBy(699)
    expect(controller.getState()).toMatchObject({ status: 'ready', snapshot: { cursor: { questionIndex: 0, phase: 'auto-advance' } } })
    await runtime.advanceBy(1)
    expect(controller.getState()).toMatchObject({ status: 'ready', snapshot: { cursor: { questionIndex: 1, phase: 'answering', pendingAdvanceAt: null } } })
    controller.dispose()
  })

  it('ignores duplicate auto-advance callbacks while the first transition is saving', async () => {
    const runtime = fakeTimers()
    const store = storage(runtime.now)
    const controller = createSessionController({ store, now: runtime.now, timers: runtime })
    const session = regularSession()
    await controller.startSession(session, instanceId)
    await controller.submitAnswer(session.questions[0].correctChoiceIndex)

    await runtime.fireNextTwice()

    expect(store.save).toHaveBeenCalledTimes(2)
    expect(controller.getState()).toMatchObject({ status: 'ready', snapshot: { cursor: { questionIndex: 1, phase: 'answering' } } })
    controller.dispose()
  })

  it('holds an auto-advance after a failed save until the identical snapshot is retried', async () => {
    const runtime = fakeTimers()
    const store = storage(runtime.now)
    const controller = createSessionController({ store, now: runtime.now, timers: runtime })
    const session = regularSession()
    await controller.startSession(session, instanceId)
    store.nextWriteResult = { status: 'storage-error', code: 'transaction-failed' }

    const failed = await controller.submitAnswer(session.questions[0].correctChoiceIndex)

    expect(failed.status).toBe('failed')
    expect(runtime.pendingCount()).toBe(0)
    if (failed.status !== 'failed') return
    expect(failed.snapshot.cursor).toEqual({ questionIndex: 0, phase: 'auto-advance', pendingAdvanceAt: 1700 })
    const failedSnapshot = failed.snapshot
    await runtime.advanceBy(5000)
    expect(controller.getState().status).toBe('failed')
    const retried = await controller.retryPendingSave()
    expect(retried.status).toBe('ready')
    if (retried.status !== 'ready') return
    expect(retried.snapshot.cursor).toEqual(failedSnapshot.cursor)
    expect(retried.snapshot.score).toEqual(failedSnapshot.score)
    expect(runtime.pendingCount()).toBe(1)
    const saveWrites = store.writes.filter(write => write.kind === 'save')
    expect(saveWrites[0].snapshot).toEqual(saveWrites[1].snapshot)
    expect(retried.snapshot.score.responses[session.questions[0].key]?.attempts).toHaveLength(1)
    await runtime.advanceBy(0)
    expect(controller.getState()).toMatchObject({ status: 'ready', snapshot: { cursor: { questionIndex: 1, phase: 'answering' } } })
    expect(store.save).toHaveBeenCalledTimes(3)
    controller.dispose()
  })

  it('retains a failed answer snapshot and retries the same save without another score transition', async () => {
    const runtime = fakeTimers()
    const store = storage(runtime.now)
    const controller = createSessionController({ store, now: runtime.now, timers: runtime })
    const session = regularSession()
    const started = await controller.startSession(session, instanceId)
    if (started.status !== 'ready') throw new Error('Session did not start')
    const question = session.questions[0]
    const wrong = wrongChoiceIndex(question)
    store.nextWriteResult = { status: 'storage-error', code: 'transaction-failed' }

    const failed = await controller.submitAnswer(wrong)

    expect(failed.status).toBe('failed')
    if (failed.status !== 'failed') return
    expect(failed.snapshot.score.responses[question.key]).toEqual({ status: 'awaiting-second-attempt', attempts: [wrong], points: 0 })
    expect(failed.snapshot.cursor.phase).toBe('retry-prompt')
    expect(runtime.pendingCount()).toBe(0)
    const blockedInput = await controller.submitAnswer(question.correctChoiceIndex)
    expect(blockedInput.status).toBe('failed')
    expect(store.writes.filter(write => write.kind === 'save')).toHaveLength(1)

    const retried = await controller.retryPendingSave()
    expect(retried.status).toBe('ready')
    if (retried.status === 'ready') expect(retried.snapshot.score.responses[question.key]).toEqual({ status: 'awaiting-second-attempt', attempts: [wrong], points: 0 })
    const saves = store.writes.filter(write => write.kind === 'save')
    expect(saves).toHaveLength(2)
    expect(saves[0].snapshot).toEqual(saves[1].snapshot)
    expect(runtime.pendingCount()).toBe(0)
    controller.dispose()
  })

  it('blocks a second submit while the first snapshot write is in flight', async () => {
    const store = storage()
    const controller = createSessionController({ store, now: () => 1000 })
    const session = regularSession()
    await controller.startSession(session, instanceId)
    let releaseWrite: (() => void) | undefined
    store.beforeNextWrite = () => new Promise<void>(resolve => { releaseWrite = resolve })

    const firstSubmit = controller.submitAnswer(session.questions[0].correctChoiceIndex)
    await Promise.resolve()
    await Promise.resolve()
    const secondSubmit = await controller.submitAnswer(session.questions[0].correctChoiceIndex)

    expect(secondSubmit.status).toBe('saving')
    expect(store.writes.filter(write => write.kind === 'save')).toHaveLength(1)
    releaseWrite?.()
    const completed = await firstSubmit
    expect(completed.status).toBe('ready')
    if (completed.status === 'ready') expect(completed.snapshot.score.responses[session.questions[0].key]?.attempts).toHaveLength(1)
    controller.dispose()
  })

  it('keeps storage conflicts separate from retryable storage failures', async () => {
    const store = storage()
    const controller = createSessionController({ store, now: () => 1000 })
    const session = regularSession()
    await controller.startSession(session, instanceId)
    store.nextWriteResult = { status: 'conflict', reason: 'revision-mismatch' }

    const conflicted = await controller.submitAnswer(session.questions[0].correctChoiceIndex)

    expect(conflicted.status).toBe('conflict')
    if (conflicted.status !== 'conflict') return
    expect(conflicted.reason).toBe('revision-mismatch')
    expect(await controller.retryPendingSave()).toBe(conflicted)
    expect(store.writes.filter(write => write.kind === 'save')).toHaveLength(1)
    const reloaded = await controller.reloadFromStorage('regular')
    expect(reloaded.status).toBe('ready')
    if (reloaded.status === 'ready') expect(reloaded.snapshot.cursor.phase).toBe('answering')
    controller.dispose()
  })

  it('records a first wrong answer as retry-prompt with zero provisional points', async () => {
    const store = storage()
    const controller = createSessionController({ store, now: () => 1000 })
    const session = regularSession()
    const started = await controller.startSession(session, instanceId)
    if (started.status !== 'ready') throw new Error('Session did not start')
    const question = session.questions[0]
    const wrongChoice = question.choices.findIndex((_choice, index) => index !== question.correctChoiceIndex)

    const state = await controller.submitAnswer(wrongChoice)

    expect(state.status).toBe('ready')
    if (state.status !== 'ready') return
    expect(state.snapshot.score.responses[question.key]).toEqual({ status: 'awaiting-second-attempt', attempts: [wrongChoice], points: 0 })
    expect(state.snapshot.cursor).toEqual({ questionIndex: 0, phase: 'retry-prompt', pendingAdvanceAt: null })
    const retryReady = await controller.enableRetry()
    expect(retryReady.status).toBe('ready')
    if (retryReady.status === 'ready') expect(retryReady.snapshot.cursor.phase).toBe('answering')
    controller.dispose()
  })

  it('awards half a point for a correct second attempt through domain scoring', async () => {
    const store = storage()
    const controller = createSessionController({ store, now: () => 1000 })
    const session = regularSession()
    await controller.startSession(session, instanceId)
    const question = session.questions[0]
    await controller.submitAnswer(wrongChoiceIndex(question))
    await controller.enableRetry()

    const completed = await controller.submitAnswer(question.correctChoiceIndex)

    expect(completed.status).toBe('ready')
    if (completed.status === 'ready') {
      expect(completed.snapshot.score.responses[question.key]).toMatchObject({ status: 'completed', points: 0.5 })
      expect(completed.snapshot.cursor.phase).toBe('auto-advance')
    }
    controller.dispose()
  })

  it('advances exhausted questions through the round boundary and resumes the next question', async () => {
    const controller = createSessionController({ store: storage(), now: () => 1000 })
    const session = regularSession()
    const started = await controller.startSession(session, instanceId)
    if (started.status !== 'ready') throw new Error('Session did not start')
    const answerWrongTwice = async (questionIndex: number) => {
      const question = session.questions[questionIndex]
      const firstWrong = wrongChoiceIndex(question)
      await controller.submitAnswer(firstWrong)
      await controller.enableRetry()
      return controller.submitAnswer(anotherWrongChoiceIndex(question, firstWrong))
    }

    const exhaustedFirst = await answerWrongTwice(0)
    expect(exhaustedFirst.status).toBe('ready')
    if (exhaustedFirst.status !== 'ready') return
    expect(exhaustedFirst.snapshot.cursor.phase).toBe('manual-advance')
    expect(exhaustedFirst.snapshot.score.responses[session.questions[0].key]?.points).toBe(0)

    const firstAdvance = await controller.advanceManual()
    expect(firstAdvance.status).toBe('ready')
    if (firstAdvance.status !== 'ready') return
    expect(firstAdvance.snapshot.cursor).toEqual({ questionIndex: 1, phase: 'answering', pendingAdvanceAt: null })

    const exhaustedAtRoundEnd = await answerWrongTwice(1)
    expect(exhaustedAtRoundEnd.status).toBe('ready')
    if (exhaustedAtRoundEnd.status !== 'ready') return
    const round = await controller.advanceManual()
    expect(round.status).toBe('ready')
    if (round.status !== 'ready') return
    expect(round.snapshot.cursor).toEqual({ questionIndex: 1, phase: 'round', pendingAdvanceAt: null })

    const nextRound = await controller.continueRound()
    expect(nextRound.status).toBe('ready')
    if (nextRound.status === 'ready') expect(nextRound.snapshot.cursor).toEqual({ questionIndex: 2, phase: 'answering', pendingAdvanceAt: null })

    const exhaustedLast = await answerWrongTwice(2)
    expect(exhaustedLast.status).toBe('ready')
    if (exhaustedLast.status !== 'ready') return
    const result = await controller.advanceManual()
    expect(result.status).toBe('ready')
    if (result.status === 'ready') expect(result.snapshot.cursor).toEqual({ questionIndex: 2, phase: 'result', pendingAdvanceAt: null })
    controller.dispose()
  })

  it('clears a pending timer on dispose', async () => {
    const runtime = fakeTimers()
    const store = storage(runtime.now)
    const controller = createSessionController({ store, now: runtime.now, timers: runtime })
    const session = regularSession()
    await controller.startSession(session, instanceId)
    await controller.submitAnswer(session.questions[0].correctChoiceIndex)
    expect(runtime.pendingCount()).toBe(1)

    controller.dispose()
    await runtime.advanceBy(1000)

    expect(runtime.pendingCount()).toBe(0)
    expect(store.save).toHaveBeenCalledTimes(1)
  })

  it.each([
    { status: 'corrupt', issues: ['BAD_RECORD'] },
    { status: 'unsupported-version', versionKind: 'schema', version: 99 },
  ] as const)('does not silently resume an invalid stored record: $status', async invalid => {
    const store = storage()
    store.loadOverride = invalid
    const controller = createSessionController({ store, now: () => 1000 })

    const state = await controller.load('regular')

    expect(state.status).toBe('unrecoverable')
    expect(await controller.startSession(regularSession(), instanceId)).toBe(state)
    expect(store.create).not.toHaveBeenCalled()
    controller.discardLocalChanges()
    expect(controller.getState().status).toBe('empty')
    controller.dispose()
  })

  it('keeps the old durable session intact when explicit replacement fails', async () => {
    const store = storage()
    const controller = createSessionController({ store, now: () => 1000 })
    const original = regularSession()
    await controller.startSession(original, instanceId)
    const oldRecord = store.records.get('regular')
    if (!oldRecord) throw new Error('Initial record missing')
    const replacement = generateSession({ level: 1, mode: 'addition', count: 3, seed: 999, roundSize: 2 })
    if (!replacement.ok) throw new Error('Replacement fixture generation failed')
    const newInstanceId = '650e8400-e29b-41d4-a716-446655440000'
    store.nextWriteResult = { status: 'storage-error', code: 'transaction-failed' }

    const failed = await controller.replaceSession(replacement.session, newInstanceId, {
      instanceId: oldRecord.instanceId,
      sessionId: oldRecord.sessionId,
      revision: oldRecord.revision,
    })

    expect(failed.status).toBe('failed')
    expect(store.records.get('regular')).toEqual(oldRecord)
    if (failed.status === 'failed') expect(failed.snapshot.instanceId).toBe(newInstanceId)
    const retried = await controller.retryPendingSave()
    expect(retried.status).toBe('ready')
    if (retried.status === 'ready') {
      expect(retried.snapshot.instanceId).toBe(newInstanceId)
      expect(retried.snapshot.revision).toBe(oldRecord.revision + 1)
      expect(retried.snapshot.sessionId).toBe(replacement.session.id)
    }
    controller.dispose()
  })
})