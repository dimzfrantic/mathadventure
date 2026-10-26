import { fireEvent, render, screen, within } from '@testing-library/react'
import { DistributionApp } from '../src/DistributionApp'
import { MemoryDistributionEvidenceStore } from '../src/learning/distributionEvidenceStore'

function start(store = new MemoryDistributionEvidenceStore()) {
  render(<DistributionApp store={store} />)
  fireEvent.click(screen.getByRole('button', { name: 'Mulai tantangan' }))
  return store
}

function allocate(itemNumber: number, recipientNumber: number) {
  fireEvent.click(screen.getByRole('button', { name: `Benda ${itemNumber} di persediaan` }))
  fireEvent.click(screen.getByRole('button', { name: `Bagikan benda ke Teman ${recipientNumber}` }))
}

describe('00.1-B distribution UI', () => {
  it('does not ask the child to count how many objects remain in shared stock', () => {
    start()
    expect(screen.getByRole('heading', { name: 'Persediaan bersama' })).toBeInTheDocument()
    expect(screen.queryByText('(5 benda)')).not.toBeInTheDocument()
  })

  it('supports tap distribution and shows the single item at its selected recipient', () => {
    start()
    allocate(1, 1)
    const recipient = screen.getByRole('group', { name: 'Teman 1' })
    expect(within(recipient).getByText('Benda 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Benda 1 di persediaan' })).not.toBeInTheDocument()
  })

  it('lets the child cancel a tap-selected item with Escape or a second tap', () => {
    start()
    const item = screen.getByRole('button', { name: 'Benda 1 di persediaan' })
    fireEvent.click(item)

    expect(screen.getByRole('status')).toHaveTextContent(/Tekan Escape/)
    fireEvent.click(item)
    expect(item).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(item)
    fireEvent.keyDown(item, { key: 'Escape' })
    expect(item).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('status')).not.toHaveTextContent('dipilih')
  })

  it('allows multiple visible objects at one recipient and offers repair controls', () => {
    start()
    allocate(1, 1)
    allocate(2, 1)
    const recipient = screen.getByRole('group', { name: 'Teman 1' })
    expect(within(recipient).getByText('Benda 1')).toBeInTheDocument()
    expect(within(recipient).getByText('Benda 2')).toBeInTheDocument()
    expect(within(recipient).getByRole('button', { name: 'Kembalikan Benda 2 ke persediaan' })).toBeInTheDocument()
  })

  it('supports undo and returning an allocation without restarting the task', () => {
    start()
    allocate(1, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan langkah terakhir' }))
    expect(screen.getByRole('button', { name: 'Benda 1 di persediaan' })).toBeInTheDocument()
    allocate(1, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Kembalikan Benda 1 ke persediaan' }))
    expect(screen.getByRole('button', { name: 'Benda 1 di persediaan' })).toBeInTheDocument()
  })

  it('saves no attempt for allocation clicks and saves only after the explicit board check', () => {
    const store = start()
    allocate(1, 1)
    expect(store.getAttempts()).toHaveLength(0)
    expect(screen.getByRole('heading', { name: 'Bagikan satu benda ke setiap teman' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sudah selesai, periksa!' }))
    expect(store.getAttempts()).toHaveLength(1)
  })

  it('saves a correct board snapshot on explicit check and keeps the board visible', () => {
    const store = start()
    for (let i = 1; i <= 5; i += 1) allocate(i, i)
    expect(store.getAttempts()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Sudah selesai, periksa!' }))
    expect(store.getAttempts()).toHaveLength(1)
    expect(store.getAttempts()[0]).toMatchObject({ taskId: '00.1-B', variantId: 'sufficient', valid: true })
    expect(screen.getByRole('heading', { name: 'Bagikan satu benda ke setiap teman' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Yeay, semua teman sudah mendapat satu benda!' })).toBeInTheDocument()
    expect(screen.queryByText(/evidence|mastery/i)).not.toBeInTheDocument()
  })

  it('keeps an incorrect distribution on the board with contextual repair cues', () => {
    const store = start()
    allocate(1, 1)
    allocate(2, 1)
    allocate(3, 3)
    allocate(4, 4)
    allocate(5, 5)
    fireEvent.click(screen.getByRole('button', { name: 'Sudah selesai, periksa!' }))
    expect(store.getAttempts()).toHaveLength(1)
    expect(store.getAttempts()[0]).toMatchObject({ valid: false, outcome: 'interpretable_incorrect' })
    expect(within(screen.getByRole('group', { name: 'Teman 1' })).getByText(/lebih dari satu/i)).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Teman 2' })).getByText(/belum mendapat/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kembalikan Benda 2 ke persediaan' })).toBeInTheDocument()
  })

  it('keeps hint history after repairing the board so a later correct attempt stays guided', () => {
    const store = start()
    fireEvent.click(screen.getByRole('button', { name: 'Petunjuk' }))
    allocate(1, 1)
    allocate(2, 1)
    allocate(3, 3)
    allocate(4, 4)
    allocate(5, 5)
    fireEvent.click(screen.getByRole('button', { name: 'Sudah selesai, periksa!' }))
    expect(store.getAttempts()[0]).toMatchObject({ valid: false, hintHistoryLevel: 1 })

    fireEvent.click(screen.getByRole('button', { name: 'Kembalikan Benda 2 ke persediaan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Benda 2 di persediaan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bagikan benda ke Teman 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sudah selesai, periksa!' }))

    expect(store.getAttempts()).toHaveLength(2)
    expect(store.getAttempts()[1]).toMatchObject({ valid: true, outcome: 'guided', hintHistoryLevel: 1, repeatedVariant: true, countsAsFreshIndependent: false })
  })

  it('pauses and resumes without losing an in-memory distribution checkpoint', () => {
    const store = start()
    allocate(1, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Jeda' }))
    expect(store.getAttempts()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }))
    const recipient = screen.getByRole('group', { name: 'Teman 1' })
    expect(within(recipient).getByText('Benda 1')).toBeInTheDocument()
  })

  it('uses native buttons that can receive keyboard focus', () => {
    start()
    const item = screen.getByRole('button', { name: 'Benda 1 di persediaan' })
    item.focus()
    expect(document.activeElement).toBe(item)
    expect(screen.getByRole('button', { name: 'Sudah selesai, periksa!' })).toBeInTheDocument()
  })
})
