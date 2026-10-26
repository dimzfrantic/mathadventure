import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { ACCEPTANCE_DATABASE_NAME, default as AcceptanceShell } from '../src/stage5b2e-acceptance/AcceptanceShell'
import { inspectAcceptanceCapabilities } from '../src/stage5b2e-acceptance/diagnostics'

afterEach(() => cleanup())

describe('Stage 5B.2E isolated acceptance entry', () => {
  it('keeps the acceptance DB under the disposable prefix', () => {
    expect(ACCEPTANCE_DATABASE_NAME).toMatch(/^math-adventure-stage5b2c-/)
    expect(ACCEPTANCE_DATABASE_NAME).not.toBe('math-adventure')
  })

  it('labels the test-only origin and fails visibly if disposable IndexedDB cannot initialize', async () => {
    render(<AcceptanceShell />)
    expect(screen.getByText('MODE PENGUJIAN — DATA TERPISAH')).toBeInTheDocument()
    expect(screen.getByText(ACCEPTANCE_DATABASE_NAME)).toBeInTheDocument()
    expect(screen.getByText('window.isSecureContext')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/GAGAL: unavailable/)).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('Database disposable belum dapat diinisialisasi')
    expect(screen.queryByRole('button', { name: 'Mulai latihan' })).not.toBeInTheDocument()
  })

  it('reports missing subtle without hiding available CSPRNG and IndexedDB', () => {
    const result = inspectAcceptanceCapabilities({
      isSecureContext: false,
      crypto: { subtle: undefined, getRandomValues: () => new Uint8Array(1), randomUUID: undefined },
      indexedDB: {},
    })
    expect(result).toEqual({
      secureContext: false,
      subtleCrypto: false,
      secureRandom: true,
      randomUUID: false,
      indexedDB: true,
    })
  })

  it('reports unavailable secure random and IndexedDB as unavailable without fallback', () => {
    const result = inspectAcceptanceCapabilities({ isSecureContext: false, crypto: undefined, indexedDB: undefined })
    expect(result).toEqual({
      secureContext: false,
      subtleCrypto: false,
      secureRandom: false,
      randomUUID: false,
      indexedDB: false,
    })
  })
})
