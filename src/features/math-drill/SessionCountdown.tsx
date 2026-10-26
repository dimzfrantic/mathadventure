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
  if (snapshot.timing.durationMs === null) return <p className="session-countdown">Tanpa batas waktu</p>
  if (snapshot.cursor.phase === 'timeout') return <p className="session-countdown" role="status">Waktu Habis</p>
  const remaining = remainingSessionMs(snapshot.timing, now) ?? 0
  return <p className="session-countdown" role="timer" aria-label={`Sisa waktu ${formatCountdown(remaining)}`} aria-live="off">
    Sisa waktu: <strong>{formatCountdown(remaining)}</strong>
  </p>
}
