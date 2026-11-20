import { useEffect, useState } from 'react'
import type { SessionControllerState } from './persistence/sessionController'

/** Presentation threshold only: never cancels a transaction or infers an abort. */
export const COMPLETION_NOTICE_DELAY_MS = 5000
export default function CompletionStatus({ state, onRetry, onVerify, onReload, onDismiss }: {
  state: Extract<SessionControllerState, { status: 'completion' }>
  onRetry: () => void
  onVerify: () => void
  onReload: () => void
  onDismiss: () => void
}) {
  const [elapsedFor, setElapsedFor] = useState<typeof state | null>(null)
  useEffect(() => {
    if (state.stage !== 'pending') return
    const handle = globalThis.setTimeout(() => setElapsedFor(state), COMPLETION_NOTICE_DELAY_MS)
    return () => globalThis.clearTimeout(handle)
  }, [state])
  const uncertain = state.stage === 'uncertain' || (state.stage === 'pending' && elapsedFor === state)
  return <section className="drill-card" aria-label="Status penyimpanan hasil" aria-busy={state.stage === 'pending'}>
    <div role={state.stage === 'pending' ? 'status' : 'alert'} aria-live="polite">
      {state.stage === 'pending' && !uncertain && <p>Menyimpan hasil...</p>}
      {uncertain && <p>Penyimpanan belum dapat dipastikan.</p>}
      {state.stage === 'failed' && <p>Hasil belum tersimpan. Progres jawaban sebelumnya tetap tersedia.</p>}
      {state.stage === 'conflict' && <p>Sesi telah berubah di tab lain. Hasil lokal tidak akan menimpa sesi terbaru.</p>}
      {state.stage === 'invalid' && <p>Data hasil atau riwayat tidak dapat diverifikasi. Data tidak dihapus atau diganti.</p>}
      <p>Hasil sudah dihitung, tetapi belum dikonfirmasi tersimpan.</p>
    </div>
    <div className="drill-actions">
      {uncertain && <button type="button" className="drill-primary" onClick={onVerify}>Periksa Penyimpanan</button>}
      {state.stage === 'failed' && <button type="button" className="drill-primary" onClick={onRetry}>Coba Simpan Lagi</button>}
      {(state.stage === 'conflict') && <button type="button" className="drill-secondary" onClick={onReload}>Muat Sesi Terbaru</button>}
      {state.stage === 'invalid' && <button type="button" className="drill-secondary" onClick={onDismiss}>Muat Sesi Terbaru</button>}
    </div>
  </section>
}
