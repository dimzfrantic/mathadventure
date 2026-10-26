import { useState } from 'react'
import { isValidSessionDurationMs, SESSION_DURATION_OPTIONS } from './persistence/sessionTimer'
import type { SessionDurationMs } from './persistence/sessionTimer'

type Props = {
  readonly value: SessionDurationMs
  readonly onChange: (durationMs: SessionDurationMs) => void
  readonly onValidityChange: (valid: boolean) => void
}

function isCustomDuration(value: SessionDurationMs): value is number {
  return value !== null && !SESSION_DURATION_OPTIONS.some(option => option.durationMs === value)
}

function parseMinutes(raw: string): { readonly durationMs: number } | { readonly error: string } {
  if (raw.trim() === '') return { error: 'Masukkan durasi custom 1–120 menit.' }
  if (!/^[0-9]+$/.test(raw)) return { error: 'Gunakan bilangan bulat positif antara 1–120 menit.' }
  const minutes = Number(raw)
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 120) {
    return { error: 'Durasi custom harus antara 1 dan 120 menit.' }
  }
  const durationMs = minutes * 60_000
  return isValidSessionDurationMs(durationMs)
    ? { durationMs }
    : { error: 'Durasi custom harus antara 1 dan 120 menit.' }
}

export default function SessionDurationControl({ value, onChange, onValidityChange }: Props) {
  const [selection, setSelection] = useState(() => isCustomDuration(value) ? 'custom' : value === null ? 'unlimited' : String(value))
  const [customMinutes, setCustomMinutes] = useState(() => isCustomDuration(value) ? String(value / 60_000) : '')
  const [error, setError] = useState('')

  function applyCustomMinutes(raw: string) {
    setCustomMinutes(raw)
    const parsed = parseMinutes(raw)
    if ('error' in parsed) {
      setError(parsed.error)
      onValidityChange(false)
      return
    }
    setError('')
    onValidityChange(true)
    onChange(parsed.durationMs)
  }

  function changeSelection(next: string) {
    setSelection(next)
    if (next === 'custom') {
      const parsed = parseMinutes(customMinutes)
      if ('error' in parsed) {
        setError(parsed.error)
        onValidityChange(false)
      } else {
        setError('')
        onValidityChange(true)
        onChange(parsed.durationMs)
      }
      return
    }
    setError('')
    onValidityChange(true)
    if (next === 'unlimited') {
      onChange(null)
      return
    }
    const durationMs = Number(next)
    if (!SESSION_DURATION_OPTIONS.some(option => option.durationMs === durationMs)) {
      setError('Pilih durasi yang tersedia.')
      onValidityChange(false)
      return
    }
    onChange(durationMs)
  }

  return <>
    <label>Durasi sesi
      <select aria-label="Durasi sesi" value={selection} onChange={event => changeSelection(event.target.value)}>
        {SESSION_DURATION_OPTIONS.map(option => <option key={option.label} value={option.durationMs === null ? 'unlimited' : String(option.durationMs)}>{option.label}</option>)}
        <option value="custom">Custom (1–120 menit)</option>
      </select>
    </label>
    {selection === 'custom' && <>
      <label>Durasi custom (menit)
        <input
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'session-duration-custom-error' : undefined}
          inputMode="numeric"
          type="number"
          min="1"
          max="120"
          step="1"
          required
          value={customMinutes}
          onChange={event => applyCustomMinutes(event.target.value)}
        />
      </label>
      {error && <p id="session-duration-custom-error" className="drill-error" role="alert">{error}</p>}
    </>}
  </>
}
