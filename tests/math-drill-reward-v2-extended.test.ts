import { describe, it, expect } from 'vitest'
import { calculateSessionRewardV2Extended } from '../src/features/math-drill/reward/rewardRulesV2Extended'

describe('Session Reward V2 Extended — Challenge & Speed Bonus', () => {
  describe('Regular mode — no speed bonus, no multiplier', () => {
    it('R1: Regular perfect session (100% coverage, 95% accuracy)', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'regular',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9.5,
        endReason: 'completed',
        remainingMs: 1000,
        deadlineAt: 5000,
        startedAt: 1000,
      })

      expect(result.sessionStars).toBe(3)
      expect(result.collectibleStars).toBe(3)
      expect(result.ruleTier).toBe('perfect-high-accuracy')
      expect(result.speedBonusApplied).toBe(false)
      expect(result.challengeMultiplierApplied).toBe(false)
      expect(result.finalStars).toBe(3) // No multiplier
    })

    it('R2: Regular good pass (70% coverage, 80% accuracy), fast', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'regular',
        plannedCount: 10,
        completedCount: 7,
        totalPoints: 5.6, // 80% accuracy
        endReason: 'completed',
        remainingMs: 800, // 20% of 4000
        deadlineAt: 5000,
        startedAt: 1000,
      })

      expect(result.collectibleStars).toBe(2)
      expect(result.speedBonusApplied).toBe(false) // Regular: no speed bonus
      expect(result.challengeMultiplierApplied).toBe(false)
      expect(result.finalStars).toBe(2)
    })

    it('R3: Regular fast but should not get speed bonus', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'regular',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9,
        endReason: 'completed',
        remainingMs: 3500, // 87.5% time remaining (very fast)
        deadlineAt: 5000,
        startedAt: 1000,
      })

      expect(result.finalStars).toBe(3) // Rule E, no speed bonus
      expect(result.speedBonusApplied).toBe(false)
    })
  })

  describe('Challenge mode — base reward with multiplier', () => {
    it('C1: Challenge perfect, slow (no speed bonus)', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9.5,
        endReason: 'completed',
        remainingMs: 500, // 12.5% — below 20% threshold
        deadlineAt: 5000,
        startedAt: 1000,
      })

      expect(result.collectibleStars).toBe(3)
      expect(result.speedBonusApplied).toBe(false)
      expect(result.challengeMultiplierApplied).toBe(true)
      expect(result.finalStars).toBe(Math.floor(3 * 1.5)) // floor(4.5) = 4
      expect(result.finalStars).toBe(4)
    })

    it('C2: Challenge perfect, exactly at speed threshold (20% remaining)', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9.5,
        endReason: 'completed',
        remainingMs: 800, // Exactly 20% of 4000 (5000-1000)
        deadlineAt: 5000,
        startedAt: 1000,
      })

      expect(result.collectibleStars).toBe(3)
      expect(result.speedBonusApplied).toBe(true) // 20% meets >= threshold
      expect(result.challengeMultiplierApplied).toBe(true)
      expect(result.finalStars).toBe(Math.floor(4 * 1.5)) // floor(6.0) = 6
      expect(result.finalStars).toBe(6)
    })

    it('C3: Challenge perfect, fast (>20% remaining), high accuracy', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9,
        endReason: 'completed',
        remainingMs: 1000, // 25% of 4000
        deadlineAt: 5000,
        startedAt: 1000,
      })

      expect(result.speedBonusApplied).toBe(true)
      expect(result.finalStars).toBe(Math.floor((3 + 1) * 1.5)) // floor(6.0) = 6
      expect(result.finalStars).toBe(6)
    })

    it('C4: Challenge good pass, fast (>=20%, >=80% accuracy)', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 7,
        totalPoints: 5.6, // 80% accuracy
        endReason: 'completed',
        remainingMs: 800, // 20% of 4000
        deadlineAt: 5000,
        startedAt: 1000,
      })

      expect(result.collectibleStars).toBe(2)
      expect(result.speedBonusApplied).toBe(true)
      expect(result.finalStars).toBe(Math.floor((2 + 1) * 1.5)) // floor(4.5) = 4
      expect(result.finalStars).toBe(4)
    })

    it('C5: Challenge marginal pass (50% coverage, 80% accuracy) — no speed bonus, coverage too low', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 5,
        totalPoints: 4, // 80% accuracy but coverage only 50%
        endReason: 'completed',
        remainingMs: 800,
        deadlineAt: 5000,
        startedAt: 1000,
      })

      // Coverage 50% < 70%, so Rule B applies
      expect(result.collectibleStars).toBe(0) // Rule B
      expect(result.sessionStars).toBe(1)
      expect(result.speedBonusApplied).toBe(false) // Coverage < 70%
      expect(result.challengeMultiplierApplied).toBe(true)
      expect(result.finalStars).toBe(0) // floor(0 * 1.5) = 0; multiplier applied to collectibleStars, not sessionStars
    })

    it('C6: Challenge good pass (70% coverage, 70% accuracy), fast but accuracy < 80%', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 7,
        totalPoints: 4.9, // 70% accuracy exactly (5*9.8=49 >= 7*7=49 ✓ Rule D)
        endReason: 'completed',
        remainingMs: 1000, // 25% time remaining
        deadlineAt: 5000,
        startedAt: 1000,
      })

      expect(result.collectibleStars).toBe(2) // Rule D (coverage 70%, accuracy 70%)
      expect(result.speedBonusApplied).toBe(false) // Accuracy = 70%, but need >= 80%
      expect(result.challengeMultiplierApplied).toBe(true)
      expect(result.finalStars).toBe(Math.floor(2 * 1.5)) // floor(3.0) = 3
      expect(result.finalStars).toBe(3)
    })

    it('C7: Challenge low accuracy (< 80%) — no speed bonus even if fast', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 7,
        totalPoints: 5, // 71% accuracy
        endReason: 'completed',
        remainingMs: 3500, // Very fast (87.5%)
        deadlineAt: 5000,
        startedAt: 1000,
      })

      expect(result.speedBonusApplied).toBe(false) // Accuracy < 80%
    })

    it('C8: Challenge partial (< 70% coverage), fast — no bonus despite speed', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 6,
        totalPoints: 5.4, // 90% accuracy (but coverage 60% < 70%)
        endReason: 'completed',
        remainingMs: 1000, // 25% time remaining
        deadlineAt: 5000,
        startedAt: 1000,
      })

      expect(result.collectibleStars).toBe(0) // Rule B: coverage < 70%
      expect(result.speedBonusApplied).toBe(false) // Coverage < 70%, no bonus
      expect(result.sessionStars).toBe(1) // Session star for effort
      expect(result.challengeMultiplierApplied).toBe(true)
      expect(result.finalStars).toBe(0) // floor(0 * 1.5) = 0; multiplier applied to collectibleStars, not sessionStars
    })
  })

  describe('Challenge mode — timeout, incomplete, invalid metadata', () => {
    it('C9: Challenge timeout — no speed bonus despite good stats', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 7,
        totalPoints: 5.6,
        endReason: 'timeout', // Not 'completed'
        remainingMs: 0,
        deadlineAt: 5000,
        startedAt: 1000,
      })

      expect(result.speedBonusApplied).toBe(false) // endReason != 'completed'
    })

    it('C10: Challenge no timer metadata — no speed bonus', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9,
        endReason: 'completed',
        remainingMs: undefined,
        deadlineAt: undefined,
        startedAt: undefined,
      })

      expect(result.speedBonusApplied).toBe(false) // Metadata missing
    })

    it('C11: Challenge incomplete (0 questions) — no reward', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 0,
        totalPoints: 0,
        endReason: 'completed',
        remainingMs: 4000,
        deadlineAt: 5000,
        startedAt: 1000,
      })

      expect(result.collectibleStars).toBe(0)
      expect(result.speedBonusApplied).toBe(false)
      expect(result.finalStars).toBe(0)
    })
  })

  describe('Fractional stars — floor() rounding', () => {
    it('Fractional 1.5 rounds down to 1', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 7,
        totalPoints: 4.9, // 70% accuracy exactly → Rule D → 2 collectible stars
        endReason: 'completed',
        remainingMs: 500,
        deadlineAt: 5000,
        startedAt: 1000,
      })

      expect(result.collectibleStars).toBe(2) // Rule D
      expect(result.speedBonusApplied).toBe(false) // Accuracy not >= 80%
      expect(result.finalStars).toBe(Math.floor(2 * 1.5)) // floor(3.0) = 3
      expect(result.finalStars).toBe(3)
    })

    it('Fractional 4.5 rounds down to 4', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 7,
        totalPoints: 5.6,
        endReason: 'completed',
        remainingMs: 800, // Speed bonus applies
        deadlineAt: 5000,
        startedAt: 1000,
      })

      expect(result.finalStars).toBe(Math.floor((2 + 1) * 1.5)) // 4.5 → 4
      expect(result.finalStars).toBe(4)
    })

    it('Exact 6.0 — no rounding needed', () => {
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

      expect(result.finalStars).toBe(Math.floor((3 + 1) * 1.5)) // 6.0 → 6
      expect(result.finalStars).toBe(6)
    })
  })

  describe('V1 legacy sessions — no timer metadata', () => {
    it('V1 Challenge session — applies multiplier but no speed bonus', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'challenge',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9,
        // No endReason, remainingMs, deadlineAt, startedAt (V1 legacy)
      })

      expect(result.speedBonusApplied).toBe(false)
      expect(result.challengeMultiplierApplied).toBe(true)
      expect(result.finalStars).toBe(4) // Rule E (3) * 1.5 = 4.5 → 4
    })

    it('V1 Regular session — unchanged (no multiplier, no bonus)', () => {
      const result = calculateSessionRewardV2Extended({
        mode: 'regular',
        plannedCount: 10,
        completedCount: 10,
        totalPoints: 9,
      })

      expect(result.speedBonusApplied).toBe(false)
      expect(result.challengeMultiplierApplied).toBe(false)
      expect(result.finalStars).toBe(3) // Rule E, no changes
    })
  })
})
