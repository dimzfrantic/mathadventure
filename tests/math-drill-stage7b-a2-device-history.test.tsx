import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ParentDashboard } from '../src/features/math-drill/ParentDashboard'
import { createDeviceHistoryStore } from '../src/features/math-drill/persistence/deviceHistoryStore'
import { createRewardWiring } from '../src/features/math-drill/rewardWiring'
import * as pinAuth from '../src/features/math-drill/parentPinAuth'
import { clearParentSessionToken, getSessions } from '../src/features/math-drill/api/sessionApi'

/**
 * Stage 7B-A2 — Dashboard history via the device-credentialed session list.
 *
 * Owner decision: the parent PIN is a local device gate and must NEVER be sent
 * to the backend as authentication. History therefore reads `GET /api/sessions`
 * (the same sessions this app uploads with its device credential), while the
 * reward **balance** stays behind the backend parent session.
 *
 * These tests lock the behaviour that was broken in the field: a parent who
 * unlocked with a local PIN saw "Penyimpanan riwayat tidak tersedia" even
 * though the session was stored on the backend.
 */

interface RecordedCall {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}

let calls: RecordedCall[] = []

function apiSession(instanceId: string, recordedAt: number) {
  return {
    instanceId,
    sessionId: `s-${instanceId}`,
    mode: 'regular' as const,
    historySchemaVersion: 1 as const,
    operationMode: 'addition',
    recordedAt,
    endedAt: recordedAt,
    outcomes: [{ level: 1, operation: 'addition', points: 1 as const }],
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

/** Stub the network: sessions come from the device route, reward from parent auth. */
function stubBackend(options: { sessions?: ReturnType<typeof apiSession>[]; sessionsStatus?: number } = {}) {
  const sessions = options.sessions ?? [apiSession('inst-new', 2_000), apiSession('inst-old', 1_000)]
  const status = options.sessionsStatus ?? 200

  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : null,
    })

    if (String(url).includes('/api/sessions')) {
      if (status !== 200) return jsonResponse({ error: 'unavailable' }, status)
      return jsonResponse({ sessions, total: sessions.length, offset: 0, limit: 500 })
    }
    // Reward ledger stays parent-authenticated; no parent session is established
    // in these tests because the local PIN is never transmitted.
    if (String(url).includes('/api/reward/')) return jsonResponse({ error: 'Parent authorization required' }, 401)
    return jsonResponse({ error: 'not-found' }, 404)
  }))
}

async function setupLocalPin(pin = '135790') {
  const verifier = await pinAuth.createPinVerifier(pin)
  pinAuth.savePinVerifier(verifier!)
}

/** Number of rendered history rows (the dashboard history is an <ol>). */
function historyRows(): number {
  return document.querySelectorAll('.parent-dashboard-history > li').length
}

async function unlock() {
  const input = await screen.findByLabelText(/^PIN$/i)
  fireEvent.change(input, { target: { value: '135790' } })
  fireEvent.click(screen.getByRole('button', { name: /buka dashboard/i }))
  await screen.findByRole('heading', { name: /dashboard orang tua/i })
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
  vi.restoreAllMocks()
})

describe('device-credentialed dashboard history', () => {
  it('1. maps GET /api/sessions into dashboard history records, newest first', async () => {
    stubBackend()
    const store = createDeviceHistoryStore()

    const result = await store.list({ limit: 500 })
    expect(result.status).toBe('success')
    if (result.status !== 'success') return

    expect(result.records.map(r => r.instanceId)).toEqual(['inst-new', 'inst-old'])
    expect(result.invalidCount).toBe(0)
  })

  it('2. reports an honest unavailable state instead of an empty history when the read fails', async () => {
    stubBackend({ sessionsStatus: 500 })
    const store = createDeviceHistoryStore()

    const result = await store.list({ limit: 500 })
    expect(result).toEqual({ status: 'storage-error', code: 'unavailable' })
  })

  it('3. renders the stored session in the dashboard and still shows it after a reload', async () => {
    stubBackend()
    await setupLocalPin()

    const wiring = createRewardWiring()
    const first = render(<ParentDashboard store={wiring.historyStore} controller={wiring.controller} onBack={vi.fn()} />)
    await unlock()

    expect(await screen.findByText(/riwayat sesi/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(historyRows()).toBe(2)
    })
    expect(screen.queryByText(/penyimpanan riwayat tidak tersedia/i)).not.toBeInTheDocument()

    // Reload: the history is re-read from the backend, not from component state.
    first.unmount()
    const second = createRewardWiring()
    render(<ParentDashboard store={second.historyStore} controller={second.controller} onBack={vi.fn()} />)
    await unlock()

    await waitFor(() => {
      expect(historyRows()).toBe(2)
    })
  })

  it('4. never sends the local parent PIN to the backend (no verify, no setup, no PIN in any body)', async () => {
    stubBackend()
    await setupLocalPin()

    const wiring = createRewardWiring()
    render(<ParentDashboard store={wiring.historyStore} controller={wiring.controller} onBack={vi.fn()} />)
    await unlock()

    await waitFor(() => {
      expect(historyRows()).toBe(2)
    })

    expect(calls.some(call => call.url.includes('/api/parent/verify'))).toBe(false)
    expect(calls.some(call => call.url.includes('/api/parent/setup'))).toBe(false)
    expect(calls.some(call => (call.body ?? '').includes('135790'))).toBe(false)
  })

  it('5. a backend authorization failure cannot consume the local PIN attempt budget', async () => {
    // Reward reads answer 401 in this stub, i.e. backend authorization fails.
    stubBackend()
    await setupLocalPin()

    const wiring = createRewardWiring()
    render(<ParentDashboard store={wiring.historyStore} controller={wiring.controller} onBack={vi.fn()} />)
    await unlock()

    await waitFor(() => {
      expect(historyRows()).toBe(2)
    })

    // Successful local unlock resets the counter, and nothing else touched it.
    expect(pinAuth.getAttemptState().failedAttempts).toBe(0)
    expect(pinAuth.isLockedOut().locked).toBe(false)
  })

  it('6. session reads hit /api/sessions once, not the double-prefixed /api/api/sessions', async () => {
    stubBackend()
    await getSessions({ limit: 5 })

    const urls = calls.map(call => call.url)
    expect(urls.some(url => url === '/api/sessions?limit=5')).toBe(true)
    expect(urls.some(url => url.includes('/api/api/'))).toBe(false)
  })
})
