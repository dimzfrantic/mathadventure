import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ParentDashboard } from '../src/features/math-drill/ParentDashboard'
import * as pinAuth from '../src/features/math-drill/parentPinAuth'
import type { UnifiedIndexedDbSessionStore } from '../src/features/math-drill/persistence/completedSessionHistoryStore'
import type { RewardController } from '../src/features/math-drill/reward'
import { setParentSessionToken, clearParentSessionToken } from '../src/features/math-drill/api/sessionApi'

/**
 * Stage 7B-A2 — Local Parent PIN & Backend Reward Alignment Tests.
 *
 * Verifies the architecture decisions:
 *   1. Parent PIN is strictly local to the device (a gate to prevent children
 *      from entering settings/rewards).
 *   2. Backend downtime does not unlock access, does not trigger fresh PIN setup,
 *      and does not alter the existing PIN. Local PIN remains usable even when
 *      the backend is unavailable or not configured.
 *   3. Authoritative reward ledger is managed by the backend. When the backend
 *      is unavailable, the dashboard honestly shows degraded status without
 *      fabricating any star balance.
 */

const VERIFIER_KEY = 'math-adventure-parent-pin-verifier'
const OPEN_LABEL = /akses orang tua terbuka/i

function fakeStore(): UnifiedIndexedDbSessionStore {
  return {
    list: vi.fn(async () => ({ status: 'success' as const, records: [], invalidCount: 0 })),
  } as unknown as UnifiedIndexedDbSessionStore
}

beforeEach(() => {
  localStorage.clear()
  pinAuth.clearPinVerifier()
  pinAuth.resetAttemptState()
  clearParentSessionToken()
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})


/** Stubs fetch so GET /api/parent/session validates the persisted token. */
function stubValidParentSession() {
  setParentSessionToken('test-session-token')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/parent/session')) {
      return new Response(JSON.stringify({ valid: true, expiresAt: Date.now() + 3_600_000 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ error: 'not-found' }), { status: 404 })
  }))
}

describe('Stage 7B-A2 — Local Parent PIN & Backend Reward Alignment', () => {
  it('1. prompts for PIN setup on a fresh device without local PIN, and never claims open access', async () => {
    render(<ParentDashboard store={fakeStore()} onBack={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: /buat pin orang tua/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/masukkan pin/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/konfirmasi pin/i)).toBeInTheDocument()
    expect(screen.queryByText(OPEN_LABEL)).not.toBeInTheDocument()
    expect(pinAuth.hasPinVerifier()).toBe(false)
  })

  it('2. completes local PIN setup, persists verifier to localStorage, and opens dashboard', async () => {
    render(<ParentDashboard store={fakeStore()} onBack={vi.fn()} />)

    const pinInput = await screen.findByLabelText(/masukkan pin/i)
    const confirmInput = screen.getByLabelText(/konfirmasi pin/i)
    const submitBtn = screen.getByRole('button', { name: /simpan pin/i })

    fireEvent.change(pinInput, { target: { value: '246810' } })
    fireEvent.change(confirmInput, { target: { value: '246810' } })
    fireEvent.click(submitBtn)

    expect(await screen.findByRole('heading', { name: /dashboard orang tua/i })).toBeInTheDocument()
    expect(pinAuth.hasPinVerifier()).toBe(true)
    expect(localStorage.getItem(VERIFIER_KEY)).toBeTruthy()
  })

  it('3. when backend is down/unavailable, an existing local PIN never triggers fresh PIN setup', async () => {
    const verifier = await pinAuth.createPinVerifier('135790')
    pinAuth.savePinVerifier(verifier!)

    // Stub fetch to simulate backend being completely down (network failure)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    render(<ParentDashboard store={fakeStore()} onBack={vi.fn()} />)

    // Must show verify form, NOT setup form
    expect(await screen.findByRole('heading', { name: /masukkan pin orang tua/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /buat pin orang tua/i })).not.toBeInTheDocument()
    expect(screen.queryByText(OPEN_LABEL)).not.toBeInTheDocument()
  })

  it('4. backend downtime never unlocks dashboard access automatically', async () => {
    const verifier = await pinAuth.createPinVerifier('135790')
    pinAuth.savePinVerifier(verifier!)

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    render(<ParentDashboard store={fakeStore()} onBack={vi.fn()} />)

    await screen.findByRole('heading', { name: /masukkan pin orang tua/i })
    // Gate remains firmly locked
    expect(screen.queryByRole('heading', { name: /dashboard orang tua/i })).not.toBeInTheDocument()
    expect(screen.queryByText(OPEN_LABEL)).not.toBeInTheDocument()
  })

  it('5. backend downtime never alters, resets, or overwrites an existing local PIN', async () => {
    const verifier = await pinAuth.createPinVerifier('135790')
    pinAuth.savePinVerifier(verifier!)
    const originalVerifier = localStorage.getItem(VERIFIER_KEY)

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    render(<ParentDashboard store={fakeStore()} onBack={vi.fn()} />)

    await screen.findByRole('heading', { name: /masukkan pin orang tua/i })
    expect(localStorage.getItem(VERIFIER_KEY)).toBe(originalVerifier)
    expect(pinAuth.hasPinVerifier()).toBe(true)
  })

  it('6. local PIN unlocks dashboard even when backend is down or not configured', async () => {
    const verifier = await pinAuth.createPinVerifier('135790')
    pinAuth.savePinVerifier(verifier!)

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    render(<ParentDashboard store={fakeStore()} onBack={vi.fn()} />)

    const pinInput = await screen.findByLabelText(/^PIN$/i)
    fireEvent.change(pinInput, { target: { value: '135790' } })
    fireEvent.click(screen.getByRole('button', { name: /buka dashboard/i }))

    expect(await screen.findByRole('heading', { name: /dashboard orang tua/i })).toBeInTheDocument()
  })

  it('7. wrong PIN entry remains rejected when backend is down', async () => {
    const verifier = await pinAuth.createPinVerifier('135790')
    pinAuth.savePinVerifier(verifier!)

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    render(<ParentDashboard store={fakeStore()} onBack={vi.fn()} />)

    const pinInput = await screen.findByLabelText(/^PIN$/i)
    fireEvent.change(pinInput, { target: { value: '999999' } })
    fireEvent.click(screen.getByRole('button', { name: /buka dashboard/i }))

    expect(await screen.findByText(/pin salah/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /dashboard orang tua/i })).not.toBeInTheDocument()
  })

  it('8. displays open access label and real star balance when backend reward controller is ready', async () => {
    const verifier = await pinAuth.createPinVerifier('135790')
    pinAuth.savePinVerifier(verifier!)
    stubValidParentSession()

    const mockController = {
      getState: vi.fn().mockReturnValue({
        status: 'ready',
        balance: { availableBalance: 42, totalEarned: 50, totalRedeemed: 8 },
        transactions: [],
        config: { rupiahPerStar: 500, minStarsPerRedemption: 1, maxStarsPerRedemption: 100 },
      }),
      load: vi.fn(),
    } as unknown as RewardController

    render(<ParentDashboard store={fakeStore()} controller={mockController} onBack={vi.fn()} />)

    const pinInput = await screen.findByLabelText(/^PIN$/i)
    fireEvent.change(pinInput, { target: { value: '135790' } })
    fireEvent.click(screen.getByRole('button', { name: /buka dashboard/i }))

    expect(await screen.findByRole('heading', { name: /dashboard orang tua/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('parent-access-status').textContent).toMatch(OPEN_LABEL)
    })
    expect(screen.getByTestId('available-balance')).toHaveTextContent('42')
  })

  it('9. displays degraded status and never fabricates balance when reward controller has storage error', async () => {
    const verifier = await pinAuth.createPinVerifier('135790')
    pinAuth.savePinVerifier(verifier!)
    stubValidParentSession()

    const mockController = {
      getState: vi.fn().mockReturnValue({
        status: 'storage-error',
        error: 'Backend unavailable',
      }),
      load: vi.fn().mockResolvedValue({ status: 'storage-error' }),
    } as unknown as RewardController

    render(<ParentDashboard store={fakeStore()} controller={mockController} onBack={vi.fn()} />)

    const pinInput = await screen.findByLabelText(/^PIN$/i)
    fireEvent.change(pinInput, { target: { value: '135790' } })
    fireEvent.click(screen.getByRole('button', { name: /buka dashboard/i }))

    expect(await screen.findByRole('heading', { name: /dashboard orang tua/i })).toBeInTheDocument()
    // Honest degraded status message
    await waitFor(() => {
      expect(screen.getByTestId('parent-access-status').textContent).toMatch(/layanan reward tidak tersedia/i)
      expect(screen.getByText(/penyimpanan reward tidak tersedia\. data tidak diubah\./i)).toBeInTheDocument()
    })
    // Never fabricates balance
    expect(screen.queryByTestId('available-balance')).toBeNull()
    // Does not falsely claim open access
    expect(screen.queryByText(OPEN_LABEL)).not.toBeInTheDocument()
  })

  it('10. indicates unconfigured reward service and never fabricates balance when no controller is provided', async () => {
    const verifier = await pinAuth.createPinVerifier('135790')
    pinAuth.savePinVerifier(verifier!)

    render(<ParentDashboard store={fakeStore()} onBack={vi.fn()} />)

    const pinInput = await screen.findByLabelText(/^PIN$/i)
    fireEvent.change(pinInput, { target: { value: '135790' } })
    fireEvent.click(screen.getByRole('button', { name: /buka dashboard/i }))

    expect(await screen.findByRole('heading', { name: /dashboard orang tua/i })).toBeInTheDocument()
    expect(screen.getByTestId('parent-access-status').textContent).toMatch(/layanan reward tidak dikonfigurasi/i)
    expect(screen.queryByTestId('available-balance')).toBeNull()
    expect(screen.queryByText(OPEN_LABEL)).not.toBeInTheDocument()
  })
})
