import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ParentDashboard } from '../src/features/math-drill/ParentDashboard'
import type { RewardController } from '../src/features/math-drill/reward'
import * as pinAuth from '../src/features/math-drill/parentPinAuth'
import {
  setParentSessionToken,
  clearParentSessionToken,
  getParentSessionToken,
} from '../src/features/math-drill/api/sessionApi'
import type { UnifiedIndexedDbSessionStore } from '../src/features/math-drill/persistence/completedSessionHistoryStore'

/**
 * Stage 7B-A2 Alternatif B — Backend reward authentication flow.
 *
 * Verifies that the local device PIN and the backend reward PIN are separate:
 *  - Local PIN opens the dashboard UI (never sent to backend).
 *  - Backend PIN opens the reward ledger (sent only to POST /api/parent/verify).
 *  - The backend session token is persisted to localStorage and restored on reload.
 *  - Lock/expire/failure paths never mutate the ledger or burn local PIN attempts.
 */

const LOCAL_PIN = '135790'
const BACKEND_PIN = '246810'
const PARENT_TOKEN = 'test-parent-session-token-abc'

interface RecordedCall { url: string; method: string; body: string | null }

let calls: RecordedCall[] = []

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

function mockController(balance = 42): RewardController {
  return {
    getState: vi.fn().mockReturnValue({
      status: 'ready',
      balance: { availableBalance: balance, totalEarned: 50, totalRedeemed: 8, isLedgerConsistent: true },
      transactions: [],
      corrections: [],
      config: { configId: 'active', version: 1, updatedAt: 0, rupiahPerStar: 500, minStarsPerRedemption: 1, maxStarsPerRedemption: 100 },
    }),
    load: vi.fn().mockResolvedValue({
      status: 'ready',
      balance: { availableBalance: balance, totalEarned: 50, totalRedeemed: 8, isLedgerConsistent: true },
      transactions: [],
      corrections: [],
      config: { configId: 'active', version: 1, updatedAt: 0, rupiahPerStar: 500, minStarsPerRedemption: 1, maxStarsPerRedemption: 100 },
    }),
    submitRedemption: vi.fn(),
    confirmRedemption: vi.fn(),
    cancelRedemption: vi.fn(),
    saveConfig: vi.fn(),
    saveCorrection: vi.fn(),
  } as unknown as RewardController
}

function fakeStore() {
  return { list: vi.fn(async () => ({ status: 'success' as const, records: [], invalidCount: 0 })) } as unknown as UnifiedIndexedDbSessionStore
}

function stubBackend(options: {
  sessionValid?: boolean
  verifyResult?: 'success' | 'wrong-pin' | 'locked-out'
} = {}) {
  const sessionValid = options.sessionValid ?? true
  const verifyResult = options.verifyResult ?? 'success'

  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? init.body : null
    calls.push({ url: u, method, body })

    if (u.endsWith('/api/parent/status')) {
      return jsonResponse({ hasPin: true, isLockedOut: false, lockoutMessage: null, remainingMs: null })
    }
    if (u.endsWith('/api/parent/session')) {
      return jsonResponse({ valid: sessionValid, expiresAt: Date.now() + 3_600_000 }, sessionValid ? 200 : 401)
    }
    if (u.endsWith('/api/parent/verify') && method === 'POST') {
      if (verifyResult === 'success') {
        return jsonResponse({ success: true, sessionToken: PARENT_TOKEN, expiresAt: Date.now() + 900_000 })
      }
      if (verifyResult === 'locked-out') {
        return jsonResponse({ error: 'Terlalu banyak percobaan', isLockedOut: true, remainingMs: 30_000 }, 429)
      }
      return jsonResponse({ error: 'PIN salah', failedAttempts: 1 }, 401)
    }
    if (u.endsWith('/api/parent/lock') && method === 'POST') {
      return jsonResponse({ success: true })
    }
    if (u.includes('/api/sessions')) {
      return jsonResponse({ sessions: [], total: 0, offset: 0, limit: 500 })
    }
    return jsonResponse({ error: 'not-found' }, 404)
  }))
}

async function setupLocalPin() {
  const verifier = await pinAuth.createPinVerifier(LOCAL_PIN)
  pinAuth.savePinVerifier(verifier!)
}

async function unlock() {
  const input = await screen.findByLabelText(/^PIN$/i)
  fireEvent.change(input, { target: { value: LOCAL_PIN } })
  fireEvent.click(screen.getByRole('button', { name: /buka dashboard/i }))
  await screen.findByRole('heading', { name: /dashboard orang tua/i })
}

function enterBackendPin(pin: string) {
  const input = screen.getByLabelText('PIN Reward')
  fireEvent.change(input, { target: { value: pin } })
  fireEvent.click(screen.getByRole('button', { name: /buka reward/i }))
}

beforeEach(() => {
  localStorage.clear()
  pinAuth.clearPinVerifier()
  pinAuth.resetAttemptState()
  clearParentSessionToken()
  calls = []
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  clearParentSessionToken()
})

describe('Stage 7B-A2 Alternatif B — backend reward authentication', () => {
  it('1. local PIN unlock does not automatically authenticate to the backend', async () => {
    stubBackend()
    await setupLocalPin()

    render(<ParentDashboard store={fakeStore()} controller={mockController()} onBack={vi.fn()} />)
    await unlock()

    await waitFor(() => {
      expect(screen.getByTestId('parent-access-status').textContent).toMatch(/masukkan PIN reward/i)
    })
    expect(calls.some(c => c.url.includes('/api/parent/verify'))).toBe(false)
    expect(calls.some(c => c.url.includes('/api/parent/setup'))).toBe(false)
  })

  it('2. correct backend PIN creates a session and shows the reward balance', async () => {
    stubBackend({ verifyResult: 'success' })
    await setupLocalPin()

    render(<ParentDashboard store={fakeStore()} controller={mockController(42)} onBack={vi.fn()} />)
    await unlock()

    await waitFor(() => expect(screen.getByLabelText('PIN Reward')).toBeInTheDocument())
    enterBackendPin(BACKEND_PIN)

    await waitFor(() => {
      expect(screen.getByTestId('parent-access-status').textContent).toMatch(/akses orang tua terbuka/i)
    })
    expect(screen.getByTestId('available-balance')).toHaveTextContent('42')
    expect(localStorage.getItem('math-adventure-parent-session-token')).toBe(PARENT_TOKEN)
  })

  it('3. local PIN is never sent to the backend in any request body', async () => {
    stubBackend({ verifyResult: 'success' })
    await setupLocalPin()

    render(<ParentDashboard store={fakeStore()} controller={mockController()} onBack={vi.fn()} />)
    await unlock()

    enterBackendPin(BACKEND_PIN)
    await waitFor(() => expect(screen.getByTestId('available-balance')).toBeInTheDocument())

    expect(calls.some(c => (c.body ?? '').includes(LOCAL_PIN))).toBe(false)
    const verifyCall = calls.find(c => c.url.includes('/api/parent/verify'))
    expect(verifyCall).toBeTruthy()
    expect(verifyCall!.body).toContain(BACKEND_PIN)
  })

  it('4. a valid persisted token is restored after reload and validated before use', async () => {
    stubBackend({ sessionValid: true })
    await setupLocalPin()

    const first = render(<ParentDashboard store={fakeStore()} controller={mockController(42)} onBack={vi.fn()} />)
    await unlock()
    enterBackendPin(BACKEND_PIN)
    await waitFor(() => expect(screen.getByTestId('available-balance')).toBeInTheDocument())

    first.unmount()
    // Simulate a page reload: in-memory token is gone, but localStorage retains it.
    clearParentSessionToken()
    localStorage.setItem('math-adventure-parent-session-token', PARENT_TOKEN)
    expect(getParentSessionToken()).toBeNull()
    expect(localStorage.getItem('math-adventure-parent-session-token')).toBe(PARENT_TOKEN)

    calls = []
    render(<ParentDashboard store={fakeStore()} controller={mockController(42)} onBack={vi.fn()} />)
    await unlock()

    await waitFor(() => {
      expect(screen.getByTestId('parent-access-status').textContent).toMatch(/akses orang tua terbuka/i)
    })
    expect(screen.getByTestId('available-balance')).toHaveTextContent('42')
    expect(calls.some(c => c.url.includes('/api/parent/session'))).toBe(true)
    expect(calls.some(c => c.url.includes('/api/parent/verify'))).toBe(false)
  })

  it('5. an expired or rejected token is cleared and reward is unavailable', async () => {
    stubBackend({ sessionValid: false })
    await setupLocalPin()

    setParentSessionToken(PARENT_TOKEN)

    render(<ParentDashboard store={fakeStore()} controller={mockController(42)} onBack={vi.fn()} />)
    await unlock()

    await waitFor(() => {
      expect(screen.getByTestId('parent-access-status').textContent).toMatch(/masukkan PIN reward/i)
    })
    expect(localStorage.getItem('math-adventure-parent-session-token')).toBeNull()
    expect(screen.queryByTestId('available-balance')).toBeNull()
  })

  it('6. backend failure does not mutate the reward ledger or balance', async () => {
    stubBackend({ verifyResult: 'wrong-pin' })
    await setupLocalPin()

    render(<ParentDashboard store={fakeStore()} controller={mockController(42)} onBack={vi.fn()} />)
    await unlock()

    enterBackendPin('000000')

    await waitFor(() => {
      expect(screen.getByTestId('parent-access-status').textContent).toMatch(/masukkan PIN reward/i)
    })
    expect(screen.queryByTestId('available-balance')).toBeNull()
    expect(calls.some(c => c.url.includes('/api/reward/transactions'))).toBe(false)
    expect(calls.some(c => c.url.includes('/api/reward/config'))).toBe(false)
    expect(calls.some(c => c.url.includes('/api/reward/corrections'))).toBe(false)
  })

  it('7. lock button clears the local token and revokes the backend session', async () => {
    stubBackend({ verifyResult: 'success' })
    await setupLocalPin()

    render(<ParentDashboard store={fakeStore()} controller={mockController(42)} onBack={vi.fn()} />)
    await unlock()
    enterBackendPin(BACKEND_PIN)
    await waitFor(() => expect(screen.getByTestId('available-balance')).toBeInTheDocument())

    calls = []
    fireEvent.click(screen.getByRole('button', { name: /kunci dashboard/i }))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /dashboard orang tua/i })).not.toBeInTheDocument()
    })
    expect(calls.some(c => c.url.includes('/api/parent/lock'))).toBe(true)
    expect(localStorage.getItem('math-adventure-parent-session-token')).toBeNull()
    expect(getParentSessionToken()).toBeNull()
  })

  it('8. backend PIN lockout does not affect the local PIN attempt counter', async () => {
    stubBackend({ verifyResult: 'locked-out' })
    await setupLocalPin()

    render(<ParentDashboard store={fakeStore()} controller={mockController(42)} onBack={vi.fn()} />)
    await unlock()

    enterBackendPin('000000')

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    expect(pinAuth.getAttemptState().failedAttempts).toBe(0)
    expect(pinAuth.isLockedOut().locked).toBe(false)
    expect(screen.getByRole('heading', { name: /dashboard orang tua/i })).toBeInTheDocument()
  })
})
