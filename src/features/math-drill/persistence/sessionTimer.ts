export type SessionDurationMs = number | null
export type SessionEndReason = 'completed' | 'timeout'
export interface SessionTiming {
  readonly durationMs: SessionDurationMs
  readonly startedAt: number
  readonly deadlineAt: number | null
  readonly endedAt: number | null
  readonly remainingMs: number | null
  readonly endReason: SessionEndReason | null
}
export interface SessionDurationOption { readonly durationMs: SessionDurationMs; readonly label: string }
export const SESSION_DURATION_OPTIONS: readonly SessionDurationOption[] = [
  { durationMs: null, label: 'Tanpa Batas Waktu' },
  { durationMs: 300_000, label: '5 menit' },
  { durationMs: 600_000, label: '10 menit' },
  { durationMs: 900_000, label: '15 menit' },
  { durationMs: 1_200_000, label: '20 menit' },
  { durationMs: 1_800_000, label: '30 menit' },
]
const preferenceKey = 'math-adventure.session-duration.v1'

function validTimestamp(value: number): boolean { return Number.isSafeInteger(value) && value >= 0 }
export function isValidSessionDurationMs(value: unknown): value is SessionDurationMs {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 60_000 && value <= 120 * 60_000 && value % 60_000 === 0)
}
function browserStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

export function createSessionTiming(durationMs: SessionDurationMs, startedAt: number): SessionTiming {
  if (!isValidSessionDurationMs(durationMs) || !validTimestamp(startedAt)) throw new TypeError('SESSION_TIMING_INVALID')
  const deadlineAt = durationMs === null ? null : startedAt + durationMs
  if (deadlineAt !== null && !validTimestamp(deadlineAt)) throw new TypeError('SESSION_DEADLINE_INVALID')
  return { durationMs, startedAt, deadlineAt, endedAt: null, remainingMs: null, endReason: null }
}

export function finishSessionTiming(timing: SessionTiming, endReason: SessionEndReason, endedAt: number): SessionTiming {
  if (!validTimestamp(endedAt) || timing.endedAt !== null || timing.endReason !== null) throw new TypeError('SESSION_END_INVALID')
  if (timing.durationMs === null) {
    if (endReason === 'timeout') throw new TypeError('UNLIMITED_SESSION_TIMEOUT_INVALID')
    return { ...timing, endedAt, endReason, remainingMs: null }
  }
  if (timing.deadlineAt === null) throw new TypeError('SESSION_DEADLINE_INVALID')
  if (endReason === 'timeout' && endedAt < timing.deadlineAt) throw new TypeError('SESSION_TIMEOUT_EARLY')
  if (endReason === 'completed' && endedAt >= timing.deadlineAt) throw new TypeError('SESSION_COMPLETION_LATE')
  return { ...timing, endedAt, endReason, remainingMs: endReason === 'timeout' ? 0 : timing.deadlineAt - endedAt }
}

export function remainingSessionMs(timing: SessionTiming, now: number): number | null {
  if (!validTimestamp(now)) throw new TypeError('SESSION_CLOCK_INVALID')
  if (timing.durationMs === null) return null
  if (timing.endedAt !== null) return timing.remainingMs
  if (timing.deadlineAt === null) throw new TypeError('SESSION_DEADLINE_INVALID')
  return Math.max(0, timing.deadlineAt - now)
}

export function formatCountdown(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) throw new TypeError('COUNTDOWN_INVALID')
  const totalSeconds = Math.ceil(Math.max(0, milliseconds) / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function loadSessionDurationPreference(storage?: Pick<Storage, 'getItem'>): SessionDurationMs {
  const source = storage ?? browserStorage()
  if (!source) return null
  try {
    const raw = source.getItem(preferenceKey)
    if (raw === 'unlimited') return null
    const duration = raw === null ? null : Number(raw)
    return isValidSessionDurationMs(duration) ? duration : null
  } catch { return null }
}

export function saveSessionDurationPreference(durationMs: SessionDurationMs, storage?: Pick<Storage, 'setItem'>): boolean {
  if (!isValidSessionDurationMs(durationMs)) return false
  const target = storage ?? browserStorage()
  if (!target) return false
  try { target.setItem(preferenceKey, durationMs === null ? 'unlimited' : String(durationMs)); return true } catch { return false }
}