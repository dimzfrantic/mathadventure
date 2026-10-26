import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import MathDrillApp from '../src/features/math-drill/MathDrillApp'
import ChallengeApp from '../src/features/math-drill/ChallengeApp'
import { validateSavedSession } from '../src/features/math-drill/persistence/sessionCodec'
import { validateChallengeRequest } from '../src/features/math-drill/domain'
import { createIndexedDbSessionStore } from '../src/features/math-drill/persistence/indexedDbSessionStore'
import type { IndexedDbSessionStore, SavedSessionDraft, SessionExpectation, SessionLoadResult, SessionWriteResult } from '../src/features/math-drill/persistence/indexedDbSessionStore'
import type { SavedSessionMode, SavedSessionV1 } from '../src/features/math-drill/persistence/sessionTypes'

const regularStore = vi.hoisted(() => ({ load: vi.fn(async (_mode: SavedSessionMode): Promise<SessionLoadResult> => persistence.records.regular ? { status: 'valid', value: structuredClone(persistence.records.regular) } : { status: 'empty' }) }))
const persistence = vi.hoisted(() => ({
  records: { regular: null, challenge: null } as Record<SavedSessionMode, SavedSessionV1 | null>,
  nextResult: null as SessionWriteResult | null,
  loadResult: null as SessionLoadResult | null,
  beforeLoad: null as (() => Promise<void>) | null,
  beforeWrite: null as (() => Promise<void>) | null,
  instances: [] as IndexedDbSessionStore[],
}))
vi.mock('../src/features/math-drill/persistence/indexedDbSessionStore', () => ({
  createIndexedDbSessionStore: (): IndexedDbSessionStore => {
    const write = async (draft: SavedSessionDraft | SavedSessionV1, expected?: SessionExpectation): Promise<SessionWriteResult> => {
      if (persistence.beforeWrite) { const wait = persistence.beforeWrite; persistence.beforeWrite = null; await wait() }
      if (persistence.nextResult) { const result = persistence.nextResult; persistence.nextResult = null; return result }
      const prior = persistence.records[draft.mode]
      if (expected ? !prior || prior.revision !== expected.revision || prior.instanceId !== expected.instanceId || prior.sessionId !== expected.sessionId : prior !== null) return { status: 'conflict', reason: 'revision-mismatch' }
      const checked = validateSavedSession({ ...draft, revision: (prior?.revision ?? 0) + 1, createdAt: prior?.createdAt ?? Date.now(), updatedAt: Date.now() })
      if (checked.status !== 'valid') throw new Error(`Invalid Challenge UI fixture: ${checked.status}`)
      persistence.records[draft.mode] = structuredClone(checked.value)
      return { status: 'success', value: checked.value }
    }
    const store: IndexedDbSessionStore = {
      load: vi.fn(async (mode: SavedSessionMode) => {
        if (mode === 'regular') return regularStore.load(mode)
        const record = persistence.records[mode]
        const result = persistence.loadResult ?? (record ? { status: 'valid' as const, value: structuredClone(record) } : { status: 'empty' as const })
        if (persistence.beforeLoad) { const wait = persistence.beforeLoad; persistence.beforeLoad = null; await wait() }
        return result
      }),
      create: vi.fn(draft => write(draft)), save: vi.fn((draft, expected) => write(draft, expected)),
      replace: vi.fn((draft, expected) => write(draft, expected)), close: vi.fn(),
    }
    persistence.instances.push(store)
    return store
  },
}))
beforeEach(() => {
  persistence.records.regular = null; persistence.records.challenge = null
  persistence.nextResult = null; persistence.loadResult = null
  persistence.beforeLoad = null; persistence.beforeWrite = null; persistence.instances = []
  regularStore.load.mockClear()
})
async function settle() { await act(async () => { await Promise.resolve() }) }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

function choices() { return within(screen.getByRole('group', { name: 'Pilihan jawaban' })).getAllByRole('button') }
function currentAnswer() {
  const equation = screen.getByTestId('equation').getAttribute('aria-label') ?? ''
  const numbers = [...equation.matchAll(/\d+/g)].map(([value]) => Number(value))
  const blank = equation.includes('kotak kosong')
  if (equation.includes('+')) return blank ? numbers[1] - numbers[0] : numbers[0] + numbers[1]
  if (blank && equation.indexOf('kotak kosong') < equation.indexOf('−')) return numbers[0] + numbers[1]
  if (blank) return numbers[0] - numbers[1]
  return numbers[0] - numbers[1]
}
async function click(element: Element) { fireEvent.click(element); await settle() }
async function openChallenge(onExit = vi.fn()) {
  render(<MathDrillApp onExit={onExit} />)
  await settle()
  fireEvent.click(screen.getByRole('button', { name: 'Tantangan Campuran' }))
  await settle()
}
async function startChallenge() { await click(screen.getByRole('button', { name: 'Mulai Tantangan Campuran' })) }
async function advanceAuto() { await act(async () => { await vi.advanceTimersByTimeAsync(700) }) }
async function answerCorrect() { await click(choices().find(button => button.textContent === String(currentAnswer()))!) }
afterEach(() => vi.useRealTimers())

describe('Challenge persistence', () => {
  it('creates a durable challenge snapshot before enabling answers', async () => {
    render(<StrictMode><ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} /></StrictMode>)
    await settle()
    const gate = deferred()
    persistence.beforeWrite = () => gate.promise
    fireEvent.click(screen.getByRole('button', { name: 'Mulai Tantangan Campuran' }))
    expect(screen.getByText('Menyimpan…')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Pilihan jawaban' })).not.toBeInTheDocument()
    await act(async () => { gate.resolve() })
    expect(choices()).toHaveLength(4)
    expect(persistence.records.challenge?.revision).toBe(1)
    expect(persistence.records.regular).toBeNull()
    expect(screen.queryByRole('group', { name: 'Pilih mode' })).not.toBeInTheDocument()
    expect(persistence.records.challenge?.instanceId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i)
  })
  it('uses a parent-selected custom duration for a new Challenge countdown and V2 snapshot', async () => {
    localStorage.clear()
    const persistenceFactory = () => ({ store: createIndexedDbSessionStore(), completionMode: 'atomic' as const })
    render(<StrictMode><ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} persistenceFactory={persistenceFactory} /></StrictMode>)
    await settle()
    const durationSelect = screen.getByLabelText('Durasi sesi')
    expect(Array.from((durationSelect as HTMLSelectElement).options, option => option.textContent)).toEqual([
      'Tanpa Batas Waktu', '5 menit', '10 menit', '15 menit', '20 menit', '30 menit', 'Custom (1–120 menit)',
    ])
    fireEvent.change(durationSelect, { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('Durasi custom (menit)'), { target: { value: '12' } })
    await settle()
    expect(localStorage.getItem('math-adventure.session-duration.v1')).toBe('720000')
    await startChallenge()
    const timing = (persistence.records.challenge as unknown as { timing: { durationMs: number; startedAt: number; deadlineAt: number } }).timing
    expect(timing.durationMs).toBe(720_000)
    expect(timing.deadlineAt - timing.startedAt).toBe(720_000)
    expect(screen.getByRole('timer')).toHaveTextContent('12:00')
  })

  it('resumes the saved questions, attempts, metadata, and options without regeneration', async () => {
    const first = render(<StrictMode><ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} /></StrictMode>)
    await settle()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Level 5 · Cari Angka' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dasar' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Menengah' }))
    fireEvent.change(screen.getByLabelText('Operasi'), { target: { value: 'addition' } })
    await startChallenge()
    const firstQuestion = persistence.records.challenge!.session.questions[0]
    const wrongIndex = firstQuestion.choices.findIndex((_, index) => index !== firstQuestion.correctChoiceIndex)
    await click(choices()[wrongIndex])
    const saved = structuredClone(persistence.records.challenge!)
    first.unmount()
    render(<StrictMode><ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} /></StrictMode>)
    await settle()
    expect(screen.queryByTestId('equation')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lanjutkan' })).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Lanjutkan' }))
    expect(screen.getByTestId('equation')).toHaveAttribute('aria-label', `Soal: ${firstQuestion.prompt.replace('□', 'kotak kosong')}`)
    expect(choices().map(button => Number(button.textContent))).toEqual(firstQuestion.choices)
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument()
    expect(persistence.records.challenge).toEqual(saved)
    expect(saved.session).toMatchObject({ selectedLevels: [1, 5], selectedLevel5Sublevels: ['dasar', 'menengah'], mode: 'addition' })
    expect(saved.score.responses[firstQuestion.key].attempts).toEqual([wrongIndex])
    expect(saved.cursor.phase).toBe('retry-prompt')
  })
  it('confirms replacement and keeps the saved session intact on cancellation', async () => {
    const first = render(<ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} />)
    await settle(); await startChallenge()
    const saved = structuredClone(persistence.records.challenge!)
    first.unmount()
    render(<StrictMode><ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} /></StrictMode>)
    await settle()
    await click(screen.getByRole('button', { name: 'Mulai Baru' }))
    fireEvent.click(screen.getByRole('button', { name: '20 soal' }))
    await click(screen.getByRole('button', { name: 'Mulai Tantangan Campuran' }))
    expect(screen.getByRole('alertdialog', { name: 'Yakin akan memulai sesi baru?' })).toBeInTheDocument()
    expect(screen.queryByText(/Sesi lama diganti hanya jika/)).not.toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Batal' }))
    expect(persistence.records.challenge).toEqual(saved)
    await click(screen.getByRole('button', { name: 'Mulai Tantangan Campuran' }))
    await click(screen.getByRole('button', { name: 'Ya, Mulai Baru' }))
    expect(persistence.records.challenge?.revision).toBe(saved.revision + 1)
    expect(persistence.records.challenge?.instanceId).not.toBe(saved.instanceId)
    expect(persistence.records.challenge?.session.questions).toHaveLength(20)
    expect(choices()).toHaveLength(4)
  })
  it('retries failed create using the identical draft and blocks answers until durable', async () => {
    render(<ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} />)
    await settle()
    persistence.nextResult = { status: 'storage-error', code: 'transaction-failed' }
    await startChallenge()
    expect(persistence.records.challenge).toBeNull()
    expect(screen.getByRole('heading', { name: 'Belum tersimpan' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Pilih mode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Pilihan jawaban' })).not.toBeInTheDocument()
    const store = persistence.instances.at(-1)!
    const draft = vi.mocked(store.create).mock.calls[0][0]
    await click(screen.getByRole('button', { name: 'Coba Simpan Lagi' }))
    expect(vi.mocked(store.create).mock.calls[1][0]).toBe(draft)
    expect(persistence.records.challenge?.revision).toBe(1)
    expect(choices()).toHaveLength(4)
  })
  it('preserves the old record after failed replace and retries the same challenge draft', async () => {
    const first = render(<ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} />)
    await settle(); await startChallenge()
    const saved = structuredClone(persistence.records.challenge!)
    first.unmount()
    render(<ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} />)
    await settle()
    await click(screen.getByRole('button', { name: 'Mulai Baru' }))
    await click(screen.getByRole('button', { name: 'Mulai Tantangan Campuran' }))
    persistence.nextResult = { status: 'storage-error', code: 'transaction-failed' }
    await click(screen.getByRole('button', { name: 'Ya, Mulai Baru' }))
    expect(persistence.records.challenge).toEqual(saved)
    expect(screen.getByRole('heading', { name: 'Belum tersimpan' })).toBeInTheDocument()
    const store = persistence.instances.at(-1)!
    const draft = vi.mocked(store.replace).mock.calls[0][0]
    await click(screen.getByRole('button', { name: 'Coba Simpan Lagi' }))
    expect(vi.mocked(store.replace).mock.calls[1][0]).toBe(draft)
    expect(persistence.records.challenge?.instanceId).not.toBe(saved.instanceId)
    expect(persistence.records.challenge?.revision).toBe(saved.revision + 1)
  })
  it('blocks blind creates on load error and retries only the challenge slot', async () => {
    persistence.loadResult = { status: 'storage-error', code: 'open-failed' }
    render(<ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} />)
    await settle()
    expect(screen.queryByRole('button', { name: 'Mulai Tantangan Campuran' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Coba Muat Lagi' })).toBeInTheDocument()
    persistence.loadResult = null
    await click(screen.getByRole('button', { name: 'Coba Muat Lagi' }))
    await startChallenge()
    expect(persistence.records.challenge?.revision).toBe(1)
    expect(persistence.instances.flatMap(store => vi.mocked(store.load).mock.calls.map(call => call[0]))).toEqual(['challenge', 'challenge'])
  })
  it('keeps the question card and feedback mounted during a silent correct-answer save', async () => {
    vi.useFakeTimers()
    render(<StrictMode><ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} /></StrictMode>)
    await settle(); await startChallenge()
    const card = screen.getByTestId('equation').closest('.drill-question')
    const before = structuredClone(persistence.records.challenge!)
    const gate = deferred()
    persistence.beforeWrite = () => gate.promise
    const answer = choices().find(button => button.textContent === String(currentAnswer()))!
    fireEvent.click(answer)
    await settle()
    expect(screen.getByTestId('equation').closest('.drill-question')).toBe(card)
    expect(screen.getByText('Benar!')).toBeInTheDocument()
    expect(screen.queryByText('Menyimpan…')).not.toBeInTheDocument()
    expect(choices().every(button => button.disabled)).toBe(true)
    expect(persistence.records.challenge).toEqual(before)
    const store = persistence.instances.at(-1)!
    fireEvent.click(answer)
    await settle()
    expect(store.save).toHaveBeenCalledTimes(1)
    await act(async () => { gate.resolve() })
    expect(persistence.records.challenge?.revision).toBe(before.revision + 1)
    await advanceAuto()
    expect(screen.getByText('2 / 10')).toBeInTheDocument()
    expect(persistence.records.challenge?.revision).toBe(before.revision + 2)
  })
  it('retains wrong-answer feedback and retry through pending saves without duplicate scoring', async () => {
    render(<ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} />)
    await settle(); await startChallenge()
    const card = screen.getByTestId('equation').closest('.drill-question')
    const key = persistence.records.challenge!.session.questions[0].key
    const wrong = choices().filter(button => button.textContent !== String(currentAnswer()))
    const gate = deferred(); persistence.beforeWrite = () => gate.promise
    fireEvent.click(wrong[0]); await settle()
    expect(screen.getByTestId('equation').closest('.drill-question')).toBe(card)
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeDisabled()
    expect(screen.queryByText('Menyimpan…')).not.toBeInTheDocument()
    await act(async () => { gate.resolve() })
    await click(screen.getByRole('button', { name: 'Coba lagi' }))
    const second = deferred(); persistence.beforeWrite = () => second.promise
    fireEvent.click(wrong[1]); await settle()
    expect(screen.getByRole('status')).toHaveTextContent('Jawaban yang benar:')
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeDisabled()
    expect(screen.queryByText('Menyimpan…')).not.toBeInTheDocument()
    expect(screen.getByTestId('equation').closest('.drill-question')).toBe(card)
    await act(async () => { second.resolve() })
    expect(persistence.records.challenge!.score.responses[key]).toMatchObject({ points: 0, status: 'completed' })
    expect(persistence.records.challenge!.score.responses[key].attempts).toHaveLength(2)
    await click(screen.getByRole('button', { name: 'Lanjut' }))
    expect(screen.getByText('2 / 10')).toBeInTheDocument()
  })
  it('keeps the same scored snapshot visible on save failure and retry', async () => {
    render(<ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} />)
    await settle(); await startChallenge()
    persistence.nextResult = { status: 'storage-error', code: 'transaction-failed' }
    const before = structuredClone(persistence.records.challenge!)
    await answerCorrect()
    expect(screen.getByRole('heading', { name: 'Belum tersimpan' })).toBeInTheDocument()
    expect(screen.getByText('Benar!')).toBeInTheDocument()
    expect(choices().every(button => button.disabled)).toBe(true)
    expect(persistence.records.challenge).toEqual(before)
    const store = persistence.instances.at(-1)!
    const pending = vi.mocked(store.save).mock.calls[0][0]
    await click(screen.getByRole('button', { name: 'Coba Simpan Lagi' }))
    expect(vi.mocked(store.save).mock.calls[1][0]).toBe(pending)
    expect(persistence.records.challenge?.revision).toBe(before.revision + 1)
    expect(persistence.records.challenge!.score.responses[before.session.questions[0].key].attempts).toHaveLength(1)
  })
  it('does not overwrite another tab and asks before reloading the durable challenge', async () => {
    render(<ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} />)
    await settle(); await startChallenge()
    const saved = structuredClone(persistence.records.challenge!)
    persistence.records.challenge = { ...saved, revision: saved.revision + 1 }
    await answerCorrect()
    expect(screen.getByRole('heading', { name: 'Sesi telah berubah di tab lain' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Pilih mode' })).not.toBeInTheDocument()
    expect(persistence.records.challenge).toEqual({ ...saved, revision: saved.revision + 1 })
    expect(choices().every(button => button.disabled)).toBe(true)
    await click(screen.getByRole('button', { name: 'Muat Sesi Terbaru' }))
    expect(screen.getByRole('alertdialog', { name: 'Buang perubahan lokal?' })).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Batal' }))
    expect(screen.getByRole('heading', { name: 'Sesi telah berubah di tab lain' })).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Muat Sesi Terbaru' }))
    await click(screen.getByRole('button', { name: 'Ya, Buang Perubahan' }))
    expect(screen.getByRole('button', { name: 'Lanjutkan' })).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Lanjutkan' }))
    expect(choices().every(button => !button.disabled)).toBe(true)
    expect(persistence.records.challenge?.revision).toBe(saved.revision + 1)
  })
  it('disposes an in-flight save and reloads whatever became durable on remount', async () => {
    const first = render(<StrictMode><ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} /></StrictMode>)
    await settle(); await startChallenge()
    const gate = deferred(); persistence.beforeWrite = () => gate.promise
    await answerCorrect()
    const active = persistence.instances.at(-1)!
    first.unmount()
    expect(active.close).toHaveBeenCalledTimes(1)
    await act(async () => { gate.resolve() })
    const durable = structuredClone(persistence.records.challenge!)
    render(<ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} />)
    await settle()
    expect(screen.getByRole('button', { name: 'Lanjutkan' })).toBeInTheDocument()
    expect(persistence.records.challenge).toEqual(durable)
  })
  it('keeps regular and challenge records in distinct slots through mode changes', async () => {
    const regularView = render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    await click(screen.getByRole('button', { name: 'Mulai latihan' }))
    const regular = structuredClone(persistence.records.regular!)
    regularView.unmount()
    const challengeView = render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    expect(screen.getByRole('heading', { name: 'Sesi latihan tersimpan' })).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Tantangan Campuran' }))
    await startChallenge()
    const challenge = structuredClone(persistence.records.challenge!)
    expect(regular.mode).toBe('regular')
    expect(challenge.mode).toBe('challenge')
    expect(persistence.records.regular).toEqual(regular)
    challengeView.unmount()
    render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    expect(screen.getByRole('button', { name: 'Lanjutkan' })).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Tantangan Campuran' }))
    expect(screen.getByRole('button', { name: 'Lanjutkan' })).toBeInTheDocument()
    expect(persistence.records.regular).toEqual(regular)
    expect(persistence.records.challenge).toEqual(challenge)
  })
  it('restores the identical summary, played categories, and score after reload', async () => {
    vi.useFakeTimers()
    const first = render(<ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} />)
    await settle()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Level 5 · Cari Angka' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dasar' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Menengah' }))
    await startChallenge()
    for (let i = 0; i < 10; i += 1) {
      if (i === 0) {
        const wrong = choices().find(button => button.textContent !== String(currentAnswer()))!
        await click(wrong)
        await click(screen.getByRole('button', { name: 'Coba lagi' }))
      }
      await answerCorrect()
      await advanceAuto()
    }
    const saved = structuredClone(persistence.records.challenge!)
    expect(saved.cursor.phase).toBe('result')
    expect(screen.getByTestId('challenge-weighted-score')).toHaveTextContent('95%')
    fireEvent.click(screen.getByText('Rincian untuk orang tua'))
    const original = screen.getByRole('heading', { name: 'Tantangan Selesai!' }).closest('.challenge-result')!.textContent
    expect(screen.getByRole('heading', { name: 'Hasil Cari Angka' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Hasil per jenis soal' })).toBeInTheDocument()
    first.unmount()
    render(<StrictMode><ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} /></StrictMode>)
    await settle()
    expect(screen.getByRole('button', { name: 'Lihat Hasil Terakhir' })).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Lihat Hasil Terakhir' }))
    fireEvent.click(screen.getByText('Rincian untuk orang tua'))
    expect(screen.getByRole('heading', { name: 'Tantangan Selesai!' }).closest('.challenge-result')!.textContent).toBe(original)
    expect(persistence.records.challenge).toEqual(saved)
  })
  it('uses a valid UUID v4 on an insecure LAN origin without randomUUID', async () => {
    const browserCrypto = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: browserCrypto.getRandomValues.bind(browserCrypto) })
    try {
      render(<ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} />)
      await settle(); await startChallenge()
      expect(choices()).toHaveLength(4)
      expect(persistence.records.challenge?.instanceId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i)
    } finally { vi.unstubAllGlobals() }
  })
  it('does not replace an unreadable challenge record or expose configuration', async () => {
    persistence.loadResult = { status: 'unsupported-version', versionKind: 'challenge-session', version: 999 }
    render(<ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} />)
    await settle()
    expect(screen.getByRole('heading', { name: 'Sesi tersimpan tidak dapat dibuka' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mulai Tantangan Campuran' })).not.toBeInTheDocument()
    expect(persistence.records.challenge).toBeNull()
  })
  it('warns that a pending write may finish after confirmed exit', async () => {
    const onExit = vi.fn()
    render(<ChallengeApp onExit={onExit} onBackToRegular={vi.fn()} />)
    await settle(); await startChallenge()
    const gate = deferred(); persistence.beforeWrite = () => gate.promise
    await answerCorrect()
    fireEvent.click(screen.getByRole('button', { name: 'Kembali' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('belum dapat dipastikan tersimpan')
    fireEvent.click(screen.getByRole('button', { name: 'Ya, keluar' }))
    expect(onExit).toHaveBeenCalledOnce()
    await act(async () => { gate.resolve() })
  })
  it('retains the generated seed when previewing the same selection after Tantangan lagi', async () => {
    const selection = { selectedLevels: [1, 2, 3] as const, selectedLevel5Sublevels: [] as const, mode: 'mixed' as const, count: 10 as const }
    const baseline = validateChallengeRequest({ ...selection, seed: 0 })
    if (!baseline.ok) throw new Error('Baseline quota fixture invalid')
    const candidate = Array.from({ length: 100 }, (_, index) => index + 1).map(seed => ({ seed, result: validateChallengeRequest({ ...selection, seed }) }))
      .find(({ result }) => result.ok && JSON.stringify(result.quota.byLevel) !== JSON.stringify(baseline.quota.byLevel))
    if (!candidate || !candidate.result.ok) throw new Error('No seed-dependent quota fixture')
    const originalCrypto = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: (values: Uint32Array | Uint8Array) => {
      if (values instanceof Uint32Array) { values[0] = candidate.seed; return values }
      return originalCrypto.getRandomValues(values)
    }, randomUUID: originalCrypto.randomUUID?.bind(originalCrypto) })
    try {
      vi.useFakeTimers()
      render(<ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} />)
      await settle()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Level 2' }))
      fireEvent.click(screen.getByRole('checkbox', { name: 'Level 3' }))
      await startChallenge()
      expect(persistence.records.challenge?.session.seed).toBe(candidate.seed)
      for (let index = 0; index < 10; index += 1) { await answerCorrect(); await advanceAuto() }
      await click(screen.getByRole('button', { name: 'Tantangan lagi' }))
      const quotas = candidate.result.quota.byLevel
      expect(screen.getByText(`Soal per level: Level 1: ${quotas[1]} · Level 2: ${quotas[2]} · Level 3: ${quotas[3]}`)).toBeInTheDocument()
    } finally { vi.unstubAllGlobals() }
  })
  it('gates configuration on the challenge slot load under StrictMode', async () => {
    const gate = deferred()
    const onBackToRegular = vi.fn()
    persistence.beforeLoad = () => gate.promise
    const view = render(<StrictMode><ChallengeApp onExit={vi.fn()} onBackToRegular={onBackToRegular} /></StrictMode>)
    expect(screen.getByText('Memuat sesi tantangan…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Latihan Biasa', exact: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mulai Tantangan Campuran' })).not.toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Latihan Biasa', exact: true }))
    expect(onBackToRegular).toHaveBeenCalledOnce()
    await act(async () => { gate.resolve() })
    expect(screen.getByRole('heading', { name: 'Tantangan Campuran' })).toBeInTheDocument()
    expect(persistence.instances.flatMap(store => vi.mocked(store.load).mock.calls.map(call => call[0]))).toEqual(['challenge'])
    view.unmount()
    for (const store of persistence.instances) expect(store.close).toHaveBeenCalledTimes(1)
  })
})

describe('Final Challenge UI', () => {
  it('keeps the new-challenge configuration page and choices through the saved-session tab round trip', async () => {
    const regularSeed = render(<MathDrillApp onExit={vi.fn()} />)
    await settle()
    await click(screen.getByRole('button', { name: 'Mulai latihan' }))
    const oldRegular = structuredClone(persistence.records.regular!)
    regularSeed.unmount()

    const challengeSeed = render(<ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} />)
    await settle(); await startChallenge()
    const oldChallenge = structuredClone(persistence.records.challenge!)
    challengeSeed.unmount()

    render(<StrictMode><MathDrillApp onExit={vi.fn()} /></StrictMode>)
    await settle()
    await click(screen.getByRole('button', { name: 'Mulai Baru' }))
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Operasi'), { target: { value: 'subtraction' } })
    fireEvent.click(screen.getByRole('button', { name: '20 soal' }))
    await click(screen.getByRole('button', { name: 'Tantangan Campuran', exact: true }))
    await click(screen.getByRole('button', { name: 'Mulai Baru' }))

    fireEvent.click(screen.getByRole('checkbox', { name: 'Level 2' }))
    fireEvent.change(screen.getByLabelText('Operasi'), { target: { value: 'addition' } })
    fireEvent.click(screen.getByRole('button', { name: '20 soal' }))
    expect(persistence.records.challenge).toEqual(oldChallenge)

    const challengeStoreBeforeSwitch = persistence.instances.at(-1)!
    await click(screen.getByRole('button', { name: 'Latihan Biasa', exact: true }))
    expect(challengeStoreBeforeSwitch.close).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'Math Drill' })).toBeInTheDocument()
    expect(screen.getByLabelText('Level')).toHaveValue('3')
    expect(screen.getByLabelText('Operasi')).toHaveValue('subtraction')
    expect(screen.getByRole('button', { name: '20 soal' })).toHaveAttribute('aria-pressed', 'true')
    expect(persistence.records.regular).toEqual(oldRegular)

    await click(screen.getByRole('button', { name: 'Tantangan Campuran', exact: true }))
    expect(await screen.findByRole('heading', { name: 'Tantangan Campuran' })).toBeInTheDocument()
    const activeStores = persistence.instances.filter(store => vi.mocked(store.close).mock.calls.length === 0)
    expect(activeStores).toHaveLength(1)
    expect(activeStores[0]).not.toBe(challengeStoreBeforeSwitch)
    expect(screen.queryByRole('heading', { name: 'Sesi tantangan tersimpan' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Level 2' })).toBeChecked()
    expect(screen.getByLabelText('Operasi')).toHaveValue('addition')
    expect(screen.getByRole('button', { name: '20 soal' })).toHaveAttribute('aria-pressed', 'true')
    expect(persistence.records.challenge).toEqual(oldChallenge)

    await click(screen.getByRole('button', { name: 'Mulai Tantangan Campuran' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(persistence.records.challenge).toEqual(oldChallenge)
    await click(screen.getByRole('button', { name: 'Batal' }))
    expect(persistence.records.challenge).toEqual(oldChallenge)
    await click(screen.getByRole('button', { name: 'Mulai Tantangan Campuran' }))
    await click(screen.getByRole('button', { name: 'Ya, Mulai Baru' }))
    expect(persistence.records.challenge?.revision).toBe(oldChallenge.revision + 1)
    expect(persistence.records.challenge?.session).toMatchObject({ selectedLevels: [1, 2], mode: 'addition' })
    expect(persistence.records.challenge?.session.questions).toHaveLength(20)
  })
  it('offers two mode tabs in each configuration and preserves both configurations while switching', async () => {
    render(<MathDrillApp onExit={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Memuat sesi latihan')
    expect(screen.queryByRole('heading', { name: 'Math Drill' })).not.toBeInTheDocument()
    await act(async () => { await Promise.resolve() })
    expect(regularStore.load).toHaveBeenCalledWith('regular')
    expect(screen.getByRole('button', { name: 'Latihan Biasa', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Tantangan Campuran', exact: true })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Operasi'), { target: { value: 'subtraction' } })
    fireEvent.click(screen.getByRole('button', { name: '20 soal' }))
    await click(screen.getByRole('button', { name: 'Tantangan Campuran', exact: true }))
    expect(screen.getByRole('heading', { name: 'Tantangan Campuran' })).toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: 'Pilih mode' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Tantangan Campuran', exact: true })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Level 2' }))
    fireEvent.change(screen.getByLabelText('Operasi'), { target: { value: 'addition' } })
    fireEvent.click(screen.getByRole('button', { name: '20 soal' }))
    await click(screen.getByRole('button', { name: 'Latihan Biasa', exact: true }))
    expect(screen.getByRole('heading', { name: 'Math Drill' })).toBeInTheDocument()
    expect(screen.getByLabelText('Level')).toHaveValue('3')
    expect(screen.getByLabelText('Operasi')).toHaveValue('subtraction')
    expect(screen.getByRole('button', { name: '20 soal' })).toHaveAttribute('aria-pressed', 'true')
    await click(screen.getByRole('button', { name: 'Tantangan Campuran', exact: true }))
    expect(screen.getByRole('checkbox', { name: 'Level 2' })).toBeChecked()
    expect(screen.getByLabelText('Operasi')).toHaveValue('addition')
    expect(screen.getByRole('button', { name: '20 soal' })).toHaveAttribute('aria-pressed', 'true')
    expect(persistence.records.regular).toBeNull()
    expect(persistence.records.challenge).toBeNull()
  })

  it('shows one result title and balanced value-above-label statistic cards', async () => {
    vi.useFakeTimers()
    await openChallenge()
    await startChallenge()
    for (let i = 0; i < 10; i += 1) { await answerCorrect(); await advanceAuto() }

    expect(screen.getByRole('heading', { name: 'Tantangan Selesai!', level: 1 })).toBeInTheDocument()
    expect(screen.queryByText('TANTANGAN SELESAI', { exact: true })).not.toBeInTheDocument()
    expect(screen.getByText('Hebat, kamu sudah menyelesaikan 10 soal!')).toBeInTheDocument()
    expect(screen.getByTestId('challenge-weighted-score')).toHaveTextContent('100%')
    expect(screen.getByText('Nilai latihan', { selector: '.challenge-main-score span' })).toBeInTheDocument()

    const firstTryCard = screen.getByText('Benar langsung').closest('.challenge-main-stat')!
    const completedCard = screen.getByText('Soal selesai').closest('.challenge-main-stat')!
    expect(within(firstTryCard).getByText('10', { selector: 'dd' })).toBeInTheDocument()
    expect(within(completedCard).getByText('10/10', { selector: 'dd' })).toBeInTheDocument()
    expect(within(firstTryCard).getByText('Benar langsung')).toBeInTheDocument()
    expect(within(completedCard).getByText('Soal selesai')).toBeInTheDocument()
  })

  it('previews quotas and disables start until every selected level has an explicit sublevel', async () => {
    await openChallenge()
    expect(screen.getAllByText(/Level 1/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Level 5 · Cari Angka' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Pilih setidaknya satu sublevel Cari Angka sebelum melanjutkan.')
    expect(screen.getByRole('alert')).not.toHaveTextContent(/UNSATISFIABLE_ALLOCATION|feasible|kuota level|bottleneck/i)
    expect(screen.getByRole('button', { name: 'Mulai Tantangan Campuran' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dasar' }))
    expect(screen.getByRole('button', { name: 'Mulai Tantangan Campuran' })).toBeEnabled()
    expect(screen.getAllByText(/Dasar/).length).toBeGreaterThan(0)
  })

  it('offers a manual feasible-count alternative without changing the selected count automatically', async () => {
    await openChallenge()
    for (const level of ['Level 2', 'Level 3', 'Level 4', 'Level 5 · Cari Angka']) fireEvent.click(screen.getByRole('checkbox', { name: level }))
    for (const sublevel of ['Dasar', 'Menengah', 'Lanjutan']) fireEvent.click(screen.getByRole('checkbox', { name: sublevel }))
    expect(screen.getByText(/Jumlah soal: 10/)).toBeInTheDocument()
    expect(screen.getByText('Jumlah soal belum cukup')).toBeInTheDocument()
    expect(screen.getByText('Kamu memilih banyak level untuk dimainkan. Pilih 20 soal agar semuanya bisa muncul.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).not.toHaveTextContent(/UNSATISFIABLE_ALLOCATION|feasible|kuota level|bottleneck/i)
    expect(screen.getByRole('button', { name: 'Mulai Tantangan Campuran' })).toBeDisabled()
    const recommendation = within(screen.getByRole('group', { name: 'Saran jumlah soal' })).getByRole('button', { name: 'Gunakan 20 soal' })
    expect(recommendation).toBeInTheDocument()
    fireEvent.click(recommendation)
    expect(screen.getByRole('button', { name: 'Mulai Tantangan Campuran' })).toBeEnabled()
  })

  it('completes a challenge and shows only played level and sublevel cards', async () => {
    vi.useFakeTimers()
    await openChallenge()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Level 5 · Cari Angka' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dasar' }))
    fireEvent.change(screen.getByLabelText('Operasi'), { target: { value: 'addition' } })
    fireEvent.click(screen.getByRole('button', { name: '10 soal' }))
    await startChallenge()
    for (let i = 0; i < 10; i += 1) {
      expect(choices()).toHaveLength(4)
      await answerCorrect()
      expect(choices().every(button => button.disabled)).toBe(true)
      await advanceAuto()
    }
    expect(screen.getByRole('heading', { name: 'Tantangan Selesai!' })).toBeInTheDocument()
    expect(screen.getByText('Hebat, kamu sudah menyelesaikan 10 soal!')).toBeInTheDocument()
    expect(screen.getByTestId('challenge-weighted-score')).toHaveTextContent('100%')
    expect(screen.getByText('10 dari 10 poin')).toBeInTheDocument()
    expect(screen.getByText('10', { selector: '.challenge-main-stat dd' })).toBeInTheDocument()
    expect(screen.getByText('10/10')).toBeInTheDocument()
    const details = screen.getByText('Rincian untuk orang tua').closest('details')!
    expect(details.open).toBe(false)
    expect(screen.queryByRole('heading', { name: 'Keseluruhan' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Rincian untuk orang tua'))
    expect(details.open).toBe(true)
    expect(screen.getByRole('heading', { name: 'Hasil per level' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Hasil Cari Angka' })).toBeInTheDocument()
    const levelCard = screen.getByRole('heading', { name: /Level 5 — 100%/ }).closest('.challenge-metric-card')!
    expect(levelCard).toHaveTextContent('Nilai latihan')
    expect(levelCard).toHaveTextContent('5 dari 5 soal')
    expect(screen.getByRole('heading', { name: /Dasar — 100%/ })).toBeInTheDocument()
    const sublevelCard = screen.getByRole('heading', { name: /Dasar — 100%/ }).closest('.challenge-metric-card')!
    expect(sublevelCard).toHaveTextContent('Benar pada percobaan pertama: 5 dari 5 soal')
    expect(screen.queryByRole('heading', { name: /Menengah/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Lanjutan/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Hasil per jenis soal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getAllByText('Nilai latihan dihitung dari jawaban benar pertama (1 poin), benar kedua (½ poin), dan salah dua kali (0 poin).')).toHaveLength(1)
    fireEvent.click(screen.getByText('Rincian untuk orang tua'))
    expect(details.open).toBe(false)
  })

  it('supports retry and waits for Next after two wrong choices', async () => {
    await openChallenge()
    await startChallenge()
    const correct = String(currentAnswer())
    const wrong = choices().filter(button => button.textContent !== correct)
    await click(wrong[0])
    expect(screen.getByText(/masih punya satu kesempatan/)).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Coba lagi' }))
    await click(wrong[1])
    expect(screen.getByRole('status')).toHaveTextContent(`Jawaban yang benar: ${correct}`)
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeInTheDocument()
  })

  it('auto-advances after a correct second attempt and retains half credit in the final summary', async () => {
    vi.useFakeTimers()
    await openChallenge()
    await startChallenge()
    for (let i = 0; i < 10; i += 1) {
      const answer = String(currentAnswer())
      const available = choices()
      if (i === 0) {
        await click(available.find(button => button.textContent !== answer)!)
        await click(screen.getByRole('button', { name: 'Coba lagi' }))
      }
      await click(choices().find(button => button.textContent === answer)!)
      await advanceAuto()
    }
    expect(screen.getByRole('heading', { name: 'Tantangan Selesai!' })).toBeInTheDocument()
    expect(screen.getByTestId('challenge-weighted-score')).toHaveTextContent('95%')
    expect(screen.getByText('9,5 dari 10 poin')).toBeInTheDocument()
    const details = screen.getByText('Rincian untuk orang tua').closest('details')!
    expect(details.open).toBe(false)
    fireEvent.click(screen.getByText('Rincian untuk orang tua'))
    const levelHeading = screen.getByRole('heading', { name: /Level 1 — 95%/ })
    const levelCard = levelHeading.closest('.challenge-metric-card')!
    expect(levelCard).toHaveTextContent('Nilai latihan')
    expect(levelCard).toHaveTextContent('Benar pada percobaan pertama: 9 dari 10 soal')
    const levelProgress = within(levelCard).getByRole('progressbar', { name: 'Nilai latihan Level 1' })
    expect(levelProgress).toHaveAttribute('max', '100')
    expect(levelProgress).toHaveAttribute('value', '95')
    expect(levelProgress).toHaveAttribute('aria-valuetext', '95%')
    expect(screen.queryByRole('heading', { name: 'Hasil Cari Angka' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Hasil per jenis soal' })).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: /Penjumlahan —/ })).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: /Pengurangan —/ })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getAllByText('Nilai latihan dihitung dari jawaban benar pertama (1 poin), benar kedua (½ poin), dan salah dua kali (0 poin).')).toHaveLength(1)
  })

  it('moves to the next round after ten completed questions and ignores a rapid double tap', async () => {
    vi.useFakeTimers()
    await openChallenge()
    fireEvent.click(screen.getByRole('button', { name: '20 soal' }))
    await startChallenge()
    for (let i = 0; i < 10; i += 1) {
      const answer = choices().find(button => button.textContent === String(currentAnswer()))!
      fireEvent.click(answer)
      if (i === 0) fireEvent.click(answer)
      await settle()
      await advanceAuto()
    }
    expect(screen.getByRole('heading', { name: 'Ronde selesai' })).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Lanjut ronde' }))
    expect(screen.getByText('11 / 20')).toBeInTheDocument()
  })

  it('shows exit confirmation and clears pending auto-advance when leaving', async () => {
    vi.useFakeTimers()
    const onExit = vi.fn()
    await openChallenge(onExit)
    await startChallenge()
    await answerCorrect()
    fireEvent.click(screen.getByRole('button', { name: 'Kembali' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ya, keluar' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(onExit).toHaveBeenCalledOnce()
  })
})
