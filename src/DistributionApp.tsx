import { useState } from 'react'
import {
  createDistributionTask,
  evaluateDistributionAttempt,
  initialDistributionState,
  reduceDistribution,
} from './learning/distribution'
import { MemoryDistributionEvidenceStore, type DistributionEvidenceStore } from './learning/distributionEvidenceStore'
import { PointerDragPreview } from './PointerDragPreview'
import { usePointerDrag } from './usePointerDrag'
import './distribution.css'

type DistributionView = 'welcome' | 'distribution' | 'paused'

export function DistributionApp({ store: providedStore }: { store?: DistributionEvidenceStore }) {
  const [store] = useState(() => providedStore ?? new MemoryDistributionEvidenceStore())
  const [task] = useState(createDistributionTask)
  const [state, setState] = useState(() => initialDistributionState(task))
  const [view, setView] = useState<DistributionView>('welcome')
  const [statusMessage, setStatusMessage] = useState('')
  const [completedVariants, setCompletedVariants] = useState<ReadonlySet<string>>(() => new Set())
  const [resultAttempt, setResultAttempt] = useState<ReturnType<typeof store.saveAttempt> | null>(null)

  function dispatch(action: Parameters<typeof reduceDistribution>[1]) {
    setState(current => reduceDistribution(current, action))
    if (action.type === 'assign' || action.type === 'return-item' || action.type === 'undo' || action.type === 'retry') {
      setResultAttempt(null)
    }
    setStatusMessage('')
  }

  function assignItemToRecipient(itemId: string, recipientId: string) {
    if (!task.recipients.includes(recipientId) || !state.stock.includes(itemId)) return
    setState(current => {
      if (!current.stock.includes(itemId)) return current
      const selected = current.selectedItemId === itemId
        ? current
        : reduceDistribution(current, { type: 'select-item', itemId })
      return reduceDistribution(selected, { type: 'assign', recipientId })
    })
    setResultAttempt(null)
    setStatusMessage('')
  }

  function assignSelected(recipientId: string) {
    if (!state.selectedItemId) {
      setStatusMessage('Pilih satu benda dari persediaan bersama terlebih dahulu.')
      return
    }
    assignItemToRecipient(state.selectedItemId, recipientId)
  }

  function checkDistribution() {
    const attempt = store.saveAttempt(evaluateDistributionAttempt(state, true))
    setResultAttempt(attempt)
    setState(current => reduceDistribution(current, { type: 'mark-repeated' }))
    if (attempt.valid === true) setCompletedVariants(current => new Set([...current, state.task.variantId]))
    setStatusMessage('')
  }

  function pause() {
    store.saveCheckpoint(state)
    setView('paused')
  }

  function resume() {
    const checkpoint = store.loadCheckpoint()
    if (checkpoint) setState(checkpoint)
    setView('distribution')
  }

  function restartSession() {
    setState(initialDistributionState(task))
    setCompletedVariants(new Set())
    setResultAttempt(null)
    store.saveCheckpoint(null)
    setStatusMessage('')
    setView('distribution')
  }

  function getItemNumber(itemId: string) {
    return task.items.indexOf(itemId) + 1
  }

  const pointerDrag = usePointerDrag(assignItemToRecipient)

  const hintMessage = state.hintLevel === 1
    ? 'Bagikan satu per satu. Siapa yang sudah menerima?'
    : state.hintLevel === 2
      ? 'Periksa setiap kartu teman. Setiap teman perlu mendapat tepat satu benda.'
      : ''

  if (view === 'welcome') {
    return (
      <main className="distribution-app">
        <header className="distribution-intro">
          <p className="distribution-eyebrow">Misi 00.1-B · Persediaan cukup</p>
          <h1>Membagikan satu untuk setiap teman</h1>
          <p>Ambil benda dari persediaan bersama dan bagikan sendiri kepada teman-teman.</p>
          <button className="distribution-primary" type="button" onClick={() => setView('distribution')}>Mulai tantangan</button>
        </header>
      </main>
    )
  }

  if (view === 'paused') {
    return (
      <main className="distribution-app">
        <section className="distribution-panel" aria-labelledby="paused-title">
          <p className="distribution-eyebrow">Misi dijeda</p>
          <h1 id="paused-title">Kita lanjut kapan saja.</h1>
          <p>Susunan benda dan pilihanmu tetap tersimpan selama halaman ini terbuka.</p>
          <button className="distribution-primary" type="button" onClick={resume}>Lanjutkan</button>
        </section>
      </main>
    )
  }


  return (
    <main className="distribution-app">
      <header className="distribution-page-heading">
        <p className="distribution-eyebrow">Misi 00.1-B · Persediaan cukup</p>
        <h1>Bagikan satu benda ke setiap teman</h1>
        <p>Bagikan satu benda ke setiap teman. Pilih benda, lalu teman yang akan menerimanya. Kamu bisa mengembalikan benda jika ingin mengubah pembagian.</p>
      </header>

      <div className="distribution-toolbar" aria-label="Bantuan dan kendali">
        <button className="distribution-secondary" type="button" onClick={() => dispatch({ type: 'hint' })}>Petunjuk</button>
        <button className="distribution-secondary" type="button" onClick={() => dispatch({ type: 'undo' })} disabled={state.history.length === 0}>Batalkan langkah terakhir</button>
        <button className="distribution-secondary" type="button" onClick={pause}>Jeda</button>
      </div>

      <div className="distribution-board" onClickCapture={pointerDrag.onClickCapture}
        onKeyDown={event => {
          if (event.key === 'Escape' && state.selectedItemId) {
            dispatch({ type: 'select-item', itemId: state.selectedItemId })
            event.preventDefault()
          }
        }}>
        <section className="distribution-stock" aria-label="Persediaan bersama">
          <h2>Persediaan bersama</h2>
          {state.stock.length === 0 ? <p>Persediaan kosong.</p> : (
            <div className="distribution-item-list">
              {state.stock.map(itemId => {
                const isDragging = pointerDrag.activeDrag?.sourceId === itemId
                return <button
                  className={`distribution-item is-draggable${state.selectedItemId === itemId ? ' is-selected' : ''}${isDragging ? ' is-dragging' : ''}`}
                  type="button"
                  key={itemId}
                  aria-pressed={state.selectedItemId === itemId}
                  aria-label={`Benda ${getItemNumber(itemId)} di persediaan`}
                  {...pointerDrag.bindSource(itemId, `Benda ${getItemNumber(itemId)}`)}
                  onClick={() => dispatch({ type: 'select-item', itemId })}
                >Benda {getItemNumber(itemId)}</button>
              })}
            </div>
          )}
        </section>

        <section className="distribution-recipients" aria-label="Teman-teman penerima">
          {task.recipients.map((recipientId, index) => {
            const isDropTarget = pointerDrag.activeDrag?.targetId === recipientId
            return <section className="distribution-recipient" key={recipientId} role="group" aria-label={`Teman ${index + 1}`}>
              <h2>Teman {index + 1}</h2>
              <button
                className={`recipient-target${isDropTarget ? ' is-drop-target' : ''}`}
                type="button"
                aria-label={`Bagikan benda ke Teman ${index + 1}`}
                data-drop-target-id={recipientId}
                data-drop-hover={isDropTarget ? 'true' : undefined}
                onClick={() => assignSelected(recipientId)}
              >{isDropTarget ? 'Lepaskan benda di sini' : 'Pilih sebagai penerima'}</button>
              {resultAttempt?.valid === false && state.allocations[recipientId].length === 0 && (
                <p className="recipient-feedback">Teman ini belum mendapat benda.</p>
              )}
              {resultAttempt?.valid === false && state.allocations[recipientId].length > 1 && (
                <p className="recipient-feedback">Teman ini mendapat lebih dari satu benda. Kamu bisa mengembalikan salah satunya.</p>
              )}
              <div className="recipient-items" aria-label={`Benda untuk Teman ${index + 1}`}>
                {state.allocations[recipientId].length === 0 ? <span className="recipient-empty">Belum ada benda</span> :
                  state.allocations[recipientId].map(itemId => (
                    <div className="recipient-assignment" key={itemId}>
                      <span className="assigned-item">Benda {getItemNumber(itemId)}</span>
                      <button className="return-item" type="button" onClick={() => dispatch({ type: 'return-item', itemId })} aria-label={`Kembalikan Benda ${getItemNumber(itemId)} ke persediaan`}>Kembalikan</button>
                    </div>
                  ))}
              </div>
            </section>
          })}
        </section>

        {resultAttempt && (
          <aside className={`distribution-feedback ${resultAttempt.valid === true ? 'is-correct' : resultAttempt.valid === false ? 'is-incorrect' : 'is-inconclusive'}`} aria-live="polite" aria-atomic="true">
            {resultAttempt.valid === true ? (
              <>
                <h2>Yeay, semua teman sudah mendapat satu benda!</h2>
                <p>Kamu sudah membagikan satu benda untuk setiap teman.</p>
                {completedVariants.has(state.task.variantId) && <p>Tantangan persediaan cukup selesai untuk sesi ini.</p>}
                <button className="distribution-secondary" type="button" onClick={restartSession}>Main lagi</button>
              </>
            ) : resultAttempt.valid === false ? (
              <>
                <h2>Ayo kita periksa lagi bersama.</h2>
                <p>Perhatikan kartu teman yang diberi pesan. Kamu bisa memperbaiki pembagian langsung di papan ini.</p>
                <button className="distribution-secondary" type="button" onClick={() => dispatch({ type: 'retry' })}>Mulai pembagian ini dari awal</button>
              </>
            ) : (
              <>
                <h2>Kita coba dengan cara yang lebih nyaman.</h2>
                <p>Kamu bisa lanjut membagikan atau meminta petunjuk.</p>
              </>
            )}
          </aside>
        )}
        <PointerDragPreview drag={pointerDrag.activeDrag} />
        <div className="distribution-actions">
          <button className="distribution-primary" type="button" onClick={checkDistribution} disabled={resultAttempt !== null}>Sudah selesai, periksa!</button>
        </div>
        <p className="distribution-live" role="status" aria-live="polite">{statusMessage || hintMessage || (state.selectedItemId ? `Benda ${getItemNumber(state.selectedItemId)} dipilih. Ketuk teman untuk membagikan. Tekan Escape atau ketuk benda ini lagi untuk membatalkan.` : '')}</p>
      </div>
    </main>
  )
}
