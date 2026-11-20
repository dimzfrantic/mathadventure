import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { getChildRewardSummary, submitChildRewardRequest, type ChildRewardSummary } from './api/childRewardApi'

const INTENT_KEY = 'math-child-redemption-intent'
type Intent = { readonly stars: number; readonly key: string }
function readIntent(): Intent | null {
  try {
    const raw = sessionStorage.getItem(INTENT_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object' && 'stars' in value && 'key' in value
      && Number.isSafeInteger(value.stars) && typeof value.key === 'string' && /^[a-f0-9]{32}$/.test(value.key)) return { stars: value.stars as number, key: value.key }
  } catch { /* storage unavailable; fail closed on submit */ }
  return null
}
function newKey(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}
const rupiah = (value: number) => `Rp ${value.toLocaleString('id-ID')}`
const statusLabel: Record<ChildRewardSummary['recentTransactions'][number]['status'], string> = {
  pending: 'Menunggu orang tua', confirmed: 'Sudah ditukar', cancelled: 'Tidak jadi ditukar',
}

export function ChildRedemption() {
  const [summary, setSummary] = useState<ChildRewardSummary | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [stars, setStars] = useState(() => String(readIntent()?.stars ?? 1))
  const [uncertain, setUncertain] = useState(() => readIntent() !== null)
  const submitting = useRef(false)
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const latest = await getChildRewardSummary()
      setSummary(latest)
      setError('')
      return latest
    } catch (caught) {
      setSummary(null)
      setError(caught instanceof Error ? caught.message : 'Layanan bintang belum tersedia.')
      return null
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const amount = stars.trim() === '' ? NaN : Number(stars)
  const invalid = summary && !uncertain && (!Number.isSafeInteger(amount) || amount < summary.minStarsPerRedemption
    || amount > summary.maxStarsPerRedemption || amount > summary.availableStars)
  const validationMessage = !summary || !invalid || summary.availableStars < summary.minStarsPerRedemption ? '' : !Number.isSafeInteger(amount) || amount < summary.minStarsPerRedemption
    ? `Pilih paling sedikit ${summary.minStarsPerRedemption} bintang.`
    : amount > summary.maxStarsPerRedemption ? `Pilih paling banyak ${summary.maxStarsPerRedemption} bintang.`
      : 'Bintang yang bisa ditukar belum cukup.'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || !summary || invalid || loading) return
    submitting.current = true
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      let intent = readIntent()
      if (intent && intent.stars !== amount) {
        setError('Permintaan sebelumnya belum pasti. Coba lagi dengan jumlah sebelumnya.')
        setUncertain(true)
        return
      }
      if (!intent) {
        intent = { stars: amount, key: newKey() }
        sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent))
      }
      const response = await submitChildRewardRequest(amount, intent.key)
      if (response.status === 'success') {
        sessionStorage.removeItem(INTENT_KEY)
        setUncertain(false)
        setSuccess('Permintaan terkirim! Tunggu persetujuan orang tua.')
        setSummary(null)
        const latest = await refresh()
        if (latest) setStars(latest.availableStars >= latest.minStarsPerRedemption ? String(latest.minStarsPerRedemption) : '')
      } else if (response.status === 'rejected') {
        sessionStorage.removeItem(INTENT_KEY)
        setUncertain(false)
        await refresh()
        setError(response.reason || 'Jumlah bintang tidak dapat diajukan.')
      } else {
        setUncertain(true)
        setError('Status permintaan belum pasti karena jaringan. Coba lagi dengan jumlah yang sama; tidak dikirim ulang otomatis.')
      }
    } catch {
      setError('Penyimpanan browser tidak tersedia. Permintaan tidak dikirim.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return <details className="drill-card child-reward" aria-label="Tukar Bintang">
    <summary><span>Tukar Bintang</span>{summary && <span className="child-reward-quick">Bisa ditukar: {summary.availableStars}</span>}</summary>
    {loading && <p role="status">Memuat bintang…</p>}
    {error && <p role="alert" className="drill-error">{error}</p>}
    {summary && <>
      <dl className="child-reward-balances">
        <div><dt>Bintang terkumpul</dt><dd data-testid="child-earned">{summary.totalEarned}</dd></div>
        <div><dt>Menunggu persetujuan</dt><dd data-testid="child-pending">{summary.pendingStars}</dd></div>
        <div><dt>Sudah ditukar</dt><dd data-testid="child-confirmed">{summary.confirmedStars}</dd></div>
        <div><dt>Bisa ditukar lagi</dt><dd data-testid="child-available">{summary.availableStars}</dd></div>
      </dl>
      <form onSubmit={event => void submit(event)} className="drill-form">
        <label>Jumlah bintang
          <input type="number" inputMode="numeric" min={summary.minStarsPerRedemption} max={Math.min(summary.availableStars, summary.maxStarsPerRedemption)} step="1" value={stars} disabled={busy || uncertain} onChange={event => setStars(event.target.value)} />
        </label>
        <p data-testid="child-preview">Perkiraan hadiah: {Number.isSafeInteger(amount) && amount > 0 && !invalid ? rupiah(amount * summary.rupiahPerStar) : '—'}</p>
        {validationMessage && <p role="alert" className="drill-error">{validationMessage}</p>}
        <button type="submit" className="drill-primary" disabled={busy || loading || !!invalid || summary.availableStars === 0}>Ajukan ke Orang Tua</button>
      </form>
      {success && <p role="status">{success}</p>}
      <h3>Penukaran terakhir</h3>
      {summary.recentTransactions.length === 0 ? <p>Belum ada penukaran.</p> :
        <ul className="child-reward-history">{summary.recentTransactions.map((tx, index) => <li key={`${tx.requestedAt}-${index}`}>
          {tx.starsRedeemed} bintang · {rupiah(tx.rupiahValue)} · {statusLabel[tx.status]}
        </li>)}</ul>}
      <button type="button" className="drill-secondary" disabled={busy} onClick={() => void refresh()}>Perbarui saldo</button>
    </>}
  </details>
}
