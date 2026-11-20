import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { ParentDashboard } from '../src/features/math-drill/ParentDashboard'
import * as pinAuth from '../src/features/math-drill/parentPinAuth'
import { clearParentSessionToken } from '../src/features/math-drill/api/sessionApi'
import type { CompletedSessionRecord } from '../src/features/math-drill/persistence/completedSessionTypes'
import type { UnifiedIndexedDbSessionStore } from '../src/features/math-drill/persistence/completedSessionHistoryStore'
import type { RewardTransaction } from '../src/features/math-drill/reward'

function fakeStore(records: readonly CompletedSessionRecord[] = []) {
  const list = vi.fn(async () => ({
    status: 'success' as const,
    records,
    invalidCount: 0,
  }))
  const store = { list } as unknown as UnifiedIndexedDbSessionStore
  return { store, list }
}

describe('Phase 7B Parent Dashboard Security & Authentication Tests', () => {
  beforeEach(() => {
    localStorage.clear()
    clearParentSessionToken()
    pinAuth.clearPinVerifier()
    pinAuth.resetAttemptState()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // 1. Setup PIN pertama kali
  it('1. prompts for 6-digit PIN setup on first open when verifier is not configured', async () => {
    const { store } = fakeStore([])
    render(<ParentDashboard store={store} onBack={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: /buat pin orang tua/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/masukkan pin/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/konfirmasi pin/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /simpan pin/i })).toBeInTheDocument()
    expect(pinAuth.hasPinVerifier()).toBe(false)
  })

  // 2. Konfirmasi PIN yang berbeda
  it('2. rejects PIN setup if confirmation does not match or format is invalid', async () => {
    const { store } = fakeStore([])
    render(<ParentDashboard store={store} onBack={vi.fn()} />)

    const pinInput = await screen.findByLabelText(/masukkan pin/i)
    const confirmInput = screen.getByLabelText(/konfirmasi pin/i)
    const submitBtn = screen.getByRole('button', { name: /simpan pin/i })

    // Non-matching PINs
    fireEvent.change(pinInput, { target: { value: '123456' } })
    fireEvent.change(confirmInput, { target: { value: '654321' } })
    fireEvent.click(submitBtn)

    expect(await screen.findByText(/konfirmasi pin tidak cocok/i)).toBeInTheDocument()
    expect(pinAuth.hasPinVerifier()).toBe(false)

    // Invalid length (less than 6 digits)
    fireEvent.change(pinInput, { target: { value: '123' } })
    fireEvent.change(confirmInput, { target: { value: '123' } })
    fireEvent.click(submitBtn)
    expect(await screen.findByText(/pin harus tepat 6 digit/i)).toBeInTheDocument()
    expect(pinAuth.hasPinVerifier()).toBe(false)
  })

  // Setup PIN berhasil
  it('completes setup with valid matching 6-digit PIN and immediately opens dashboard', async () => {
    const { store } = fakeStore([])
    render(<ParentDashboard store={store} onBack={vi.fn()} />)

    const pinInput = await screen.findByLabelText(/masukkan pin/i)
    const confirmInput = screen.getByLabelText(/konfirmasi pin/i)
    const submitBtn = screen.getByRole('button', { name: /simpan pin/i })

    fireEvent.change(pinInput, { target: { value: '246810' } })
    fireEvent.change(confirmInput, { target: { value: '246810' } })
    fireEvent.click(submitBtn)

    // Verifier is now persisted
    await waitFor(() => expect(pinAuth.hasPinVerifier()).toBe(true))
    // Dashboard should now be unlocked
    expect(await screen.findByRole('heading', { name: /dashboard orang tua/i })).toBeInTheDocument()
  })

  // 3. Verifikasi PIN benar dan salah
  it('3. rejects wrong PIN, preserves lock, and unlocks only upon correct PIN entry', async () => {
    // Setup initial PIN verifier
    const verifier = await pinAuth.createPinVerifier('135790')
    pinAuth.savePinVerifier(verifier!)

    const { store } = fakeStore([])
    render(<ParentDashboard store={store} onBack={vi.fn()} />)

    // Should display verification screen
    expect(await screen.findByRole('heading', { name: /masukkan pin orang tua/i })).toBeInTheDocument()
    const pinInput = screen.getByLabelText(/^PIN$/i)
    const submitBtn = screen.getByRole('button', { name: /buka dashboard/i })

    // Wrong PIN
    fireEvent.change(pinInput, { target: { value: '999999' } })
    fireEvent.click(submitBtn)

    expect(await screen.findByText(/pin salah/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /dashboard orang tua/i })).not.toBeInTheDocument()

    // Correct PIN
    fireEvent.change(pinInput, { target: { value: '135790' } })
    fireEvent.click(submitBtn)

    expect(await screen.findByRole('heading', { name: /dashboard orang tua/i })).toBeInTheDocument()
    // Finding A: when rendered without a reward controller/backend, the dashboard
    // does not falsely claim that parent access to rewards is open.
    expect(screen.getByTestId('parent-access-status').textContent).toMatch(/layanan reward tidak dikonfigurasi/i)
  })

  // 4. PIN tidak tersedia atau rusak di storage
  it('4. fails safely (closed) when verifier in storage is corrupted or unparseable', async () => {
    localStorage.setItem('math-adventure-parent-pin-verifier', '{malformed-json}')

    const { store } = fakeStore([])
    render(<ParentDashboard store={store} onBack={vi.fn()} />)

    // hasPinVerifier is true because item is in localStorage, but verifyPin will fail closed
    expect(await screen.findByRole('heading', { name: /masukkan pin orang tua/i })).toBeInTheDocument()
    const pinInput = screen.getByLabelText(/^PIN$/i)
    const submitBtn = screen.getByRole('button', { name: /buka dashboard/i })

    fireEvent.change(pinInput, { target: { value: '123456' } })
    fireEvent.click(submitBtn)

    expect(await screen.findByText(/pin belum diatur|terjadi kesalahan/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /dashboard orang tua/i })).not.toBeInTheDocument()
  })

  // 5. Non-secure context: crypto.subtle absent but the local PIN gate still works
  it('5. keeps the local PIN gate usable when crypto.subtle is unavailable (plain-HTTP LAN origin)', async () => {
    // On http://<lan-ip>:4180 the browser exposes no crypto.subtle. The PIN gate
    // must degrade to the pure-JS PBKDF2 fallback instead of dead-ending.
    vi.spyOn(pinAuth, 'isWebCryptoAvailable').mockReturnValue(false)

    const { store } = fakeStore([])
    render(<ParentDashboard store={store} onBack={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: /buat pin orang tua/i })).toBeInTheDocument()
    expect(screen.queryByText(/tidak mendukung keamanan yang diperlukan/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /dashboard orang tua/i })).not.toBeInTheDocument()
  })

  // 5b. Without a CSPRNG there is no salt, so the gate must refuse honestly
  it('5b. refuses honestly only when the browser provides no CSPRNG at all', async () => {
    vi.spyOn(pinAuth, 'isPinGateSupported').mockReturnValue(false)

    const { store } = fakeStore([])
    render(<ParentDashboard store={store} onBack={vi.fn()} />)

    expect(await screen.findByText(/peramban tidak mendukung pembuatan pin lokal/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /dashboard orang tua/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /buka dashboard/i })).not.toBeInTheDocument()
  })

  // 6. Lima percobaan salah dan lockout
  it('6. enforces lockout after 5 consecutive failed PIN attempts and disables input', async () => {
    const verifier = await pinAuth.createPinVerifier('888888')
    pinAuth.savePinVerifier(verifier!)

    const { store } = fakeStore([])
    render(<ParentDashboard store={store} onBack={vi.fn()} />)

    const pinInput = await screen.findByLabelText(/^PIN$/i)
    const submitBtn = screen.getByRole('button', { name: /buka dashboard/i })

    // Perform 4 failed attempts
    for (let i = 1; i <= 4; i++) {
      fireEvent.change(pinInput, { target: { value: '000000' } })
      fireEvent.click(submitBtn)
      await waitFor(() => expect(pinAuth.getAttemptState().failedAttempts).toBe(i))
    }

    // 5th failed attempt triggers lockout
    fireEvent.change(pinInput, { target: { value: '000000' } })
    fireEvent.click(submitBtn)

    expect(await screen.findByText(/terlalu banyak percobaan/i)).toBeInTheDocument()
    expect(pinInput).toBeDisabled()
    expect(submitBtn).toBeDisabled()
  })

  // 7. Backoff yang meningkat sesuai implementasi
  it('7. increases lockout duration on repeated failures after lockout expires', async () => {
    const verifier = await pinAuth.createPinVerifier('888888')
    pinAuth.savePinVerifier(verifier!)

    let fakeNow = 1700000000000
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow)

    // Trigger initial 5 failed attempts
    for (let i = 0; i < 5; i++) {
      await pinAuth.verifyPin('111111')
    }
    expect(pinAuth.isLockedOut().locked).toBe(true)
    expect(pinAuth.isLockedOut().remainingMs).toBe(30_000)

    // Advance time past 30 seconds
    fakeNow += 31_000
    expect(pinAuth.isLockedOut().locked).toBe(false)

    // 6th attempt (1st attempt after lockout) fails -> 60s
    await pinAuth.verifyPin('111111')
    expect(pinAuth.isLockedOut().locked).toBe(true)
    expect(pinAuth.isLockedOut().remainingMs).toBe(60_000)

    // Advance past 60s
    fakeNow += 61_000
    expect(pinAuth.isLockedOut().locked).toBe(false)

    // 7th attempt fails -> 120s
    await pinAuth.verifyPin('111111')
    expect(pinAuth.isLockedOut().locked).toBe(true)
    expect(pinAuth.isLockedOut().remainingMs).toBe(120_000)
  })

  // 8. Tidak ada bypass setelah reload atau remount
  it('8. does not keep authentication active after remount (reload simulation)', async () => {
    const verifier = await pinAuth.createPinVerifier('123456')
    pinAuth.savePinVerifier(verifier!)

    const { store } = fakeStore([])
    const { unmount } = render(<ParentDashboard store={store} onBack={vi.fn()} />)

    // Unlock dashboard
    const pinInput = await screen.findByLabelText(/^PIN$/i)
    fireEvent.change(pinInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /buka dashboard/i }))
    expect(await screen.findByRole('heading', { name: /dashboard orang tua/i })).toBeInTheDocument()

    // Simulate page reload / route change (unmount and fresh mount)
    unmount()
    render(<ParentDashboard store={store} onBack={vi.fn()} />)

    // Must be locked again!
    expect(await screen.findByRole('heading', { name: /masukkan pin orang tua/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /dashboard orang tua/i })).not.toBeInTheDocument()
  })

  // 9. Idle timeout 5 menit
  it('9. automatically locks dashboard after 5 minutes of user inactivity', async () => {
    const verifier = await pinAuth.createPinVerifier('123456')
    pinAuth.savePinVerifier(verifier!)

    const { store } = fakeStore([])
    render(<ParentDashboard store={store} onBack={vi.fn()} />)

    // Unlock with real timers
    const pinInput = await screen.findByLabelText(/^PIN$/i)
    fireEvent.change(pinInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /buka dashboard/i }))

    expect(await screen.findByRole('heading', { name: /dashboard orang tua/i })).toBeInTheDocument()

    // Switch to fake timers for advancing the idle timer
    vi.useFakeTimers()

    // Advance 4 minutes (not locked yet)
    act(() => {
      vi.advanceTimersByTime(4 * 60 * 1000)
    })
    expect(screen.getByRole('heading', { name: /dashboard orang tua/i })).toBeInTheDocument()

    // Activity resets timer
    act(() => {
      fireEvent.mouseDown(document)
    })

    // Advance another 4 minutes (still unlocked because activity reset it)
    act(() => {
      vi.advanceTimersByTime(4 * 60 * 1000)
    })
    expect(screen.getByRole('heading', { name: /dashboard orang tua/i })).toBeInTheDocument()

    // Advance 5 full minutes without activity -> auto lock!
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000)
    })

    // Switch back to real timers to check UI update
    vi.useRealTimers()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /masukkan pin orang tua/i })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /dashboard orang tua/i })).not.toBeInTheDocument()
    })
  })

  // 10. Lock manual
  it('10. manual lock button locks dashboard immediately and returns to PIN verification', async () => {
    const verifier = await pinAuth.createPinVerifier('123456')
    pinAuth.savePinVerifier(verifier!)

    const { store } = fakeStore([])
    render(<ParentDashboard store={store} onBack={vi.fn()} />)

    // Unlock
    const pinInput = await screen.findByLabelText(/^PIN$/i)
    fireEvent.change(pinInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /buka dashboard/i }))
    expect(await screen.findByRole('heading', { name: /dashboard orang tua/i })).toBeInTheDocument()

    // Click "Kunci Dashboard"
    const lockBtn = screen.getByRole('button', { name: /kunci dashboard/i })
    fireEvent.click(lockBtn)

    // Immediately locked
    expect(await screen.findByRole('heading', { name: /masukkan pin orang tua/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /dashboard orang tua/i })).not.toBeInTheDocument()
  })

  // 11. Timer dan listener dibersihkan
  it('11. cleans up idle timers and document event listeners on lock and unmount', async () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')

    const verifier = await pinAuth.createPinVerifier('123456')
    pinAuth.savePinVerifier(verifier!)

    const { store } = fakeStore([])
    const { unmount } = render(<ParentDashboard store={store} onBack={vi.fn()} />)

    // Unlock
    const pinInput = await screen.findByLabelText(/^PIN$/i)
    fireEvent.change(pinInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /buka dashboard/i }))
    await screen.findByRole('heading', { name: /dashboard orang tua/i })

    // Unmount while unlocked
    unmount()

    // Activity listeners must be removed
    const removedEvents = removeEventListenerSpy.mock.calls.map(call => call[0])
    expect(removedEvents).toContain('mousedown')
    expect(removedEvents).toContain('keydown')
    expect(removedEvents).toContain('scroll')
    expect(removedEvents).toContain('touchstart')

    // Timer must be cleared
    expect(clearTimeoutSpy).toHaveBeenCalled()
  })

  // 12. Dashboard dan tindakan sensitif tidak dapat digunakan saat terkunci
  it('12. ensures sensitive admin actions and data cannot be accessed when locked', async () => {
    const verifier = await pinAuth.createPinVerifier('123456')
    pinAuth.savePinVerifier(verifier!)

    const mockConfirm = vi.fn()
    const mockCancel = vi.fn()
    const pendingTx: RewardTransaction = {
      transactionId: 'tx-sec-1',
      starsRedeemed: 10,
      rupiahValue: 10000,
      rupiahPerStarSnapshot: 1000,
      status: 'pending',
      requestedAt: Date.now(),
      confirmedAt: null,
      cancelledAt: null,
    }

    const { store } = fakeStore([])
    render(
      <ParentDashboard
        store={store}
        onBack={vi.fn()}
        initialTransactions={[pendingTx]}
        onConfirmTransaction={mockConfirm}
        onCancelTransaction={mockCancel}
      />
    )

    // While locked: no transaction list, no confirm/cancel buttons exist in the DOM
    expect(screen.queryByText(/tx-sec-1/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /konfirmasi/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /batalkan/i })).not.toBeInTheDocument()
    expect(mockConfirm).not.toHaveBeenCalled()
    expect(mockCancel).not.toHaveBeenCalled()
  })

  // 13. Perilaku multi-tab
  it('13. shares lockout and verifier across tabs via storage, while keeping unlocked memory state per-tab', async () => {
    const verifier = await pinAuth.createPinVerifier('123456')
    pinAuth.savePinVerifier(verifier!)

    // Tab 1: Locks out via 5 failed attempts
    for (let i = 0; i < 5; i++) {
      await pinAuth.verifyPin('000000')
    }
    expect(pinAuth.isLockedOut().locked).toBe(true)

    // Tab 2: Mounts now in the same storage environment
    const { store } = fakeStore([])
    render(<ParentDashboard store={store} onBack={vi.fn()} />)

    // Tab 2 immediately sees the lockout from Tab 1!
    expect(await screen.findByText(/terlalu banyak percobaan/i)).toBeInTheDocument()
    const pinInput = screen.getByLabelText(/^PIN$/i)
    expect(pinInput).toBeDisabled()
  })
})
