import type { SavedSessionV2 } from './persistence/sessionTypes'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createSessionController } from './persistence/sessionController'
import type { SessionControllerState, SessionControllerOptions } from './persistence/sessionController'
import CompletionStatus from './CompletionStatus'
import SessionCountdown from './SessionCountdown'
import { SessionRewardStars } from './SessionRewardStars'
import SessionDurationControl from './SessionDurationControl'
import { loadSessionDurationPreference, saveSessionDurationPreference } from './persistence/sessionTimer'
import type { SessionDurationMs } from './persistence/sessionTimer'
import { createIndexedDbSessionStore } from './persistence/indexedDbSessionStore'
import { generateChallengeSession, getChallengeCapacity, getChallengeSummary, validateChallengeRequest } from './domain'
import type { ChallengeCapacity, ChallengeError, ChallengeMetrics, ChallengeRate, ChallengeRequest, ChallengeSession, DrillLevel, Level5Sublevel, Operation, OperationMode, ScoreState } from './domain'

type Screen = 'configure' | 'question' | 'round' | 'result'
type Feedback = 'idle' | 'retry' | 'completed'
const levels: readonly DrillLevel[] = [1, 2, 3, 4, 5]
const sublevels: readonly Level5Sublevel[] = ['dasar', 'menengah', 'lanjutan']
const counts = [10, 20, 30, 50] as const
const operations: readonly Operation[] = ['addition', 'subtraction']
const level5Names: Record<Level5Sublevel, string> = { dasar: 'Dasar', menengah: 'Menengah', lanjutan: 'Lanjutan' }
const operationNames: Record<Operation, string> = { addition: 'Tambah', subtraction: 'Kurang' }
const modeNames: Record<OperationMode, string> = { addition: 'Tambah', subtraction: 'Kurang', mixed: 'Campuran' }
function makeSeed() { const values = new Uint32Array(1); crypto.getRandomValues(values); return values[0] }
function makeInstanceId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

class ChallengeOwner {
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
    void this.controller.load('challenge')
  }
}
const initialControllerState: SessionControllerState = { status: 'loading', mode: 'challenge' }
function releaseOwner(owner: ChallengeOwner) {
  if (!owner.active) return
  owner.active = false
  owner.controller.dispose()
  // close() does not cancel an IndexedDB transaction already in progress.
  owner.store.close()
}
function useChallengePersistence(factory?: () => SessionControllerOptions) {
  const [owner, setOwner] = useState<ChallengeOwner | null>(null)
  useEffect(() => {
    const next = new ChallengeOwner(factory)
    queueMicrotask(() => { if (next.active) setOwner(next) })
    return () => releaseOwner(next)
  }, [factory])
  useEffect(() => { owner?.loadOnce() }, [owner])
  const subscribe = useCallback((listener: () => void) => owner?.active ? owner.controller.subscribe(listener) : () => undefined, [owner])
  const getSnapshot = useCallback(() => owner?.active ? owner.controller.getState() : initialControllerState, [owner])
  const state = useSyncExternalStore(subscribe, getSnapshot)
  return { state, controller: owner?.active ? owner.controller : null, release: () => { if (owner) releaseOwner(owner) } }
}
function formatNumber(value: number) { return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value) }
function formatPercent(rate: ChallengeRate) { return rate.value === null ? 'N/A' : `${Math.round(rate.value)}%` }
function formatPoints(rate: ChallengeRate) { return rate.value === null ? 'N/A' : `${formatNumber(rate.numerator)} dari ${formatNumber(rate.denominator)} poin` }
function friendlyConfigurationError(error: ChallengeError, count: number, capacity: ChallengeCapacity) {
  if (error.code === 'MISSING_SUBLEVEL') return { title: 'Pilih sublevel Cari Angka', body: 'Pilih setidaknya satu sublevel Cari Angka sebelum melanjutkan.', recommendation: undefined }
  if (error.code === 'INVALID_LEVELS') return { title: 'Pilih level', body: 'Pilih satu atau lebih level untuk tantangan ini.', recommendation: undefined }
  if (error.code === 'INVALID_SUBLEVELS') return { title: 'Periksa pilihan Cari Angka', body: 'Sublevel Cari Angka hanya dapat dipilih bersama Level 5. Pilih Level 5 atau hapus sublevel tersebut.', recommendation: undefined }
  if (error.code !== 'INSUFFICIENT_CAPACITY' && error.code !== 'UNSATISFIABLE_ALLOCATION') return { title: 'Tantangan belum siap', body: 'Coba ubah pilihan level, sublevel Cari Angka, atau operasi.', recommendation: undefined }
  const recommendation = capacity.feasibleCounts.find(value => value > count) ?? [...capacity.feasibleCounts].reverse().find(value => value < count)
  if (recommendation !== undefined) {
    const canAdd = recommendation > count
    return {
      title: canAdd ? 'Jumlah soal belum cukup' : 'Jumlah soal terlalu banyak',
      body: canAdd
        ? `Kamu memilih banyak level untuk dimainkan. Pilih ${recommendation} soal agar semuanya bisa muncul.`
        : `Untuk pilihan ini, coba ${recommendation} soal agar tantangan bisa dimainkan.`,
      recommendation,
    }
  }
  return { title: 'Pilihan belum bisa dimainkan', body: 'Coba ubah level, sublevel Cari Angka, atau operasi yang dipilih.', recommendation: undefined }
}

export type ChallengeConfiguration = { selectedLevels: DrillLevel[]; selectedLevel5Sublevels: Level5Sublevel[]; mode: OperationMode; count: (typeof counts)[number] }

export default function ChallengeApp({ onExit, onBackToRegular, configuration, onConfigurationChange, configurationOpen = false, onConfigurationOpenChange, persistenceFactory }: { onExit: () => void; onBackToRegular: () => void; configuration?: ChallengeConfiguration; onConfigurationChange?: (configuration: ChallengeConfiguration) => void; configurationOpen?: boolean; onConfigurationOpenChange?: (open: boolean) => void; persistenceFactory?: () => SessionControllerOptions }) {
  const { state: persistenceState, controller, release } = useChallengePersistence(persistenceFactory)
  const [selectedLevels, setSelectedLevels] = useState<DrillLevel[]>(() => configuration?.selectedLevels ?? [1])
  const [selectedSublevels, setSelectedSublevels] = useState<Level5Sublevel[]>(() => configuration?.selectedLevel5Sublevels ?? [])
  const [mode, setMode] = useState<OperationMode>(() => configuration?.mode ?? 'mixed')
  const [count, setCount] = useState<(typeof counts)[number]>(() => configuration?.count ?? 10)
  const [sessionDuration, setSessionDuration] = useState<SessionDurationMs>(() => loadSessionDurationPreference())
  const [durationValid, setDurationValid] = useState(true)
  const [seed, setSeed] = useState(0)
  const [view, setView] = useState<'menu' | 'configure' | 'play'>(() => configurationOpen ? 'configure' : 'menu')
  const [confirmExit, setConfirmExit] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [confirmConflict, setConfirmConflict] = useState<'reload' | 'exit' | null>(null)
  const [reloadingLatest, setReloadingLatest] = useState(false)
  const [errorText, setErrorText] = useState('')
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const choicesRef = useRef<HTMLDivElement | null>(null)
  const snapshot = 'snapshot' in persistenceState && persistenceState.snapshot.mode === 'challenge' ? persistenceState.snapshot : null
  const session = snapshot?.session ?? null
  const score = snapshot?.score ?? null
  const questionIndex = snapshot?.cursor.questionIndex ?? 0
  const phase = snapshot?.cursor.phase
  const pendingStart = 'operation' in persistenceState && persistenceState.operation !== 'save'
  const screen: Screen = view !== 'play' || !snapshot || pendingStart ? 'configure' : phase === 'round' ? 'round' : phase === 'result' || phase === 'timeout' ? 'result' : 'question'
  const feedback: Feedback = phase === 'retry-prompt' ? 'retry' : phase === 'auto-advance' || phase === 'manual-advance' ? 'completed' : 'idle'
  const blocked = persistenceState.status !== 'ready'
  const canConfigure = persistenceState.status === 'empty' || persistenceState.status === 'ready'
  const request: ChallengeRequest = useMemo(() => ({ selectedLevels, selectedLevel5Sublevels: selectedSublevels, mode, count, seed }), [selectedLevels, selectedSublevels, mode, count, seed])
  const validation = validateChallengeRequest(request)
  const capacity = getChallengeCapacity(request)
  const invalidMessage = validation.ok ? null : friendlyConfigurationError(validation.error, count, capacity)
  const current = session?.questions[questionIndex]
  const response = current && score?.responses[current.key]
  const roundNumber = session ? Math.floor(questionIndex / session.roundSize) + 1 : 1
  useEffect(() => { saveSessionDurationPreference(sessionDuration) }, [sessionDuration])
  useEffect(() => {
    if (reloadingLatest && persistenceState.status !== 'loading' && persistenceState.status !== 'conflict' && persistenceState.status !== 'completion') setReloadingLatest(false)
  }, [reloadingLatest, persistenceState.status])
  useEffect(() => { if (screen !== 'configure' && !confirmExit) headingRef.current?.focus() }, [screen, questionIndex, confirmExit])
  useEffect(() => {
    if (screen === 'question' && feedback === 'idle' && response?.status === 'awaiting-second-attempt') choicesRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [screen, feedback, response?.status])
  function saveConfiguration(next: Partial<ChallengeConfiguration>) { onConfigurationChange?.({ selectedLevels, selectedLevel5Sublevels: selectedSublevels, mode, count, ...next }) }
  function toggleLevel(level: DrillLevel) { const next = selectedLevels.includes(level) ? selectedLevels.filter(item => item !== level) : [...selectedLevels, level].sort(); setSelectedLevels(next); saveConfiguration({ selectedLevels: next }); setErrorText('') }
  function toggleSublevel(sublevel: Level5Sublevel) { const next = selectedSublevels.includes(sublevel) ? selectedSublevels.filter(item => item !== sublevel) : sublevels.filter(item => item === sublevel || selectedSublevels.includes(item)); setSelectedSublevels(next); saveConfiguration({ selectedLevel5Sublevels: next }); setErrorText('') }
  function changeMode(next: OperationMode) { setMode(next); saveConfiguration({ mode: next }) }
  function changeCount(next: (typeof counts)[number]) { setCount(next); saveConfiguration({ count: next }) }
  function start(confirmed = false) {
    if (!validation.ok || !durationValid || !controller || !canConfigure) return
    if (snapshot && !confirmed) { setConfirmReplace(true); return }
    const nextSeed = makeSeed()
    const result = generateChallengeSession({ ...request, seed: nextSeed })
    if (!result.ok) { const message = friendlyConfigurationError(result.error, count, capacity); setErrorText(`${message.title}. ${message.body}`); return }
    setSeed(nextSeed); setErrorText(''); setConfirmReplace(false); setView('play'); onConfigurationOpenChange?.(false)
    if (persistenceState.status === 'ready') {
      const saved = persistenceState.snapshot
      void controller.replaceSession(result.session, makeInstanceId(), { instanceId: saved.instanceId, sessionId: saved.sessionId, revision: saved.revision }, sessionDuration)
    } else void controller.startSession(result.session, makeInstanceId(), sessionDuration)
  }
  function submit(choiceIndex: number) { if (!blocked && !confirmExit) void controller?.submitAnswer(choiceIndex) }
  function retryAnswer() { if (!blocked) void controller?.enableRetry() }
  function advance() { if (!blocked) void controller?.advanceManual() }
  function nextRound() { if (!blocked) void controller?.continueRound() }
  function leave() { release(); onExit() }
  function backToRegular() { onBackToRegular() }
  function exit() {
    if (persistenceState.status === 'conflict') setConfirmConflict('exit')
    else if (screen === 'question' || screen === 'round' || persistenceState.status === 'saving' || persistenceState.status === 'failed' || persistenceState.status === 'completion') setConfirmExit(true)
    else leave()
  }
  function restart() { setErrorText(''); setView('configure'); onConfigurationOpenChange?.(true) }
  function reloadLatest() { setReloadingLatest(true); setView('menu'); void controller?.reloadFromStorage('challenge') }
  function returnToChallengeSetup() { controller?.dismissInvalidCompletion(); setView('configure') }
  if (persistenceState.status === 'loading') return <main className="drill-shell challenge-shell"><div className="drill-topline"><span className="drill-brand">Math Adventure · Tantangan Campuran</span>{!reloadingLatest && <div className="drill-mode-switch" role="group" aria-label="Pilih mode"><button type="button" aria-pressed={false} onClick={backToRegular}>Latihan Biasa</button><button type="button" aria-pressed={true}>Tantangan Campuran</button></div>}<button type="button" className="drill-back" onClick={exit}>Kembali</button></div><section className="drill-card" aria-busy="true"><p role="status">Memuat sesi tantangan…</p></section></main>
  if (confirmConflict) return <main className="drill-shell challenge-shell"><section className="drill-card drill-confirm" role="alertdialog" aria-modal="true" aria-labelledby="challenge-conflict-title"><h2 id="challenge-conflict-title">Buang perubahan lokal?</h2><p>Perubahan lokal yang belum tersimpan akan dibuang. Sesi di penyimpanan tidak akan ditimpa.</p><div className="drill-actions"><button type="button" className="drill-primary" autoFocus onClick={() => setConfirmConflict(null)}>Batal</button><button type="button" className="drill-secondary" onClick={() => { const action = confirmConflict; setConfirmConflict(null); if (action === 'exit') leave(); else reloadLatest() }}>Ya, Buang Perubahan</button></div></section></main>
  if (confirmReplace) return <main className="drill-shell challenge-shell"><section className="drill-card drill-confirm" role="alertdialog" aria-modal="true" aria-labelledby="challenge-replace-title"><h2 id="challenge-replace-title">Yakin akan memulai sesi baru?</h2><div className="drill-actions"><button type="button" className="drill-primary" autoFocus onClick={() => setConfirmReplace(false)}>Batal</button><button type="button" className="drill-secondary" disabled={blocked} onClick={() => start(true)}>Ya, Mulai Baru</button></div></section></main>
  if (confirmExit) return <main className="drill-shell challenge-shell"><section className="drill-card drill-confirm" role="alertdialog" aria-modal="true" aria-labelledby="challenge-exit-title" aria-describedby="challenge-exit-description"><h2 id="challenge-exit-title">Keluar dari tantangan?</h2><p id="challenge-exit-description">{persistenceState.status === 'saving' || persistenceState.status === 'completion' ? 'Penyimpanan masih berlangsung. Jika keluar, perubahan terakhir belum dapat dipastikan tersimpan. Transaksi yang berjalan mungkin tetap selesai; sesi akan dimuat ulang saat kembali.' : persistenceState.status === 'failed' ? 'Perubahan terakhir belum tersimpan dan akan hilang jika keluar. Sesi yang sudah tersimpan tidak dihapus.' : 'Progres yang sudah tersimpan tetap tersedia saat kamu kembali.'}</p><div className="drill-actions"><button type="button" className="drill-primary" autoFocus onClick={() => setConfirmExit(false)}>Tetap bermain</button><button type="button" className="drill-secondary" onClick={leave}>Ya, keluar</button></div></section></main>
  return <main className="drill-shell challenge-shell">
    <div className="drill-topline"><span className="drill-brand">Math Adventure · Tantangan Campuran</span>{screen === 'configure' && persistenceState.status !== 'saving' && persistenceState.status !== 'failed' && persistenceState.status !== 'conflict' && persistenceState.status !== 'completion' && <div className="drill-mode-switch" role="group" aria-label="Pilih mode"><button type="button" aria-pressed={false} onClick={backToRegular}>Latihan Biasa</button><button type="button" aria-pressed={true}>Tantangan Campuran</button></div>}<button type="button" className="drill-back" onClick={exit}>Kembali</button></div>
    {view === 'menu' && persistenceState.status === 'ready' && snapshot && <section className="drill-card" aria-labelledby="challenge-saved-title"><h1 id="challenge-saved-title">Sesi tantangan tersimpan</h1><p>{phase === 'timeout' ? 'Waktu tantangan habis.' : phase === 'result' ? 'Tantangan terakhir sudah selesai.' : 'Ada tantangan yang dapat dilanjutkan.'}</p><div className="drill-actions"><button type="button" className="drill-primary" onClick={() => { setView('play'); onConfigurationOpenChange?.(false) }}>{phase === 'result' || phase === 'timeout' ? 'Lihat Hasil Terakhir' : 'Lanjutkan'}</button><button type="button" className="drill-secondary" onClick={restart}>Mulai Baru</button></div></section>}
    {persistenceState.status === 'unrecoverable' && <section className="drill-card drill-error" role="alert"><h2>Sesi tersimpan tidak dapat dibuka</h2><p>{persistenceState.result.status === 'unsupported-version' ? 'Versi sesi belum didukung aplikasi ini.' : 'Data sesi tidak valid.'} Data tidak dihapus atau diganti.</p><button type="button" className="drill-secondary" onClick={leave}>Kembali ke Menu</button></section>}
    {persistenceState.status === 'conflict' && <section className="drill-card drill-error" role="alert"><h2>Sesi telah berubah di tab lain</h2><p>Progres lokal belum tersimpan. Jangan lanjutkan sampai memilih sesi yang akan digunakan.</p><div className="drill-actions"><button type="button" className="drill-primary" onClick={() => setConfirmConflict('reload')}>Muat Sesi Terbaru</button><button type="button" className="drill-secondary" onClick={() => setConfirmConflict('exit')}>Kembali ke Menu</button></div></section>}
    {persistenceState.status === 'failed' && <section className="drill-card drill-error" role="alert"><h2>Belum tersimpan</h2><p>{persistenceState.operation === 'load' ? 'Sesi belum dapat dimuat. Jangan mulai tantangan sebelum penyimpanan dapat diperiksa.' : 'Perubahan terakhir belum tersimpan. Tantangan ditahan; coba simpan lagi atau keluar dengan kehilangan perubahan lokal.'}</p><button type="button" className="drill-primary" onClick={() => { if (persistenceState.operation === 'load') void controller?.reloadFromStorage('challenge'); else void controller?.retryPendingSave() }}>{persistenceState.operation === 'load' ? 'Coba Muat Lagi' : 'Coba Simpan Lagi'}</button><button type="button" className="drill-secondary" onClick={() => setConfirmExit(true)}>Kembali ke Menu</button></section>}
    {persistenceState.status === 'completion' && <CompletionStatus state={persistenceState} onRetry={() => void controller?.retryPendingSave()} onVerify={() => void controller?.verifyPendingCompletion()} onReload={reloadLatest} onDismiss={returnToChallengeSetup} />}
      {persistenceState.status === 'saving' && persistenceState.operation !== 'save' && <p role="status" aria-live="polite">Menyimpan…</p>}
    {screen === 'configure' && canConfigure && (view === 'configure' || persistenceState.status === 'empty') && <section className="drill-card" aria-labelledby="challenge-title"><p className="drill-kicker">MODE TANTANGAN</p><h1 id="challenge-title">Tantangan Campuran</h1><p className="drill-muted">Pilih level, operasi, dan jumlah soal untuk sesi ini.</p>
      <fieldset className="challenge-fieldset"><legend>Pilih level (satu atau lebih)</legend><div className="challenge-options">{levels.map(level => <label key={level}><input type="checkbox" checked={selectedLevels.includes(level)} onChange={() => toggleLevel(level)}/>Level {level}{level === 5 ? ' · Cari Angka' : ''}</label>)}</div></fieldset>
      {(selectedLevels.includes(5) || selectedSublevels.length > 0) && <fieldset className="challenge-fieldset"><legend>Sublevel Cari Angka (pilih satu atau lebih)</legend>{!selectedLevels.includes(5) && <p>Sublevel tersimpan tetapi Level 5 belum dipilih. Pilih Level 5 atau hapus sublevel terpilih.</p>}<div className="challenge-options">{sublevels.map(item => <label key={item}><input type="checkbox" checked={selectedSublevels.includes(item)} onChange={() => toggleSublevel(item)}/>{level5Names[item]}</label>)}</div></fieldset>}
      <div className="drill-form"><label>Operasi<select value={mode} onChange={event => changeMode(event.target.value as OperationMode)}>{Object.entries(modeNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><div className="drill-preset-label">Jumlah soal</div><div className="drill-presets" role="group" aria-label="Jumlah soal">{counts.map(item => <button key={item} type="button" aria-pressed={count === item} onClick={() => changeCount(item)}>{item} soal</button>)}</div><SessionDurationControl value={sessionDuration} onChange={setSessionDuration} onValidityChange={setDurationValid} /></div>
      <section className="challenge-preview" aria-labelledby="challenge-preview-title"><h2 id="challenge-preview-title">Preview sesi</h2><p>Level: {selectedLevels.length ? selectedLevels.map(level => `Level ${level}`).join(', ') : 'Belum dipilih'}{selectedLevels.includes(5) ? ` · ${selectedSublevels.length ? selectedSublevels.map(item => level5Names[item]).join(', ') : 'sublevel belum dipilih'}` : ''}</p><p>Jumlah soal: {count}</p><p>Operasi: {modeNames[mode]}</p>
        {validation.ok ? <><p className="challenge-validity">Pilihan ini siap dimainkan.</p><ul><li>Soal per level: {levels.filter(level => validation.quota.byLevel[level] > 0).map(level => `Level ${level}: ${validation.quota.byLevel[level]}`).join(' · ')}</li>{selectedLevels.includes(5) && <li>Soal per sublevel: {sublevels.filter(item => validation.quota.bySublevel[item] > 0).map(item => `${level5Names[item]}: ${validation.quota.bySublevel[item]}`).join(' · ')}</li>}<li>Soal per operasi: {operations.filter(operation => validation.quota.byOperation[operation] > 0).map(operation => `${operationNames[operation]}: ${validation.quota.byOperation[operation]}`).join(' · ')}</li></ul></> : invalidMessage && <div role="alert" className="drill-error"><strong>{invalidMessage.title}</strong><p>{invalidMessage.body}</p>{invalidMessage.recommendation !== undefined && <div className="challenge-alternatives" role="group" aria-label="Saran jumlah soal"><button type="button" onClick={() => changeCount(invalidMessage.recommendation!)}>Gunakan {invalidMessage.recommendation} soal</button></div>}</div>}</section>
      {errorText && <p role="alert" className="drill-error">{errorText}</p>}<button type="button" className="drill-primary drill-wide" disabled={!validation.ok || !durationValid || !canConfigure} onClick={() => start()}>Mulai Tantangan Campuran</button>
    </section>}
    {screen === 'question' && session && current && <section className="drill-card drill-question" aria-labelledby="challenge-question-title"><div className="drill-progress"><span>Soal <strong>{questionIndex + 1} / {session.questions.length}</strong></span>{snapshot?.schemaVersion === 2 && <SessionCountdown snapshot={snapshot} />}<span>Ronde {roundNumber} / {session.rounds.length}</span></div><progress value={questionIndex + (response?.status === 'completed' ? 1 : 0)} max={session.questions.length} aria-label="Progres tantangan"/><h1 id="challenge-question-title" ref={headingRef} tabIndex={-1} className="drill-instruction">Berapa jawabannya?</h1><p className="drill-equation" data-testid="equation" aria-label={`Soal: ${current.prompt.replace('□', 'kotak kosong')}`}><bdi>{current.prompt.includes('□') ? <>{current.prompt.split('□')[0]}<span className="drill-blank" aria-hidden="true"/>{current.prompt.split('□')[1]}</> : current.prompt}</bdi></p><div ref={choicesRef} className="drill-choices" role="group" aria-label="Pilihan jawaban">{current.choices.map((choice, index) => <button key={`${current.key}:${index}`} type="button" disabled={blocked || feedback !== 'idle' || response?.attempts.includes(index)} onClick={() => submit(index)} aria-label={`Jawaban ${choice}`} className="drill-choice">{choice}</button>)}</div><div className="drill-feedback" role="status" aria-live="polite">{feedback === 'retry' && <span>Coba lagi. Kamu masih punya satu kesempatan.</span>}{feedback === 'completed' && response && (response.points === 0 ? <span>Jawaban yang benar: <strong>{current.answer}</strong></span> : <span>Benar!</span>)}{errorText && <span>{errorText}</span>}</div>{feedback === 'retry' && <button type="button" className="drill-primary drill-wide" disabled={blocked} onClick={retryAnswer}>Coba lagi</button>}{feedback === 'completed' && response?.points === 0 && <button type="button" className="drill-primary drill-wide" disabled={blocked} onClick={advance}>Lanjut</button>}</section>}
    {screen === 'round' && session && <section className="drill-card drill-transition" aria-labelledby="challenge-round-title"><div className="drill-card-header-bar"><p className="drill-kicker">RONDE {roundNumber}</p>{snapshot?.schemaVersion === 2 && <SessionCountdown snapshot={snapshot} />}</div><h1 id="challenge-round-title" ref={headingRef} tabIndex={-1}>Ronde selesai</h1><p className="drill-muted">Kamu sudah menyelesaikan ronde ini. Siap lanjut?</p><button type="button" className="drill-primary drill-wide" disabled={blocked} onClick={nextRound}>Lanjut ronde</button></section>}
    {screen === 'result' && session && score && <ChallengeResults session={session} score={score} headingRef={headingRef} onRestart={restart} onExit={exit} blocked={blocked} timedOut={phase === 'timeout'} snapshot={snapshot}/>}
  </main>
}
function MetricCards({ rows }: { rows: readonly { name: string; metrics: ChallengeMetrics }[] }) {
  return <div className="challenge-metric-grid">{rows.map(({ name, metrics }) => {
    const score = metrics.weightedScore
    const firstTry = metrics.firstTryAccuracy
    const percent = formatPercent(score)
    return <article className="challenge-metric-card" key={name}>
      <h3>{name} — {percent}</h3>
      <p className="challenge-metric-label">Nilai latihan</p>
      <progress max={100} value={score.value ?? 0} aria-label={`Nilai latihan ${name}`} aria-valuetext={percent}/>
      <p className="challenge-first-try">Benar pada percobaan pertama: <strong>{firstTry.value === null ? 'N/A' : `${formatNumber(firstTry.numerator)} dari ${formatNumber(firstTry.denominator)} soal`}</strong></p>
    </article>
  })}</div>
}

function ChallengeResults({ session, score, headingRef, onRestart, onExit, blocked, timedOut, snapshot }: { session: ChallengeSession; score: ScoreState; headingRef: React.RefObject<HTMLHeadingElement | null>; onRestart: () => void; onExit: () => void; blocked: boolean; timedOut: boolean; snapshot?: { schemaVersion: number; timing?: { durationMs?: number | null; startedAt?: number | null; deadlineAt?: number | null; endedAt?: number | null; remainingMs?: number | null } | null } | null }) {
  const summary = getChallengeSummary(score, session)
  const total = summary.overall
  const levelRows = levels.filter(level => summary.byLevel[level].planned > 0).map(level => ({ name: `Level ${level}`, metrics: summary.byLevel[level] }))
  const sublevelRows = session.selectedLevels.includes(5)
    ? sublevels.filter(sublevel => summary.bySublevel[sublevel].planned > 0).map(sublevel => ({ name: level5Names[sublevel], metrics: summary.bySublevel[sublevel] }))
    : []
  const operationRows = session.mode === 'mixed'
    ? operations.filter(operation => session.questions.some(question => question.operation === operation) && summary.byOperation[operation].planned > 0).map(operation => ({ name: operation === 'addition' ? 'Penjumlahan' : 'Pengurangan', metrics: summary.byOperation[operation] }))
    : []

  return <section className="drill-card drill-result challenge-result" aria-labelledby="challenge-result-title">
    <h1 id="challenge-result-title" ref={headingRef} tabIndex={-1}>{timedOut ? 'Waktu Habis' : 'Tantangan Selesai!'}</h1>
    {timedOut && <p role="status">Waktu Habis</p>}
    <p className="challenge-result-lead">{timedOut ? `Kamu menyelesaikan ${total.completed} dari ${total.planned} soal.` : `Hebat, kamu sudah menyelesaikan ${total.completed} soal!`}</p>
    <SessionRewardStars
      mode="challenge"
      plannedCount={total.planned}
      completedCount={total.completed}
      totalPoints={total.firstTryCorrect + 0.5 * total.secondTryCorrect}
      isTimeout={timedOut}
      snapshot={snapshot}
    />
    <div className="drill-score challenge-main-score">
      <span>Nilai latihan</span>
      <strong data-testid="challenge-weighted-score">{formatPercent(total.weightedScore)}</strong>
      <span data-testid="challenge-weighted-points">{formatPoints(total.weightedScore)}</span>
    </div>
    <dl className="drill-metrics challenge-main-stats">
      <div className="challenge-main-stat"><dt>Benar langsung</dt><dd>{total.firstTryCorrect}</dd></div>
      <div className="challenge-main-stat"><dt>Soal selesai</dt><dd>{total.completed}/{total.planned}</dd></div>
    </dl>
    <p className="challenge-motivation">Terima kasih sudah berusaha sampai selesai.</p>
    <details className="challenge-parent-details">
      <summary>Rincian untuk orang tua</summary>
      <div className="challenge-parent-content">
        <section className="challenge-parent-section" aria-labelledby="challenge-level-results-title">
          <h2 id="challenge-level-results-title">Hasil per level</h2>
          <MetricCards rows={levelRows}/>
        </section>
        {sublevelRows.length > 0 && <section className="challenge-parent-section" aria-labelledby="challenge-sublevel-results-title">
          <h2 id="challenge-sublevel-results-title">Hasil Cari Angka</h2>
          <MetricCards rows={sublevelRows}/>
        </section>}
        {operationRows.length > 0 && <section className="challenge-parent-section" aria-labelledby="challenge-operation-results-title">
          <h2 id="challenge-operation-results-title">Hasil per jenis soal</h2>
          <MetricCards rows={operationRows}/>
        </section>}
        <p className="challenge-scoring-explanation">Nilai latihan dihitung dari jawaban benar pertama (1 poin), benar kedua (½ poin), dan salah dua kali (0 poin).</p>
      </div>
    </details>
    <div className="drill-actions"><button type="button" className="drill-primary" disabled={blocked} onClick={onRestart}>Tantangan lagi</button><button type="button" className="drill-secondary" onClick={onExit}>Kembali</button></div>
  </section>
}
