import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionRewardStars } from '../src/features/math-drill/SessionRewardStars'
import type { SavedRegularSessionV2 } from '../src/features/math-drill/persistence/sessionTypes'

describe('SessionRewardStars Component', () => {
  it('renders 3 stars for regular drill with perfect completion and accuracy', () => {
    render(
      <SessionRewardStars
        mode="regular"
        plannedCount={10}
        completedCount={10}
        totalPoints={10}
      />
    )
    expect(screen.getByTestId('drill-reward-stars')).toBeInTheDocument()
    expect(screen.getByText('+3 Bintang Diperoleh!')).toBeInTheDocument()
    expect(screen.getByText('Bintang sudah otomatis masuk ke tabunganmu.')).toBeInTheDocument()
  })

  it('renders 2 stars for >=70% completion with good accuracy', () => {
    render(
      <SessionRewardStars
        mode="regular"
        plannedCount={10}
        completedCount={8}
        totalPoints={6} // 75% accuracy
      />
    )
    expect(screen.getByText('+2 Bintang Diperoleh!')).toBeInTheDocument()
  })

  it('renders 1 star for >=70% completion with lower accuracy', () => {
    render(
      <SessionRewardStars
        mode="regular"
        plannedCount={10}
        completedCount={7}
        totalPoints={3} // ~42.8% accuracy
      />
    )
    expect(screen.getByText('+1 Bintang Diperoleh!')).toBeInTheDocument()
  })

  it('renders ineligible guidance when completion is below 70%', () => {
    render(
      <SessionRewardStars
        mode="regular"
        plannedCount={10}
        completedCount={5}
        totalPoints={5}
        isTimeout={true}
      />
    )
    expect(screen.getByText('Belum Mendapatkan Bintang')).toBeInTheDocument()
    expect(screen.getByText(/Selesaikan minimal 70% soal/i)).toBeInTheDocument()
  })

  it('displays challenge multiplier badge for challenge mode', () => {
    render(
      <SessionRewardStars
        mode="challenge"
        plannedCount={10}
        completedCount={10}
        totalPoints={7} // base 2 stars -> * 1.5 = 3 stars
      />
    )
    expect(screen.getByText('🚀 Mode Tantangan (1.5x)')).toBeInTheDocument()
    expect(screen.getByText('+3 Bintang Diperoleh!')).toBeInTheDocument()
  })

  it('displays speed bonus badge when completed fast on timed session', () => {
    const timedSnapshot = {
      schemaVersion: 2,
      mode: 'challenge' as const,
      instanceId: 'inst-1',
      sessionId: 'sess-1',
      revision: 1,
      createdAt: 1000,
      updatedAt: 2000,
      cursor: { questionIndex: 10, phase: 'result' as const, roundNumber: 2 },
      session: { id: 'sess-1', mode: 'challenge' as const, questions: [], rounds: [] },
      score: { answers: {} },
      timing: {
        durationMs: 60000,
        startedAt: 1000,
        deadlineAt: 61000,
        endedAt: 21000, // finished in 20s (40s remaining / 60s total = 66% >= 20% threshold)
        endReason: 'completed' as const,
        remainingMs: 40000,
      },
    }

    render(
      <SessionRewardStars
        mode="challenge"
        plannedCount={10}
        completedCount={10}
        totalPoints={8} // base 2 stars + 1 speed bonus = 3 stars * 1.5 = floor(4.5) = 4
        snapshot={timedSnapshot}
      />
    )
    expect(screen.getByText('⚡ Bonus Kecepatan (+1 ⭐)')).toBeInTheDocument()
    expect(screen.getByText('+4 Bintang Diperoleh!')).toBeInTheDocument()
  })
})
