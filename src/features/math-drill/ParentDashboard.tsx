import { useEffect, useState, useRef, useCallback } from 'react'
import type { CompletedSessionHistoryStore, UnifiedIndexedDbSessionStore } from './persistence/completedSessionHistoryStore'
import type { CompletedSessionRecord } from './persistence/completedSessionTypes'
import type { RewardConfig, RewardTransaction } from './reward'
import './parent-dashboard.css'
import {
  hasPinVerifier,
  createPinVerifier,
  savePinVerifier,
  verifyPin,
  validatePinFormat,
  isPinGateSupported,
  getLockoutMessage,
  PIN_CONFIG,
} from './parentPinAuth'
import {
  lockParentSession,
  clearParentSessionToken,
  restoreParentSessionToken,
  checkParentSession,
  verifyParentPin,
} from './api/sessionApi'

type DashboardStore = Pick<CompletedSessionHistoryStore, 'list'>
type LoadState = { readonly status: 'loading' } | { readonly status: 'error'; readonly message: string } | { readonly status: 'ready'; readonly records: readonly CompletedSessionRecord[] }

export interface ParentDashboardProps {
  readonly store: DashboardStore | UnifiedIndexedDbSessionStore
  readonly onBack: () => void
  readonly initialTransactions?: readonly RewardTransaction[]
  readonly initialConfig?: RewardConfig
  /** @deprecated PIN is now managed via secure storage - this prop is ignored */
  readonly parentPin?: string
  readonly onConfirmTransaction?: (transactionId: string) => void
  readonly onCancelTransaction?: (transactionId: string) => void
  /** Optional RewardController when the dashboard is wired to persisted reward storage. */
  readonly controller?: import('./reward').RewardController
}

/**
 * Session state for dashboard.
 *
 * Stage 7B-A2 local PIN alignment: the parent PIN is strictly local to the
 * device to protect settings and rewards against inadvertent child access.
 * Backend availability never alters local PIN status or unlocks the gate.
 */
type AuthSession = 
  | { readonly state: 'uninitialized' }
  | { readonly state: 'needs-setup' }
  | { readonly state: 'locked'; readonly lockMessage: string | null }
  | { readonly state: 'unlocked' }

function completedCount(record: CompletedSessionRecord): number { return record.historySchemaVersion === 1 ? record.outcomes.length : record.completedCount }
function plannedCount(record: CompletedSessionRecord): number { return record.historySchemaVersion === 1 ? record.outcomes.length : record.plannedCount }
function scorePercent(record: CompletedSessionRecord): number | null {
  const count = completedCount(record)
  return count ? record.outcomes.reduce((sum, outcome) => sum + outcome.points, 0) / plannedCount(record) * 100 : null
}
/** Hitung jumlah jawaban berdasarkan points: 1 = benar penuh, 0.5 = benar sebagian, 0 = salah */
function correctFullCount(record: CompletedSessionRecord): number { return record.outcomes.filter(o => o.points === 1).length }
function correctPartialCount(record: CompletedSessionRecord): number { return record.outcomes.filter(o => o.points === 0.5).length }
function incorrectCount(record: CompletedSessionRecord): number { return record.outcomes.filter(o => o.points === 0).length }
function timeOf(record: CompletedSessionRecord): number { return record.historySchemaVersion === 1 ? record.completedAt ?? record.recordedAt : record.endedAt }
function compareRecent(a: CompletedSessionRecord, b: CompletedSessionRecord): number {
  return timeOf(b) - timeOf(a) || b.recordedAt - a.recordedAt || b.instanceId.localeCompare(a.instanceId)
}
function average(records: readonly CompletedSessionRecord[]): number | null {
  const scored = records.map(scorePercent).filter((value): value is number => value !== null)
  return scored.length ? scored.reduce((sum, value) => sum + value, 0) / scored.length : null
}
function percent(value: number | null) { return value === null ? '—' : `${Math.round(value)}%` }
function sessionDate(record: CompletedSessionRecord) {
  const timestamp = timeOf(record), label = record.historySchemaVersion === 1 && record.completedAt === null ? 'Tanggal pencatatan' : 'Tanggal selesai'
  const date = new Date(timestamp)
  return { text: Number.isNaN(date.getTime()) ? 'Tanggal tidak tersedia' : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(date), label }
}

function balanceFromController(controller: import('./reward').RewardController): number | null {
  const s = controller.getState()
  return s.status === 'ready' ? s.balance.availableBalance : null
}

/** Analytics Helper Functions */
function totalCorrectFull(records: readonly CompletedSessionRecord[]): number {
  return records.reduce((sum, record) => sum + correctFullCount(record), 0)
}
function totalCorrectPartial(records: readonly CompletedSessionRecord[]): number {
  return records.reduce((sum, record) => sum + correctPartialCount(record), 0)
}
function totalQuestionsAnswered(records: readonly CompletedSessionRecord[]): number {
  return records.reduce((sum, record) => sum + record.outcomes.length, 0)
}
function overallAccuracy(records: readonly CompletedSessionRecord[]): number | null {
  const total = totalQuestionsAnswered(records)
  if (total === 0) return null
  const correct = totalCorrectFull(records) + totalCorrectPartial(records) * 0.5
  return (correct / total) * 100
}
interface LevelStats { readonly level: number; readonly count: number; readonly avgScore: number | null; readonly correct: number; readonly incorrect: number; readonly accuracy: number | null }
function accuracyByLevel(records: readonly CompletedSessionRecord[]): LevelStats[] {
  const byLevel = new Map<number, CompletedSessionRecord[]>()
  records.forEach(record => {
    for (const outcome of record.outcomes) {
      const level = outcome.level
      if (typeof level !== 'number') continue
      if (!byLevel.has(level)) byLevel.set(level, [])
      byLevel.get(level)!.push(record)
    }
  })
  const stats: LevelStats[] = []
  for (const [level, levelRecords] of Array.from(byLevel.entries()).sort((a, b) => a[0] - b[0])) {
    const uniqueRecords = Array.from(new Set(levelRecords.map(r => r.instanceId))).map(id => levelRecords.find(r => r.instanceId === id)!).sort(compareRecent)
    const levelOutcomes = levelRecords.flatMap(r => r.outcomes)
    const correct = levelOutcomes.filter(o => o.points === 1).length
    const incorrect = levelOutcomes.filter(o => o.points === 0).length
    const total = correct + incorrect
    stats.push({
      level,
      count: uniqueRecords.length,
      avgScore: average(uniqueRecords),
      correct,
      incorrect,
      accuracy: total > 0 ? (correct / total) * 100 : null,
    })
  }
  return stats
}
interface OperationStats { readonly operation: string; readonly count: number; readonly correct: number; readonly incorrect: number; readonly accuracy: number | null }
function accuracyByOperation(records: readonly CompletedSessionRecord[]): OperationStats[] {
  const byOp = new Map<string, { correct: number; incorrect: number }>()
  records.forEach(record => {
    for (const outcome of record.outcomes) {
      const key = outcome.operation
      if (typeof key !== 'string' || key.length === 0) continue
      if (!byOp.has(key)) byOp.set(key, { correct: 0, incorrect: 0 })
      const stats = byOp.get(key)!
      if (outcome.points === 1) stats.correct++
      else if (outcome.points === 0) stats.incorrect++
    }
  })
  const opNames: Record<string, string> = { addition: 'Penjumlahan', subtraction: 'Pengurangan', mixed: 'Campuran' }
  return Array.from(byOp.entries())
    .map(([op, { correct, incorrect }]) => ({
      operation: opNames[op] ?? op,
      count: correct + incorrect,
      correct,
      incorrect,
      accuracy: correct + incorrect > 0 ? (correct / (correct + incorrect)) * 100 : null,
    }))
    .sort((a, b) => b.count - a.count)
}

/** PIN Setup Form Component */
function PinSetupForm({ 
  onComplete,
}: { 
  onComplete: (success: boolean) => void
}) {
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [cryptoError] = useState(() => !isPinGateSupported())

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validate PIN format
    const pinValidation = validatePinFormat(pin)
    if (!pinValidation.valid) {
      setError(pinValidation.error || 'PIN tidak valid')
      return
    }

    // Check confirmation
    if (pin !== confirmPin) {
      setError('Konfirmasi PIN tidak cocok')
      return
    }

    setIsProcessing(true)

    try {
      const verifier = await createPinVerifier(pin)
      if (!verifier) {
        setError('Gagal membuat verifier PIN. Silakan coba lagi.')
        setIsProcessing(false)
        return
      }

      // Save verifier lokal di perangkat ini
      const saved = savePinVerifier(verifier)
      if (!saved) {
        setError('Gagal menyimpan PIN. Penyimpanan tidak tersedia.')
        setIsProcessing(false)
        return
      }

      // PIN orang tua TIDAK pernah dikirim ke backend — tidak untuk membuat,
      // tidak untuk memverifikasi. Gerbang ini murni lokal di perangkat.
      onComplete(true)
    } catch {
      setError('Terjadi kesalahan. Silakan coba lagi.')
      setIsProcessing(false)
    }
  }

  if (cryptoError) {
    return (
      <div className="parent-pin-form" role="alert">
        <h2>Autentikasi Tidak Tersedia</h2>
        <p>Peramban tidak mendukung pembuatan PIN lokal.</p>
        <p>Peramban ini tidak menyediakan generator angka acak (crypto.getRandomValues), sehingga PIN tidak dapat disimpan dengan aman. Silakan gunakan peramban modern.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="parent-pin-form">
      <h2 id="pin-setup-title">Buat PIN Orang Tua</h2>
      <p>Buat PIN 6 digit untuk mengakses dashboard orang tua. PIN ini akan digunakan untuk melindungi data reward dan transaksi.</p>
      
      <div style={{ marginTop: '1rem' }}>
        <label htmlFor="new-pin">Masukkan PIN</label>
        <input
          id="new-pin"
          type="password"
          inputMode="numeric"
          maxLength={PIN_CONFIG.PIN_LENGTH}
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_CONFIG.PIN_LENGTH))}
          placeholder="6 digit"
          autoComplete="off"
          required
          disabled={isProcessing}
        />
      </div>

      <div style={{ marginTop: '0.75rem' }}>
        <label htmlFor="confirm-pin">Konfirmasi PIN</label>
        <input
          id="confirm-pin"
          type="password"
          inputMode="numeric"
          maxLength={PIN_CONFIG.PIN_LENGTH}
          value={confirmPin}
          onChange={e => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, PIN_CONFIG.PIN_LENGTH))}
          placeholder="6 digit"
          autoComplete="off"
          required
          disabled={isProcessing}
        />
      </div>

      {error && <p role="alert" style={{ color: '#d9534f', marginTop: '0.5rem' }}>{error}</p>}

      <button type="submit" style={{ marginTop: '1rem' }} disabled={isProcessing || !pin || !confirmPin}>
        {isProcessing ? 'Menyimpan...' : 'Simpan PIN'}
      </button>
    </form>
  )
}

/** PIN Verification Form Component */
function PinVerifyForm({ 
  onVerified,
}: { 
  onVerified: () => void
}) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const formatValidation = validatePinFormat(pin)
    if (!formatValidation.valid) {
      setError(formatValidation.error || 'PIN tidak valid')
      return
    }

    setIsProcessing(true)

    try {
      const result = await verifyPin(pin)
      if (result.success) {
        // PIN lokal adalah satu-satunya otorisasi gerbang ini. PIN tidak dikirim
        // ke backend, sehingga kegagalan autentikasi backend tidak pernah
        // memakai jatah percobaan PIN (lokal maupun backend).
        onVerified()
      } else {
        setError(result.error || 'PIN salah')
        setPin('')
      }
    } catch {
      setError('Terjadi kesalahan. Silakan coba lagi.')
    } finally {
      setIsProcessing(false)
    }
  }

  const lockoutMessage = getLockoutMessage()
  const isLocked = lockoutMessage !== null

  return (
    <form onSubmit={handleSubmit} className="parent-pin-form">
      <h2 id="pin-verify-title">Masukkan PIN Orang Tua</h2>
      <p>Masukkan PIN 6 digit untuk mengelola penukaran dan pengaturan.</p>

      <div style={{ marginTop: '1rem' }}>
        <label htmlFor="pin-input">PIN</label>
        <input
          id="pin-input"
          type="password"
          inputMode="numeric"
          maxLength={PIN_CONFIG.PIN_LENGTH}
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_CONFIG.PIN_LENGTH))}
          placeholder="6 digit"
          autoComplete="off"
          required
          disabled={isProcessing || isLocked}
        />
      </div>

      {(error || lockoutMessage) && (
        <p role="alert" style={{ color: '#d9534f', marginTop: '0.5rem' }}>
          {lockoutMessage || error}
        </p>
      )}

      <button 
        type="submit" 
        style={{ marginTop: '1rem' }} 
        disabled={isProcessing || !pin || isLocked}
      >
        {isProcessing ? 'Memeriksa...' : 'Buka Dashboard'}
      </button>
    </form>
  )
}

export function ParentDashboard({
  store,
  onBack,
  initialTransactions = [],
  initialConfig,
  onConfirmTransaction,
  onCancelTransaction,
  controller,
}: ParentDashboardProps) {
  const [authSession, setAuthSession] = useState<AuthSession>({ state: 'uninitialized' })

  // Development‑only bypass: aktif bila VITE_BYPASS_PIN=1 dan mode development
  useEffect(() => {
    // Vite mengekspor env lewat import.meta.env
    if (import.meta.env.DEV && import.meta.env.VITE_BYPASS_PIN === '1') {
      setAuthSession({ state: 'unlocked' })
    }
  }, [])
  const idleTimerRef = useRef<number | null>(null)
  useEffect(() => {
    let mounted = true

    const init = async () => {
      if (!mounted) return

      // Derivation works via crypto.subtle (secure context) or the pure-JS
      // PBKDF2 fallback (plain-HTTP LAN origin). Only a missing CSPRNG blocks us.
      if (!isPinGateSupported()) {
        setAuthSession({ state: 'locked', lockMessage: 'Peramban tidak mendukung pembuatan PIN lokal' })
        return
      }

      // PIN orang tua tetap lokal di perangkat
      if (!hasPinVerifier()) {
        setAuthSession({ state: 'needs-setup' })
      } else {
        setAuthSession({ state: 'locked', lockMessage: null })
      }
    }

    init()
    return () => {
      mounted = false
      clearParentSessionToken()
    }
  }, [])

  // Reset idle timer on user activity
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
    }
    
    // Only set timer if authenticated
    if (authSession.state === 'unlocked') {
      idleTimerRef.current = window.setTimeout(async () => {
        try {
          await lockParentSession()
        } catch {
          // ignore
        }
        clearParentSessionToken()
        setAuthSession({ state: 'locked', lockMessage: null })
      }, PIN_CONFIG.IDLE_TIMEOUT_MS)
    }
  }, [authSession.state])

  // Set up activity listeners
  useEffect(() => {
    if (authSession.state !== 'unlocked') {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
      return
    }

    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart']
    const handleActivity = () => resetIdleTimer()

    activityEvents.forEach(event => {
      document.addEventListener(event, handleActivity, { passive: true })
    })

    // Initial timer
    resetIdleTimer()

    return () => {
      activityEvents.forEach(event => {
        document.removeEventListener(event, handleActivity)
      })
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
      }
    }
  }, [authSession.state, resetIdleTimer])

  // Handle successful PIN setup
  const handleSetupComplete = useCallback((success: boolean) => {
    if (success) {
      setAuthSession({ state: 'unlocked' })
    } else {
      setAuthSession({ state: 'needs-setup' })
    }
  }, [])

  // Handle successful PIN verification
  const handleVerified = useCallback(() => {
    setAuthSession({ state: 'unlocked' })
  }, [])

  // Handle manual lock
  const handleLock = useCallback(async () => {
    try {
      await lockParentSession()
    } catch {
      // ignore
    }
    clearParentSessionToken()
    setAuthSession({ state: 'locked', lockMessage: null })
  }, [])

  // Render based on auth state
  const renderContent = () => {
    switch (authSession.state) {
      case 'uninitialized':
        return (
          <section className="parent-dashboard-card" aria-busy="true">
            <p>Memuat...</p>
          </section>
        )

      case 'needs-setup':
        return <PinSetupForm onComplete={handleSetupComplete} />

      case 'locked':
        if (authSession.lockMessage) {
          return (
            <div className="parent-pin-form" role="alert">
              <p>{authSession.lockMessage}</p>
            </div>
          )
        }
        return <PinVerifyForm onVerified={handleVerified} />

      case 'unlocked':
        return (
          <ParentDashboardContent
            store={store}
            controller={controller}
            onLock={handleLock}
            onBack={onBack}
            onConfirmTransaction={onConfirmTransaction}
            onCancelTransaction={onCancelTransaction}
            initialTransactions={initialTransactions}
            initialConfig={initialConfig}
          />
        )
    }
  }

  return (
    <>
      {/* Back button always visible when not authenticated */}
      {(authSession.state === 'locked' || authSession.state === 'needs-setup') && (
        <div style={{ padding: '0.5rem', borderBottom: '1px solid #ccc' }}>
          <button type="button" onClick={onBack} style={{ cursor: 'pointer' }}>
            ← Kembali ke menu utama
          </button>
        </div>
      )}
      {renderContent()}
    </>
  )
}

/** Main Dashboard Content (when authenticated) */
function ParentDashboardContent({
  store,
  controller,
  onLock,
  onBack,
  onConfirmTransaction,
  onCancelTransaction,
  initialTransactions,
  initialConfig,
}: {
  readonly store: DashboardStore | UnifiedIndexedDbSessionStore
  readonly controller?: import('./reward').RewardController
  readonly onLock: () => void
  readonly onBack: () => void
  readonly onConfirmTransaction?: (transactionId: string) => void
  readonly onCancelTransaction?: (transactionId: string) => void
  readonly initialTransactions?: readonly RewardTransaction[]
  readonly initialConfig?: RewardConfig
}) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [controllerStatus, setControllerStatus] = useState<string>(() => controller ? controller.getState().status : 'none')
  const [transactions, setTransactions] = useState<readonly RewardTransaction[]>(
    initialTransactions || []
  )
  const [config, setConfig] = useState<RewardConfig | undefined>(initialConfig)
  const [corrections, setCorrections] = useState<readonly import('./reward/redemption/correctionTypes').RewardCorrection[]>([])
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: 'confirm' | 'cancel'; txId: string } | null>(null)

  // Dashboard main tab state
  const [activeTab, setActiveTab] = useState<'all' | 'rewards' | 'learning'>('all')

  // Reward history filter & pagination state
  const [rewardFilter, setRewardFilter] = useState<'all' | 'redemption' | 'correction'>('all')
  const [rewardPage, setRewardPage] = useState<number>(1)
  const REWARD_PAGE_SIZE = 5

  // Config editing state
  const [isEditingConfig, setIsEditingConfig] = useState(false)
  const [configForm, setConfigForm] = useState<{ rupiahPerStar: string; minStarsPerRedemption: string; maxStarsPerRedemption: string }>({
    rupiahPerStar: config ? String(config.rupiahPerStar) : '500',
    minStarsPerRedemption: config ? String(config.minStarsPerRedemption) : '1',
    maxStarsPerRedemption: config ? String(config.maxStarsPerRedemption) : '100',
  })
  const [configBusy, setConfigBusy] = useState(false)

  // Correction state
  const [correctionForm, setCorrectionForm] = useState<{ originalTransactionId: string; starsDelta: string; reason: string }>({
    originalTransactionId: '',
    starsDelta: '',
    reason: '',
  })
  const [correctionBusy, setCorrectionBusy] = useState(false)

  // Update local form when config loads
  useEffect(() => {
    if (config) {
      setConfigForm({
        rupiahPerStar: String(config.rupiahPerStar),
        minStarsPerRedemption: String(config.minStarsPerRedemption),
        maxStarsPerRedemption: String(config.maxStarsPerRedemption),
      })
    }
  }, [config])

  // Backend reward authentication (separate from the local device PIN).
  // The local PIN opens the dashboard UI; the backend PIN opens the reward
  // ledger. The local PIN is never sent to the backend.
  const [backendAuth, setBackendAuth] = useState<'idle' | 'checking' | 'needed' | 'authenticated' | 'failed'>('idle')
  const [backendPinInput, setBackendPinInput] = useState('')
  const [backendAuthError, setBackendAuthError] = useState<string | null>(null)
  const [backendAuthBusy, setBackendAuthBusy] = useState(false)

  const handleConfirm = useCallback(async (txId: string) => {
    setConfirmAction({ type: 'confirm', txId })
  }, [])

  const handleCancel = useCallback(async (txId: string) => {
    setConfirmAction({ type: 'cancel', txId })
  }, [])

  const executeAction = useCallback(async () => {
    if (!confirmAction) return

    const { type, txId } = confirmAction

    if (controller) {
      const result = type === 'confirm' 
        ? await controller.confirmRedemption(txId)
        : await controller.cancelRedemption(txId)
      
      if (result.status === 'success') {
        const current = controller.getState()
        if (current.status === 'ready') {
          setTransactions([...(current.transactions ?? [])])
          setCorrections([...(current.corrections ?? [])])
          setConfig(current.config)
        }
        setActionMessage(type === 'confirm' 
          ? `Transaksi ${txId} berhasil dikonfirmasi.`
          : `Transaksi ${txId} dibatalkan.`
        )
      } else {
        setActionMessage(type === 'confirm'
          ? 'Gagal mengonfirmasi transaksi.'
          : 'Gagal membatalkan transaksi.'
        )
      }
    } else {
      if (type === 'confirm' && onConfirmTransaction) {
        onConfirmTransaction(txId)
      } else if (type === 'cancel' && onCancelTransaction) {
        onCancelTransaction(txId)
      }
      
      setTransactions(prev => prev.map(tx => {
        if (tx.transactionId === txId && tx.status === 'pending') {
          return {
            ...tx,
            status: type === 'confirm' ? 'confirmed' : 'cancelled',
            confirmedAt: type === 'confirm' ? Date.now() : null,
            cancelledAt: type === 'cancel' ? Date.now() : null,
          } as RewardTransaction
        }
        return tx
      }))
      setActionMessage(type === 'confirm'
        ? `Transaksi ${txId} berhasil dikonfirmasi.`
        : `Transaksi ${txId} dibatalkan.`
      )
    }
    setConfirmAction(null)
  }, [confirmAction, controller, onConfirmTransaction, onCancelTransaction])

  // Submit the BACKEND reward PIN. This is NOT the local device PIN — it is a
  // separate credential for the reward ledger. The local PIN is never sent.
  const handleBackendAuthSubmit = useCallback(async () => {
    if (!backendPinInput || !/^\d{6}$/.test(backendPinInput)) return
    setBackendAuthBusy(true)
    setBackendAuthError(null)
    const result = await verifyParentPin(backendPinInput)
    if (result.success) {
      setBackendPinInput('')
      // Token is now in memory + localStorage. Setting backendAuth triggers
      // the reward-load effect below — no extra validation round-trip needed.
      setBackendAuth('authenticated')
    } else {
      setBackendAuth('failed')
      setBackendAuthError(result.error || 'PIN salah. Silakan coba lagi.')
    }
    setBackendAuthBusy(false)
  }, [backendPinInput])

  // Effect 1: Backend auth bootstrap + history load.
  // Restores any persisted token, validates it via GET /api/parent/session,
  // and loads the device-credentialed session history. No reward access happens
  // here — that is deferred to Effect 2 until the session is confirmed valid.
  useEffect(() => {
    let current = true
    void (async () => {
      if (controller) {
        const token = restoreParentSessionToken()
        if (token) {
          if (current) setBackendAuth('checking')
          const sessionCheck = await checkParentSession()
          if (!current) return
          if (sessionCheck.valid) {
            if (current) setBackendAuth('authenticated')
          } else {
            // Expired or revoked — token was already cleared by checkParentSession.
            if (current) setBackendAuth('needed')
          }
        } else {
          if (current) setBackendAuth('needed')
        }
      }

      const records: CompletedSessionRecord[] = []
      let cursor: { readonly recordedAt: number; readonly instanceId: string } | undefined
      do {
        const result = await store.list({ limit: 500, ...(cursor ? { cursor } : {}) })
        if (result.status !== 'success') {
          if (current) {
            const message = result.code === 'unavailable'
              ? 'Penyimpanan riwayat tidak tersedia. Data tidak diubah.'
              : result.code === 'unsupported-database-version'
                ? 'Versi penyimpanan riwayat belum didukung. Data tidak diubah.'
                : 'Riwayat belum dapat dibuka. Data tidak diubah.'
            setState({ status: 'error', message })
          }
          return
        }
        if (result.invalidCount > 0 && current) {
          setState({ status: 'error', message: 'Sebagian riwayat tidak didukung atau rusak. Data tidak diubah.' })
          return
        }
        records.push(...result.records)
        cursor = result.nextCursor
      } while (cursor)
      if (current) setState({ status: 'ready', records: records.sort(compareRecent) })
    })().catch(() => { if (current) setState({ status: 'error', message: 'Penyimpanan riwayat tidak tersedia. Data tidak diubah.' }) })
    return () => { current = false }
  }, [store, attempt, controller])

  // Effect 2: Reward load — only when the backend session is authenticated.
  // Triggered by backendAuth changing to 'authenticated' (either from bootstrap
  // validation or from a successful backend PIN entry). This avoids loading
  // reward data without a valid parent session, and avoids a redundant
  // validation round-trip after the handler already obtained a fresh token.
  useEffect(() => {
    if (!controller) return
    if (backendAuth !== 'authenticated') {
      setControllerStatus('none')
      return
    }
    let current = true
    void (async () => {
      try {
        const rewardState = controller.getState().status === 'ready'
          ? controller.getState()
          : await controller.load()
        if (current) {
          setControllerStatus(rewardState.status)
          if (rewardState.status === 'ready') {
            setTransactions([...(rewardState.transactions ?? [])])
            setCorrections([...(rewardState.corrections ?? [])])
            setConfig(rewardState.config)
          }
          if (rewardState.status === 'storage-error') {
            setActionMessage('Penyimpanan reward tidak tersedia. Data tidak diubah.')
          }
        }
      } catch {
        if (current) {
          setControllerStatus('storage-error')
          setActionMessage('Penyimpanan reward tidak tersedia. Data tidak diubah.')
        }
      }
    })()
    return () => { current = false }
  }, [backendAuth, controller])

  const handleBackAndLock = useCallback(() => {
    onLock()
    onBack()
  }, [onLock, onBack])

  const handleUpdateConfig = useCallback(async () => {
    if (!controller) return
    const rupiahPerStar = Number(configForm.rupiahPerStar)
    const minStars = Number(configForm.minStarsPerRedemption)
    const maxStars = Number(configForm.maxStarsPerRedemption)

    if (!Number.isSafeInteger(rupiahPerStar) || rupiahPerStar < 1) {
      setActionMessage('Nilai tukar harus berupa bilangan bulat positif.')
      return
    }
    if (!Number.isSafeInteger(minStars) || minStars < 1) {
      setActionMessage('Minimum bintang harus berupa bilangan bulat positif.')
      return
    }
    if (!Number.isSafeInteger(maxStars) || maxStars < minStars) {
      setActionMessage('Maksimum bintang harus lebih besar atau sama dengan minimum.')
      return
    }

    const confirmed = window.confirm(`Simpan perubahan pengaturan reward?\nRp ${rupiahPerStar.toLocaleString('id-ID')} per bintang\nMin: ${minStars} · Max: ${maxStars}`)
    if (!confirmed) return

    setConfigBusy(true)
    const result = await controller.updateConfig({ rupiahPerStar, minStarsPerRedemption: minStars, maxStarsPerRedemption: maxStars })
    setConfigBusy(false)

    if (result.status === 'success') {
      setConfig(result.config)
      setIsEditingConfig(false)
      setActionMessage('Pengaturan reward berhasil disimpan.')
    } else {
      setActionMessage('Gagal menyimpan pengaturan reward. Data tidak diubah.')
    }
  }, [controller, configForm])

  const handleApplyCorrection = useCallback(async () => {
    if (!controller) return
    const starsDelta = Number(correctionForm.starsDelta)
    const reason = correctionForm.reason.trim()
    const originalTransactionId = correctionForm.originalTransactionId

    if (!originalTransactionId) {
      setActionMessage('Pilih transaksi asal untuk koreksi.')
      return
    }
    if (!Number.isSafeInteger(starsDelta) || starsDelta === 0) {
      setActionMessage('Nominal koreksi harus berupa bilangan bulat positif (tambah) atau negatif (kurang), bukan nol.')
      return
    }
    if (reason.length === 0) {
      setActionMessage('Alasan koreksi wajib diisi.')
      return
    }

    const actionText = starsDelta > 0
      ? `menambahkan ${starsDelta} bintang ke saldo`
      : `mengurangi ${Math.abs(starsDelta)} bintang dari saldo`
    const confirmed = window.confirm(`Terapkan koreksi?\n${actionText}\nAlasan: ${reason}`)
    if (!confirmed) return

    setCorrectionBusy(true)
    const correctionId = `corr-${Date.now()}`
    const result = await controller.applyCorrection({
      correctionId,
      originalTransactionId,
      starsDelta,
      reason,
    })
    setCorrectionBusy(false)

    if (result.status === 'success') {
      const current = controller.getState()
      if (current.status === 'ready') {
        setTransactions([...(current.transactions ?? [])])
        setCorrections([...(current.corrections ?? [])])
        setConfig(current.config)
      }
      setCorrectionForm({ originalTransactionId: '', starsDelta: '', reason: '' })
      setActionMessage(`Koreksi berhasil diterapkan: ${starsDelta > 0 ? '+' : ''}${starsDelta} bintang.`)
    } else {
      setActionMessage('Gagal menerapkan koreksi. Data tidak diubah.')
    }
  }, [controller, correctionForm])

  return (
    <main className="parent-dashboard" aria-labelledby="parent-dashboard-title">
      <header className="parent-dashboard-header">
        <div><p className="parent-dashboard-kicker">MATH ADVENTURE</p><h1 id="parent-dashboard-title">Dashboard Orang Tua</h1></div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="parent-dashboard-back" onClick={onLock}>Kunci Dashboard</button>
          <button type="button" className="parent-dashboard-back" onClick={handleBackAndLock}>Kembali ke latihan</button>
        </div>
      </header>

      <nav className="parent-dashboard-tabs" aria-label="Navigasi Dasbor">
        <button
          type="button"
          className={`parent-tab-btn ${activeTab === 'all' ? 'parent-tab-btn-active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          📋 Semua Bagian
        </button>
        <button
          type="button"
          className={`parent-tab-btn ${activeTab === 'rewards' ? 'parent-tab-btn-active' : ''}`}
          onClick={() => setActiveTab('rewards')}
        >
          🎁 Reward &amp; Penukaran
        </button>
        <button
          type="button"
          className={`parent-tab-btn ${activeTab === 'learning' ? 'parent-tab-btn-active' : ''}`}
          onClick={() => setActiveTab('learning')}
        >
          📊 Progres Belajar
        </button>
      </nav>

      {(activeTab === 'all' || activeTab === 'rewards') && (
      <section className="parent-dashboard-card" aria-labelledby="reward-management-title">
        <h2 id="reward-management-title">Penukaran bintang &amp; hadiah</h2>
        
        {controller ? (
          backendAuth === 'authenticated' ? (
            controllerStatus === 'ready' ? (
              <div className="parent-reward-header-box">
                <div>
                  <span className="parent-status-badge parent-status-open" data-testid="parent-access-status">Akses Orang Tua Terbuka</span>
                  <p className="parent-reward-header-sub">Ledger reward tersinkronisasi dan terverifikasi.</p>
                </div>
                {balanceFromController(controller) !== null && (
                  <div className="parent-balance-display">
                    <span className="parent-balance-label">Saldo Bintang</span>
                    <strong data-testid="available-balance" className="parent-balance-value">
                      {balanceFromController(controller)} <span aria-hidden="true">⭐</span>
                    </strong>
                  </div>
                )}
              </div>
            ) : controllerStatus === 'storage-error' ? (
              <div className="parent-reward-header-box">
                <span className="parent-status-badge parent-status-error" data-testid="parent-access-status">
                  Status: Layanan reward tidak tersedia
                </span>
              </div>
            ) : null
          ) : backendAuth === 'checking' ? (
            <div className="parent-reward-header-box">
              <span className="parent-status-badge parent-status-checking" data-testid="parent-access-status">
                Memeriksa sesi reward…
              </span>
            </div>
          ) : (
            <div className="parent-pin-form">
              <p data-testid="parent-access-status" style={{ color: '#666', fontWeight: 600 }}>
                Masukkan PIN Reward untuk melihat saldo dan penukaran bintang.
              </p>
              <p style={{ fontSize: '0.85rem', color: '#999', marginTop: '0.25rem' }}>
                PIN ini terpisah dari PIN lokal perangkat dan hanya untuk mengakses ledger reward.
              </p>
              <input
                type="password"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                placeholder="PIN Reward (6 digit)"
                value={backendPinInput}
                onChange={e => { setBackendPinInput(e.target.value); setBackendAuthError(null) }}
                onKeyDown={e => { if (e.key === 'Enter') handleBackendAuthSubmit() }}
                aria-label="PIN Reward"
                className="parent-input"
                style={{ marginTop: '0.5rem', fontSize: '1rem', width: '100%', maxWidth: '200px' }}
              />
              <button
                type="button"
                onClick={handleBackendAuthSubmit}
                disabled={backendAuthBusy || !/^\d{6}$/.test(backendPinInput)}
                className="parent-btn-primary"
                style={{ marginTop: '0.5rem', width: '100%', maxWidth: '200px' }}
              >
                {backendAuthBusy ? 'Memeriksa…' : 'Buka Reward'}
              </button>
              {backendAuthError && (
                <p role="alert" style={{ color: '#d9534f', marginTop: '0.5rem', fontSize: '0.9rem' }}>{backendAuthError}</p>
              )}
            </div>
          )
        ) : (
          <div className="parent-reward-header-box">
            <span className="parent-status-badge parent-status-muted" data-testid="parent-access-status">
              Layanan reward tidak dikonfigurasi.
            </span>
          </div>
        )}
        {actionMessage && <p role="status" className="parent-alert-success">{actionMessage}</p>}

        {backendAuth === 'authenticated' && (
          <>
        <div className="parent-subcard">
          <div className="parent-subcard-header">
            <div>
              <h3 className="parent-subcard-title">Daftar Permintaan Penukaran</h3>
              <p className="parent-subcard-desc">Permintaan penukaran hadiah yang diajukan oleh anak.</p>
            </div>
          </div>
          {transactions.length === 0 ? (
            <p className="parent-subcard-empty">Belum ada permintaan penukaran bintang.</p>
          ) : (
            <ul className="parent-item-list">
              {transactions.map(tx => (
                <li key={tx.transactionId} className="parent-item-card">
                  <div className="parent-item-main">
                    <div className="parent-item-id"><strong>ID: {tx.transactionId}</strong></div>
                    <div className="parent-item-details">
                      <span>Bintang: {tx.starsRedeemed} (Rp {tx.rupiahValue.toLocaleString('id-ID')})</span>
                    </div>
                    <div className="parent-item-status-row">
                      Status: <span className={`parent-badge parent-badge-${tx.status}`}>{tx.status}</span>
                    </div>
                  </div>
                  {tx.status === 'pending' && (
                    <div className="parent-item-actions">
                      <button type="button" className="parent-btn-success" onClick={() => handleConfirm(tx.transactionId)}>Konfirmasi</button>
                      <button type="button" className="parent-btn-danger" onClick={() => handleCancel(tx.transactionId)}>Batalkan</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {config && (
          <div className="parent-subcard">
            <div className="parent-subcard-header">
              <div>
                <h3 className="parent-subcard-title">Pengaturan Nilai Tukar</h3>
                <p className="parent-subcard-desc">Aturan konversi nilai bintang dan batasan jumlah penukaran hadiah.</p>
              </div>
              {!isEditingConfig && (
                <button
                  type="button"
                  className="parent-btn-secondary"
                  onClick={() => setIsEditingConfig(true)}
                >
                  Ubah Pengaturan
                </button>
              )}
            </div>

            {!isEditingConfig ? (
              <div className="parent-config-content">
                <div className="parent-config-grid">
                  <div className="parent-stat-col">
                    <span className="parent-stat-col-label">Nilai Kurs</span>
                    <strong className="parent-stat-col-value">Rp {config.rupiahPerStar.toLocaleString('id-ID')}</strong>
                    <span className="parent-stat-col-sub">per 1 bintang</span>
                  </div>
                  <div className="parent-stat-col">
                    <span className="parent-stat-col-label">Min. Penukaran</span>
                    <strong className="parent-stat-col-value">{config.minStarsPerRedemption} ⭐</strong>
                    <span className="parent-stat-col-sub">bintang per klaim</span>
                  </div>
                  <div className="parent-stat-col">
                    <span className="parent-stat-col-label">Maks. Penukaran</span>
                    <strong className="parent-stat-col-value">{config.maxStarsPerRedemption} ⭐</strong>
                    <span className="parent-stat-col-sub">bintang per klaim</span>
                  </div>
                </div>
                <p className="parent-config-summary-note">
                  Nilai tukar saat ini: Rp {config.rupiahPerStar} per bintang (Min: {config.minStarsPerRedemption}, Max: {config.maxStarsPerRedemption})
                </p>
              </div>
            ) : (
              <div>
                <div className="parent-form-grid">
                  <label className="parent-form-field">
                    <span className="parent-field-label">Rp per bintang</span>
                    <div className="parent-input-affix-wrapper">
                      <span className="parent-input-prefix">Rp</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        className="parent-input"
                        value={configForm.rupiahPerStar}
                        onChange={e => setConfigForm(f => ({ ...f, rupiahPerStar: e.target.value }))}
                      />
                    </div>
                  </label>
                  <label className="parent-form-field">
                    <span className="parent-field-label">Min bintang per penukaran</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      className="parent-input"
                      value={configForm.minStarsPerRedemption}
                      onChange={e => setConfigForm(f => ({ ...f, minStarsPerRedemption: e.target.value }))}
                    />
                  </label>
                  <label className="parent-form-field">
                    <span className="parent-field-label">Max bintang per penukaran</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      className="parent-input"
                      value={configForm.maxStarsPerRedemption}
                      onChange={e => setConfigForm(f => ({ ...f, maxStarsPerRedemption: e.target.value }))}
                    />
                  </label>
                </div>
                <div className="parent-form-actions">
                  <button
                    type="button"
                    className="parent-btn-primary"
                    onClick={handleUpdateConfig}
                    disabled={configBusy}
                  >
                    {configBusy ? 'Menyimpan…' : 'Simpan Pengaturan'}
                  </button>
                  <button
                    type="button"
                    className="parent-btn-secondary"
                    onClick={() => { setIsEditingConfig(false); if (config) setConfigForm({ rupiahPerStar: String(config.rupiahPerStar), minStarsPerRedemption: String(config.minStarsPerRedemption), maxStarsPerRedemption: String(config.maxStarsPerRedemption) }) }}
                    disabled={configBusy}
                  >
                    Batal
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="parent-subcard">
          <div className="parent-subcard-header">
            <div>
              <h3 className="parent-subcard-title">Koreksi Saldo Manual</h3>
              <p className="parent-subcard-desc">
                Koreksi digunakan untuk memperbaiki saldo akibat kesalahan proses di luar aplikasi. Pilih transaksi yang sudah dikonfirmasi sebagai acuan.
              </p>
            </div>
          </div>
          {transactions.filter(tx => tx.status === 'confirmed').length === 0 ? (
            <p className="parent-subcard-empty">Tidak ada transaksi terkonfirmasi yang dapat dikoreksi.</p>
          ) : (
            <div>
              <div className="parent-form-grid">
                <label className="parent-form-field">
                  <span className="parent-field-label">Transaksi asal</span>
                  <select
                    className="parent-input"
                    value={correctionForm.originalTransactionId}
                    onChange={e => setCorrectionForm(f => ({ ...f, originalTransactionId: e.target.value }))}
                  >
                    <option value="">Pilih transaksi</option>
                    {transactions.filter(tx => tx.status === 'confirmed').map(tx => (
                      <option key={tx.transactionId} value={tx.transactionId}>
                        {tx.transactionId} – {tx.starsRedeemed} bintang
                      </option>
                    ))}
                  </select>
                </label>
                <label className="parent-form-field">
                  <span className="parent-field-label">Nominal koreksi (bintang)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    className="parent-input"
                    placeholder="Contoh: -2 atau +3"
                    value={correctionForm.starsDelta}
                    onChange={e => setCorrectionForm(f => ({ ...f, starsDelta: e.target.value }))}
                  />
                </label>
                <label className="parent-form-field">
                  <span className="parent-field-label">Alasan koreksi</span>
                  <input
                    type="text"
                    className="parent-input"
                    placeholder="Jelaskan alasan koreksi"
                    value={correctionForm.reason}
                    onChange={e => setCorrectionForm(f => ({ ...f, reason: e.target.value }))}
                  />
                </label>
              </div>
              <div className="parent-form-actions">
                <button
                  type="button"
                  className="parent-btn-primary"
                  onClick={handleApplyCorrection}
                  disabled={correctionBusy}
                >
                  {correctionBusy ? 'Menerapkan…' : 'Terapkan Koreksi'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="parent-subcard">
          <div className="parent-subcard-header">
            <div>
              <h3 className="parent-subcard-title">Riwayat Reward</h3>
              <p className="parent-subcard-desc">Catatan historis transaksi penukaran dan penyesuaian saldo bintang.</p>
            </div>
          </div>
          {transactions.length === 0 && corrections.length === 0 ? (
            <p className="parent-subcard-empty">Belum ada riwayat penukaran atau koreksi.</p>
          ) : (
            <>
              <div className="parent-filter-bar">
                <button
                  type="button"
                  className={`parent-filter-chip ${rewardFilter === 'all' ? 'parent-filter-chip-active' : ''}`}
                  onClick={() => { setRewardFilter('all'); setRewardPage(1); }}
                >
                  Semua ({transactions.length + corrections.length})
                </button>
                <button
                  type="button"
                  className={`parent-filter-chip ${rewardFilter === 'redemption' ? 'parent-filter-chip-active' : ''}`}
                  onClick={() => { setRewardFilter('redemption'); setRewardPage(1); }}
                >
                  Penukaran ({transactions.length})
                </button>
                <button
                  type="button"
                  className={`parent-filter-chip ${rewardFilter === 'correction' ? 'parent-filter-chip-active' : ''}`}
                  onClick={() => { setRewardFilter('correction'); setRewardPage(1); }}
                >
                  Koreksi ({corrections.length})
                </button>
              </div>

              {(() => {
                const allEntries = [
                  ...transactions.map(tx => ({ type: 'transaction' as const, tx })),
                  ...corrections.map(corr => ({ type: 'correction' as const, corr })),
                ]
                allEntries.sort((a, b) => {
                  const timeA = a.type === 'transaction' ? (a.tx.confirmedAt ?? a.tx.cancelledAt ?? a.tx.requestedAt) : a.corr.createdAt
                  const timeB = b.type === 'transaction' ? (b.tx.confirmedAt ?? b.tx.cancelledAt ?? b.tx.requestedAt) : b.corr.createdAt
                  return timeB - timeA
                })

                const filtered = allEntries.filter(entry => {
                  if (rewardFilter === 'redemption') return entry.type === 'transaction'
                  if (rewardFilter === 'correction') return entry.type === 'correction'
                  return true
                })

                if (filtered.length === 0) {
                  return <p className="parent-subcard-empty">Tidak ada riwayat untuk filter ini.</p>
                }

                const totalPages = Math.max(1, Math.ceil(filtered.length / REWARD_PAGE_SIZE))
                const safePage = Math.min(rewardPage, totalPages)
                const startIndex = (safePage - 1) * REWARD_PAGE_SIZE
                const paginated = filtered.slice(startIndex, startIndex + REWARD_PAGE_SIZE)

                return (
                  <>
                    <ul className="parent-item-list">
                      {paginated.map(entry => {
                        if (entry.type === 'transaction') {
                          const tx = entry.tx
                          return (
                            <li key={`tx-${tx.transactionId}`} className="parent-item-card">
                              <div className="parent-item-main">
                                <div className="parent-item-id"><strong>Penukaran – {tx.transactionId}</strong></div>
                                <div className="parent-item-details">Bintang: {tx.starsRedeemed} · Rp {tx.rupiahValue.toLocaleString('id-ID')}</div>
                                <div className="parent-item-status-row">Status: <span className={`parent-badge parent-badge-${tx.status}`}>{tx.status}</span></div>
                              </div>
                            </li>
                          )
                        }
                        const corr = entry.corr
                        return (
                          <li key={`corr-${corr.correctionId}`} className="parent-item-card parent-item-correction">
                            <div className="parent-item-main">
                                <div className="parent-item-id"><strong>Koreksi Saldo – {corr.correctionId}</strong></div>
                                <div className="parent-item-details">Nominal: {corr.starsDelta > 0 ? '+' : ''}{corr.starsDelta} bintang</div>
                                <div className="parent-item-status-row">Alasan: {corr.reason}</div>
                            </div>
                          </li>
                        )
                      })}
                    </ul>

                    {totalPages > 1 && (
                      <div className="parent-pagination">
                        <span className="parent-pagination-info">
                          Halaman {safePage} dari {totalPages} ({filtered.length} riwayat)
                        </span>
                        <div className="parent-pagination-actions">
                          <button
                            type="button"
                            className="parent-page-btn"
                            disabled={safePage <= 1}
                            onClick={() => setRewardPage(p => Math.max(1, p - 1))}
                          >
                            « Sebelumnya
                          </button>
                          <button
                            type="button"
                            className="parent-page-btn"
                            disabled={safePage >= totalPages}
                            onClick={() => setRewardPage(p => Math.min(totalPages, p + 1))}
                          >
                            Berikutnya »
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}
            </>
          )}
        </div>
          </>
        )}
      </section>
      )}

      {(activeTab === 'all' || activeTab === 'learning') && (
      <>
      {state.status === 'loading' && <section className="parent-dashboard-card" aria-busy="true"><p role="status">Memuat riwayat latihan…</p></section>}
      {state.status === 'error' && <section className="parent-dashboard-card parent-dashboard-error" role="alert"><p>{state.message}</p><button type="button" onClick={() => { setState({ status: 'loading' }); setAttempt(v => v + 1) }}>Coba lagi</button></section>}
      {state.status === 'ready' && state.records.length === 0 && <section className="parent-dashboard-card parent-dashboard-empty"><h2>Belum ada riwayat latihan</h2><p>Hasil sesi yang selesai akan tampil di sini.</p></section>}
      {state.status === 'ready' && state.records.length > 0 && <>
        <section className="parent-dashboard-card parent-dashboard-summary" aria-label="Ringkasan hasil">
          <div className="parent-dashboard-total"><span>Total sesi selesai</span><strong>{state.records.length}</strong></div>
          <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.9rem' }}>
            <div><span>Regular</span><br/><strong>{state.records.filter(r => r.mode === 'regular').length}</strong></div>
            <div><span>Tantangan</span><br/><strong>{state.records.filter(r => r.mode === 'challenge').length}</strong></div>
          </div>
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #ddd' }}>
            <p><strong>Rata-rata per sesi</strong></p>
            <p style={{ margin: '0.25rem 0', fontSize: '0.9rem' }}>Regular: {percent(average(state.records.filter(item => item.mode === 'regular')))}</p>
            <p style={{ margin: '0.25rem 0', fontSize: '0.9rem' }}>Tantangan: {percent(average(state.records.filter(item => item.mode === 'challenge')))}</p>
          </div>
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #ddd' }}>
            <p><strong>Akurasi keseluruhan</strong> {percent(overallAccuracy(state.records))}</p>
            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem', color: '#666' }}>
              Benar: {totalCorrectFull(state.records)} + Benar sebagian: {totalCorrectPartial(state.records)} = Total {totalQuestionsAnswered(state.records)} soal
            </p>
          </div>
          <small style={{ marginTop: '1rem', display: 'block', color: '#666' }}>Rata-rata per sesi = total poin soal ÷ jumlah soal × 100. Akurasi keseluruhan = total jawaban benar ÷ total soal × 100.</small>
        </section>

        <section className="parent-dashboard-card" aria-labelledby="level-stats-title">
          <h2 id="level-stats-title" style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Statistik Per Level</span>
          </h2>
          {accuracyByLevel(state.records).length === 0 ? (
            <p style={{ color: '#666', fontSize: '0.9rem' }}>Data per level tidak tersedia.</p>
          ) : (
            <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.75rem' }}>
              {accuracyByLevel(state.records).map(stats => (
                <div key={stats.level} className="parent-stat-tile">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <strong>Level {stats.level}</strong>
                    <span style={{ fontSize: '0.85rem', color: '#666' }}>{stats.count} sesi</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <div>Rata-rata: <strong>{percent(stats.avgScore)}</strong></div>
                    <div>Akurasi: <strong>{percent(stats.accuracy)}</strong></div>
                  </div>
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#666' }}>✓ {stats.correct} · ✗ {stats.incorrect}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {accuracyByOperation(state.records).some(op => op.count >= 5) && (
          <section className="parent-dashboard-card" aria-labelledby="operation-stats-title">
            <h2 id="operation-stats-title">Statistik Per Operasi</h2>
            <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.75rem' }}>
              {accuracyByOperation(state.records).filter(op => op.count >= 5).map(stats => (
                <div key={stats.operation} className="parent-stat-tile">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <strong>{stats.operation}</strong>
                    <span style={{ fontSize: '0.85rem', color: '#666' }}>{stats.count} soal</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <div>Akurasi: <strong>{percent(stats.accuracy)}</strong></div>
                    <div>Benar: <strong>{stats.correct}</strong></div>
                  </div>
                </div>
              ))}
            </div>
            <small style={{ marginTop: '1rem', display: 'block', color: '#666' }}>Hanya operasi dengan ≥5 soal ditampilkan untuk akurasi yang dapat dipercaya.</small>
          </section>
        )}
        <section className="parent-dashboard-card" aria-labelledby="parent-chart-title">
          <h2 id="parent-chart-title">10 sesi terakhir</h2><p className="parent-dashboard-chart-note">Persentase nilai tiap sesi</p>
          <div className="parent-dashboard-chart-wrap"><svg className="parent-dashboard-chart" viewBox="0 0 360 150" role="img" aria-label="Grafik hasil dari 10 sesi terakhir">
            <line x1="22" y1="122" x2="352" y2="122" stroke="currentColor" strokeWidth="1" />
            {state.records.slice(0, 10).slice().reverse().map((item, index, rows) => {
              const value = scorePercent(item), x = 30 + index * (320 / Math.max(1, rows.length)), height = value === null || value === 0 ? 2 : value * 0.9
              const title = value === null ? 'Belum ada soal selesai' : `${item.mode === 'regular' ? 'Regular' : 'Tantangan'}: ${Math.round(value)}%`
              return <g key={item.instanceId}><rect x={x} y={120 - height} width="20" height={height} rx="4" fill={item.mode === 'regular' ? '#347f9d' : '#e69b39'}><title>{title}</title></rect><text x={x + 10} y="140" textAnchor="middle" fontSize="9">{index + 1}</text></g>
            })}
          </svg></div><p className="parent-dashboard-chart-note">Biru: Regular · Oranye: Tantangan. Urutan: lama ke baru</p>
        </section>
        <section className="parent-dashboard-card" aria-labelledby="parent-history-title"><h2 id="parent-history-title">Riwayat sesi</h2><ol className="parent-dashboard-history">
          {state.records.map(item => {
            const date = sessionDate(item), value = scorePercent(item)
            const correctFull = correctFullCount(item), correctPartial = correctPartialCount(item), incorrect = incorrectCount(item)
            const total = plannedCount(item)
            return <li key={item.instanceId} data-instance-id={item.instanceId}>
              <div className="parent-dashboard-history-top"><strong>{item.mode === 'regular' ? 'Regular' : 'Tantangan'}</strong><strong>{percent(value)}</strong></div><p>{date.label}: {date.text}</p>
              {item.historySchemaVersion === 2 && item.endReason === 'timeout' && <p role="status">Waktu Habis</p>}
              <p className="parent-dashboard-session-detail">
                <span className="detail-correct-full" title="Benar (poin penuh)">✓ {correctFull}</span>
                {correctPartial > 0 && <span className="detail-correct-partial" title="Benar sebagian (0.5 poin)">~ {correctPartial}</span>}
                <span className="detail-incorrect" title="Salah">✗ {incorrect}</span>
                <span className="detail-completed">{completedCount(item)}/{total} soal selesai</span>
              </p>
            </li> })}
        </ol></section>
      </>}
      </>
      )}

      {confirmAction && (
        <div className="parent-modal-overlay" onClick={() => setConfirmAction(null)}>
          <div className="parent-modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="parent-modal-title">Konfirmasi Tindakan</h3>
            <p className="parent-modal-message">
              {confirmAction.type === 'confirm'
                ? `Apakah Anda yakin ingin mengonfirmasi transaksi ${confirmAction.txId}? Saldo bintang akan berkurang.`
                : `Apakah Anda yakin ingin membatalkan transaksi ${confirmAction.txId}? Transaksi akan ditandai sebagai dibatalkan.`
              }
            </p>
            <div className="parent-modal-actions">
              <button type="button" className="parent-btn-secondary" onClick={() => setConfirmAction(null)}>Batal</button>
              <button
                type="button"
                className={confirmAction.type === 'confirm' ? 'parent-btn-success' : 'parent-btn-danger'}
                onClick={executeAction}
              >
                {confirmAction.type === 'confirm' ? 'Konfirmasi' : 'Batalkan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
