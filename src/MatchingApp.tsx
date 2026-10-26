import { useState } from 'react'
import { MemoryEvidenceStore } from './learning/evidenceStore'
import type { EvidenceStore } from './learning/evidenceStore'
import type { AttemptEvidence } from './learning/evidenceStore'
import { createTask, evaluateAttempt, initialState, reduceMatch } from './learning/matching'
import type { Action, MatchState, Side } from './learning/matching'
import { PointerDragPreview } from './PointerDragPreview'
import { usePointerDrag } from './usePointerDrag'
import './index.css'
import './matching.css'

const missions = [
  { id: 'balanced', label: 'Susunan 1', astronauts: 3, rockets: 3 },
  { id: 'more-astronauts', label: 'Susunan 2', astronauts: 4, rockets: 3 },
  { id: 'more-rockets', label: 'Susunan 3', astronauts: 3, rockets: 4 },
] as const

function nextUncompletedMission(currentVariantId: string, completedVariants: Set<string>) {
  const currentIndex = missions.findIndex(mission => mission.id === currentVariantId)
  for (let step = 1; step <= missions.length; step += 1) {
    const candidate = missions[(currentIndex + step) % missions.length]
    if (!completedVariants.has(candidate.id)) return candidate
  }
  return null
}

function MatchingBoard({ state, onAction }: { state: MatchState; onAction: (action: Action) => void }) {
  const pointerDrag = usePointerDrag((astronaut, rocket) => onAction({ type: 'pair', astronaut, rocket }))

  return (
    <div
      className="matching-board"
      onClickCapture={pointerDrag.onClickCapture}
      onKeyDown={event => {
        if (event.key === 'Escape' && state.selectedAstronaut) {
          onAction({ type: 'clear-selection' })
          event.preventDefault()
        }
      }}
    >
      <div className="board-grid">
        <section className="crew-panel" aria-label="Daftar astronaut">
          <h3>Para astronaut</h3><p>Seret astronaut ke roket, atau ketuk keduanya bergantian.</p>
          <div className="token-list">
            {state.task.astronauts.map((id, index) => {
              const paired = state.pairs.some(pair => pair.astronaut === id)
              const isDragging = pointerDrag.activeDrag?.sourceId === id
              return <button key={id} type="button" className={`token astronaut${paired ? '' : ' is-draggable'}${isDragging ? ' is-dragging' : ''}`} aria-label={`Pilih astronaut ${index + 1}`}
                aria-pressed={state.selectedAstronaut === id} disabled={paired}
                data-hint={state.highlightedAstronaut === id ? 'true' : undefined}
                {...(!paired ? pointerDrag.bindSource(id, `Astronaut ${index + 1}`) : {})}
                onClick={() => onAction(state.selectedAstronaut === id
                  ? { type: 'clear-selection' }
                  : { type: 'select', astronaut: id })}>
                <span className="token-illustration" aria-hidden="true">👩‍🚀</span><span>Astronaut {index + 1}</span>
                <small>{paired ? 'Sudah punya roket' : state.selectedAstronaut === id ? 'Dipilih · ketuk lagi untuk batal' : 'Belum berpasangan'}</small>
              </button>
            })}
          </div>
        </section>
        <section className="crew-panel rockets" aria-label="Daftar roket">
          <h3>Roket</h3><p>Pilih roket yang belum dipakai.</p>
          <div className="token-list">
            {state.task.rockets.map((id, index) => {
              const paired = state.pairs.some(pair => pair.rocket === id)
              const isDropTarget = pointerDrag.activeDrag?.targetId === id
              return <button key={id} type="button" className={`token rocket${isDropTarget ? ' is-drop-target' : ''}`}
                aria-label={`Pilih roket ${index + 1}`} disabled={paired}
                data-drop-target-id={paired ? undefined : id}
                data-drop-hover={isDropTarget ? 'true' : undefined}
                onClick={() => state.selectedAstronaut && onAction({ type: 'pair', astronaut: state.selectedAstronaut, rocket: id })}>
                <span className="token-illustration" aria-hidden="true">🚀</span><span>Roket {index + 1}</span>
                <small>{paired ? 'Sudah dipakai' : isDropTarget ? 'Lepaskan di sini' : 'Belum berpasangan'}</small>
              </button>
            })}
          </div>
        </section>
      </div>
      <PointerDragPreview drag={pointerDrag.activeDrag} />
      <section className="pair-summary" role="region" aria-label="Pasangan yang dibuat">
        <h3>Pasanganmu</h3>
        {state.pairs.length ? <ul>{state.pairs.map(pair => <li key={pair.astronaut}>
          Astronaut {Number(pair.astronaut.slice(1))} — Roket {Number(pair.rocket.slice(1))}
        </li>)}</ul> : <p>Belum ada pasangan. Ayo mulai!</p>}
      </section>
    </div>
  )
}

function MatchingApp({ evidenceStore }: { evidenceStore?: EvidenceStore } = {}) {
  const [store] = useState<EvidenceStore>(() => evidenceStore ?? new MemoryEvidenceStore())
  const [state, setState] = useState<MatchState | null>(null)
  const [view, setView] = useState<'home' | 'activity' | 'paused' | 'result' | 'session-complete'>('home')
  const [completedVariants, setCompletedVariants] = useState<Set<string>>(() => new Set())
  const [result, setResult] = useState<AttemptEvidence | null>(null)
  const [message, setMessage] = useState('')
  const [hasCheckpoint, setHasCheckpoint] = useState(false)

  function startMission(mission: typeof missions[number]) {
    const priorAttempts = store.getAttempts().filter(attempt => attempt.variantId === mission.id)
    const priorHintHistoryLevel = priorAttempts.reduce<number>((highest, attempt) => Math.max(highest, attempt.hintHistoryLevel), 0) as 0 | 1 | 2
    store.saveCheckpoint(null)
    setHasCheckpoint(false)
    setState({ ...initialState(createTask(mission.id, mission.astronauts, mission.rockets)),
      repeatedVariant: priorAttempts.length > 0, hintHistoryLevel: priorHintHistoryLevel })
    setResult(null); setMessage(''); setView('activity')
  }
  function act(action: Action) {
    setState(previous => previous && reduceMatch(previous, action))
    setMessage('')
  }
  function submit() {
    if (!state) return
    if (state.pairs.length < Math.min(state.task.astronauts.length, state.task.rockets.length)) {
      setMessage('Masih ada astronaut dan roket yang bisa dipasangkan. Ayo lanjutkan dulu!'); return
    }
    if (!state.answer) {
      setMessage('Pilih dulu apa yang tersisa, lalu periksa jawabanmu.'); return
    }
    const evidence = store.saveAttempt(evaluateAttempt(state, true))
    store.saveCheckpoint(null)
    setHasCheckpoint(false)
    setResult(evidence)
    if (evidence.valid) {
    const completed = new Set(completedVariants)
      completed.add(state.task.variantId)
      setCompletedVariants(completed)
      if (completed.size === missions.length) {
        setMessage('')
        setView('session-complete')
        return
      }
    }
    setMessage(''); setView('result')
  }
  function pause() {
    if (state) {
      store.saveCheckpoint(state)
      setHasCheckpoint(true)
    }
    setView('paused')
  }
  function resume() {
    const checkpoint = store.loadCheckpoint()
    if (checkpoint) setState(checkpoint)
    setView('activity')
  }
  function retry() {
    if (state) setState(reduceMatch(state, { type: 'retry' }))
    store.saveCheckpoint(null)
    setHasCheckpoint(false)
    setResult(null); setMessage(''); setView('activity')
  }

  const feedback = result?.outcome === 'inconclusive'
    ? 'Tidak apa-apa. Kita bisa mencoba lagi dengan cara lain.'
    : result?.valid
      ? result.identifiedRemainder === 'none' ? 'Semua astronaut dan roket sudah berpasangan.'
        : result.identifiedRemainder === 'astronaut' ? 'Ada astronaut yang belum mendapat roket.'
          : 'Ada roket yang belum digunakan.'
      : 'Coba lihat lagi benda mana yang belum mendapat pasangan. Kamu bisa mengubah pilihanmu.'
  const resultTitle = result?.outcome === 'inconclusive'
    ? 'Tidak apa-apa, kita coba pelan-pelan.'
    : result?.valid ? 'Yeay, kamu berhasil! 🚀' : 'Ayo, coba sekali lagi!'

  return <main className="adventure-shell">
    <header className="topbar">
      <span className="brand-mark" aria-hidden="true">✦</span>
      <div><h1>Math Adventure</h1><p>Belajar dengan mencoba</p></div>
      <span className="module-badge">Misi 00.1-A</span>
    </header>

    {view === 'home' && <section className="hero-card" aria-labelledby="mission-heading">
      <div className="hero-art" aria-hidden="true">👩‍🚀 <span>✦</span> 🚀</div>
      <p className="eyebrow">SATU MISI KECIL</p>
      <h2 id="mission-heading">Pasangkan astronaut dan roket</h2>
      <p>Setiap astronaut membutuhkan satu roket. Kamu boleh mencoba pelan-pelan, tanpa batas waktu.</p>
      {hasCheckpoint && <button type="button" className="primary" onClick={resume}>Lanjutkan misi tertunda</button>}
      <div className="mission-choices" aria-label="Pilihan susunan">
        {missions.map(mission => <button type="button" key={mission.id} onClick={() => startMission(mission)}>
          <strong>{mission.label}</strong><span>Ayo pasangkan satu per satu</span>
        </button>)}
      </div>
      <p className="storage-note">Progres hanya ada selama halaman ini terbuka. Memuat ulang atau menutup halaman akan menghapusnya.</p>
    </section>}

    {view === 'paused' && <section className="hero-card" aria-labelledby="pause-heading">
      <p className="eyebrow">WAKTU ISTIRAHAT</p><h2 id="pause-heading">Misi dijeda. Kamu boleh melanjutkan nanti.</h2>
      <p>Pasangan yang sudah dibuat tetap ada selama halaman ini terbuka.</p>
      <div className="actions"><button type="button" className="primary" onClick={resume}>Lanjutkan misi</button>
        <button type="button" onClick={() => setView('home')}>Keluar ke pilihan misi</button></div>
    </section>}

    {view === 'activity' && state && <section className="activity-card" aria-labelledby="activity-heading">
      <div className="section-heading"><div><p className="eyebrow">LANGKAH 1 · PASANGKAN</p>
        <h2 id="activity-heading">Satu astronaut, satu roket.</h2>
        <p>Seret astronaut ke roket, atau ketuk astronaut lalu roket sebagai cara lain.</p></div>
        <button type="button" onClick={pause}>Jeda</button></div>
      <MatchingBoard state={state} onAction={act} />
      <div className="tool-row">
        <button type="button" onClick={() => act({ type: 'undo' })} disabled={!state.history.length}>Urungkan langkah</button>
        <button type="button" onClick={retry}>Coba lagi</button>
        <button type="button" onClick={() => act({ type: 'hint' })} disabled={state.hintLevel === 2}>Minta petunjuk</button>
      </div>
      <p className="hint-message" role="status">{message || (state.hintLevel === 2
        ? state.highlightedAstronaut
          ? 'Satu astronaut yang belum punya pasangan ditandai. Kamu pilih roketnya sendiri.'
          : 'Lihat benda yang masih belum berpasangan. Pilih sendiri apa yang tersisa.'
        : state.hintLevel === 1 ? 'Cari yang belum punya pasangan.' : 'Pasangkan satu per satu. Tidak perlu terburu-buru.')}</p>
      <fieldset className="remainder"><legend>Menurutmu, siapa yang tersisa?</legend>
        {([['none', 'Tidak ada yang tersisa'], ['astronaut', 'Astronaut tersisa'], ['rocket', 'Roket tersisa']] as const).map(([side, label]) =>
          <label key={side}><input type="radio" name="remainder" value={side}
            checked={state.answer === side} onChange={() => act({ type: 'answer', side: side as Side })}/>{label}</label>)}
      </fieldset>
      <div className="actions"><button type="button" className="primary" onClick={() => submit()}>Periksa jawaban</button></div>
    </section>}

    {view === 'session-complete' && <section className="hero-card result-card" aria-labelledby="session-complete-heading">
      <p className="eyebrow">MISI SELESAI</p><h2 id="session-complete-heading">Yeay, semua susunan sudah kamu coba!</h2>
      <div className="actions">
        <button type="button" className="primary" onClick={() => { setCompletedVariants(new Set()); setView('home') }}>Bermain lagi</button>
        <button type="button" onClick={() => setView('home')}>Kembali ke pilihan misi</button>
      </div>
    </section>}

    {view === 'result' && state && result && <section className="hero-card result-card" aria-labelledby="result-heading">
      <p className="eyebrow">HASIL MISI</p><h2 id="result-heading">{resultTitle}</h2>
      <p role="status">{feedback}</p>
      {result.outcome === 'interpretable_incorrect' && <div className="actions">
        <button type="button" className="primary" onClick={() => {
          setState(previous => previous && { ...previous, repeatedVariant: true })
          setMessage(''); setView('activity')
        }}>Perbaiki jawaban</button>
        <button type="button" onClick={() => setView('home')}>Kembali ke pilihan misi</button>
      </div>}
      {result.outcome === 'inconclusive' && <div className="actions">
        <button type="button" className="primary" onClick={() => {
          setState(previous => previous && { ...previous, repeatedVariant: true })
          setMessage(''); setView('activity')
        }}>Kembali ke aktivitas</button>
        <button type="button" onClick={() => setView('home')}>Kembali ke pilihan misi</button>
      </div>}
      {result.valid && <div className="actions">
        {nextUncompletedMission(state.task.variantId, completedVariants) && <button type="button" className="primary" onClick={() => {
          const nextMission = nextUncompletedMission(state.task.variantId, completedVariants)
          if (nextMission) startMission(nextMission)
        }}>Lanjut ke {nextUncompletedMission(state.task.variantId, completedVariants)?.label}</button>}
        <button type="button" onClick={() => setView('home')}>Kembali ke pilihan misi</button>
      </div>}
    </section>}
  </main>
}

export { MatchingApp }
export default MatchingApp
