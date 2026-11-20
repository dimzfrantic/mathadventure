import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ParentDashboard } from '../src/features/math-drill/ParentDashboard'
import { createPinVerifier, savePinVerifier, clearPinVerifier, resetAttemptState } from '../src/features/math-drill/parentPinAuth'
import { setParentSessionToken } from '../src/features/math-drill/api/sessionApi'
import { createRewardWiring } from '../src/features/math-drill/rewardWiring'
import { computeAvailableBalance } from '../src/features/math-drill/reward/redemption/balanceComputation'
import type { CompletedSessionRecordV1 } from '../src/features/math-drill/persistence/completedSessionTypes'
import type { RewardConfig, RewardTransaction } from '../src/features/math-drill/reward'

/**
 * Stage 7B-A2 — P0-2 integration test.
 *
 * Proves the ParentDashboard actually uses a *connected* reward controller:
 * every read and write below travels UI -> controller -> rewardApi -> fetch,
 * and the rendered balance is the number the backend returned (never a local
 * computation, never a dummy).
 */

function record(instanceId: string, sessionId: string, recordedAt: number, points: readonly (0 | 0.5 | 1)[]): CompletedSessionRecordV1 {
  return {
    historySchemaVersion: 1,
    instanceId,
    sessionId,
    mode: 'regular',
    operationMode: 'mixed',
    completedAt: recordedAt - 1,
    recordedAt,
    provenance: 'new-atomic',
    outcomes: points.map(p => ({ level: 1 as const, operation: 'addition' as const, points: p })),
  }
}

const sessionA = record('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 1_000, [1, 1, 1])
const sessionB = record('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000c2', 2_000, [1, 1, 1, 1])

const config: RewardConfig = {
  configId: 'active',
  version: 1,
  rupiahPerStar: 500,
  minStarsPerRedemption: 1,
  maxStarsPerRedemption: 100,
  updatedAt: 1_000,
}

function pendingTransaction(transactionId: string, starsRedeemed: number): RewardTransaction {
  return {
    transactionId,
    starsRedeemed,
    rupiahValue: starsRedeemed * 500,
    ruleSnapshotVersion: 1,
    ruleSnapshot: { rupiahPerStar: 500 },
    status: 'pending',
    requestedAt: 5_000,
    confirmedAt: null,
    cancelledAt: null,
  } as RewardTransaction
}

type FetchCall = { readonly url: string; readonly method: string; readonly headers: Record<string, string>; readonly body: string | null }

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}


const PARENT_TOKEN = 'test-parent-session'

/** Parent auth endpoints used by the dashboard's own gate (unrelated to A2). */
function parentRoute(url: string, method: string): Response | null {
  if (url.endsWith('/api/parent/status')) {
    return jsonResponse({ hasPin: true, isLockedOut: false, lockoutMessage: null, remainingMs: null })
  }
  if (url.endsWith('/api/parent/session')) {
    return jsonResponse({ valid: true, expiresAt: Date.now() + 3_600_000 })
  }
  if (url.endsWith('/api/parent/verify') && method === 'POST') {
    return jsonResponse({ success: true, sessionToken: PARENT_TOKEN, expiresAt: Date.now() + 3_600_000 })
  }
  return null
}

async function setupTestPin() {
  clearPinVerifier()
  resetAttemptState()
  const verifier = await createPinVerifier('123456')
  savePinVerifier(verifier!)
}

async function unlockTestDashboard() {
  const pinInput = await screen.findByLabelText(/^PIN$/i)
  fireEvent.change(pinInput, { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: /buka dashboard/i }))
  await screen.findByRole('heading', { name: /dashboard orang tua/i })
}

describe('Stage 7B-A2 P0-2 — reward controller wired to the authoritative backend', () => {
  let calls: FetchCall[] = []

  beforeEach(async () => {
    localStorage.clear()
    await setupTestPin()
    calls = []
    setParentSessionToken(PARENT_TOKEN)
  })

  afterEach(() => {
    setParentSessionToken(null)
    vi.unstubAllGlobals()
  })

  it('renders the backend balance and history, and confirms a redemption through the API', async () => {
    const pending = pendingTransaction('tx-wired-1', 1)
    // Server state advances ONLY when the confirmation POST arrives — never
    // because the client happened to read state more than once.
    const server = { confirmed: false, secondSessionRecorded: false }
    const balanceWithPending = computeAvailableBalance([sessionA], [pending], [])
    const balanceAfterServerUpdate = computeAvailableBalance([sessionA, sessionB], [{ ...pending, status: 'confirmed' }], [])

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      calls.push({
        url: String(url),
        method,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? init.body : null,
      })

      const parent = parentRoute(String(url), method)
      if (parent) return parent

      if (String(url).endsWith('/api/reward/state')) {
        const sessions = server.secondSessionRecorded ? [sessionA, sessionB] : [sessionA]
        const transactions = [server.confirmed ? { ...pending, status: 'confirmed' as const } : pending]
        return jsonResponse({
          config,
          configValid: true,
          transactions,
          corrections: [],
          balance: computeAvailableBalance(sessions, transactions, []),
          completedSessionsCount: sessions.length,
        })
      }
      if (String(url).endsWith('/api/reward/completed-sessions')) {
        const sessions = server.secondSessionRecorded ? [sessionA, sessionB] : [sessionA]
        return jsonResponse({ sessions, total: sessions.length, invalidCount: 0 })
      }
      if (String(url).includes('/api/sessions')) {
        // Dashboard history is a device-credentialed read of the sessions the
        // app itself uploads, not a reward-ledger read.
        const sessions = server.secondSessionRecorded ? [sessionA, sessionB] : [sessionA]
        return jsonResponse({ sessions, total: sessions.length, offset: 0, limit: 500 })
      }
      if (String(url).includes('/api/reward/transactions/tx-wired-1/confirm') && method === 'POST') {
        server.confirmed = true
        server.secondSessionRecorded = true
        return jsonResponse({ status: 'success', transaction: { ...pending, status: 'confirmed' } })
      }
      if (String(url).endsWith('/api/reward/transactions')) {
        return jsonResponse({ status: 'success', transaction: pending })
      }
      return jsonResponse({ error: 'not-found' }, 404)
    }))

    const wiring = createRewardWiring()
    render(<ParentDashboard store={wiring.historyStore} controller={wiring.controller} onBack={vi.fn()} />)
    await unlockTestDashboard()

    // Balance comes from the server payload, not from local computation.
    await waitFor(() => {
      expect(screen.getByTestId('available-balance')).toHaveTextContent(String(balanceWithPending.availableBalance))
    })

    // Regression guard: the pre-confirmation balance must NOT already be the
    // post-confirmation value. The previous mock advanced server state on the
    // second read, which made this test unable to distinguish "reloaded after
    // the mutation" from "read twice".
    expect(balanceAfterServerUpdate.availableBalance).not.toBe(balanceWithPending.availableBalance)
    expect(screen.getByTestId('available-balance')).not.toHaveTextContent(String(balanceAfterServerUpdate.availableBalance))

    // Every protected call carried the parent session header.
    const stateCall = calls.find(call => call.url.endsWith('/api/reward/state'))
    expect(stateCall?.headers['X-Parent-Session']).toBe('test-parent-session')

    // History is read from the backend, not from the local IndexedDB store.
    // History comes from the device-credentialed session list, so a parent who
    // unlocked with a local PIN still sees it even without a backend parent
    // session. The reward ledger read above stays parent-authenticated.
    expect(calls.some(call => call.url.includes('/api/sessions'))).toBe(true)
    expect(await screen.findByText(/total sesi selesai/i)).toBeInTheDocument()

    // Confirm the pending redemption: the UI must POST to the backend...
    fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi' }))
    expect(screen.getByRole('heading', { name: /konfirmasi tindakan/i })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Konfirmasi' })[1])

    await waitFor(() => {
      expect(calls.some(call => call.method === 'POST' && call.url.includes('/api/reward/transactions/tx-wired-1/confirm'))).toBe(true)
    })

    // ...and the displayed balance must be the reloaded server value.
    await waitFor(() => {
      expect(screen.getByTestId('available-balance')).toHaveTextContent(String(balanceAfterServerUpdate.availableBalance))
    })
    expect(screen.getByText(/berhasil dikonfirmasi/i)).toBeInTheDocument()

    // The authoritative state really was re-read after the mutation.
    expect(calls.filter(call => call.url.endsWith('/api/reward/state')).length).toBeGreaterThan(1)
  })

  it('shows no balance and no fake success when the backend rejects the read', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      calls.push({ url: String(url), method, headers: {}, body: null })
      const parent = parentRoute(String(url), method)
      if (parent) return parent
      if (String(url).endsWith('/api/reward/state')) return jsonResponse({ error: 'Parent authorization required' }, 401)
      if (String(url).endsWith('/api/reward/completed-sessions')) return jsonResponse({ error: 'Parent authorization required' }, 401)
      return jsonResponse({ error: 'not-found' }, 404)
    }))

    const wiring = createRewardWiring()
    render(<ParentDashboard store={wiring.historyStore} controller={wiring.controller} onBack={vi.fn()} />)
    await unlockTestDashboard()

    await waitFor(() => {
      expect(screen.getByText(/penyimpanan reward tidak tersedia\. data tidak diubah\./i)).toBeInTheDocument()
    })
    expect(screen.queryByTestId('available-balance')).toBeNull()
    expect(screen.getByText(/penyimpanan riwayat tidak tersedia\. data tidak diubah\./i)).toBeInTheDocument()
  })

  it('does not render any balance while the authoritative read is still in flight', async () => {
    let release: (() => void) | null = null
    const gate = new Promise<void>(resolve => { release = resolve })

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      calls.push({ url: String(url), method, headers: {}, body: null })
      const parent = parentRoute(String(url), method)
      if (parent) return parent
      await gate
      if (String(url).endsWith('/api/reward/state')) {
        return jsonResponse({
          config,
          configValid: true,
          transactions: [],
          corrections: [],
          balance: computeAvailableBalance([sessionA], [], []),
          completedSessionsCount: 1,
        })
      }
      return jsonResponse({ sessions: [sessionA], total: 1, invalidCount: 0 })
    }))

    const wiring = createRewardWiring()
    render(<ParentDashboard store={wiring.historyStore} controller={wiring.controller} onBack={vi.fn()} />)
    await unlockTestDashboard()

    expect(screen.queryByTestId('available-balance')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(/memuat/i)

    release!()
    await waitFor(() => {
      expect(screen.getByTestId('available-balance')).toHaveTextContent(String(computeAvailableBalance([sessionA], [], []).availableBalance))
    })
  })
})
