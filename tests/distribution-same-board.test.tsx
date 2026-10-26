import { fireEvent, render, screen, within } from '@testing-library/react'
import { DistributionApp } from '../src/DistributionApp'
import { MemoryDistributionEvidenceStore } from '../src/learning/distributionEvidenceStore'

function openBoard(store = new MemoryDistributionEvidenceStore()) {
  render(<DistributionApp store={store} />)
  fireEvent.click(screen.getByRole('button', { name: 'Mulai tantangan' }))
  return store
}

function allocate(itemNumber: number, recipientNumber: number) {
  fireEvent.click(screen.getByRole('button', { name: `Benda ${itemNumber} di persediaan` }))
  fireEvent.click(screen.getByRole('button', { name: `Bagikan benda ke Teman ${recipientNumber}` }))
}

describe('00.1-B single-board check flow', () => {
  it('prompts one object per friend without suggesting an intentional duplicate', () => {
    openBoard()
    expect(screen.getByText('Bagikan satu benda ke setiap teman. Pilih benda, lalu teman yang akan menerimanya. Kamu bisa mengembalikan benda jika ingin mengubah pembagian.')).toBeInTheDocument()
  })

  it('keeps the whole board visible and gives no verdict until the child explicitly checks', () => {
    const store = openBoard()
    for (let i = 1; i <= 5; i += 1) {
      allocate(i, i)
      expect(store.getAttempts()).toHaveLength(0)
      expect(screen.queryByRole('heading', { name: 'Yeay, semua teman sudah mendapat satu benda!' })).not.toBeInTheDocument()
    }

    fireEvent.click(screen.getByRole('button', { name: 'Sudah selesai, periksa!' }))

    expect(store.getAttempts()).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Bagikan satu benda ke setiap teman' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Persediaan bersama' })).toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: /^Teman / })).toHaveLength(5)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Yeay, semua teman sudah mendapat satu benda!' })).toBeInTheDocument()

    const evidence = store.getAttempts()[0]
    expect(evidence).toMatchObject({ taskId: '00.1-B', variantId: 'sufficient', valid: true, outcome: 'independent' })
    expect(evidence).not.toHaveProperty('reviewAccurate')
    expect(evidence).not.toHaveProperty('reportedUnassignedItems')
    expect(evidence).not.toHaveProperty('selectedRecipientsNeedingAdjustment')
  })

  it('shows contextual feedback on the same board and retains an incorrect allocation for repair', () => {
    const store = openBoard()
    allocate(1, 1)
    allocate(2, 1)
    allocate(3, 3)
    allocate(4, 4)
    allocate(5, 5)

    fireEvent.click(screen.getByRole('button', { name: 'Sudah selesai, periksa!' }))

    expect(store.getAttempts()).toHaveLength(1)
    expect(store.getAttempts()[0]).toMatchObject({ valid: false, outcome: 'interpretable_incorrect' })
    expect(screen.getByRole('heading', { name: 'Bagikan satu benda ke setiap teman' })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Teman 1' })).getByText(/lebih dari satu/i)).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Teman 2' })).getByText(/belum mendapat/i)).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Teman 1' })).getByText('Benda 1')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Teman 1' })).getByText('Benda 2')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Periksa pembagianmu' })).not.toBeInTheDocument()
  })

  it('prevents duplicate attempts for an unchanged snapshot but enables checking after an allocation change', () => {
    const store = openBoard()
    allocate(1, 1)
    allocate(2, 2)
    fireEvent.click(screen.getByRole('button', { name: 'Sudah selesai, periksa!' }))
    expect(store.getAttempts()).toHaveLength(1)
    const checkButton = screen.getByRole('button', { name: 'Sudah selesai, periksa!' })
    expect(checkButton).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Benda 3 di persediaan' }))
    expect(checkButton).toBeDisabled()
    expect(store.getAttempts()).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Bagikan benda ke Teman 3' }))
    expect(checkButton).toBeEnabled()
    fireEvent.click(checkButton)
    expect(store.getAttempts()).toHaveLength(2)
  })

  it('keeps a corrected hint-assisted result guided rather than relabeling it independent', () => {
    const store = openBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Petunjuk' }))
    allocate(1, 1)
    allocate(2, 1)
    allocate(3, 3)
    allocate(4, 4)
    allocate(5, 5)
    expect(store.getAttempts()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Sudah selesai, periksa!' }))
    expect(store.getAttempts()[0]).toMatchObject({ valid: false, hintHistoryLevel: 1 })

    fireEvent.click(screen.getByRole('button', { name: 'Kembalikan Benda 2 ke persediaan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Benda 2 di persediaan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bagikan benda ke Teman 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sudah selesai, periksa!' }))

    expect(store.getAttempts()).toHaveLength(2)
    expect(store.getAttempts()[1]).toMatchObject({ valid: true, outcome: 'guided', hintHistoryLevel: 1, repeatedVariant: true, countsAsFreshIndependent: false })
    expect(screen.getByRole('heading', { name: 'Bagikan satu benda ke setiap teman' })).toBeInTheDocument()
  })

  it('keeps earlier attempts when the child explicitly retries, and records the next success as guided', () => {
    const store = openBoard()
    allocate(1, 1)
    allocate(2, 1)
    allocate(3, 3)
    allocate(4, 4)
    allocate(5, 5)
    fireEvent.click(screen.getByRole('button', { name: 'Sudah selesai, periksa!' }))
    expect(store.getAttempts()).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Mulai pembagian ini dari awal' }))
    expect(store.getAttempts()).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Benda 1 di persediaan' })).toBeInTheDocument()
    expect(screen.queryByText('Benda 1', { selector: '.assigned-item' })).not.toBeInTheDocument()

    for (let i = 1; i <= 5; i += 1) allocate(i, i)
    fireEvent.click(screen.getByRole('button', { name: 'Sudah selesai, periksa!' }))

    expect(store.getAttempts()).toHaveLength(2)
    expect(store.getAttempts()[1]).toMatchObject({
      valid: true,
      outcome: 'guided',
      repeatedVariant: true,
      countsAsFreshIndependent: false,
    })
  })
})
