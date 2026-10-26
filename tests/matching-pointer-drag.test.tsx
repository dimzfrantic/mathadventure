import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MatchingApp } from '../src/MatchingApp'
import { dispatchPointer, installPointerHitTest, restorePointerHitTest, setPointerHitTarget } from './pointer-test-utils'

function startMatching() {
  render(<MatchingApp />)
  fireEvent.click(screen.getByRole('button', { name: /^Susunan 1/ }))
}

function beginDrag(source: HTMLElement) {
  source.setPointerCapture = vi.fn()
  source.releasePointerCapture = vi.fn()
  dispatchPointer(source, 'pointerdown', { x: 20, y: 20 })
  dispatchPointer(source, 'pointermove', { x: 40, y: 42 })
}

describe('00.1-A pointer drag interaction', () => {
  afterEach(restorePointerHitTest)

  it('shows the grabbed state as soon as a pointer is pressed', () => {
    startMatching()
    const astronaut = screen.getByRole('button', { name: 'Pilih astronaut 1' })

    dispatchPointer(astronaut, 'pointerdown', { x: 20, y: 20 })

    expect(astronaut).toHaveClass('is-dragging')
    expect(screen.getByTestId('pointer-drag-preview')).toHaveTextContent('Astronaut 1')
    dispatchPointer(astronaut, 'pointercancel', { x: 20, y: 20 })
  })

  it('lets the child cancel a tap-selected astronaut with Escape', () => {
    startMatching()
    const astronaut = screen.getByRole('button', { name: 'Pilih astronaut 1' })
    fireEvent.click(astronaut)

    expect(astronaut).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(astronaut, { key: 'Escape' })

    expect(astronaut).toHaveAttribute('aria-pressed', 'false')
    expect(within(screen.getByRole('region', { name: 'Pasangan yang dibuat' })).queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('captures a pointer, shows a moving preview and pairs once on a valid drop', () => {
    installPointerHitTest()
    startMatching()
    const astronaut = screen.getByRole('button', { name: 'Pilih astronaut 1' })
    const rocket = screen.getByRole('button', { name: 'Pilih roket 2' })
    setPointerHitTarget(rocket)

    beginDrag(astronaut)

    expect(astronaut.setPointerCapture).toHaveBeenCalledWith(1)
    expect(screen.getByTestId('pointer-drag-preview')).toHaveTextContent('Astronaut 1')
    expect(rocket).toHaveAttribute('data-drop-hover', 'true')

    dispatchPointer(astronaut, 'pointerup', { x: 40, y: 42 })

    const pairs = within(screen.getByRole('region', { name: 'Pasangan yang dibuat' })).getAllByRole('listitem')
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toHaveTextContent('Astronaut 1 — Roket 2')
    expect(astronaut).toBeDisabled()
    expect(rocket).toBeDisabled()
    expect(screen.queryByTestId('pointer-drag-preview')).not.toBeInTheDocument()
  })

  it('does not change matching state or select the source after an invalid drag release', () => {
    installPointerHitTest()
    startMatching()
    const astronaut = screen.getByRole('button', { name: 'Pilih astronaut 1' })
    setPointerHitTarget(document.body)

    beginDrag(astronaut)
    dispatchPointer(astronaut, 'pointerup', { x: 40, y: 42 })
    fireEvent.click(astronaut, { detail: 1 })

    expect(astronaut).toHaveAttribute('aria-pressed', 'false')
    expect(within(screen.getByRole('region', { name: 'Pasangan yang dibuat' })).queryByRole('listitem')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pointer-drag-preview')).not.toBeInTheDocument()
  })

  it('cleans up a cancelled pointer without pairing or losing either object', () => {
    installPointerHitTest()
    startMatching()
    const astronaut = screen.getByRole('button', { name: 'Pilih astronaut 1' })
    const rocket = screen.getByRole('button', { name: 'Pilih roket 1' })
    setPointerHitTarget(rocket)

    beginDrag(astronaut)
    dispatchPointer(astronaut, 'pointercancel', { x: 40, y: 42 })

    expect(astronaut).toBeEnabled()
    expect(rocket).toBeEnabled()
    expect(within(screen.getByRole('region', { name: 'Pasangan yang dibuat' })).queryByRole('listitem')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pointer-drag-preview')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Urungkan langkah' })).toBeDisabled()
  })

  it('keeps a short pointer movement as a tap and lets the child cancel selection by tapping again', () => {
    installPointerHitTest()
    startMatching()
    const astronaut = screen.getByRole('button', { name: 'Pilih astronaut 1' })

    dispatchPointer(astronaut, 'pointerdown', { x: 20, y: 20 })
    dispatchPointer(astronaut, 'pointermove', { x: 22, y: 22 })
    dispatchPointer(astronaut, 'pointerup', { x: 22, y: 22 })
    fireEvent.click(astronaut, { detail: 1 })

    expect(astronaut).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('pointer-drag-preview')).not.toBeInTheDocument()
    fireEvent.click(astronaut)
    expect(astronaut).toHaveAttribute('aria-pressed', 'false')
  })

  it('supports keyboard pairing and undo after a pointer drop', () => {
    installPointerHitTest()
    startMatching()
    const astronaut = screen.getByRole('button', { name: 'Pilih astronaut 1' })
    const rocket = screen.getByRole('button', { name: 'Pilih roket 1' })
    setPointerHitTarget(rocket)

    beginDrag(astronaut)
    dispatchPointer(astronaut, 'pointerup', { x: 40, y: 42 })
    expect(astronaut).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Urungkan langkah' }))
    expect(astronaut).toBeEnabled()
    expect(rocket).toBeEnabled()

    astronaut.focus()
    fireEvent.keyDown(astronaut, { key: 'Enter' })
    fireEvent.click(astronaut)
    fireEvent.click(rocket)
    expect(within(screen.getByRole('region', { name: 'Pasangan yang dibuat' })).getAllByRole('listitem')).toHaveLength(1)
  })
})
