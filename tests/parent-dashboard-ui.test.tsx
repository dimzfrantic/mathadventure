import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ParentDashboard } from '../src/features/math-drill/ParentDashboard'
import { createPinVerifier, savePinVerifier, clearPinVerifier, resetAttemptState } from '../src/features/math-drill/parentPinAuth'
import type { CompletedSessionRecord, CompletedSessionRecordV1, CompletedSessionRecordV2 } from '../src/features/math-drill/persistence/completedSessionTypes'
import type { UnifiedIndexedDbSessionStore } from '../src/features/math-drill/persistence/completedSessionHistoryStore'
import type { RewardController, RewardTransaction, RewardConfig } from '../src/features/math-drill/reward'
import { setParentSessionToken, clearParentSessionToken } from '../src/features/math-drill/api/sessionApi'

function record(instanceId: string, mode: 'regular' | 'challenge', recordedAt: number, points: readonly (0 | 0.5 | 1)[], completedAt: number | null = recordedAt - 1): CompletedSessionRecordV1 {
  const outcomes = points.map(p => ({ level: 1 as const, operation: 'addition' as const, points: p }))
  return { historySchemaVersion: 1, instanceId, sessionId: `session-${instanceId}`, mode, operationMode: 'addition', completedAt, recordedAt, provenance: completedAt === null ? 'legacy-last-result' : 'new-atomic', outcomes }
}

function fakeStore(pages: readonly (readonly CompletedSessionRecord[])[], invalidCount = 0) {
  let pageIndex = 0
  const list = vi.fn(async () => {
    const index = pageIndex++
    return {
      status: 'success' as const,
      records: pages[index] ?? [],
      invalidCount,
      ...(index < pages.length - 1 ? { nextCursor: { recordedAt: index + 1, instanceId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` } } : {}),
    }
  })
  const store = { list } as unknown as UnifiedIndexedDbSessionStore
  return { store, list }
}

const regular = record('00000000-0000-4000-8000-000000000001', 'regular', 200, [1, 0.5, 0])
const challenge = record('00000000-0000-4000-8000-000000000002', 'challenge', 300, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1])

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

afterEach(() => { vi.unstubAllGlobals() })

describe('Parent Dashboard UI & Functional Integration Tests', () => {
  beforeEach(async () => {
    localStorage.clear()
    clearParentSessionToken()
    await setupTestPin()
  })

  it('renders empty history correctly when authenticated', async () => {
    const { store } = fakeStore([[]])
    render(<ParentDashboard store={store} onBack={vi.fn()} />)
    await unlockTestDashboard()

    expect(await screen.findByText(/belum ada riwayat latihan/i)).toBeInTheDocument()
    expect(store.list).toHaveBeenCalledWith({ limit: 500 })
  })

  it('renders session summary, separate Regular/Challenge averages, and history list', async () => {
    const a = record('00000000-0000-4000-8000-000000000004', 'regular', 400, [1], 500)
    const b = record('00000000-0000-4000-8000-000000000005', 'challenge', 500, [0, 1, 1, 1, 1, 1, 1, 1, 1, 1], 500)
    const { store } = fakeStore([[a, b, regular, challenge]])

    render(<ParentDashboard store={store} onBack={vi.fn()} />)
    await unlockTestDashboard()

    expect(await screen.findByText(/total sesi selesai/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Ringkasan hasil')).toHaveTextContent('4')
    expect(screen.getByLabelText('Ringkasan hasil')).toHaveTextContent('Regular:')
    expect(screen.getByLabelText('Ringkasan hasil')).toHaveTextContent('Tantangan:')
  })

  it('renders mixed V1/V2 records with timeout reason', async () => {
    const v2Timeout: CompletedSessionRecordV2 = {
      historySchemaVersion: 2,
      instanceId: '00000000-0000-4000-8000-000000000006',
      sessionId: 'session-v2-1',
      mode: 'regular',
      operationMode: 'addition',
      endReason: 'timeout',
      plannedCount: 10,
      completedCount: 5,
      startedAt: 100,
      durationMs: 60000,
      deadlineAt: 60100,
      endedAt: 60100,
      remainingMs: 0,
      recordedAt: 60101,
      outcomes: [{ level: 1, operation: 'addition', points: 1 }],
    }
    const { store } = fakeStore([[v2Timeout, regular]])

    render(<ParentDashboard store={store} onBack={vi.fn()} />)
    await unlockTestDashboard()

    expect(await screen.findByText('Waktu Habis')).toBeInTheDocument()
    expect(screen.getByText('5/10 soal selesai')).toBeInTheDocument()
  })

  it('supports returning to exercise via back button', async () => {
    const onBack = vi.fn()
    const { store } = fakeStore([[regular]])

    render(<ParentDashboard store={store} onBack={onBack} />)
    await unlockTestDashboard()

    const backBtn = screen.getByRole('button', { name: /kembali ke latihan/i })
    fireEvent.click(backBtn)

    expect(onBack).toHaveBeenCalledOnce()
  })

  it('integrates with RewardController to display balance and transactions', async () => {
    const tx: RewardTransaction = {
      transactionId: 'tx-parent-1',
      starsRedeemed: 25,
      rupiahValue: 25000,
      rupiahPerStarSnapshot: 1000,
      status: 'pending',
      requestedAt: Date.now(),
      confirmedAt: null,
      cancelledAt: null,
    }
    const config: RewardConfig = {
      rupiahPerStar: 1000,
      minStarsPerRedemption: 10,
      maxStarsPerRedemption: 100,
    }

    const mockController = {
      getState: vi.fn().mockReturnValue({
        status: 'ready',
        balance: { availableBalance: 150, totalEarned: 200, totalRedeemed: 50 },
        transactions: [tx],
        config,
      }),
      load: vi.fn(),
      confirmRedemption: vi.fn().mockResolvedValue({ status: 'success' }),
      cancelRedemption: vi.fn().mockResolvedValue({ status: 'success' }),
    } as unknown as RewardController

    const { store } = fakeStore([])
    setParentSessionToken('test-session-token')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/parent/session')) {
        return new Response(JSON.stringify({ valid: true, expiresAt: Date.now() + 3_600_000 }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: 'not-found' }), { status: 404 })
    }))
    render(<ParentDashboard store={store} onBack={vi.fn()} controller={mockController} />)
    await unlockTestDashboard()

    // Balance display
    expect(await screen.findByTestId('available-balance')).toHaveTextContent('150')
    expect(screen.getByText(/ID: tx-parent-1/i)).toBeInTheDocument()
    expect(screen.getByText(/25 \(Rp 25\.000\)/i)).toBeInTheDocument()

    // Confirm button opens confirmation modal
    const confirmBtn = screen.getByRole('button', { name: 'Konfirmasi' })
    fireEvent.click(confirmBtn)

    expect(screen.getByRole('heading', { name: /konfirmasi tindakan/i })).toBeInTheDocument()

    // Execute confirmation inside modal
    const modalConfirmBtn = screen.getAllByRole('button', { name: 'Konfirmasi' })[1]
    fireEvent.click(modalConfirmBtn)

    await waitFor(() => {
      expect(mockController.confirmRedemption).toHaveBeenCalledWith('tx-parent-1')
    })
  })
})
