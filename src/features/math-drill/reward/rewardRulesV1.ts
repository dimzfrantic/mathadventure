import type { SessionRewardInputV1, SessionRewardV1 } from './rewardTypes'

function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

/**
 * Pure and deterministic calculation of session reward stars (Stage 7A / V1 rules).
 *
 * Rules:
 * - A: completedQuestions = 0 -> sessionStars = 0, collectibleStars = 0
 * - E: coverage = 100% AND accuracy >= 90% -> sessionStars = 3, collectibleStars = 3
 * - D: coverage >= 70% AND accuracy >= 70% -> sessionStars = 2, collectibleStars = 2
 * - C: coverage >= 70% AND accuracy < 70% -> sessionStars = 1, collectibleStars = 1
 * - B: completedQuestions > 0 AND coverage < 70% -> sessionStars = 1, collectibleStars = 0
 *
 * Evaluated using exact rational/integer arithmetic (points are in 0.5 increments, so 2*points is an integer).
 */
export function calculateSessionRewardV1(input: SessionRewardInputV1): SessionRewardV1 {
  const { plannedCount, completedCount, totalPoints } = input

  if (!isSafeCount(plannedCount) || plannedCount <= 0) {
    throw new TypeError('PLANNED_COUNT_INVALID')
  }
  if (!isSafeCount(completedCount) || completedCount < 0 || completedCount > plannedCount) {
    throw new TypeError('COMPLETED_COUNT_INVALID')
  }
  if (typeof totalPoints !== 'number' || !Number.isFinite(totalPoints) || totalPoints < 0 || totalPoints > completedCount) {
    throw new TypeError('TOTAL_POINTS_INVALID')
  }

  const coverageRatio = { numerator: completedCount, denominator: plannedCount }

  if (completedCount === 0) {
    return {
      sessionStars: 0,
      collectibleStars: 0,
      ruleTier: 'none',
      coverageRatio,
      accuracyRatio: { numerator: 0, denominator: 0 },
    }
  }

  const accuracyRatio = { numerator: totalPoints, denominator: completedCount }

  // Points in Math Adventure are 0, 0.5, or 1.
  // When totalPoints is a half-integer, 2*totalPoints (S2) is an exact integer.
  // In that standard domain case, integer arithmetic is exact:
  // Accuracy >= 90% <=> 5 * S2 >= 9 * completedCount.
  // Accuracy >= 70% <=> 5 * S2 >= 7 * completedCount.
  // For arbitrary rational/floating inputs in tests, standard decimal threshold with precision tolerance is used.
  const S2 = 2 * totalPoints
  const isIntegerS2 = Number.isInteger(S2)
  const isFullCoverage = completedCount === plannedCount
  const isSufficientCoverage = 10 * completedCount >= 7 * plannedCount
  const isAccuracy90 = isIntegerS2
    ? 5 * S2 >= 9 * completedCount
    : (totalPoints / completedCount) >= 0.9 - 1e-12
  const isAccuracy70 = isIntegerS2
    ? 5 * S2 >= 7 * completedCount
    : (totalPoints / completedCount) >= 0.7 - 1e-12

  // Rule E: coverage = 100% AND accuracy >= 90% (evaluated before 2-star)
  if (isFullCoverage && isAccuracy90) {
    return {
      sessionStars: 3,
      collectibleStars: 3,
      ruleTier: 'perfect-high-accuracy',
      coverageRatio,
      accuracyRatio,
    }
  }

  // Rule D: coverage >= 70% AND accuracy >= 70%
  if (isSufficientCoverage && isAccuracy70) {
    return {
      sessionStars: 2,
      collectibleStars: 2,
      ruleTier: 'passing-good-accuracy',
      coverageRatio,
      accuracyRatio,
    }
  }

  // Rule C: coverage >= 70% AND accuracy < 70%
  if (isSufficientCoverage) {
    return {
      sessionStars: 1,
      collectibleStars: 1,
      ruleTier: 'passing-low-accuracy',
      coverageRatio,
      accuracyRatio,
    }
  }

  // Rule B: completedQuestions > 0 AND coverage < 70%
  return {
    sessionStars: 1,
    collectibleStars: 0,
    ruleTier: 'partial-low-coverage',
    coverageRatio,
    accuracyRatio,
  }
}
