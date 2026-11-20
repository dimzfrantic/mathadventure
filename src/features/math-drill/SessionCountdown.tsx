import { useEffect, useState } from 'react'
import type { SavedSessionV2 } from './persistence/sessionTypes'
import { formatCountdown, remainingSessionMs } from './persistence/sessionTimer'

export default function SessionCountdown({ snapshot }: { readonly snapshot: Pick<SavedSessionV2, 'timing' | 'cursor'> }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const interval = globalThis.setInterval(refresh, 1_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { globalThis.clearInterval(interval); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  if (snapshot.timing.durationMs === null) return <span className="session-countdown session-countdown-unlimited"><span aria-hidden="true">⏱️</span> Tanpa batas waktu</span>
  if (snapshot.cursor.phase === 'timeout') return <span className="session-countdown session-countdown-timeout" role="status"><span aria-hidden="true">⚠️</span> Waktu Habis</span>
  const remaining = remainingSessionMs(snapshot.timing, now) ?? 0
  return <span className="session-countdown session-countdown-timer" role="timer" aria-label={`Sisa waktu ${formatCountdown(remaining)}`} aria-live="off">
    <span aria-hidden="true">⏱️</span> Sisa waktu: <strong>{formatCountdown(remaining)}</strong>
  </span>
}
