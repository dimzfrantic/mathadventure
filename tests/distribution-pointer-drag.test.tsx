import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DistributionApp } from '../src/DistributionApp'
import { MemoryDistributionEvidenceStore } from '../src/learning/distributionEvidenceStore'
import { dispatchPointer, installPointerHitTest, restorePointerHitTest, setPointerHitTarget } from './pointer-test-utils'

function startDistribution() {
  const store = new MemoryDistributionEvidenceStore()
  render(<DistributionApp store={store} />)
  fireEvent.click(screen.getByRole('button', { name: 'Mulai tantangan' }))
  return store
}

function beginDrag(source: HTMLElement, pointerType: 'touch' | 'mouse' = 'touch') {
  source.setPointerCapture = vi.fn()
  source.releasePointerCapture = vi.fn()
  dispatchPointer(source, 'pointerdown', { x: 20, y: 20, pointerType })
  dispatchPointer(source, 'pointermove', { x: 42, y: 42, pointerType })
}

describe('00.1-B pointer drag interaction', () => {
  afterEach(restorePointerHitTest)

  it('allocates once on a valid pointer drop without creating a learning attempt', () => {
    installPointerHitTest()
    const store = startDistribution()
    const item = screen.getByRole('button', { name: 'Benda 1 di persediaan' })
    const target = screen.getByRole('button', { name: 'Bagikan benda ke Teman 2' })
    setPointerHitTarget(target)

    beginDrag(item, 'mouse')

    expect(item.setPointerCapture).toHaveBeenCalledWith(1)
    expect(screen.getByTestId('pointer-drag-preview')).toHaveTextContent('Benda 1')
    expect(target).toHaveAttribute('data-drop-hover', 'true')

    dispatchPointer(item, 'pointerup', { x: 42, y: 42 })

    expect(within(screen.getByRole('group', { name: 'Teman 2' })).getByText('Benda 1')).toBeInTheDocument()
    fireEvent.click(target, { detail: 1 })
    expect(screen.getByRole('status')).not.toHaveTextContent('Pilih satu benda')
    expect(screen.queryByRole('button', { name: 'Benda 1 di persediaan' })).not.toBeInTheDocument()
    expect(store.getAttempts()).toHaveLength(0)
    expect(screen.queryByTestId('pointer-drag-preview')).not.toBeInTheDocument()
  })

  it('does not change allocation or selection when released outside a valid target', () => {
    installPointerHitTest()
    startDistribution()
    const item = screen.getByRole('button', { name: 'Benda 1 di persediaan' })
    setPointerHitTarget(document.body)

    beginDrag(item)
    dispatchPointer(item, 'pointerup', { x: 42, y: 42 })
    fireEvent.click(item, { detail: 1 })

    expect(item).toBeInTheDocument()
    expect(item).toHaveAttribute('aria-pressed', 'false')
    expect(within(screen.getByRole('group', { name: 'Teman 1' })).getByText('Belum ada benda')).toBeInTheDocument()
    expect(screen.queryByTestId('pointer-drag-preview')).not.toBeInTheDocument()
  })

  it('leaves stock unchanged after pointer cancellation', () => {
    installPointerHitTest()
    startDistribution()
    const item = screen.getByRole('button', { name: 'Benda 1 di persediaan' })
    const target = screen.getByRole('button', { name: 'Bagikan benda ke Teman 1' })
    setPointerHitTarget(target)

    beginDrag(item)
    dispatchPointer(item, 'pointercancel', { x: 42, y: 42 })

    expect(item).toBeInTheDocument()
    expect(item).toHaveAttribute('aria-pressed', 'false')
    expect(within(screen.getByRole('group', { name: 'Teman 1' })).getByText('Belum ada benda')).toBeInTheDocument()
    expect(screen.queryByTestId('pointer-drag-preview')).not.toBeInTheDocument()
  })

  it('treats a pointer gesture below the movement threshold as tap selection', () => {
    installPointerHitTest()
    startDistribution()
    const item = screen.getByRole('button', { name: 'Benda 1 di persediaan' })

    dispatchPointer(item, 'pointerdown', { x: 20, y: 20 })
    dispatchPointer(item, 'pointermove', { x: 22, y: 22 })
    dispatchPointer(item, 'pointerup', { x: 22, y: 22 })
    fireEvent.click(item, { detail: 1 })

    expect(item).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Benda 1 dipilih')
    expect(screen.queryByTestId('pointer-drag-preview')).not.toBeInTheDocument()
  })

  it('allows dragging an already tap-selected item and preserves undo conservation', () => {
    installPointerHitTest()
    const store = startDistribution()
    const item = screen.getByRole('button', { name: 'Benda 1 di persediaan' })
    fireEvent.click(item)
    expect(item).toHaveAttribute('aria-pressed', 'true')
    const target = screen.getByRole('button', { name: 'Bagikan benda ke Teman 1' })
    setPointerHitTarget(target)

    beginDrag(item)
    dispatchPointer(item, 'pointerup', { x: 42, y: 42 })

    expect(within(screen.getByRole('group', { name: 'Teman 1' })).getByText('Benda 1')).toBeInTheDocument()
    expect(store.getAttempts()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan langkah terakhir' }))
    expect(screen.getByRole('button', { name: 'Benda 1 di persediaan' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Teman 1' })).toHaveTextContent('Belum ada benda')
    expect(store.getAttempts()).toHaveLength(0)
  })
})
