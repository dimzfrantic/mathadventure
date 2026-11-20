import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ParentDashboard } from '../src/features/math-drill/ParentDashboard'
import { createPinVerifier, savePinVerifier, clearPinVerifier, resetAttemptState } from '../src/features/math-drill/parentPinAuth'
import { setParentSessionToken, clearParentSessionToken } from '../src/features/math-drill/api/sessionApi'
import type { RewardController, RewardConfig, RewardTransaction, RewardCorrection } from '../src/features/math-drill/reward'
import type { UnifiedIndexedDbSessionStore } from '../src/features/math-drill/persistence/completedSessionHistoryStore'

function fakeStore(): UnifiedIndexedDbSessionStore {
  return {
    list: vi.fn().mockResolvedValue({ status: 'success' as const, records: [], invalidCount: 0 }),
  } as unknown as UnifiedIndexedDbSessionStore
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

function mockController(overrides: {
  transactions?: readonly RewardTransaction[]
  corrections?: readonly RewardCorrection[]
  config?: RewardConfig
  balance?: number
} = {}): RewardController {
  const config: RewardConfig = overrides.config ?? {
    configId: 'active',
    version: 1,
    rupiahPerStar: 500,
    minStarsPerRedemption: 1,
    maxStarsPerRedemption: 100,
    updatedAt: 1_000,
  }
  const transactions = overrides.transactions ?? []
  const corrections = overrides.corrections ?? []
  return {
    getState: vi.fn().mockReturnValue({
      status: 'ready',
      config,
      transactions,
      corrections,
      balance: { availableBalance: overrides.balance ?? 10, isLedgerConsistent: true },
    }),
    load: vi.fn().mockResolvedValue({ status: 'ready', config, transactions, corrections, balance: { availableBalance: overrides.balance ?? 10, isLedgerConsistent: true } }),
    confirmRedemption: vi.fn(),
    cancelRedemption: vi.fn(),
    updateConfig: vi.fn().mockResolvedValue({ status: 'success', config: { ...config, version: config.version + 1 } }),
    applyCorrection: vi.fn().mockResolvedValue({ status: 'success', correction: corrections[0] }),
  } as unknown as RewardController
}

const confirmedTx: RewardTransaction = {
  transactionId: 'tx-confirmed-1',
  starsRedeemed: 2,
  rupiahValue: 1000,
  status: 'confirmed',
  requestedAt: 1000,
  confirmedAt: 2000,
  cancelledAt: null,
} as RewardTransaction

describe('Parent Dashboard Reward Management', () => {
  beforeEach(async () => {
    localStorage.clear()
    clearParentSessionToken()
    await setupTestPin()
    setParentSessionToken('test-session-token')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/parent/session')) {
        return new Response(JSON.stringify({ valid: true, expiresAt: Date.now() + 3_600_000 }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: 'not-found' }), { status: 404 })
    }))
    window.confirm = vi.fn(() => true)
  })

  afterEach(() => {
    setParentSessionToken(null)
    vi.unstubAllGlobals()
  })

  it('updates reward config through the controller after confirmation', async () => {
    const controller = mockController()
    render(<ParentDashboard store={fakeStore()} onBack={vi.fn()} controller={controller} />)
    await unlockTestDashboard()

    expect(await screen.findByText(/nilai tukar saat ini: rp 500 per bintang/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /ubah pengaturan/i }))

    const rupiahInput = screen.getByLabelText(/rp per bintang/i)
    fireEvent.change(rupiahInput, { target: { value: '750' } })

    fireEvent.click(screen.getByRole('button', { name: /simpan pengaturan/i }))

    await waitFor(() => {
      expect(controller.updateConfig).toHaveBeenCalledWith({ rupiahPerStar: 750, minStarsPerRedemption: 1, maxStarsPerRedemption: 100 })
    })
    expect(screen.getByText(/pengaturan reward berhasil disimpan/i)).toBeInTheDocument()
  })

  it('applies a positive balance correction and shows it in reward history', async () => {
    const appliedCorrection: RewardCorrection = {
      correctionId: 'corr-test-1',
      originalTransactionId: confirmedTx.transactionId,
      starsDelta: 3,
      reason: 'Koreksi manual test',
      createdAt: 3000,
    }
    const controller = mockController({ transactions: [confirmedTx], balance: 5 })
    controller.applyCorrection = vi.fn().mockResolvedValue({ status: 'success', correction: appliedCorrection })
    controller.getState = vi.fn().mockReturnValue({
      status: 'ready',
      config: { configId: 'active', version: 1, rupiahPerStar: 500, minStarsPerRedemption: 1, maxStarsPerRedemption: 100, updatedAt: 1_000 },
      transactions: [confirmedTx],
      corrections: [appliedCorrection],
      balance: { availableBalance: 8, isLedgerConsistent: true },
    })

    render(<ParentDashboard store={fakeStore()} onBack={vi.fn()} controller={controller} />)
    await unlockTestDashboard()

    const select = await screen.findByLabelText(/transaksi asal/i)
    fireEvent.change(select, { target: { value: confirmedTx.transactionId } })

    fireEvent.change(screen.getByPlaceholderText(/contoh: -2 atau \+3/i), { target: { value: '3' } })
    fireEvent.change(screen.getByPlaceholderText(/jelaskan alasan koreksi/i), { target: { value: 'Koreksi manual test' } })

    fireEvent.click(screen.getByRole('button', { name: /terapkan koreksi/i }))

    await waitFor(() => {
      expect(controller.applyCorrection).toHaveBeenCalledWith(expect.objectContaining({
        originalTransactionId: confirmedTx.transactionId,
        starsDelta: 3,
        reason: 'Koreksi manual test',
      }))
    })
    expect(screen.getByText(/koreksi berhasil diterapkan: \+3 bintang/i)).toBeInTheDocument()
    expect(screen.getByText(/koreksi saldo – corr-test-1/i)).toBeInTheDocument()
  })

  it('shows validation error when correction form is incomplete', async () => {
    const controller = mockController({ transactions: [confirmedTx], balance: 5 })
    render(<ParentDashboard store={fakeStore()} onBack={vi.fn()} controller={controller} />)
    await unlockTestDashboard()

    await screen.findByLabelText(/transaksi asal/i)
    fireEvent.click(screen.getByRole('button', { name: /terapkan koreksi/i }))

    expect(screen.getByText(/pilih transaksi asal untuk koreksi/i)).toBeInTheDocument()
    expect(controller.applyCorrection).not.toHaveBeenCalled()
  })

  it('does not show confirm/cancel buttons for confirmed transactions', async () => {
    const controller = mockController({ transactions: [confirmedTx], balance: 5 })
    render(<ParentDashboard store={fakeStore()} onBack={vi.fn()} controller={controller} />)
    await unlockTestDashboard()

    await screen.findByText(/ID: tx-confirmed-1/i)
    expect(screen.queryByRole('button', { name: 'Konfirmasi' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Batalkan' })).not.toBeInTheDocument()
  })

  it('cancels a pending redemption after confirmation', async () => {
    const pendingTx: RewardTransaction = {
      transactionId: 'tx-pending-1',
      starsRedeemed: 2,
      rupiahValue: 1000,
      status: 'pending',
      requestedAt: 1000,
      confirmedAt: null,
      cancelledAt: null,
    } as RewardTransaction
    const controller = mockController({ transactions: [pendingTx], balance: 10 })
    controller.cancelRedemption = vi.fn().mockResolvedValue({ status: 'success' })
    render(<ParentDashboard store={fakeStore()} onBack={vi.fn()} controller={controller} />)
    await unlockTestDashboard()

    await screen.findByText(/ID: tx-pending-1/i)
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan' }))
    const modalConfirmBtn = screen.getAllByRole('button', { name: 'Batalkan' })[1]
    fireEvent.click(modalConfirmBtn)

    await waitFor(() => {
      expect(controller.cancelRedemption).toHaveBeenCalledWith('tx-pending-1')
    })
  })
})
