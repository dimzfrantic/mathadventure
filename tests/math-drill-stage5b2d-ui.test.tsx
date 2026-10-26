import { act, fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import MathDrillApp from '../src/features/math-drill/MathDrillApp'
import ChallengeApp from '../src/features/math-drill/ChallengeApp'
import { answerQuestion, createScoreState, generateChallengeSession, generateSession } from '../src/features/math-drill/domain'
import type { SavedSessionV1 } from '../src/features/math-drill/persistence/sessionTypes'
import type { AtomicCompletionResult } from '../src/features/math-drill/persistence/completedSessionHistoryStore'
import type { SessionControllerOptions } from '../src/features/math-drill/persistence/sessionController'

function harness(challenge: boolean) {
  const g = challenge ? generateChallengeSession({ selectedLevels: [1], selectedLevel5Sublevels: [], mode: 'mixed', count: 10, seed: 2027, roundSize: 10 }) : generateSession({ level: 1, mode: 'addition', count: 1, seed: 2027 })
  if (!g.ok) throw Error('fixture generation')
  const session = g.session
  let score = createScoreState(session)
  for (const q of session.questions) for (const i of q.choices.map((_, i) => i).filter(i => i !== q.correctChoiceIndex).slice(0, 2)) {
    const a = answerQuestion(score, session, q.key, i); if (!a.ok) throw Error('fixture answer'); score = a.state
  }
  let record = { schemaVersion: 1, mode: challenge ? 'challenge' : 'regular', instanceId: '550e8400-e29b-41d4-a716-446655440000', sessionId: session.id, session, score, revision: 7, createdAt: 100, updatedAt: 200, cursor: { phase: 'manual-advance', questionIndex: session.questions.length - 1, pendingAdvanceAt: null } } as SavedSessionV1
  let release!: (v: AtomicCompletionResult) => void
  const gate = new Promise<AtomicCompletionResult>(r => { release = r })
  const commit = vi.fn((): Promise<AtomicCompletionResult> => gate)
  const store = { load: vi.fn(async () => ({ status: 'valid' as const, value: record })), create: vi.fn(), save: vi.fn(), replace: vi.fn(), close: vi.fn(), commitResult: commit, verifyCommitted: vi.fn(), get: vi.fn() }
  const factory = (): SessionControllerOptions => ({ store: { ...store }, completionMode: 'atomic', now: () => 1000 })
  return { factory, commit, store, release, success() { record = { ...record, revision: 8, updatedAt: 2000, cursor: { ...record.cursor, phase: 'result' } }; return { status: 'inserted', snapshot: record, value: {} } as AtomicCompletionResult } }
}
async function settle() { await act(async () => { await Promise.resolve() }) }
afterEach(() => { cleanup(); vi.useRealTimers() })

describe.each([false, true])('Stage 5B.2D %s UI with actual controller', challenge => {
  it('shows unconfirmed status after the UI threshold without aborting the pending operation', async () => {
    vi.useFakeTimers()
    const h = harness(challenge)
    render(challenge ? <ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} persistenceFactory={h.factory} /> : <MathDrillApp onExit={vi.fn()} persistenceFactory={h.factory} />)
    await settle(); fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' })); await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' })); await settle()
    await act(async () => { await vi.advanceTimersByTimeAsync(4999) })
    expect(screen.queryByText('Penyimpanan belum dapat dipastikan.')).not.toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(screen.getByText('Penyimpanan belum dapat dipastikan.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Periksa Penyimpanan' })).toBeEnabled()
    expect(h.commit).toHaveBeenCalledTimes(1)
    expect(h.store.close).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: challenge ? 'Tantangan lagi' : 'Latihan lagi' })).toBeDisabled()
    await act(async () => h.release(h.success()))
    expect(screen.getByRole('button', { name: challenge ? 'Tantangan lagi' : 'Latihan lagi' })).toBeEnabled()
  })

  it('offers same-completion retry on failure and distinctly reports a conflict', async () => {
    const h = harness(challenge)
    h.commit.mockResolvedValueOnce({ status: 'storage-error', code: 'transaction-failed' })
    render(challenge ? <ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} persistenceFactory={h.factory} /> : <MathDrillApp onExit={vi.fn()} persistenceFactory={h.factory} />)
    await settle(); fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' })); await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' })); await settle()
    expect(screen.getByText('Hasil belum tersimpan. Progres jawaban sebelumnya tetap tersedia.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Coba Simpan Lagi' })).toBeEnabled()
    h.commit.mockResolvedValueOnce({ status: 'active-session-conflict' })
    fireEvent.click(screen.getByRole('button', { name: 'Coba Simpan Lagi' })); await settle()
    expect(screen.getByText('Sesi telah berubah di tab lain. Hasil lokal tidak akan menimpa sesi terbaru.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Coba Simpan Lagi' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Muat Sesi Terbaru' })).toBeEnabled()
  })

  it('uses the visible verification action to recover a lost completion response', async () => {
    const h = harness(challenge)
    h.commit.mockImplementationOnce(async () => { h.success(); throw Error('lost after commit') })
    h.store.verifyCommitted.mockResolvedValue({ status: 'committed' })
    render(challenge ? <ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} persistenceFactory={h.factory} /> : <MathDrillApp onExit={vi.fn()} persistenceFactory={h.factory} />)
    await settle(); fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' })); await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' })); await settle()
    expect(screen.getByText('Penyimpanan belum dapat dipastikan.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Periksa Penyimpanan' })); await settle()
    expect(h.store.verifyCommitted).toHaveBeenCalledTimes(1)
    expect(h.commit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: challenge ? 'Tantangan lagi' : 'Latihan lagi' })).toBeEnabled()
  })

  it('marks a calculated pending result and disables replacement until exact committed success', async () => {
    const h = harness(challenge)
    render(<StrictMode>{challenge ? <ChallengeApp onExit={vi.fn()} onBackToRegular={vi.fn()} persistenceFactory={h.factory} /> : <MathDrillApp onExit={vi.fn()} persistenceFactory={h.factory} />}</StrictMode>)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' })); await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' })); await settle()
    expect(screen.getByText('Menyimpan hasil...')).toBeInTheDocument()
    expect(screen.getByText('Hasil sudah dihitung, tetapi belum dikonfirmasi tersimpan.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: challenge ? 'Tantangan lagi' : 'Latihan lagi' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Mulai Baru' })).not.toBeInTheDocument()
    await act(async () => h.release(h.success()))
    expect(screen.queryByText('Menyimpan hasil...')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: challenge ? 'Tantangan lagi' : 'Latihan lagi' })).toBeEnabled()
    expect(h.commit).toHaveBeenCalledTimes(1)
  })
})
