import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createSessionController } from './persistence/sessionController'
import type { SessionControllerState, SessionControllerOptions } from './persistence/sessionController'
import CompletionStatus from './CompletionStatus'
import { createIndexedDbSessionStore } from './persistence/indexedDbSessionStore'
import { generateSession, getScoreMetrics, validateRequest } from './domain'
import type { DrillLevel, Level5Sublevel, OperationMode } from './domain'
import './math-drill.css'
import ChallengeApp, { type ChallengeConfiguration } from './ChallengeApp'
import SessionCountdown from './SessionCountdown'
import { SessionRewardStars } from './SessionRewardStars'
import SessionDurationControl from './SessionDurationControl'
import { loadSessionDurationPreference, saveSessionDurationPreference } from './persistence/sessionTimer'
import type { SessionDurationMs } from './persistence/sessionTimer'

type Screen = 'configure' | 'question' | 'round' | 'result'
type Feedback = 'idle' | 'retry' | 'completed'

const presetCounts = [10, 20, 30, 50, 100] as const
const modeNames: Record<OperationMode, string> = { addition: 'Penjumlahan', subtraction: 'Pengurangan', mixed: 'Campuran' }

function freshSeed(previous: number | null): number {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return previous === values[0] ? (values[0] + 1) >>> 0 : values[0]
}

function freshInstanceId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

class RegularOwner {
  readonly store
  readonly controller
  constructor(factory?: () => SessionControllerOptions) {
    const options = factory?.() ?? { store: createIndexedDbSessionStore() }
    this.store = options.store
    this.controller = createSessionController(options)
  }
  active = true
  private loaded = false

  loadOnce() {
    if (!this.active || this.loaded) return
    this.loaded = true
    void this.controller.load('regular')
  }
}
const initialControllerState: SessionControllerState = { status: 'loading', mode: 'regular' }

function releaseOwner(owner: RegularOwner) {
  if (!owner.active) return
  owner.active = false
  owner.controller.dispose()
  // close() allows active transactions to finish; it does not promise cancellation.
  owner.store.close()
}

function useRegularPersistence(enabled: boolean, factory?: () => SessionControllerOptions) {
  const [owner, setOwner] = useState<RegularOwner | null>(null)
  useEffect(() => {
    if (!enabled) return
    const next = new RegularOwner(factory)
    // Publish only after StrictMode's synchronous setup/cleanup replay has settled.
    queueMicrotask(() => { if (next.active) setOwner(next) })
    return () => releaseOwner(next)
  }, [enabled, factory])
  useEffect(() => {
    if (enabled) owner?.loadOnce()
  }, [enabled, owner])
  const subscribe = useCallback((listener: () => void) => {
    if (!enabled || !owner?.active) return () => undefined
    return owner.controller.subscribe(listener)
  }, [enabled, owner])
  const getSnapshot = useCallback(() => enabled && owner?.active ? owner.controller.getState() : initialControllerState, [enabled, owner])
  const state = useSyncExternalStore(subscribe, getSnapshot)
  return { state, controller: enabled && owner?.active ? owner.controller : null, release: () => { if (owner) releaseOwner(owner) } }
}

export default function MathDrillApp({ onExit, persistenceFactory }: { onExit: () => void; persistenceFactory?: () => SessionControllerOptions }) {
  const [isChallenge, setIsChallenge] = useState(false)
  const [challengeConfiguration, setChallengeConfiguration] = useState<ChallengeConfiguration>({ selectedLevels: [1], selectedLevel5Sublevels: [], mode: 'mixed', count: 10 })
  const [challengeConfigurationOpen, setChallengeConfigurationOpen] = useState(false)
  const { state: persistenceState, controller, release } = useRegularPersistence(!isChallenge, persistenceFactory)
  const [level, setLevel] = useState<DrillLevel>(1)
  const [level5Sublevel, setLevel5Sublevel] = useState<Level5Sublevel>('dasar')
  const [mode, setMode] = useState<OperationMode>('mixed')
  const [countText, setCountText] = useState('10')
  const [sessionDuration, setSessionDuration] = useState<SessionDurationMs>(() => loadSessionDurationPreference())
  const [durationValid, setDurationValid] = useState(true)
  const [view, setView] = useState<'menu' | 'configure' | 'play'>('menu')
  const [confirmExit, setConfirmExit] = useState(false)
  const [generationError, setGenerationError] = useState('')
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [confirmConflict, setConfirmConflict] = useState<'reload' | 'exit' | null>(null)
  const [reloadingLatest, setReloadingLatest] = useState(false)
  const lastSeed = useRef<number | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const choicesRef = useRef<HTMLDivElement | null>(null)
  const snapshot = 'snapshot' in persistenceState && persistenceState.snapshot.mode === 'regular' ? persistenceState.snapshot : null
  const session = snapshot?.session ?? null
  const score = snapshot?.score ?? null
  const questionIndex = snapshot?.cursor.questionIndex ?? 0
  const phase = snapshot?.cursor.phase
  const pendingStart = 'operation' in persistenceState && persistenceState.operation !== 'save'
  const screen: Screen = view !== 'play' || !snapshot || pendingStart ? 'configure' : phase === 'round' ? 'round' : phase === 'result' || phase === 'timeout' ? 'result' : 'question'
  const feedback: Feedback = phase === 'retry-prompt' ? 'retry' : phase === 'auto-advance' || phase === 'manual-advance' ? 'completed' : 'idle'
  const blocked = persistenceState.status !== 'ready'
  const canConfigure = persistenceState.status === 'empty' || persistenceState.status === 'ready'

  const count = countText.trim() === '' ? NaN : Number(countText)
  const validation = validateRequest({ level, mode, count, ...(level === 5 ? { level5Sublevel } : {}) })
  const current = session?.questions[questionIndex]
  const response = current && score?.responses[current.key]
  const metrics = session && score ? getScoreMetrics(score, session) : null
  const roundNumber = session ? Math.floor(questionIndex / session.roundSize) + 1 : 1

  useEffect(() => { saveSessionDurationPreference(sessionDuration) }, [sessionDuration])

  useEffect(() => {
    if (reloadingLatest && persistenceState.status !== 'loading' && persistenceState.status !== 'conflict' && persistenceState.status !== 'completion') setReloadingLatest(false)
  }, [reloadingLatest, persistenceState.status])

  function reloadLatest() {
    setReloadingLatest(true)
    setView('menu')
    void controller?.reloadFromStorage('regular')
  }

  function returnToDrillSetup() {
    controller?.dismissInvalidCompletion()
    setView('configure')
  }

  useEffect(() => {
    if (!confirmExit && screen !== 'configure') headingRef.current?.focus()
  }, [screen, questionIndex, confirmExit])

  useEffect(() => {
    if (screen === 'question' && feedback === 'idle' && response?.status === 'awaiting-second-attempt') {
      choicesRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    }
  }, [feedback, screen, response?.status])

  function startSession(confirmed = false) {
    if (!validation.ok || !durationValid || !controller || !canConfigure) return
    if (snapshot && !confirmed) { setConfirmReplace(true); return }
    const seed = freshSeed(lastSeed.current)
    const generated = generateSession({ level, mode, count, seed, ...(level === 5 ? { level5Sublevel } : {}) })
    if (!generated.ok) {
      setGenerationError(`${generated.error.message} Kapasitas: ${generated.error.capacity} soal.`)
      return
    }
    lastSeed.current = seed
    setGenerationError('')
    setConfirmReplace(false)
    setView('play')
    if (persistenceState.status === 'ready') {
      const saved = persistenceState.snapshot
      void controller.replaceSession(generated.session, freshInstanceId(), { instanceId: saved.instanceId, sessionId: saved.sessionId, revision: saved.revision }, sessionDuration)
    } else void controller.startSession(generated.session, freshInstanceId(), sessionDuration)
  }

  function submitAnswer(index: number) {
    if (!confirmExit && !blocked) void controller?.submitAnswer(index)
  }

  function readyForRetry() { if (!blocked) void controller?.enableRetry() }
  function advance() { if (!blocked) void controller?.advanceManual() }
  function nextRound() { if (!blocked) void controller?.continueRound() }

  function exit() {
    if (persistenceState.status === 'conflict') setConfirmConflict('exit')
    else if (screen === 'question' || screen === 'round' || persistenceState.status === 'saving' || persistenceState.status === 'failed' || persistenceState.status === 'completion') setConfirmExit(true)
    else leave()
  }

  function leave() { release(); onExit() }

  function restart() {
    setLevel5Sublevel('dasar')
    setGenerationError('')
    setView('configure')
  }

  if (isChallenge) return <ChallengeApp persistenceFactory={persistenceFactory} onExit={onExit} onBackToRegular={() => setIsChallenge(false)} configuration={challengeConfiguration} onConfigurationChange={setChallengeConfiguration} configurationOpen={challengeConfigurationOpen} onConfigurationOpenChange={setChallengeConfigurationOpen} />

  if (confirmConflict) return (
    <main className="drill-shell"><section className="drill-card drill-confirm" role="alertdialog" aria-modal="true" aria-labelledby="conflict-title" aria-describedby="conflict-description">
      <h2 id="conflict-title">Buang perubahan lokal?</h2>
      <p id="conflict-description">Perubahan lokal yang belum tersimpan akan dibuang. Sesi di penyimpanan tidak akan ditimpa.</p>
      <div className="drill-actions">
        <button type="button" className="drill-primary" autoFocus onClick={() => setConfirmConflict(null)}>Batal</button>
        <button type="button" className="drill-secondary" onClick={() => {
          const action = confirmConflict
          setConfirmConflict(null)
          if (action === 'exit') leave()
          else reloadLatest()
        }}>Ya, Buang Perubahan</button>
      </div>
    </section></main>
  )

  if (confirmReplace) return (
    <main className="drill-shell"><section className="drill-card drill-confirm" role="alertdialog" aria-modal="true" aria-labelledby="replace-title">
      <h2 id="replace-title">Yakin akan memulai sesi baru?</h2>
      <div className="drill-actions">
        <button type="button" className="drill-primary" autoFocus onClick={() => setConfirmReplace(false)}>Batal</button>
        <button type="button" className="drill-secondary" disabled={blocked} onClick={() => startSession(true)}>Ya, Mulai Baru</button>
      </div>
    </section></main>
  )

  if (confirmExit) return (
    <main className="drill-shell">
      <section className="drill-card drill-confirm" role="alertdialog" aria-modal="true" aria-labelledby="drill-exit-title" aria-describedby="drill-exit-description">
        <h2 id="drill-exit-title">Keluar dari latihan?</h2>
        <p id="drill-exit-description">{persistenceState.status === 'saving' || persistenceState.status === 'completion' ? 'Penyimpanan masih berlangsung. Jika keluar, perubahan terakhir belum dapat dipastikan tersimpan. Transaksi yang berjalan mungkin tetap selesai; sesi akan dimuat ulang saat kembali.' : persistenceState.status === 'failed' ? 'Perubahan terakhir belum tersimpan dan akan hilang jika keluar. Sesi yang sudah tersimpan tidak dihapus.' : 'Progres yang sudah tersimpan tetap tersedia saat kamu kembali.'}</p>
        <div className="drill-actions">
          <button type="button" className="drill-primary" autoFocus onClick={() => setConfirmExit(false)}>Tetap latihan</button>
          <button type="button" className="drill-secondary" onClick={leave}>Ya, keluar</button>
        </div>
      </section>
    </main>
  )

  return (
    <main className="drill-shell">
      <div className="drill-topline">
        <span className="drill-brand">Math Adventure · Latihan</span>
        {screen === 'configure' && !(reloadingLatest && persistenceState.status === 'loading') && persistenceState.status !== 'saving' && persistenceState.status !== 'failed' && persistenceState.status !== 'conflict' && persistenceState.status !== 'completion' && <div className="drill-mode-switch" role="group" aria-label="Pilih mode">
          <button type="button" aria-pressed={!isChallenge} onClick={() => setIsChallenge(false)}>Latihan Biasa</button>
          <button type="button" aria-pressed={isChallenge} onClick={() => setIsChallenge(true)}>Tantangan Campuran</button>
        </div>}
        <button type="button" className="drill-back" onClick={exit}>Kembali</button>
      </div>

      {view === 'menu' && persistenceState.status === 'ready' && snapshot && <section className="drill-card" aria-labelledby="saved-title">
        <h1 id="saved-title">Sesi latihan tersimpan</h1>
        <p>{phase === 'timeout' ? 'Waktu sesi habis.' : phase === 'result' ? 'Latihan terakhir sudah selesai.' : 'Ada latihan yang dapat dilanjutkan.'}</p>
        <div className="drill-actions">
          <button type="button" className="drill-primary" onClick={() => setView('play')}>{phase === 'result' || phase === 'timeout' ? 'Lihat Hasil Terakhir' : 'Lanjutkan'}</button>
          <button type="button" className="drill-secondary" onClick={restart}>Mulai Baru</button>
        </div>
      </section>}
      {persistenceState.status === 'unrecoverable' && <section className="drill-card drill-error" role="alert">
        <h2>Sesi tersimpan tidak dapat dibuka</h2>
        <p>{persistenceState.result.status === 'unsupported-version' ? 'Versi sesi belum didukung aplikasi ini.' : 'Data sesi tidak valid.'} Data tidak dihapus atau diganti. Kembali ke menu atau pilih mode lain.</p>
        <button type="button" className="drill-secondary" onClick={leave}>Kembali ke Menu</button>
      </section>}
      {persistenceState.status === 'conflict' && <section className="drill-card drill-error" role="alert">
        <h2>Sesi telah berubah di tab lain</h2>
        <p>Progres lokal belum tersimpan. Jangan lanjutkan sampai memilih sesi yang akan digunakan.</p>
        <div className="drill-actions">
          <button type="button" className="drill-primary" onClick={() => setConfirmConflict('reload')}>Muat Sesi Terbaru</button>
          <button type="button" className="drill-secondary" onClick={() => setConfirmConflict('exit')}>Kembali ke Menu</button>
        </div>
      </section>}
      {persistenceState.status === 'failed' && <section className="drill-card drill-error" role="alert">
        <h2>Belum tersimpan</h2>
        <p>{persistenceState.operation === 'load' ? 'Sesi belum dapat dimuat. Jangan mulai latihan sebelum penyimpanan dapat diperiksa.' : 'Perubahan terakhir belum tersimpan. Latihan ditahan; coba simpan lagi atau keluar dengan kehilangan perubahan lokal.'}</p>
        <button type="button" className="drill-primary" onClick={() => { if (persistenceState.operation === 'load') void controller?.reloadFromStorage('regular'); else void controller?.retryPendingSave() }}>{persistenceState.operation === 'load' ? 'Coba Muat Lagi' : 'Coba Simpan Lagi'}</button>
        <button type="button" className="drill-secondary" onClick={() => setConfirmExit(true)}>Kembali ke Menu</button>
      </section>}
      {persistenceState.status === 'completion' && <CompletionStatus state={persistenceState} onRetry={() => void controller?.retryPendingSave()} onVerify={() => void controller?.verifyPendingCompletion()} onReload={reloadLatest} onDismiss={returnToDrillSetup} />}
      {persistenceState.status === 'saving' && persistenceState.operation !== 'save' && <p role="status" aria-live="polite">Menyimpan…</p>}
      {persistenceState.status === 'loading' && <section className="drill-card" aria-busy="true"><p role="status">Memuat sesi latihan…</p></section>}
      {screen === 'configure' && persistenceState.status !== 'loading' && persistenceState.status !== 'unrecoverable' && persistenceState.status !== 'conflict' && persistenceState.status !== 'failed' && persistenceState.status !== 'completion' && (canConfigure || (view === 'menu' && !snapshot)) && (view === 'configure' || persistenceState.status === 'empty' || (view === 'menu' && !snapshot)) && (
        <section className="drill-card" aria-labelledby="drill-title">
          <p className="drill-kicker">ATUR LATIHAN</p>
          <h1 id="drill-title">Math Drill</h1>
          <p className="drill-muted">Pilih latihanmu. Tidak ada batas waktu.</p>
          <div className="drill-form">
            <label>Level
              <select value={level} onChange={event => { setLevel(Number(event.target.value) as DrillLevel); setLevel5Sublevel('dasar'); setGenerationError('') }}>
                {[1, 2, 3, 4, 5].map(value => <option value={value} key={value}>Level {value}{value === 5 ? ' · Cari Angka' : ''}</option>)}
              </select>
            </label>
            {level === 5 && <label>Sublevel
              <select value={level5Sublevel} onChange={event => { setLevel5Sublevel(event.target.value as Level5Sublevel); setGenerationError('') }}>
                <option value="dasar">Dasar · 1–10</option>
                <option value="menengah">Menengah · 1–20</option>
                <option value="lanjutan">Lanjutan</option>
              </select>
            </label>}
            <label>Operasi
              <select value={mode} onChange={event => { setMode(event.target.value as OperationMode); setGenerationError('') }}>
                {Object.entries(modeNames).map(([value, name]) => <option value={value} key={value}>{name}</option>)}
              </select>
            </label>
            <div className="drill-preset-label">Jumlah cepat</div>
            <div className="drill-presets" role="group" aria-label="Jumlah cepat">
              {presetCounts.map(value => <button type="button" key={value} aria-pressed={countText === String(value)} onClick={() => { setCountText(String(value)); setGenerationError('') }}>{value} soal</button>)}
            </div>
            <label>Jumlah custom
              <input inputMode="numeric" type="number" min="1" max="500" step="1" value={countText} onChange={event => { setCountText(event.target.value); setGenerationError('') }} />
            </label>
            <SessionDurationControl value={sessionDuration} onChange={setSessionDuration} onValidityChange={setDurationValid} />
          </div>
          {!validation.ok && <p role="alert" className="drill-error">{validation.error.message} Kapasitas: {validation.error.capacity} soal.</p>}
          {generationError && <p role="alert" className="drill-error">{generationError}</p>}
          <button type="button" className="drill-primary drill-wide" disabled={!validation.ok || !durationValid || !canConfigure} onClick={() => startSession()}>Mulai latihan</button>
          <p className="drill-footnote">Progres yang berhasil disimpan tersedia kembali di browser ini.</p>
        </section>
      )}

      {screen === 'question' && session && current && (
        <section className="drill-card drill-question" aria-labelledby="drill-question-title">
          <div className="drill-progress">
            <span>Soal <strong>{questionIndex + 1} / {session.questions.length}</strong></span>
            {snapshot?.schemaVersion === 2 && <SessionCountdown snapshot={snapshot} />}
            <span>Ronde {roundNumber} / {session.rounds.length}</span>
          </div>
          <progress value={questionIndex + (response?.status === 'completed' ? 1 : 0)} max={session.questions.length} aria-label="Progres latihan" />
          <h1 id="drill-question-title" ref={headingRef} tabIndex={-1} className="drill-instruction">Berapa jawabannya?</h1>
          <p className="drill-equation" data-testid="equation" aria-label={`Soal: ${current.prompt.replace('□', 'kotak kosong')}`}><bdi>{current.prompt.includes('□') ? <>{current.prompt.split('□')[0]}<span className="drill-blank" aria-hidden="true" />{current.prompt.split('□')[1]}</> : current.prompt}</bdi></p>
          <div ref={choicesRef} className="drill-choices" role="group" aria-label="Pilihan jawaban">
            {current.choices.map((choice, index) => <button type="button" key={`${current.key}:${index}`} disabled={blocked || feedback !== 'idle' || response?.attempts.includes(index)} onClick={() => submitAnswer(index)} aria-label={`Jawaban ${choice}`} className="drill-choice">{choice}</button>)}
          </div>
          <div className="drill-feedback" role="status" aria-live="polite">
            {feedback === 'retry' && <span>Coba lagi. Kamu masih punya satu kesempatan.</span>}
            {feedback === 'completed' && response && (response.points === 0 ? <span>Jawaban yang benar: <strong>{current.answer}</strong></span> : <span>Benar!</span>)}
          </div>
          {feedback === 'retry' && <button type="button" className="drill-primary drill-wide" disabled={blocked} onClick={readyForRetry}>Coba lagi</button>}
          {feedback === 'completed' && response?.points === 0 && <button type="button" className="drill-primary drill-wide" disabled={blocked} onClick={advance}>Lanjut</button>}
        </section>
      )}

      {screen === 'round' && session && (
        <section className="drill-card drill-transition" aria-labelledby="drill-round-title">
          <div className="drill-card-header-bar">
            <p className="drill-kicker">RONDE {roundNumber}</p>
            {snapshot?.schemaVersion === 2 && <SessionCountdown snapshot={snapshot} />}
          </div>
          <h1 id="drill-round-title" ref={headingRef} tabIndex={-1}>Ronde selesai</h1>
          <p className="drill-muted">Kamu sudah mengerjakan {questionIndex + 1} soal. Siap untuk ronde berikutnya?</p>
          <button type="button" className="drill-primary drill-wide" disabled={blocked} onClick={nextRound}>Lanjut ronde</button>
        </section>
      )}

      {screen === 'result' && session && metrics && (
        <section className="drill-card drill-result" aria-labelledby="drill-result-title">
          <p className="drill-kicker">{phase === 'timeout' ? 'WAKTU HABIS' : 'LATIHAN SELESAI'}</p>
          <h1 id="drill-result-title" ref={headingRef} tabIndex={-1}>{phase === 'timeout' ? 'Waktu habis' : 'Latihan selesai'}</h1>
          <p className="drill-muted">{phase === 'timeout' ? 'Sesi berakhir otomatis. Jawab soal berikutnya pada sesi lain.' : 'Terima kasih sudah mencoba dan berlatih.'}</p>
          <SessionRewardStars
            mode="regular"
            plannedCount={metrics.planned}
            completedCount={metrics.completed}
            totalPoints={metrics.firstTryCorrect + 0.5 * metrics.secondTryCorrect}
            isTimeout={phase === 'timeout'}
            snapshot={snapshot}
          />
          <div className="drill-score"><span>Skor latihan</span><strong data-testid="weighted-score">{Math.round(metrics.weightedScore)}%</strong></div>
          <dl className="drill-metrics">
            <div><dt>Soal selesai</dt><dd data-testid="completed">{metrics.completed} dari {metrics.planned}</dd></div>
            <div><dt>Benar sekali coba</dt><dd data-testid="first-try-correct">{metrics.firstTryCorrect}</dd></div>
            <div><dt>Benar setelah mencoba lagi</dt><dd data-testid="second-try-correct">{metrics.secondTryCorrect}</dd></div>
            <div><dt>Belum tepat setelah dua coba</dt><dd data-testid="wrong-twice">{metrics.wrongTwice}</dd></div>
            <div><dt>Akurasi percobaan pertama</dt><dd>{Math.round(metrics.firstTryAccuracy)}%</dd></div>
          </dl>
          <div className="drill-actions">
            <button type="button" className="drill-primary" disabled={blocked} onClick={restart}>Latihan lagi</button>
            <button type="button" className="drill-secondary" onClick={exit}>Kembali</button>
          </div>
        </section>
      )}
    </main>
  )
}
