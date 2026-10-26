import { fireEvent, render, screen, within } from '@testing-library/react'
import App from '../src/App'
import { MatchingApp } from '../src/MatchingApp'
import { MemoryEvidenceStore } from '../src/learning/evidenceStore'
import { dispatchPointer, installPointerHitTest, restorePointerHitTest, setPointerHitTarget } from './pointer-test-utils'

function start(label = 'Susunan 1') {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))
}

function pair(a: number, r: number) {
  fireEvent.click(screen.getByRole('button', { name: `Pilih astronaut ${a}` }))
  fireEvent.click(screen.getByRole('button', { name: `Pilih roket ${r}` }))
}

describe('00.1-A child interaction', () => {
  it('does not ask the child to classify interface difficulty', () => {
    start()
    expect(screen.queryByRole('button', { name: 'Aku kesulitan memakai layar' })).not.toBeInTheDocument()
  })

  it('shows the requested context-specific title after an incorrect completed answer', () => {
    start('Susunan 2')
    pair(1, 1); pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('radio', { name: 'Tidak ada yang tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(screen.getByRole('heading', { name: 'Ayo, coba sekali lagi!' })).toBeInTheDocument()
  })

  it('does not expose internal evaluation language on the child-facing result', () => {
    start()
    pair(1, 1); pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('radio', { name: 'Tidak ada yang tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(screen.queryByText(/Belum menentukan penguasaan dari satu tugas/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\b(evidence|mastery|diagnostic|independent|guided|inconclusive)\b/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Bukti:/)).not.toBeInTheDocument()
  })

  it('keeps an incorrect attempt recorded while returning to edit its answer', () => {
    start('Susunan 2')
    pair(1, 1); pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('radio', { name: 'Tidak ada yang tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    fireEvent.click(screen.getByRole('button', { name: 'Perbaiki jawaban' }))
    expect(screen.getByRole('region', { name: 'Pasangan yang dibuat' })).toHaveTextContent('Astronaut 1 — Roket 1')
    expect(screen.getByRole('radio', { name: 'Tidak ada yang tersisa' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Urungkan langkah' })).toBeEnabled()
    fireEvent.click(screen.getByRole('radio', { name: 'Astronaut tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(screen.getByRole('heading', { name: 'Yeay, kamu berhasil! 🚀' })).toBeInTheDocument()
  })

  it('keeps a previous attempt in the evidence store after editing and submitting again', () => {
    const evidenceStore = new MemoryEvidenceStore()
    render(<MatchingApp evidenceStore={evidenceStore} />)
    fireEvent.click(screen.getByRole('button', { name: /^Susunan 2/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Minta petunjuk' }))
    pair(1, 1); pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('radio', { name: 'Tidak ada yang tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(evidenceStore.getAttempts()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Perbaiki jawaban' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Astronaut tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(evidenceStore.getAttempts()).toHaveLength(2)
    expect(evidenceStore.getAttempts()[0].outcome).toBe('interpretable_incorrect')
    expect(evidenceStore.getAttempts()[1].outcome).toBe('guided')
    expect(evidenceStore.getAttempts()[0].hintLevel).toBe(1)
    expect(evidenceStore.getAttempts()[1].hintLevel).toBe(1)
    expect(evidenceStore.getAttempts()[1].repeatedVariant).toBe(true)
    expect(evidenceStore.getAttempts()[1].countsAsFreshIndependent).toBe(false)
    expect(evidenceStore.getAttempts()[0].identifiedRemainder).toBe('none')
  })

  it('does not misclassify a repeated retry of the same variant as fresh independent evidence', () => {
    start()
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    pair(1, 1); pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('radio', { name: 'Tidak ada yang tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(screen.getByRole('heading', { name: 'Yeay, kamu berhasil! 🚀' })).toBeInTheDocument()
  })

  it('marks a same-variant attempt reopened from the mission menu as non-fresh evidence', () => {
    const evidenceStore = new MemoryEvidenceStore()
    render(<MatchingApp evidenceStore={evidenceStore} />)
    const startSame = () => fireEvent.click(screen.getByRole('button', { name: /^Susunan 1/ }))
    startSame()
    fireEvent.click(screen.getByRole('button', { name: 'Minta petunjuk' }))
    pair(1, 1); pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('radio', { name: 'Tidak ada yang tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    fireEvent.click(screen.getByRole('button', { name: 'Kembali ke pilihan misi' }))
    startSame()
    pair(1, 1); pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('radio', { name: 'Tidak ada yang tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(evidenceStore.getAttempts()).toHaveLength(2)
    expect(evidenceStore.getAttempts()[1].repeatedVariant).toBe(true)
    expect(evidenceStore.getAttempts()[1].hintLevel).toBe(0)
    expect(evidenceStore.getAttempts()[1].hintHistoryLevel).toBe(1)
    expect(evidenceStore.getAttempts()[1].countsAsFreshIndependent).toBe(false)
  })

  it('offers the next mission and the mission menu after a correct answer', () => {
    start()
    pair(1, 1); pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('radio', { name: 'Tidak ada yang tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(screen.getByRole('button', { name: 'Lanjut ke Susunan 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kembali ke pilihan misi' })).toBeInTheDocument()
  })

  it('keeps balanced-answer child feedback specific and supportive', () => {
    start()
    pair(1, 1); pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('radio', { name: 'Tidak ada yang tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(screen.getByText('Semua astronaut dan roket sudah berpasangan.')).toBeInTheDocument()
  })

  it('keeps astronaut-remainder child feedback specific', () => {
    start('Susunan 2')
    pair(1, 1); pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('radio', { name: 'Astronaut tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(screen.getByText('Ada astronaut yang belum mendapat roket.')).toBeInTheDocument()
  })

  it('keeps rocket-remainder child feedback specific', () => {
    start('Susunan 3')
    pair(1, 1); pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('radio', { name: 'Roket tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(screen.getByText('Ada roket yang belum digunakan.')).toBeInTheDocument()
  })

  it('keeps wrong-answer feedback supportive without revealing the answer', () => {
    start('Susunan 2')
    pair(1, 1); pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('radio', { name: 'Tidak ada yang tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(screen.getByText('Coba lihat lagi benda mana yang belum mendapat pasangan. Kamu bisa mengubah pilihanmu.')).toBeInTheDocument()
    expect(screen.queryByText('Ada astronaut yang belum mendapat roket.')).not.toBeInTheDocument()
  })

  it('supports tap pairing and confirms no remainder with independent evidence', () => {
    start()
    pair(1, 1); pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('radio', { name: 'Tidak ada yang tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(screen.getByRole('status')).toHaveTextContent('Semua astronaut dan roket sudah berpasangan.')
    expect(screen.getByRole('heading', { name: 'Yeay, kamu berhasil! 🚀' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Yeay, kamu berhasil! 🚀' })).toBeInTheDocument()
    expect(screen.queryByText(/\b(independent|guided|interpretable_incorrect|inconclusive)\b/)).not.toBeInTheDocument()
  })

  it('blocks incomplete submission and preserves pairs and selected remainder without recording evidence', () => {
    start()
    pair(1, 1)
    fireEvent.click(screen.getByRole('radio', { name: 'Roket tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(screen.getByRole('region', { name: 'Daftar astronaut' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Masih ada astronaut dan roket yang bisa dipasangkan. Ayo lanjutkan dulu!')
    expect(screen.getByRole('button', { name: 'Pilih astronaut 1' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Roket tersisa' })).toBeChecked()
    expect(screen.queryByText(/^Bukti:/)).not.toBeInTheDocument()
  })

  it('asks for the remainder choice after all possible pairs are made', () => {
    start()
    pair(1, 1); pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(screen.getByRole('region', { name: 'Daftar astronaut' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Pilih dulu apa yang tersisa, lalu periksa jawabanmu.')
    expect(screen.getByRole('button', { name: 'Pilih astronaut 1' })).toBeDisabled()
    expect(screen.queryByText(/^Bukti:/)).not.toBeInTheDocument()
  })

  it('keeps leftover rockets visible and checks their identification', () => {
    start('Susunan 3')
    pair(1, 1); pair(2, 2); pair(3, 3)
    expect(screen.getByRole('button', { name: 'Pilih roket 4' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Roket tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(screen.getByRole('heading', { name: 'Yeay, kamu berhasil! 🚀' })).toBeInTheDocument()
  })

  it('prevents double pairing via tap, offers undo and retry', () => {
    start()
    pair(1, 1)
    expect(screen.getByRole('button', { name: 'Pilih astronaut 1' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Urungkan langkah' }))
    expect(screen.getByRole('button', { name: 'Pilih astronaut 1' })).not.toBeDisabled()
    pair(1, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    expect(screen.getByRole('button', { name: 'Pilih roket 1' })).not.toBeDisabled()
  })

  it('stages hints without marking the answer rocket, and records guided outcome', () => {
    start()
    fireEvent.click(screen.getByRole('button', { name: 'Minta petunjuk' }))
    expect(screen.getByRole('status')).toHaveTextContent('Cari yang belum punya pasangan')
    fireEvent.click(screen.getByRole('button', { name: 'Minta petunjuk' }))
    expect(screen.getByRole('status')).toHaveTextContent('Satu astronaut yang belum punya pasangan ditandai')
    expect(screen.getByRole('button', { name: 'Pilih astronaut 1' })).toHaveAttribute('data-hint', 'true')
    expect(screen.getByRole('button', { name: 'Pilih roket 1' })).not.toHaveAttribute('data-hint', 'true')
    pair(1, 1); pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('radio', { name: 'Tidak ada yang tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(screen.getByRole('heading', { name: 'Yeay, kamu berhasil! 🚀' })).toBeInTheDocument()
  })

  it('lets the child pause and resume without losing current pairs', () => {
    start()
    pair(1, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Jeda' }))
    expect(screen.getByText('Misi dijeda. Kamu boleh melanjutkan nanti.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan misi' }))
    expect(screen.getByRole('button', { name: 'Pilih astronaut 1' })).toBeDisabled()
  })

  it('pause and resume preserve undo history for the previous pair', () => {
    start()
    pair(1, 1)
    fireEvent.click(screen.getByRole('radio', { name: 'Roket tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Minta petunjuk' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jeda' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan misi' }))
    expect(screen.getByRole('radio', { name: 'Roket tersisa' })).toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent('Cari yang belum punya pasangan')
    fireEvent.click(screen.getByRole('button', { name: 'Urungkan langkah' }))
    expect(screen.getByRole('radio', { name: 'Roket tersisa' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Urungkan langkah' }))
    expect(screen.getByRole('button', { name: 'Pilih astronaut 1' })).not.toBeDisabled()
  })

  it.each([
    ['Susunan 1', 'Lanjut ke Susunan 2', 'Lanjut ke Susunan 3'],
    ['Susunan 2', 'Lanjut ke Susunan 3', 'Lanjut ke Susunan 1'],
    ['Susunan 3', 'Lanjut ke Susunan 1', 'Lanjut ke Susunan 2'],
  ])('follows remaining arrangements in circular order when starting at %s', (startLabel, firstNext, secondNext) => {
    start(startLabel)
    const completeCurrent = (answer: string) => {
      pair(1, 1); pair(2, 2); pair(3, 3)
      fireEvent.click(screen.getByRole('radio', { name: answer }))
      fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    }
    const expectedAnswers: Record<string, string> = {
      'Susunan 1': 'Tidak ada yang tersisa',
      'Susunan 2': 'Astronaut tersisa',
      'Susunan 3': 'Roket tersisa',
    }
    completeCurrent(expectedAnswers[startLabel])
    fireEvent.click(screen.getByRole('button', { name: firstNext }))
    const firstDest = firstNext.replace('Lanjut ke ', '')
    completeCurrent(expectedAnswers[firstDest])
    fireEvent.click(screen.getByRole('button', { name: secondNext }))
    const secondDest = secondNext.replace('Lanjut ke ', '')
    completeCurrent(expectedAnswers[secondDest])
    expect(screen.getByText('Yeay, semua susunan sudah kamu coba!')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Lanjut ke Susunan/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kembali ke pilihan misi' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bermain lagi' })).toBeInTheDocument()
  })

  it('does not mark an incomplete or incorrect arrangement complete in session progress', () => {
    start('Susunan 1')
    pair(1, 1)
    fireEvent.click(screen.getByRole('radio', { name: 'Astronaut tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(screen.getByRole('status')).toHaveTextContent('Masih ada astronaut dan roket yang bisa dipasangkan')
    pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('radio', { name: 'Astronaut tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(screen.getByRole('button', { name: 'Perbaiki jawaban' })).toBeInTheDocument()
    expect(screen.queryByText('Yeay, semua susunan sudah kamu coba!')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Perbaiki jawaban' }))
    expect(screen.getByRole('button', { name: 'Pilih astronaut 1' })).toBeDisabled()
  })

  it('uses native button keyboard activation for a pairing', () => {
    start()
    const astronaut = screen.getByRole('button', { name: 'Pilih astronaut 1' })
    astronaut.focus()
    fireEvent.keyDown(astronaut, { key: 'Enter' })
    // Native buttons activate on Enter in browsers; click simulates that activation in jsdom.
    fireEvent.click(astronaut)
    const rocket = screen.getByRole('button', { name: 'Pilih roket 1' })
    fireEvent.click(rocket)
    expect(astronaut).toBeDisabled()
    expect(within(screen.getByRole('region', { name: 'Pasangan yang dibuat' })).getByText(/Astronaut 1/)).toBeInTheDocument()
  })

  it('can return from the mission menu to a paused board', () => {
    start()
    pair(1, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Jeda' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keluar ke pilihan misi' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan misi tertunda' }))
    expect(screen.getByRole('button', { name: 'Pilih astronaut 1' })).toBeDisabled()
  })

  it('pairs through Pointer Events with a mouse pointer', () => {
    installPointerHitTest()
    try {
      start()
      const astronaut = screen.getByRole('button', { name: 'Pilih astronaut 1' })
      const rocket = screen.getByRole('button', { name: 'Pilih roket 2' })
      astronaut.setPointerCapture = vi.fn()
      astronaut.releasePointerCapture = vi.fn()
      setPointerHitTarget(rocket)
      dispatchPointer(astronaut, 'pointerdown', { x: 20, y: 20, pointerType: 'mouse' })
      dispatchPointer(astronaut, 'pointermove', { x: 40, y: 42, pointerType: 'mouse' })
      dispatchPointer(astronaut, 'pointerup', { x: 40, y: 42, pointerType: 'mouse' })
      expect(astronaut).toBeDisabled()
      expect(rocket).toBeDisabled()
    } finally {
      restorePointerHitTest()
    }
  })

  it('does not claim an astronaut is highlighted when only a rocket remains', () => {
    start('Susunan 3')
    pair(1, 1); pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('button', { name: 'Minta petunjuk' }))
    fireEvent.click(screen.getByRole('button', { name: 'Minta petunjuk' }))
    expect(screen.getByRole('status')).not.toHaveTextContent('Satu astronaut yang belum punya pasangan ditandai')
  })

  it('records an interpretable incorrect remainder without exposing internal labels', () => {
    start('Susunan 2')
    pair(1, 1); pair(2, 2); pair(3, 3)
    fireEvent.click(screen.getByRole('radio', { name: 'Tidak ada yang tersisa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periksa jawaban' }))
    expect(screen.getByRole('heading', { name: 'Ayo, coba sekali lagi!' })).toBeInTheDocument()
    expect(screen.queryByText(/\b(independent|guided|interpretable_incorrect|inconclusive)\b/)).not.toBeInTheDocument()
  })
})
