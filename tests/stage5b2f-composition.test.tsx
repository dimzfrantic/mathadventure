import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../src/App'
import { selectMathDrillPersistence } from '../src/features/math-drill/persistence/historyActivation'
import { SESSION_DATABASE_VERSION, UNIFIED_DATABASE_VERSION } from '../src/features/math-drill/persistence/indexedDbSessionStore'
import { createUnifiedIndexedDbSessionStore } from '../src/features/math-drill/persistence/completedSessionHistoryStore'

const disposable = 'math-adventure-stage5b2c-stage5b2f-composition-unit'
afterEach(() => cleanup())

describe('Stage 5B.2F composition gate', () => {
  it('defaults OFF and retains the existing v1 store selection', () => {
    expect(selectMathDrillPersistence()).toBeUndefined()
    expect(SESSION_DATABASE_VERSION).toBe(1)
    expect(UNIFIED_DATABASE_VERSION).toBe(2)
  })

  it('fails closed for an unrecognized activation flag', () => {
    expect(selectMathDrillPersistence({ mode: 'unexpected' } as never)).toBeUndefined()
  })

  it('keeps the future live capability dormant until an explicit composition decision', () => {
    expect(selectMathDrillPersistence()).toBeUndefined()
    const selected = selectMathDrillPersistence({ mode: 'live' })
    expect(selected).toBeTypeOf('function')
    // Do not invoke: live database access is outside this stage.
  })

  it('routes an explicit disposable ON through atomic v2 without opening any default database', async () => {
    const open = vi.fn(() => { throw new Error('unit-only open trap') })
    const fake = { open } as unknown as IDBFactory
    const selected = selectMathDrillPersistence({ mode: 'disposable', databaseName: disposable, indexedDB: fake })
    expect(selected).toBeTypeOf('function')
    const options = selected!()
    expect(options.completionMode).toBe('atomic')
    expect('commitResult' in options.store).toBe(true)
    expect(await options.store.load('regular')).toMatchObject({ status: 'storage-error', code: 'open-failed' })
    expect(open).toHaveBeenCalledExactlyOnceWith(disposable, 2)
    options.store.close()
  })

  it('the normal App passes the selected disposable provider through its Regular owner', async () => {
    const open = vi.fn(() => { throw new Error('unit-only open trap') })
    render(<App historyActivation={{ mode: 'disposable', databaseName: disposable, indexedDB: { open } as unknown as IDBFactory }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Math Drill · Latihan' }))
    await waitFor(() => expect(open).toHaveBeenCalled())
    expect(open).toHaveBeenCalledExactlyOnceWith(disposable, 2)
  })

  it('keeps the general unified provider disposable-only even with an explicit composition option', async () => {
    const open = vi.fn(() => { throw new Error('unit-only open trap') })
    const invalid = createUnifiedIndexedDbSessionStore({ databaseName: 'unprefixed-stage5b2f-fixture', indexedDB: { open } as unknown as IDBFactory })
    expect(await invalid.open()).toEqual({ status: 'storage-error', code: 'unsafe-database-name' })
    expect(open).not.toHaveBeenCalled()
    invalid.close()
  })
})
