import { beforeEach, describe, expect, it } from 'vitest'
import {
  SESSION_DURATION_OPTIONS,
  createSessionTiming,
  finishSessionTiming,
  formatCountdown,
  loadSessionDurationPreference,
  remainingSessionMs,
  saveSessionDurationPreference,
} from '../src/features/math-drill/persistence/sessionTimer'

const expectedDurations = [null, 300_000, 600_000, 900_000, 1_200_000, 1_800_000]

beforeEach(() => localStorage.clear())

describe('Stage 6 session timer contract', () => {
  it('exposes exactly the parent-selected whole-session durations', () => {
    expect(SESSION_DURATION_OPTIONS.map(option => option.durationMs)).toEqual(expectedDurations)
    expect(SESSION_DURATION_OPTIONS.map(option => option.label)).toEqual([
      'Tanpa Batas Waktu', '5 menit', '10 menit', '15 menit', '20 menit', '30 menit',
    ])
  })

  it('persists valid parent preference and treats corrupt values as unlimited', () => {
    for (const duration of expectedDurations) {
      expect(saveSessionDurationPreference(duration)).toBe(true)
      expect(loadSessionDurationPreference()).toBe(duration)
    }
    localStorage.setItem('math-adventure.session-duration.v1', '123456')
    expect(loadSessionDurationPreference()).toBe(null)
    expect(saveSessionDurationPreference(123456 as never)).toBe(false)
  })

  it('accepts, persists, and schedules each supported custom whole-minute duration', () => {
    for (const minutes of [1, 7, 12, 25, 120]) {
      const durationMs = minutes * 60_000
      expect(saveSessionDurationPreference(durationMs as never)).toBe(true)
      expect(loadSessionDurationPreference()).toBe(durationMs)
      expect(createSessionTiming(durationMs as never, 1_000)).toMatchObject({
        durationMs, startedAt: 1_000, deadlineAt: 1_000 + durationMs, endReason: null,
      })
    }
  })

  it('rejects custom durations that are blank-equivalent, non-positive, fractional-minute, or outside 1–120 minutes', () => {
    for (const durationMs of [0, -60_000, 60_001, 121 * 60_000, 123_456]) {
      expect(() => createSessionTiming(durationMs as never, 1_000)).toThrow('SESSION_TIMING_INVALID')
      expect(saveSessionDurationPreference(durationMs as never)).toBe(false)
    }
  })

  it('uses an absolute deadline and remains correct after an arbitrarily long background pause', () => {
    const timing = createSessionTiming(600_000, 1_000)
    expect(timing).toMatchObject({ durationMs: 600_000, startedAt: 1_000, deadlineAt: 601_000, endReason: null })
    expect(remainingSessionMs(timing, 2_000)).toBe(599_000)
    expect(remainingSessionMs(timing, 901_000)).toBe(0)
  })

  it('keeps unlimited sessions without an invented deadline or remaining-time value', () => {
    const timing = createSessionTiming(null, 1_000)
    expect(timing).toMatchObject({ durationMs: null, startedAt: 1_000, deadlineAt: null, remainingMs: null })
    expect(remainingSessionMs(timing, 99_000)).toBe(null)
    expect(finishSessionTiming(timing, 'completed', 99_000).remainingMs).toBe(null)
  })

  it('records zero time on timeout and positive remaining time on timely completion', () => {
    const timed = createSessionTiming(300_000, 10_000)
    expect(finishSessionTiming(timed, 'timeout', 310_001)).toMatchObject({ endReason: 'timeout', endedAt: 310_001, remainingMs: 0 })
    expect(finishSessionTiming(timed, 'completed', 100_000)).toMatchObject({ endReason: 'completed', endedAt: 100_000, remainingMs: 210_000 })
    expect(() => finishSessionTiming(timed, 'completed', 310_000)).toThrow()
  })

  it.each([
    [0, '00:00'], [1, '00:01'], [999, '00:01'], [1_000, '00:01'],
    [59_000, '00:59'], [60_000, '01:00'], [1_800_000, '30:00'],
  ])('formats %i ms as %s', (milliseconds, expected) => {
    expect(formatCountdown(milliseconds)).toBe(expected)
  })
})