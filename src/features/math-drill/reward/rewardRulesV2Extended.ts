import type { SessionRewardInputV1, SessionRewardV1 } from './rewardTypes'
import { calculateSessionRewardV1 } from './rewardRulesV1'

/**
 * Extended reward calculation for Phase 2 — adds conditional speed bonus for Challenge
 * and applies Challenge mode multiplier (1.5x).
 *
 * Rules:
 * - Speed bonus: Challenge ONLY, requires all conditions:
 *   • endReason = 'completed'
 *   • accuracy >= 80%
 *   • remaining time >= 20% of allocated time
 *   • Metadata (remainingMs, deadlineAt, startedAt) valid
 * - Challenge multiplier: 1.5x applied to (baseStars + speedBonus)
 * - Regular: No speed bonus, no multiplier (uses base reward)
 * - Fractional stars: floor() applied
 */

export interface SessionRewardInputV2Extended extends SessionRewardInputV1 {
  readonly mode: 'regular' | 'challenge'
  readonly endReason?: 'completed' | 'timeout'
  readonly remainingMs?: number | null
  readonly deadlineAt?: number | null
  readonly startedAt?: number | null
}

export interface SessionRewardV2Extended extends SessionRewardV1 {
  readonly speedBonusApplied: boolean
  readonly challengeMultiplierApplied: boolean
  readonly finalStars: number
}

/**
 * Calculate session reward with Challenge multiplier and conditional speed bonus.
 * @param input Session parameters including mode, endReason, and timer metadata
 * @returns Extended reward with speed bonus flag and final stars after multiplier
 */
export function calculateSessionRewardV2Extended(
  input: SessionRewardInputV2Extended
): SessionRewardV2Extended {
  // Step 1: Calculate base reward (Rules A-E)
  const baseReward = calculateSessionRewardV1({
    plannedCount: input.plannedCount,
    completedCount: input.completedCount,
    totalPoints: input.totalPoints,
  })

  // Step 2: Calculate speed bonus (Challenge only, conditional)
  let speedBonusStars = 0
  let speedBonusApplied = false

  if (
    input.mode === 'challenge' &&
    input.endReason === 'completed' &&
    input.remainingMs !== null &&
    input.remainingMs !== undefined &&
    input.deadlineAt !== null &&
    input.deadlineAt !== undefined &&
    input.startedAt !== null &&
    input.startedAt !== undefined
  ) {
    const timeAvailable = input.deadlineAt - input.startedAt
    
    // Validate timer metadata: timeAvailable must be positive
    if (timeAvailable > 0) {
      const coverage = input.plannedCount > 0 ? input.completedCount / input.plannedCount : 0

      // Use integer arithmetic for accuracy check (same as V1 rules)
      // Accuracy >= 80% <=> 5 * S2 >= 8 * completedCount (where S2 = 2*totalPoints)
      const S2 = 2 * input.totalPoints
      const isIntegerS2 = Number.isInteger(S2)
      const isAccuracy80 = isIntegerS2
        ? 5 * S2 >= 8 * input.completedCount
        : (input.totalPoints / input.completedCount) >= 0.8 - 1e-12

      // ALL conditions must be met:
      // 1. Coverage >= 70%
      // 2. Accuracy >= 80% (using integer arithmetic)
      // 3. Time remaining >= 20% of allocated time
      if (
        coverage >= 0.7 &&
        isAccuracy80 &&
        input.remainingMs >= timeAvailable * 0.2
      ) {
        speedBonusStars = 1
        speedBonusApplied = true
      }
    }
  }

  // Step 3: Apply Challenge multiplier
  // For regular: finalStars = collectibleStars (no multiplier)
  // For challenge: finalStars = floor((collectibleStars + speedBonus) * 1.5)
  let finalStars = baseReward.collectibleStars + speedBonusStars
  let challengeMultiplierApplied = false

  if (input.mode === 'challenge') {
    finalStars = Math.floor(finalStars * 1.5)
    challengeMultiplierApplied = true
  }

  return {
    ...baseReward,
    speedBonusApplied,
    challengeMultiplierApplied,
    finalStars,
  }
}
