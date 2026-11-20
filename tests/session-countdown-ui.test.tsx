import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SessionCountdown from '../src/features/math-drill/SessionCountdown'
import type { SavedRegularSessionV2 } from '../src/features/math-drill/persistence/sessionTypes'

describe('SessionCountdown UI', () => {
  function createSnapshot(durationMs: number | null, phase: 'question' | 'round' | 'result' | 'timeout' = 'question'): SavedRegularSessionV2 {
    return {
      schemaVersion: 2,
      mode: 'regular',
      instanceId: 'inst-test',
      sessionId: 'sess-test',
      revision: 1,
      createdAt: 1000,
      updatedAt: 1000,
      cursor: { questionIndex: 0, phase, roundNumber: 1 },
      session: { id: 'sess-test', mode: 'regular', questions: [], rounds: [] },
      score: { answers: {} },
      timing: {
        durationMs,
        startedAt: 1000,
        deadlineAt: durationMs !== null ? 1000 + durationMs : null,
        endedAt: null,
        endReason: null,
        remainingMs: null,
      },
    }
  }

  it('renders inline badge with "Tanpa batas waktu" for unlimited sessions', () => {
    const snapshot = createSnapshot(null)
    render(<SessionCountdown snapshot={snapshot} />)
    const badge = screen.getByText(/Tanpa batas waktu/i)
    expect(badge).toBeInTheDocument()
    expect(badge.tagName.toLowerCase()).toBe('span')
    expect(badge.className).toContain('session-countdown')
    expect(badge.className).toContain('session-countdown-unlimited')
  })

  it('renders countdown timer badge when duration is active', () => {
    const snapshot = createSnapshot(180000)
    render(<SessionCountdown snapshot={snapshot} />)
    const timer = screen.getByRole('timer')
    expect(timer).toBeInTheDocument()
    expect(timer.tagName.toLowerCase()).toBe('span')
    expect(timer.className).toContain('session-countdown-timer')
    expect(timer).toHaveTextContent(/Sisa waktu/i)
  })

  it('renders timeout status badge when session timed out', () => {
    const snapshot = createSnapshot(60000, 'timeout')
    render(<SessionCountdown snapshot={snapshot} />)
    const status = screen.getByRole('status')
    expect(status).toBeInTheDocument()
    expect(status.tagName.toLowerCase()).toBe('span')
    expect(status.className).toContain('session-countdown-timeout')
    expect(status).toHaveTextContent(/Waktu Habis/i)
  })
})
