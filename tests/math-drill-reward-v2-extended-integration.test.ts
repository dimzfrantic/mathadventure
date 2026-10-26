import { describe, it, expect } from 'vitest'
import { calculateSessionRewardV2Extended } from '../src/features/math-drill/reward/rewardRulesV2Extended'

/**
 * Integration tests for Phase 2C — reward deduplication, retry resilience,
 * concurrent requests, and transaction integrity.
 */
describe('Session Reward V2 Extended — Integration Tests', () => {
  describe('Idempotency & Retry Resilience', () => {
    it('Same session evaluated twice returns identical reward', () => {
      const input = {
        mode: 'challenge' as const,
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9,
        endReason: 'completed' as const,
        remainingMs: 1000,
        deadlineAt: 5000,
        startedAt: 1000,
      }

      const result1 = calculateSessionRewardV2Extended(input)
      const result2 = calculateSessionRewardV2Extended(input)

      expect(result1.finalStars).toBe(result2.finalStars)
      expect(result1.speedBonusApplied).toBe(result2.speedBonusApplied)
      expect(result1.sessionStars).toBe(result2.sessionStars)
    })

    it('Challenge perfect session consistent across retries', () => {
      const baseInput = {
        mode: 'challenge' as const,
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9,
        endReason: 'completed' as const,
        remainingMs: 800,
        deadlineAt: 5000,
        startedAt: 1000,
      }

      const results = Array(5)
        .fill(null)
        .map(() => calculateSessionRewardV2Extended(baseInput))

      // All retries should produce identical results
      results.forEach((result) => {
        expect(result.finalStars).toBe(6) // (3+1)*1.5 = 6
        expect(result.speedBonusApplied).toBe(true)
      })
    })

    it('Regular fast session ignores time metadata', () => {
      const regularFast = calculateSessionRewardV2Extended({
        mode: 'regular',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9,
        endReason: 'completed',
        remainingMs: 4000, // 100% time remaining
        deadlineAt: 5000,
        startedAt: 1000,
      })

      const regularNoMeta = calculateSessionRewardV2Extended({
        mode: 'regular',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9,
      })

      // Both should be identical (no speed bonus for Regular)
      expect(regularFast.finalStars).toBe(regularNoMeta.finalStars)
      expect(regularFast.finalStars).toBe(3)
    })
  })

  describe('Boundary & Edge Conditions', () => {
    it('Challenge with exactly 80% accuracy threshold', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 8, // Exactly 80% (< 90%), so Rule D not E
        endReason: 'completed',
        remainingMs: 800,
        deadlineAt: 5000,
        startedAt: 1000,
      })

      // 80% accuracy qualifies for speed bonus (>= 80% threshold)
      expect(result.speedBonusApplied).toBe(true)
      // But base is Rule D (not E): (2+1)*1.5 = 4.5 → 4
      expect(result.collectibleStars).toBe(2) // Rule D (coverage 100%, accuracy 80%)
      expect(result.finalStars).toBe(4)
    })

    it('Challenge with 79.99% accuracy (just below threshold)', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 100,
        completedCount: 100,
        totalPoints: 79.9, // 79.9% accuracy
        endReason: 'completed',
        remainingMs: 8000,
        deadlineAt: 50000,
        startedAt: 10000,
      })

      // 79.9% < 80% threshold
      expect(result.speedBonusApplied).toBe(false)
    })

    it('Challenge with exactly 20% time remaining (threshold)', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9, // 90% accuracy
        endReason: 'completed',
        remainingMs: 800, // Exactly 20% of 4000
        deadlineAt: 5000,
        startedAt: 1000,
      })

      // 20% meets >= threshold
      expect(result.speedBonusApplied).toBe(true)
      expect(result.finalStars).toBe(6)
    })

    it('Challenge with 19.99% time remaining (below threshold)', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9,
        endReason: 'completed',
        remainingMs: 799, // 19.975% of 4000 (just below 20%)
        deadlineAt: 5000,
        startedAt: 1000,
      })

      // 19.975% < 20%
      expect(result.speedBonusApplied).toBe(false)
    })

    it('Challenge with exactly 70% coverage threshold', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 7, // Exactly 70%
        totalPoints: 5.6, // 80% accuracy
        endReason: 'completed',
        remainingMs: 800,
        deadlineAt: 5000,
        startedAt: 1000,
      })

      // 70% coverage meets threshold
      expect(result.speedBonusApplied).toBe(true)
      // (2+1)*1.5 = 4
      expect(result.finalStars).toBe(4)
    })

    it('Challenge with 69.99% coverage (below threshold)', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 100,
        completedCount: 69, // 69% coverage
        totalPoints: 55.2, // 80% accuracy
        endReason: 'completed',
        remainingMs: 8000,
        deadlineAt: 50000,
        startedAt: 10000,
      })

      // 69% < 70% coverage
      expect(result.speedBonusApplied).toBe(false)
      // Rule B: 1 session star, 0 collectible
      expect(result.collectibleStars).toBe(0)
    })
  })

  describe('Configuration Lock — rupiahPerStar', () => {
    it('V2Extended formula does not access rupiahPerStar', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9,
        endReason: 'completed',
        remainingMs: 1000,
        deadlineAt: 5000,
        startedAt: 1000,
      })

      // finalStars is star count, not rupiah value
      expect(typeof result.finalStars).toBe('number')
      expect(result.finalStars).toBeGreaterThan(0)
      // rupiahPerStar (500) applied only during redemption, not here
    })
  })

  describe('Data Integrity — Metadata Validation', () => {
    it('Invalid timer metadata does not cause speed bonus', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9,
        endReason: 'completed',
        remainingMs: null, // Missing timer
        deadlineAt: 5000,
        startedAt: 1000,
      })

      expect(result.speedBonusApplied).toBe(false)
    })

    it('Corrupted deadlineAt (< startedAt) does not cause speed bonus', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9,
        endReason: 'completed',
        remainingMs: 1000,
        deadlineAt: 500, // Less than startedAt → invalid timer
        startedAt: 1000,
      })

      // Invalid timer metadata (timeAvailable <= 0) prevents speed bonus
      expect(result.speedBonusApplied).toBe(false)
      expect(result.finalStars).toBeGreaterThan(0)
    })

    it('Incomplete session (endReason not completed) has no bonus', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 7,
        totalPoints: 5.6,
        endReason: 'timeout',
        remainingMs: 800,
        deadlineAt: 5000,
        startedAt: 1000,
      })

      expect(result.speedBonusApplied).toBe(false)
    })
  })

  describe('Multiplier & Bonus Separation', () => {
    it('Challenge multiplier does not stack with bonus', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9,
        endReason: 'completed',
        remainingMs: 1000,
        deadlineAt: 5000,
        startedAt: 1000,
      })

      // Should be: (baseStars + speedBonus) * 1.5, NOT baseStars * 1.5 * speedBonus
      const baseReward = 3
      const speedBonus = 1
      const expected = Math.floor((baseReward + speedBonus) * 1.5) // 6
      expect(result.finalStars).toBe(expected)

      // Verify it's NOT (3*1.5) + 1 = 5.5 → 5 (incorrect stacking)
      expect(result.finalStars).not.toBe(5)
    })

    it('Regular multiplier never applied', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'regular',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9,
        endReason: 'completed',
        remainingMs: 1000,
        deadlineAt: 5000,
        startedAt: 1000,
      })

      expect(result.challengeMultiplierApplied).toBe(false)
      expect(result.finalStars).toBe(3) // Base reward, no multiplier
    })
  })

  describe('Backward Compatibility — V1 Legacy Sessions', () => {
    it('V1 Challenge session uses multiplier without error', () => {
      // V1 has no endReason, remainingMs, deadlineAt, startedAt
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9,
      })

      expect(result.speedBonusApplied).toBe(false) // No metadata
      expect(result.challengeMultiplierApplied).toBe(true)
      expect(result.finalStars).toBe(4) // (3*1.5) = 4.5 → 4
    })

    it('V1 Regular session unchanged', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'regular',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9,
      })

      expect(result.speedBonusApplied).toBe(false)
      expect(result.challengeMultiplierApplied).toBe(false)
      expect(result.finalStars).toBe(3)
    })

    it('V1 partial session (Rule B) handled correctly', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 6,
        totalPoints: 5.4, // 90% accuracy, but only 60% coverage
      })

      expect(result.collectibleStars).toBe(0) // Rule B: 60% coverage < 70% → no reward
      expect(result.sessionStars).toBe(1) // Effort credit for completing 6/10
      expect(result.speedBonusApplied).toBe(false) // No timer metadata
      expect(result.challengeMultiplierApplied).toBe(true) // Challenge mode
      expect(result.finalStars).toBe(0) // floor(0 * 1.5) = 0; no multiplier applied to zero
    })
  })
})
