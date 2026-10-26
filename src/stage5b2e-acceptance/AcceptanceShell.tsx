import { useCallback, useEffect, useMemo, useState } from 'react'
import MathDrillApp from '../features/math-drill/MathDrillApp'
import { createUnifiedIndexedDbSessionStore } from '../features/math-drill/persistence/completedSessionHistoryStore'
import type { CompletedSessionRecord } from '../features/math-drill/persistence/completedSessionTypes'
import type { SessionLoadResult } from '../features/math-drill/persistence/indexedDbSessionStore'
import type { SessionControllerOptions } from '../features/math-drill/persistence/sessionController'
import { inspectAcceptanceCapabilities } from './diagnostics'

export const ACCEPTANCE_DATABASE_NAME = 'math-adventure-stage5b2c-stage5b2e-lan-20261017-2d67b001aa3d'

type SnapshotState = { readonly regular: SessionLoadResult | null; readonly challenge: SessionLoadResult | null }
type DiagnosticState =
  | { readonly status: 'opening' }
  | { readonly status: 'ready'; readonly snapshots: SnapshotState; readonly history: readonly CompletedSessionRecord[]; readonly invalidCount: number; readonly error?: string }
  | { readonly status: 'error'; readonly error: string }

function displayActive(result: SessionLoadResult | null) {
  if (!result) return 'Belum diperiksa'
  if (result.status === 'empty') return 'Tidak ada sesi aktif'
  if (result.status !== 'valid') return `Tidak valid / tidak tersedia (${result.status})`
  const value = result.value
  const score = Object.values(value.score.responses).reduce((total, answer) => total + (answer.status === 'completed' ? answer.points : 0), 0)
  return `instanceId ${value.instanceId} · fase ${value.cursor.phase} · revisi ${value.revision} · ${score} poin`
}

function CapabilityRow({ label, value }: { label: string; value: string }) {
  return <div className="stage5b2e-cap-row"><dt>{label}</dt><dd>{value}</dd></div>
}

export default function AcceptanceShell() {
  const capabilities = useMemo(() => inspectAcceptanceCapabilities({
    isSecureContext: window.isSecureContext,
    crypto: window.crypto,
    indexedDB: window.indexedDB,
  }), [])
  const diagnosticStore = useMemo(() => createUnifiedIndexedDbSessionStore({ databaseName: ACCEPTANCE_DATABASE_NAME }), [])
  const [diagnostics, setDiagnostics] = useState<DiagnosticState>({ status: 'opening' })
  const [notice, setNotice] = useState('')
  const canUseSessionFlow = capabilities.indexedDB && capabilities.secureRandom

  const refresh = useCallback(async () => {
    const [regular, challenge, history] = await Promise.all([
      diagnosticStore.load('regular'),
      diagnosticStore.load('challenge'),
      diagnosticStore.list({ limit: 100 }),
    ])
    const historyError = history.status === 'storage-error' ? history.code : undefined
    setDiagnostics({
      status: 'ready',
      snapshots: { regular, challenge },
      history: history.status === 'success' ? history.records : [],
      invalidCount: history.status === 'success' ? history.invalidCount : 0,
      ...(historyError ? { error: `Riwayat belum dapat dibaca: ${historyError}` } : {}),
    })
  }, [diagnosticStore])

  useEffect(() => {
    let live = true
    void diagnosticStore.open().then(async result => {
      if (!live) return
      if (result.status !== 'opened') { setDiagnostics({ status: 'error', error: result.code }); return }
      await refresh()
    }).catch(error => {
      if (live) setDiagnostics({ status: 'error', error: error instanceof Error ? error.message : 'unexpected' })
    })
    return () => { live = false; diagnosticStore.close() }
  }, [diagnosticStore, refresh])

  const persistenceFactory = useCallback((): SessionControllerOptions => ({
    store: createUnifiedIndexedDbSessionStore({ databaseName: ACCEPTANCE_DATABASE_NAME }),
    completionMode: 'atomic',
  }), [])

  const retryInitialization = useCallback(async () => {
    setDiagnostics({ status: 'opening' })
    const result = await diagnosticStore.open()
    if (result.status !== 'opened') { setDiagnostics({ status: 'error', error: result.code }); return }
    await refresh()
  }, [diagnosticStore, refresh])

  const history = diagnostics.status === 'ready' ? diagnostics.history : []
  return <main className="stage5b2e-shell">
    <header className="stage5b2e-banner">
      <p className="stage5b2e-warning">MODE PENGUJIAN — DATA TERPISAH</p>
      <h1>Penerimaan Android · Math Adventure</h1>
      <p>Halaman uji lokal. Tidak tersambung ke database aplikasi biasa.</p>
      <p className="stage5b2e-db-name"><strong>Database disposable v2:</strong> <code>{ACCEPTANCE_DATABASE_NAME}</code></p>
    </header>

    <section className="stage5b2e-diagnostics" aria-labelledby="stage5b2e-diagnostics-title">
      <div className="stage5b2e-section-heading">
        <h2 id="stage5b2e-diagnostics-title">Pemeriksaan lingkungan</h2>
        <button type="button" className="stage5b2e-refresh" onClick={() => void refresh()} disabled={diagnostics.status !== 'ready'}>Perbarui diagnosis</button>
      </div>
      <dl className="stage5b2e-capabilities">
        <CapabilityRow label="window.isSecureContext" value={String(capabilities.secureContext)} />
        <CapabilityRow label="crypto.subtle" value={capabilities.subtleCrypto ? 'tersedia' : 'tidak tersedia'} />
        <CapabilityRow label="crypto.getRandomValues" value={capabilities.secureRandom ? 'tersedia' : 'tidak tersedia'} />
        <CapabilityRow label="crypto.randomUUID" value={capabilities.randomUUID ? 'tersedia' : 'tidak tersedia (fallback CSPRNG dipakai)'} />
        <CapabilityRow label="IndexedDB API" value={capabilities.indexedDB ? 'tersedia' : 'tidak tersedia'} />
        <CapabilityRow label="Inisialisasi disposable v2" value={diagnostics.status === 'ready' ? 'BERHASIL' : diagnostics.status === 'error' ? `GAGAL: ${diagnostics.error}` : 'sedang membuka database uji…'} />
      </dl>
      {!capabilities.subtleCrypto && <p className="stage5b2e-note">crypto.subtle tidak tersedia pada origin ini. Tidak ada fallback validasi kriptografis: kode session, projection, dan history memakai validasi kontrak/schema; operasi sesi tetap memerlukan crypto.getRandomValues untuk seed dan instanceId.</p>}
      {!capabilities.secureRandom && <p className="stage5b2e-blocked" role="alert">BLOCKED: pembuatan seed dan instanceId memerlukan crypto.getRandomValues. Tidak ada fallback yang melemahkan keamanan.</p>}
      {diagnostics.status === 'error' && <div className="stage5b2e-blocked" role="alert"><p>Database disposable belum dapat diinisialisasi: {diagnostics.error}. Data tidak dihapus atau diganti.</p><button type="button" onClick={() => void retryInitialization()}>Coba inisialisasi lagi</button></div>}
    </section>

    <section className="stage5b2e-diagnostics" aria-labelledby="stage5b2e-history-title">
      <div className="stage5b2e-section-heading"><h2 id="stage5b2e-history-title">Penyimpanan uji</h2></div>
      <p><strong>Snapshot aktif Regular</strong><br />{diagnostics.status === 'ready' ? displayActive(diagnostics.snapshots.regular) : 'Belum siap'}</p>
      <p><strong>Snapshot aktif Challenge</strong><br />{diagnostics.status === 'ready' ? displayActive(diagnostics.snapshots.challenge) : 'Belum siap'}</p>
      <div className="stage5b2e-archive"><h3>Riwayat selesai (arsip immutable)</h3>
        {diagnostics.status === 'ready' && <p role="status">Riwayat valid: {history.length} · record tidak valid: {diagnostics.invalidCount}</p>}
        {diagnostics.status === 'ready' && diagnostics.error && <p role="alert">{diagnostics.error}</p>}
        {history.length === 0 && diagnostics.status === 'ready' && <p>Belum ada hasil selesai yang terarsip.</p>}
        <ol>{history.map(record => <li key={record.instanceId}>
          <strong>{record.mode === 'regular' ? 'Regular' : 'Challenge'} · {record.outcomes.reduce((sum, outcome) => sum + outcome.points, 0)} poin</strong>
          <span>instanceId: <code>{record.instanceId}</code></span>
          <span>jumlah outcome: {record.outcomes.length}</span>
          <span>recordedAt: {new Date(record.recordedAt).toLocaleString('id-ID')}</span>
          <span>validasi: VALID</span>
        </li>)}</ol>
      </div>
      <p className="stage5b2e-note">Diagnosis bersifat baca-saja. Halaman ini tidak menghapus database; riwayat tetap ada untuk pengujian refresh/reopen.</p>
    </section>

    {diagnostics.status === 'ready' && canUseSessionFlow
      ? <section className="stage5b2e-app" aria-label="Math Adventure acceptance app"><MathDrillApp onExit={() => { setNotice('Kembali ke latihan melalui kontrol aplikasi.'); void refresh() }} persistenceFactory={persistenceFactory} /></section>
      : diagnostics.status === 'ready' && <p className="stage5b2e-blocked" role="alert">BLOCKED: aplikasi tidak dibuka karena IndexedDB atau crypto.getRandomValues tidak tersedia.</p>}
    {notice && <p className="stage5b2e-note" role="status">{notice}</p>}
  </main>
}
