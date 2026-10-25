import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { createIndexedDbSessionStore } from '../src/features/math-drill/persistence/indexedDbSessionStore'
import type { IndexedDbSessionStore, SavedSessionDraft, SessionExpectation, SessionLoadResult, SessionWriteResult } from '../src/features/math-drill/persistence/indexedDbSessionStore'
import type { SavedSessionMode, SavedSessionV1 } from '../src/features/math-drill/persistence/sessionTypes'
import { validateSavedSession } from '../src/features/math-drill/persistence/sessionCodec'
import { answerQuestion, createScoreState, generateSession } from '../src/features/math-drill/domain'
import type { SessionController } from '../src/features/math-drill/persistence/sessionController'

const controllerAudit = vi.hoisted(() => [] as { controller: SessionController; disposed: boolean; listeners: number; callsAfterDispose: number; timers: Set<unknown> }[])
vi.mock('../src/features/math-drill/persistence/sessionController', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/features/math-drill/persistence/sessionController')>()
  return { ...actual, createSessionController: (options: Parameters<typeof actual.createSessionController>[0]) => {
    const timers = new Set<unknown>()
    const controller = actual.createSessionController({ ...options, timers: options.timers ?? {
      setTimeout(callback, delay) {
        const handle = globalThis.setTimeout(() => { timers.delete(handle); void callback() }, delay)
        timers.add(handle)
        return handle
      },
      clearTimeout(handle) { timers.delete(handle); globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>) },
    } })
    const entry = { controller, disposed: false, listeners: 0, callsAfterDispose: 0, timers }
    const getState = controller.getState; const subscribe = controller.subscribe; const dispose = controller.dispose
    controller.getState = () => { if (entry.disposed) entry.callsAfterDispose++; return getState() }
    controller.subscribe = listener => {
      if (entry.disposed) entry.callsAfterDispose++
      entry.listeners++
      let subscribed = true
      const unsubscribe = subscribe(listener)
      return () => { if (subscribed) { subscribed = false; entry.listeners-- }; unsubscribe() }
    }
    controller.dispose = () => { entry.disposed = true; dispose() }
    controllerAudit.push(entry)
    return controller
  } }
})

const persistence = vi.hoisted(() => ({
  record: null as SavedSessionV1 | null,
  challengeRecord: null as SavedSessionV1 | null,
  nextResult: null as SessionWriteResult | null,
  loadResult: null as SessionLoadResult | null,
  beforeLoad: null as (() => Promise<void>) | null,
  beforeWrite: null as (() => Promise<void>) | null,
  instances: [] as IndexedDbSessionStore[],
}))
vi.mock('../src/features/math-drill/persistence/indexedDbSessionStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/features/math-drill/persistence/indexedDbSessionStore')>()
  return { ...actual,
  createIndexedDbSessionStore: () => {
    const write = async (draft: SavedSessionDraft | SavedSessionV1, expected?: SessionExpectation): Promise<SessionWriteResult> => {
      if (persistence.beforeWrite) { const wait = persistence.beforeWrite; persistence.beforeWrite = null; await wait() }
      if (persistence.nextResult) { const result = persistence.nextResult; persistence.nextResult = null; return result }
      const prior = draft.mode === 'challenge' ? persistence.challengeRecord : persistence.record
      if (expected ? !prior || prior.revision !== expected.revision || prior.instanceId !== expected.instanceId || prior.sessionId !== expected.sessionId : prior !== null) return { status: 'conflict', reason: 'revision-mismatch' }
      const checked = validateSavedSession({ ...draft, revision: (prior?.revision ?? 0) + 1, createdAt: prior?.createdAt ?? Date.now(), updatedAt: Date.now() })
      if (checked.status !== 'valid') throw new Error(`Invalid UI fixture: ${checked.status}`)
      if (draft.mode === 'challenge') persistence.challengeRecord = structuredClone(checked.value)
      else persistence.record = structuredClone(checked.value)
      return { status: 'success', value: checked.value }
    }
    const store: IndexedDbSessionStore = {
      load: vi.fn(async (mode: SavedSessionMode) => {
        if (mode === 'challenge') return persistence.challengeRecord ? { status: 'valid' as const, value: structuredClone(persistence.challengeRecord) } : { status: 'empty' as const }
        const result = persistence.loadResult ?? (persistence.record ? { status: 'valid' as const, value: structuredClone(persistence.record) } : { status: 'empty' as const })
        if (persistence.beforeLoad) { const wait = persistence.beforeLoad; persistence.beforeLoad = null; await wait() }
        return result
      }),
      create: vi.fn(draft => write(draft)), save: vi.fn((draft, expected) => write(draft, expected)),
      replace: vi.fn((draft, expected) => write(draft, expected)), close: vi.fn(),
    }
    persistence.instances.push(store)
    return store
  },
}})
beforeEach(() => {
  controllerAudit.length = 0
  persistence.record = null; persistence.challengeRecord = null; persistence.nextResult = null; persistence.loadResult = null
  persistence.beforeLoad = null; persistence.beforeWrite = null; persistence.instances = []
})
async function settle() { await act(async () => { await Promise.resolve() }) }
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function resumeFixture(caseName: string): SavedSessionV1 {
  const generated = generateSession({ level: 1, mode: 'addition', count: 3, seed: 917, roundSize: 2 })
  if (!generated.ok) throw new Error('Fixture generation failed')
  const session = generated.session
  let score = createScoreState(session)
  let questionIndex = 0
  let phase: SavedSessionV1['cursor']['phase'] = 'answering'
  const answer = (index: number, choice: number) => {
    const result = answerQuestion(score, session, session.questions[index].key, choice)
    if (!result.ok) throw new Error('Fixture answer failed')
    score = result.state
  }
  const question = session.questions[0]
  const wrong = question.choices.map((_, index) => index).filter(index => index !== question.correctChoiceIndex)
  if (['retry-prompt', 'second-answering', 'second-auto', 'manual-advance'].includes(caseName)) {
    answer(0, wrong[0]); phase = caseName === 'retry-prompt' ? 'retry-prompt' : 'answering'
  }
  if (caseName === 'manual-advance') { answer(0, wrong[1]); phase = 'manual-advance' }
  if (['first-auto', 'second-auto', 'pending-timer', 'overdue'].includes(caseName)) { answer(0, question.correctChoiceIndex); phase = 'auto-advance' }
  if (caseName === 'round' || caseName === 'result') {
    questionIndex = caseName === 'round' ? 1 : 2
    for (let index = 0; index <= questionIndex; index++) answer(index, session.questions[index].correctChoiceIndex)
    phase = caseName
  }
  const checked = validateSavedSession({ schemaVersion: 1, mode: 'regular', instanceId: '550e8400-e29b-41d4-a716-446655440000', sessionId: session.id, session, score, revision: 5, createdAt: 100, updatedAt: 200, cursor: { questionIndex, phase, pendingAdvanceAt: phase === 'auto-advance' ? Date.now() + (caseName === 'overdue' ? -100 : 700) : null } })
  if (checked.status !== 'valid') throw new Error('Invalid fixture')
  return checked.value
}

describe('Regular persistence integration', () => {
  it('creates a durable session without randomUUID on an HTTP LAN origin', async () => {
    const browserCrypto = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: browserCrypto.getRandomValues.bind(browserCrypto) })
    try {
      render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
      await settle(); await start('2', '1', 'addition')
      expect(screen.getByTestId('equation')).toBeInTheDocument()
      expect(choices()).toHaveLength(4)
      expect(persistence.record?.revision).toBe(1)
      expect(persistence.record?.instanceId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i)
      expect(persistence.instances.at(-1)!.create).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('replaces a saved session without randomUUID while preserving its revision guard', async () => {
    const browserCrypto = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: browserCrypto.getRandomValues.bind(browserCrypto) })
    try {
      const first = render(<MathDrillApp onExit={vi.fn()} />)
      await settle(); await start('2', '1', 'addition')
      const saved = structuredClone(persistence.record!)
      first.unmount()
      render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
      await settle()
      await click(screen.getByRole('button', { name: 'Mulai Baru' }))
      await start('2', '1', 'addition')
      await click(screen.getByRole('button', { name: 'Ya, Mulai Baru' }))
      expect(screen.getByTestId('equation')).toBeInTheDocument()
      expect(persistence.record?.revision).toBe(saved.revision + 1)
      expect(persistence.record?.instanceId).not.toBe(saved.instanceId)
      expect(persistence.record?.instanceId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('keeps the same question and correct feedback visible throughout a pending answer autosave', async () => {
    vi.useFakeTimers()
    render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
    await settle(); await start('2', '1', 'addition')
    const equation = screen.getByTestId('equation')
    const card = equation.closest('.drill-question')
    const before = structuredClone(persistence.record)!
    const gate = deferred()
    persistence.beforeWrite = () => gate.promise
    await selectCorrectAddition()
    expect(screen.getByTestId('equation')).toBe(equation)
    expect(equation.closest('.drill-question')).toBe(card)
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(screen.getByText('Benar!')).toBeInTheDocument()
    expect(screen.queryByText('Menyimpan…')).not.toBeInTheDocument()
    expect(choices().every(button => button.disabled)).toBe(true)
    expect(persistence.record).toEqual(before)
    const store = persistence.instances.at(-1)!
    expect(store.save).toHaveBeenCalledTimes(1)
    await click(choices()[0])
    expect(store.save).toHaveBeenCalledTimes(1)
    await act(async () => { gate.resolve() })
    expect(screen.getByTestId('equation')).toBe(equation)
    expect(screen.getByRole('status')).toHaveTextContent('Benar!')
    expect(persistence.record!.revision).toBe(before.revision + 1)
    await advanceAuto()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
  })
  it('keeps wrong-answer feedback and layout stable through both pending autosaves', async () => {
    render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
    await settle(); await start('1', '1', 'addition')
    const card = screen.getByTestId('equation').closest('.drill-question')
    const answer = currentAdditionAnswer()
    const wrong = choices().filter(button => button.textContent !== String(answer))
    const store = persistence.instances.at(-1)!
    const first = deferred()
    persistence.beforeWrite = () => first.promise
    await click(wrong[0])
    expect(screen.getByTestId('equation').closest('.drill-question')).toBe(card)
    expect(screen.getByText('Coba lagi. Kamu masih punya satu kesempatan.')).toBeInTheDocument()
    expect(screen.queryByText('Menyimpan…')).not.toBeInTheDocument()
    expect(choices().every(button => button.disabled)).toBe(true)
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeDisabled()
    expect(store.save).toHaveBeenCalledTimes(1)
    await act(async () => { first.resolve() })
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeEnabled()
    const retry = deferred()
    persistence.beforeWrite = () => retry.promise
    await click(screen.getByRole('button', { name: 'Coba lagi' }))
    expect(screen.getByTestId('equation').closest('.drill-question')).toBe(card)
    expect(screen.queryByText('Menyimpan…')).not.toBeInTheDocument()
    expect(choices().every(button => button.disabled)).toBe(true)
    await act(async () => { retry.resolve() })
    expect(wrong[1]).toBeEnabled()
    const second = deferred()
    persistence.beforeWrite = () => second.promise
    await click(wrong[1])
    expect(screen.getByTestId('equation').closest('.drill-question')).toBe(card)
    expect(screen.getByRole('status')).toHaveTextContent(`Jawaban yang benar: ${answer}`)
    expect(screen.queryByText('Menyimpan…')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeDisabled()
    expect(choices().every(button => button.disabled)).toBe(true)
    await act(async () => { second.resolve() })
    expect(store.save).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeEnabled()
    await click(screen.getByRole('button', { name: 'Lanjut' }))
    expect(screen.getByRole('heading', { name: 'Latihan selesai' })).toBeInTheDocument()
    expect(persistence.record!.score.responses[persistence.record!.session.questions[0].key]).toMatchObject({ points: 0, attempts: [persistence.record!.session.questions[0].choices.indexOf(Number(wrong[0].textContent)), persistence.record!.session.questions[0].choices.indexOf(Number(wrong[1].textContent))] })
  })
  it('keeps feedback and retry visible if a deferred silent autosave fails', async () => {
    render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
    await settle(); await start('2', '1', 'addition')
    const gate = deferred()
    persistence.beforeWrite = () => gate.promise
    persistence.nextResult = { status: 'storage-error', code: 'transaction-failed' }
    await selectCorrectAddition()
    expect(screen.getByText('Benar!')).toBeInTheDocument()
    expect(screen.queryByText('Menyimpan…')).not.toBeInTheDocument()
    await act(async () => { gate.resolve() })
    expect(screen.getByText('Belum tersimpan')).toBeInTheDocument()
    expect(screen.getByText('Benar!')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Coba Simpan Lagi' })).toBeEnabled()
    expect(choices().every(button => button.disabled)).toBe(true)
  })
  it('retries an initial load error without allowing a blind create', async () => {
    persistence.loadResult = { status: 'storage-error', code: 'open-failed' }
    render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
    await settle()
    expect(screen.queryByRole('button', { name: 'Mulai latihan' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Coba Muat Lagi' })).toBeInTheDocument()
    persistence.loadResult = null
    await click(screen.getByRole('button', { name: 'Coba Muat Lagi' }))
    await start('2', '1', 'addition')
    expect(persistence.record?.revision).toBe(1)
  })
  it('keeps failed create input locked and retries the same draft', async () => {
    render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
    await settle()
    persistence.nextResult = { status: 'storage-error', code: 'transaction-failed' }
    await start('2', '1', 'addition')
    expect(persistence.record).toBeNull()
    expect(screen.queryByRole('group', { name: 'Pilihan jawaban' })).not.toBeInTheDocument()
    const calls = persistence.instances.flatMap(store => vi.mocked(store.create).mock.calls)
    expect(calls).toHaveLength(1)
    await click(screen.getByRole('button', { name: 'Coba Simpan Lagi' }))
    const retried = persistence.instances.flatMap(store => vi.mocked(store.create).mock.calls)
    expect(retried).toHaveLength(2)
    expect(retried[1][0]).toEqual(retried[0][0])
    expect(persistence.record?.revision).toBe(1)
    expect(choices().every(button => !button.disabled)).toBe(true)
  })
  it('allows late durable save completion but isolates a fresh mounted controller', async () => {
    vi.useFakeTimers()
    const first = render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
    await settle(); await start('2', '1', 'addition')
    const saved = structuredClone(persistence.record)!
    const gate = deferred()
    persistence.beforeWrite = () => gate.promise
    await selectCorrectAddition()
    first.unmount()
    const oldOwners = [...controllerAudit]
    const second = render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
    await settle(); await click(screen.getByRole('button', { name: 'Lanjutkan' }))
    expect(choices().every(button => !button.disabled)).toBe(true)
    await act(async () => { gate.resolve() })
    expect(persistence.record!.revision).toBe(saved.revision + 1)
    expect(persistence.record!.cursor.phase).toBe('auto-advance')
    expect(screen.getByRole('status')).not.toHaveTextContent('Benar!')
    expect(choices().every(button => !button.disabled)).toBe(true)
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    for (const entry of oldOwners) { expect(entry.disposed).toBe(true); expect(entry.listeners).toBe(0); expect(entry.callsAfterDispose).toBe(0); expect(entry.timers.size).toBe(0) }
    second.unmount()
    render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
    await settle(); await click(screen.getByRole('button', { name: 'Lanjutkan' }))
    expect(screen.getByRole('status')).toHaveTextContent('Benar!')
    await advanceAuto()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(persistence.record!.revision).toBe(saved.revision + 2)
  })
  it.each(['answering', 'retry-prompt', 'second-answering', 'first-auto', 'second-auto', 'manual-advance', 'pending-timer', 'overdue', 'round', 'result'])('resumes phase without changing identity, choices or scoring: %s', async caseName => {
    vi.useFakeTimers()
    const saved = resumeFixture(caseName)
    persistence.record = structuredClone(saved)
    const view = render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
    await settle()
    expect(screen.queryByTestId('equation')).not.toBeInTheDocument()
    if (caseName === 'overdue') await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await click(screen.getByRole('button', { name: caseName === 'result' ? 'Lihat Hasil Terakhir' : 'Lanjutkan' }))
    if (caseName === 'round') expect(screen.getByRole('heading', { name: 'Ronde selesai' })).toBeInTheDocument()
    else if (caseName === 'result') expect(screen.getByTestId('completed')).toHaveTextContent('3 dari 3')
    else {
      const index = caseName === 'overdue' ? 1 : 0
      expect(screen.getByTestId('equation')).toHaveTextContent(saved.session.questions[index].prompt)
      expect(choices().map(button => Number(button.textContent))).toEqual(saved.session.questions[index].choices)
      if (caseName === 'retry-prompt') expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument()
      if (caseName === 'second-answering') {
        expect(choices().filter(button => button.disabled)).toHaveLength(1)
        expect(choices().find(button => !button.disabled)).toHaveFocus()
      }
      if (caseName === 'manual-advance') expect(screen.getByRole('button', { name: 'Lanjut' })).toBeInTheDocument()
    }
    expect(persistence.record!.session).toEqual(saved.session)
    expect(persistence.record!.score).toEqual(saved.score)
    expect(persistence.record!.instanceId).toBe(saved.instanceId)
    expect(persistence.record!.revision).toBe(saved.revision + (caseName === 'overdue' ? 1 : 0))
    const autoPending = ['first-auto', 'second-auto', 'pending-timer'].includes(caseName)
    expect(controllerAudit.reduce((total, entry) => total + entry.timers.size, 0)).toBe(autoPending ? 1 : 0)
    view.unmount()
    for (const entry of controllerAudit) { expect(entry.timers.size).toBe(0); expect(entry.disposed).toBe(true); expect(entry.listeners).toBe(0); expect(entry.callsAfterDispose).toBe(0) }
  })
  it('isolates a late load from a new owner when switching Challenge and returning', async () => {
    const gate = deferred()
    persistence.beforeLoad = () => gate.promise
    const view = render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
    await settle()
    await click(screen.getByRole('button', { name: 'Tantangan Campuran' }))
    expect(await screen.findByRole('button', { name: 'Mulai Tantangan Campuran' })).toBeInTheDocument()
    persistence.record = resumeFixture('retry-prompt')
    await click(screen.getByRole('button', { name: 'Latihan Biasa', exact: true }))
    await act(async () => { gate.resolve() })
    expect(screen.getByRole('button', { name: 'Lanjutkan' })).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Lanjutkan' }))
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument()
    view.unmount()
    for (const entry of controllerAudit) { expect(entry.disposed).toBe(true); expect(entry.listeners).toBe(0); expect(entry.callsAfterDispose).toBe(0) }
  })
  it.each([
    { status: 'corrupt' as const, issues: ['fixture'] },
    { status: 'unsupported-version' as const, versionKind: 'schema', version: 2 },
  ])('does not open or overwrite unreadable records: $status', async result => {
    persistence.loadResult = result
    render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
    await settle()
    expect(screen.getByText(/Sesi tersimpan tidak dapat dibuka/)).toBeInTheDocument()
    expect(screen.queryByTestId('equation')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mulai latihan' })).not.toBeInTheDocument()
    await settle()
    await click(screen.getByRole('button', { name: 'Tantangan Campuran' }))
    expect(await screen.findByRole('button', { name: 'Mulai Tantangan Campuran' })).toBeInTheDocument()
    for (const store of persistence.instances) { expect(store.create).not.toHaveBeenCalled(); expect(store.replace).not.toHaveBeenCalled() }
  })
  it('confirms discarding local conflict changes before reloading or exiting', async () => {
    const onExit = vi.fn()
    render(<StrictMode><MathDrillApp onExit={onExit} /></StrictMode>)
    await settle(); await start('2', '1', 'addition')
    const latest = { ...persistence.record!, revision: persistence.record!.revision + 1 }
    persistence.record = latest
    await click(choices().find(button => button.textContent !== String(currentAdditionAnswer()))!)
    expect(screen.getByText(/Sesi telah berubah di tab lain/)).toBeInTheDocument()
    expect(choices().every(button => button.disabled)).toBe(true)
    await click(screen.getByRole('button', { name: 'Muat Sesi Terbaru' }))
    expect(screen.getByRole('alertdialog', { name: 'Buang perubahan lokal?' })).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Batal' }))
    expect(persistence.record).toEqual(latest)
    await click(screen.getByRole('button', { name: 'Muat Sesi Terbaru' }))
    await click(screen.getByRole('button', { name: 'Ya, Buang Perubahan' }))
    expect(screen.getByRole('button', { name: 'Lanjutkan' })).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Lanjutkan' }))
    persistence.record = { ...latest, revision: latest.revision + 1 }
    await selectCorrectAddition()
    await click(screen.getByRole('button', { name: 'Kembali ke Menu' }))
    expect(onExit).not.toHaveBeenCalled()
    await click(screen.getByRole('button', { name: 'Ya, Buang Perubahan' }))
    expect(onExit).toHaveBeenCalledTimes(1)
  })
  it('warns about pending and failed saves on exit without deleting durable data', async () => {
    const onExit = vi.fn()
    render(<MathDrillApp onExit={onExit} />)
    await settle(); await start('2', '1', 'addition')
    const saved = structuredClone(persistence.record)
    const gate = deferred()
    persistence.beforeWrite = () => gate.promise
    persistence.nextResult = { status: 'storage-error', code: 'transaction-failed' }
    await selectCorrectAddition()
    await click(screen.getByRole('button', { name: 'Kembali' }))
    expect(screen.getByText(/Penyimpanan masih berlangsung/)).toBeInTheDocument()
    await act(async () => { gate.resolve() })
    expect(screen.getByText(/Perubahan terakhir belum tersimpan/)).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Ya, keluar' }))
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(persistence.record).toEqual(saved)
  })
  it('keeps feedback on failed autosave and retries the identical answer without double scoring', async () => {
    vi.useFakeTimers()
    render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
    await settle(); await start('2', '1', 'addition')
    const saved = structuredClone(persistence.record)
    persistence.nextResult = { status: 'storage-error', code: 'transaction-failed' }
    await selectCorrectAddition()
    expect(screen.getByText('Belum tersimpan')).toBeInTheDocument()
    expect(screen.getByText('Benar!')).toBeInTheDocument()
    expect(choices().every(button => button.disabled)).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(persistence.record).toEqual(saved)
    const store = persistence.instances.at(-1)!
    const pending = vi.mocked(store.save).mock.calls[0][0]
    await click(screen.getByRole('button', { name: 'Coba Simpan Lagi' }))
    expect(vi.mocked(store.save).mock.calls[1][0]).toBe(pending)
    expect(Object.values(persistence.record!.score.responses)[0]).toMatchObject({ points: 1, attempts: [saved!.session.questions[0].correctChoiceIndex] })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
  })
  it('preserves the durable old session when replacement fails and retries without regenerating', async () => {
    render(<MathDrillApp onExit={vi.fn()} />)
    await settle(); await start('1', '1', 'addition')
    await click(screen.getByRole('button', { name: 'Kembali' }))
    await click(screen.getByRole('button', { name: 'Tetap latihan' }))
    const saved = structuredClone(persistence.record)
    await selectCorrectAddition()
    await act(async () => { await new Promise(done => setTimeout(done, 750)) })
    await click(screen.getByRole('button', { name: 'Latihan lagi' }))
    await start('2', '1', 'addition')
    const old = structuredClone(persistence.record)
    persistence.nextResult = { status: 'storage-error', code: 'transaction-failed' }
    await click(screen.getByRole('button', { name: 'Ya, Mulai Baru' }))
    expect(screen.getByText('Belum tersimpan')).toBeInTheDocument()
    expect(persistence.record).toEqual(old)
    expect(persistence.record!.instanceId).toBe(saved!.instanceId)
    expect(screen.queryByRole('group', { name: 'Pilihan jawaban' })).not.toBeInTheDocument()
    const store = persistence.instances.at(-1)!
    const draft = vi.mocked(store.replace).mock.calls[0][0]
    await click(screen.getByRole('button', { name: 'Coba Simpan Lagi' }))
    expect(vi.mocked(store.replace).mock.calls[1][0]).toBe(draft)
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })
  it('cancels replacement without changing the record then replaces only after confirmation', async () => {
    const first = render(<MathDrillApp onExit={vi.fn()} />)
    await settle(); await start('1', '1', 'addition')
    first.unmount()
    render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
    await settle()
    const saved = structuredClone(persistence.record)
    await click(screen.getByRole('button', { name: 'Mulai Baru' }))
    await start('2', '1', 'addition')
    expect(screen.getByRole('alertdialog', { name: 'Yakin akan memulai sesi baru?' })).toBeInTheDocument()
    expect(screen.queryByText(/Sesi lama diganti hanya jika/)).not.toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Batal' }))
    expect(persistence.record).toEqual(saved)
    await start('2', '1', 'addition')
    await click(screen.getByRole('button', { name: 'Ya, Mulai Baru' }))
    expect(persistence.record!.instanceId).not.toBe(saved!.instanceId)
    expect(persistence.record!.revision).toBe(saved!.revision + 1)
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })
  it('offers explicit resume without regenerating stored questions', async () => {
    const first = render(<MathDrillApp onExit={vi.fn()} />)
    await settle(); await start('2', '1', 'addition')
    const saved = structuredClone(persistence.record)
    first.unmount()
    render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
    await settle()
    expect(screen.queryByTestId('equation')).not.toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Lanjutkan' }))
    expect(screen.getByTestId('equation')).toHaveTextContent(saved!.session.questions[0].prompt)
    expect(choices().map(button => Number(button.textContent))).toEqual(saved!.session.questions[0].choices)
    expect(persistence.record).toEqual(saved)
  })
  it('creates a durable session before enabling answers', async () => {
    render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
    await settle()
    const gate = deferred()
    persistence.beforeWrite = () => gate.promise
    await start('1', '1', 'addition')
    expect(screen.getByText('Menyimpan…')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Pilihan jawaban' })).not.toBeInTheDocument()
    await act(async () => { gate.resolve() })
    expect(choices()).toHaveLength(4)
    expect(persistence.record?.revision).toBe(1)
  })
  it('loads exactly once on the active StrictMode owner and does not write during empty initial load', async () => {
    const gate = deferred()
    persistence.beforeLoad = () => gate.promise
    const view = render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
    expect(screen.getByText('Memuat sesi latihan…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mulai latihan' })).not.toBeInTheDocument()
    await act(async () => { gate.resolve() })
    expect(screen.getByRole('heading', { name: 'Math Drill' })).toBeInTheDocument()
    expect(persistence.instances.reduce((count, store) => count + vi.mocked(store.load).mock.calls.length, 0)).toBe(1)
    for (const store of persistence.instances) expect(store.create).not.toHaveBeenCalled()
    view.unmount()
    for (const store of persistence.instances) expect(store.close).toHaveBeenCalledTimes(1)
  })
})
import MathDrillApp from '../src/features/math-drill/MathDrillApp'
import App from '../src/App'

async function start(count = '1', level = '1', mode = 'mixed') {
  fireEvent.change(screen.getByLabelText('Level'), { target: { value: level } })
  fireEvent.change(screen.getByLabelText('Operasi'), { target: { value: mode } })
  fireEvent.change(screen.getByLabelText('Jumlah custom'), { target: { value: count } })
  await click(screen.getByRole('button', { name: 'Mulai latihan' }))
}
function choices() { return within(screen.getByRole('group', { name: 'Pilihan jawaban' })).getAllByRole('button') }
async function advanceAuto() { await act(async () => { await vi.advanceTimersByTimeAsync(700) }) }
function currentAdditionAnswer() {
  return screen.getByTestId('equation').textContent!.split('+').map(value => Number(value.trim())).reduce((a, b) => a + b)
}
async function selectCorrectAddition() {
  await click(choices().find(button => button.textContent === String(currentAdditionAnswer()))!)
}

afterEach(() => vi.useRealTimers())
async function click(element: Element) { fireEvent.click(element); await settle() }

describe('Math Drill UI', () => {
  it('validates configuration against actual capacity and creates a four-choice question', async () => {
    render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    expect(screen.getByRole('heading', { name: 'Math Drill' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '10 soal' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Operasi'), { target: { value: 'addition' } })
    fireEvent.change(screen.getByLabelText('Jumlah custom'), { target: { value: '100' } })
    expect(screen.getByRole('alert')).toHaveTextContent('25')
    expect(screen.getByRole('button', { name: 'Mulai latihan' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Jumlah custom'), { target: { value: '1' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Mulai latihan' }))
    expect(choices()).toHaveLength(4)
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
  })

  it('validates and retains a custom minute preference for a new Regular session', async () => {
    localStorage.clear()
    const persistenceFactory = () => ({ store: createIndexedDbSessionStore(), completionMode: 'atomic' as const })
    const first = render(<MathDrillApp onExit={vi.fn()} persistenceFactory={persistenceFactory} />)
    await settle()
    const durationSelect = screen.getByLabelText('Durasi sesi')
    expect(Array.from((durationSelect as HTMLSelectElement).options, option => option.textContent)).toEqual([
      'Tanpa Batas Waktu', '5 menit', '10 menit', '15 menit', '20 menit', '30 menit', 'Custom (1–120 menit)',
    ])
    fireEvent.change(durationSelect, { target: { value: 'custom' } })
    const customInput = screen.getByLabelText('Durasi custom (menit)')
    const startButton = screen.getByRole('button', { name: 'Mulai latihan' })
    for (const invalid of ['', 'abc', '1.5', '-1', '0', '121']) {
      fireEvent.change(customInput, { target: { value: invalid } })
      expect(customInput).toHaveAttribute('aria-invalid', 'true')
      expect(startButton).toBeDisabled()
      expect(screen.getByRole('alert')).toHaveTextContent(/durasi|bilangan bulat|masukkan/i)
    }
    for (const [minutes, durationMs] of [['1', '60000'], ['120', '7200000']]) {
      fireEvent.change(customInput, { target: { value: minutes } })
      expect(startButton).toBeEnabled()
      await settle()
      expect(localStorage.getItem('math-adventure.session-duration.v1')).toBe(durationMs)
    }
    fireEvent.change(customInput, { target: { value: '7' } })
    expect(startButton).toBeEnabled()
    fireEvent.change(durationSelect, { target: { value: '300000' } })
    expect(durationSelect).toHaveValue('300000')
    expect(screen.queryByLabelText('Durasi custom (menit)')).not.toBeInTheDocument()
    await settle()
    expect(localStorage.getItem('math-adventure.session-duration.v1')).toBe('300000')
    fireEvent.change(durationSelect, { target: { value: 'unlimited' } })
    expect(startButton).toBeEnabled()
    expect(screen.queryByLabelText('Durasi custom (menit)')).not.toBeInTheDocument()
    await settle()
    expect(localStorage.getItem('math-adventure.session-duration.v1')).toBe('unlimited')
    fireEvent.change(durationSelect, { target: { value: 'custom' } })
    expect(screen.getByLabelText('Durasi custom (menit)')).toHaveValue(7)
    await settle()
    expect(localStorage.getItem('math-adventure.session-duration.v1')).toBe('420000')
    first.unmount()

    render(<MathDrillApp onExit={vi.fn()} persistenceFactory={persistenceFactory} />)
    await settle()
    expect(screen.getByLabelText('Durasi sesi')).toHaveValue('custom')
    expect(screen.getByLabelText('Durasi custom (menit)')).toHaveValue(7)
    await start('1', '1', 'addition')
    const timing = (persistence.record as unknown as { timing: { durationMs: number; startedAt: number; deadlineAt: number } }).timing
    expect(timing.durationMs).toBe(420_000)
    expect(timing.deadlineAt - timing.startedAt).toBe(420_000)
    expect(screen.getByRole('timer')).toHaveTextContent('07:00')
  })

  it('auto-advances after correct feedback and finishes on the last question', async () => {
    vi.useFakeTimers()
    render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    await start('1', '1', 'addition')
    await selectCorrectAddition()
    expect(screen.getByRole('status')).toHaveTextContent('Benar!')
    expect(screen.queryByRole('button', { name: 'Lanjut' })).not.toBeInTheDocument()
    expect(choices().every(button => button.disabled)).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(699) })
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(screen.getByRole('heading', { name: 'Latihan selesai' })).toBeInTheDocument()
  })

  it('auto-advances after a second-try correct answer while keeping half credit', async () => {
    vi.useFakeTimers()
    render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    await start('2', '1', 'addition')
    const firstWrong = choices().find(button => button.textContent !== String(currentAdditionAnswer()))!
    await click(firstWrong)
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Coba lagi' }))
    await selectCorrectAddition()
    expect(screen.getByRole('status')).toHaveTextContent('Benar!')
    expect(choices().every(button => button.disabled)).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
  })

  it('does not advance after wrong answers; two wrong answers still wait for Lanjut', async () => {
    vi.useFakeTimers()
    render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    await start('1', '1', 'addition')
    const answer = currentAdditionAnswer()
    const wrong = choices().filter(button => button.textContent !== String(answer))
    await click(wrong[0])
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })
    expect(screen.getByText('Coba lagi. Kamu masih punya satu kesempatan.')).toBeInTheDocument()
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Coba lagi' }))
    await click(wrong[1])
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })
    expect(screen.getByRole('status')).toHaveTextContent(`Jawaban yang benar: ${answer}`)
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeInTheDocument()
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
  })

  it('does not run a pending auto-advance after the learner opens and confirms exit', async () => {
    vi.useFakeTimers()
    const onExit = vi.fn()
    render(<MathDrillApp onExit={onExit} />)
    await settle()
    await start('2', '1', 'addition')
    await selectCorrectAddition()
    await click(screen.getByRole('button', { name: 'Kembali' }))
    await click(screen.getByRole('button', { name: 'Ya, keluar' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alertdialog', { name: 'Keluar dari latihan?' })).toBeInTheDocument()
    expect(screen.queryByText('2 / 2')).not.toBeInTheDocument()
  })

  it('clears the pending auto-advance timer when the component unmounts', async () => {
    vi.useFakeTimers()
    const view = render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    await start('2', '1', 'addition')
    const timersBeforeAnswer = vi.getTimerCount()
    await selectCorrectAddition()
    expect(vi.getTimerCount()).toBe(timersBeforeAnswer + 1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(timersBeforeAnswer)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  })

  it('does not duplicate a transition after a rapid double tap on the correct choice', async () => {
    vi.useFakeTimers()
    render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    await start('2', '1', 'addition')
    const answer = currentAdditionAnswer()
    const correct = choices().find(button => button.textContent === String(answer))!
    await click(correct)
    await click(correct)
    expect(correct).toBeDisabled()
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
  })

  it('shows Level 5 with the user-facing name Cari Angka', async () => {
    render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    expect(screen.getByRole('option', { name: 'Level 5 · Cari Angka' })).toBeInTheDocument()
  })

  it('defaults a newly selected Level 5 session to Dasar and validates its addition capacity', async () => {
    render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    expect(screen.queryByLabelText('Sublevel')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '5' } })
    expect(screen.getByLabelText('Sublevel')).toHaveValue('dasar')
    fireEvent.change(screen.getByLabelText('Operasi'), { target: { value: 'addition' } })
    fireEvent.change(screen.getByLabelText('Jumlah custom'), { target: { value: '46' } })
    expect(screen.getByRole('button', { name: 'Mulai latihan' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('45')
    fireEvent.change(screen.getByLabelText('Sublevel'), { target: { value: 'menengah' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '4' } })
    expect(screen.queryByLabelText('Sublevel')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '5' } })
    expect(screen.getByLabelText('Sublevel')).toHaveValue('dasar')
  })

  it('uses a chosen sublevel in a session and retains auto-advance and half-credit scoring', async () => {
    vi.useFakeTimers()
    render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Sublevel'), { target: { value: 'menengah' } })
    fireEvent.change(screen.getByLabelText('Operasi'), { target: { value: 'addition' } })
    fireEvent.change(screen.getByLabelText('Jumlah custom'), { target: { value: '1' } })
    await click(screen.getByRole('button', { name: 'Mulai latihan' }))
    expect(screen.queryByLabelText('Sublevel')).not.toBeInTheDocument()
    const equation = screen.getByTestId('equation')
    expect(equation).toHaveAttribute('aria-label', expect.stringContaining('kotak kosong'))
    expect(equation.querySelector('.drill-blank')).toBeInTheDocument()
    const answer = Number(equation.textContent!.split('+')[1].split('=')[1].trim()) - Number(equation.textContent!.split('+')[1].split('=')[0].trim())
    const wrong = choices().find(button => button.textContent !== String(answer))!
    await click(wrong)
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Coba lagi' }))
    await click(choices().find(button => button.textContent === String(answer))!)
    expect(screen.getByRole('status')).toHaveTextContent('Benar!')
    expect(screen.queryByRole('button', { name: 'Lanjut' })).not.toBeInTheDocument()
    await advanceAuto()
    expect(screen.getByTestId('weighted-score')).toHaveTextContent('50%')
    await click(screen.getByRole('button', { name: 'Latihan lagi' }))
    expect(screen.getByLabelText('Sublevel')).toHaveValue('dasar')
  })

  it('records full credit and shows a complete result after automatic advance', async () => {
    vi.useFakeTimers()
    render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    await start('1', '1', 'addition')
    const equation = screen.getByTestId('equation').textContent!
    const operands = equation.match(/(\d+) \+ (\d+)/)!
    const answer = Number(operands[1]) + Number(operands[2])
    await click(choices().find(button => button.textContent === String(answer))!)
    expect(screen.getByRole('status')).toHaveTextContent('Benar!')
    expect(choices().every(button => button.hasAttribute('disabled'))).toBe(true)
    await advanceAuto()
    expect(screen.getByRole('heading', { name: 'Latihan selesai' })).toBeInTheDocument()
    expect(screen.getByText('100%', { selector: '[data-testid="weighted-score"]' })).toBeInTheDocument()
    expect(screen.getByTestId('first-try-correct')).toHaveTextContent('1')
    expect(screen.getByTestId('completed')).toHaveTextContent('1 dari 1')
  })

  it('keeps the same choices after the first mistake and never reveals answer early', async () => {
    vi.useFakeTimers()
    render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    await start('1', '1', 'addition')
    const buttons = choices()
    const answer = currentAdditionAnswer()
    const before = buttons.map(button => button.textContent)
    const wrong = buttons.find(button => button.textContent !== String(answer))!
    await click(wrong)
    await click(wrong)
    expect(screen.getByRole('status')).toHaveTextContent('Coba lagi')
    expect(screen.queryByText(/Jawaban yang benar:/)).not.toBeInTheDocument()
    expect(choices().map(button => button.textContent)).toEqual(before)
    await click(screen.getByRole('button', { name: 'Coba lagi' }))
    expect(wrong).toBeDisabled()
    await click(buttons.find(button => button.textContent === String(answer))!)
    expect(screen.getByRole('status')).toHaveTextContent('Benar!')
    await advanceAuto()
    expect(screen.getByTestId('weighted-score')).toHaveTextContent('50%')
    expect(screen.getByTestId('second-try-correct')).toHaveTextContent('1')
  })

  it('reveals the answer only after two distinct wrong choices and prevents a third', async () => {
    render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    await start('1', '1', 'addition')
    const answer = currentAdditionAnswer()
    const wrong = choices().filter(button => button.textContent !== String(answer))
    await click(wrong[0])
    await click(screen.getByRole('button', { name: 'Coba lagi' }))
    await click(wrong[1])
    expect(screen.getByRole('status')).toHaveTextContent(`Jawaban yang benar: ${answer}`)
    expect(choices().every(button => button.hasAttribute('disabled'))).toBe(true)
    await click(screen.getByRole('button', { name: 'Lanjut' }))
    expect(screen.getByTestId('wrong-twice')).toHaveTextContent('1')
    expect(screen.getByTestId('weighted-score')).toHaveTextContent('0%')
  })

  it('moves through rounds without repeating question keys and resets on play again', async () => {
    vi.useFakeTimers()
    render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    await start('11', '2', 'mixed')
    const prompts: string[] = []
    for (let i = 0; i < 11; i += 1) {
      prompts.push(screen.getByTestId('equation').textContent!)
      expect(screen.getByText(`${i + 1} / 11`)).toBeInTheDocument()
      const expression = prompts[i].match(/(\d+) ([+−]) (\d+)/)!
      const answer = expression[2] === '+' ? Number(expression[1]) + Number(expression[3]) : Number(expression[1]) - Number(expression[3])
      await click(choices().find(button => button.textContent === String(answer))!)
      await advanceAuto()
      if (i === 9) {
        expect(screen.getByText('Ronde selesai')).toBeInTheDocument()
        await click(screen.getByRole('button', { name: 'Lanjut ronde' }))
      }
    }
    expect(new Set(prompts).size).toBe(11)
    expect(screen.getByTestId('completed')).toHaveTextContent('11 dari 11')
    await click(screen.getByRole('button', { name: 'Latihan lagi' }))
    expect(screen.getByRole('button', { name: 'Mulai latihan' })).toBeInTheDocument()
    await start('1', '1', 'addition')
    await click(screen.getByRole('button', { name: 'Ya, Mulai Baru' }))
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
  })

  it('confirms exit from an active session and does not report completion', async () => {
    const onExit = vi.fn()
    render(<MathDrillApp onExit={onExit} />)
    await settle()
    await start('10')
    await click(screen.getByRole('button', { name: 'Kembali' }))
    expect(screen.getByText('Keluar dari latihan?')).toBeInTheDocument()
    expect(screen.getByText(/Progres yang sudah tersimpan tetap tersedia/i)).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Tetap latihan' }))
    expect(onExit).not.toHaveBeenCalled()
    await click(screen.getByRole('button', { name: 'Kembali' }))
    await click(screen.getByRole('button', { name: 'Ya, keluar' }))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('renders each Level 5 missing-value form with a drawn blank and accessible name', async () => {
    for (const mode of ['addition', 'subtraction', 'mixed']) {
      persistence.record = null
      const { unmount } = render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
      await start('1', '5', mode)
      const equation = screen.getByTestId('equation')
      expect(equation.getAttribute('aria-label')).toContain('kotak kosong')
      expect(equation.querySelector('.drill-blank')).toHaveAttribute('aria-hidden', 'true')
      const text = equation.textContent!
      if (mode === 'addition') expect(text).toContain(' + ')
      if (mode === 'subtraction') expect(text).toContain(' − ')
      if (mode === 'mixed') expect(text).toMatch(/ − | −  /)
      expect(choices()).toHaveLength(4)
      unmount()
    }
  })

  it('rejects non-integer custom counts and restores a valid preset without changing the level', async () => {
    render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    fireEvent.change(screen.getByLabelText('Jumlah custom'), { target: { value: '1.5' } })
    expect(screen.getByRole('alert')).toHaveTextContent('integer')
    expect(screen.getByRole('button', { name: 'Mulai latihan' })).toBeDisabled()
    await click(screen.getByRole('button', { name: '20 soal' }))
    expect(screen.getByRole('button', { name: '20 soal' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Level')).toHaveValue('1')
    expect(screen.getByRole('button', { name: 'Mulai latihan' })).toBeEnabled()
  })

  it('renders distinct weighted score and first-try accuracy after mixed outcomes', async () => {
    vi.useFakeTimers()
    render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    await start('3', '1', 'addition')
    for (const outcome of ['first', 'second', 'twice'] as const) {
      const answer = currentAdditionAnswer()
      const correct = choices().find(button => button.textContent === String(answer))!
      const wrong = choices().filter(button => button.textContent !== String(answer))
      if (outcome === 'first') {
        await click(correct)
        await advanceAuto()
      } else {
        await click(wrong[0])
        await click(screen.getByRole('button', { name: 'Coba lagi' }))
        await click(outcome === 'second' ? correct : wrong[1])
        if (outcome === 'second') await advanceAuto()
        else await click(screen.getByRole('button', { name: 'Lanjut' }))
      }
    }
    expect(screen.getByTestId('completed')).toHaveTextContent('3 dari 3')
    expect(screen.getByTestId('weighted-score')).toHaveTextContent('50%')
    expect(screen.getByText('Akurasi percobaan pertama').parentElement).toHaveTextContent('33%')
    expect(screen.getByTestId('first-try-correct')).toHaveTextContent('1')
    expect(screen.getByTestId('second-try-correct')).toHaveTextContent('1')
    expect(screen.getByTestId('wrong-twice')).toHaveTextContent('1')
  })

  it('moves keyboard focus to the next question and keeps exit confirm accessible', async () => {
    vi.useFakeTimers()
    render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    await start('2', '1', 'addition')
      const answer = currentAdditionAnswer()
    await click(choices().find(button => button.textContent === String(answer))!)
    await advanceAuto()
    expect(screen.getByRole('heading', { name: 'Berapa jawabannya?' })).toHaveFocus()
    await click(screen.getByRole('button', { name: 'Kembali' }))
    expect(screen.getByRole('alertdialog', { name: 'Keluar dari latihan?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tetap latihan' })).toHaveFocus()
    await click(screen.getByRole('button', { name: 'Tetap latihan' }))
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
  })

  it('keeps an active concept mounted when opening Math Drill and returning', async () => {
    render(<App />)
    await click(screen.getByRole('button', { name: /00\.1-A/ }))
    await click(screen.getByRole('button', { name: /Math Drill/ }))
    expect(screen.queryByRole('navigation', { name: 'Pilih aktivitas' })).not.toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Kembali' }))
    expect(screen.getByRole('button', { name: /00\.1-A/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Pasangkan astronaut dan roket' })).toBeInTheDocument()
  })

  it('preserves concept navigation when Math Drill is opened and returned from', async () => {
    render(<App />)
    await click(screen.getByRole('button', { name: /00\.1-B/ }))
    expect(screen.getByRole('heading', { name: 'Membagikan satu untuk setiap teman' })).toBeInTheDocument()
    await click(screen.getByRole('button', { name: /Math Drill/ }))
    expect(screen.getByRole('heading', { name: 'Math Drill' })).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Kembali' }))
    expect(screen.getByRole('heading', { name: 'Membagikan satu untuk setiap teman' })).toBeInTheDocument()
  })
})
