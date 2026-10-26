/**
 * Stage 7B — Reward Configuration and Transaction Validators
 *
 * Pure validation functions. No I/O, no storage, no side effects.
 * All validation results are typed discriminated unions; nothing throws.
 */

import type {
  RewardConfig,
  RewardConfigSnapshot,
  RewardTransaction,
} from './redemptionTypes'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function validTimestamp(value: unknown): value is number {
  return isSafeNonNegativeInteger(value)
}

// ---------------------------------------------------------------------------
// RewardConfig validation
// ---------------------------------------------------------------------------

export type RewardConfigValidation =
  | { readonly status: 'valid'; readonly value: RewardConfig }
  | { readonly status: 'invalid'; readonly issues: readonly string[] }

/**
 * Validates a RewardConfig object.
 * Returns 'valid' only when all constraints are satisfied.
 *
 * Constraints:
 * - configId must be exactly 'active'.
 * - version must be a positive integer.
 * - updatedAt must be a non-negative safe integer (0 is allowed for the default).
 * - rupiahPerStar must be a positive integer (Rp0 per star would be nonsensical).
 * - minStarsPerRedemption must be a positive integer (≥ 1).
 * - maxStarsPerRedemption must be a positive integer and >= minStarsPerRedemption.
 */
export function validateRewardConfig(value: unknown): RewardConfigValidation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'invalid', issues: ['NOT_AN_OBJECT'] }
  }

  const v = value as Record<string, unknown>
  const issues: string[] = []

  if (v.configId !== 'active') issues.push('CONFIG_ID_INVALID')
  if (!isSafePositiveInteger(v.version)) issues.push('VERSION_INVALID')
  if (!validTimestamp(v.updatedAt)) issues.push('UPDATED_AT_INVALID')
  if (!isSafePositiveInteger(v.rupiahPerStar)) issues.push('RUPIAH_PER_STAR_INVALID')
  if (!isSafePositiveInteger(v.minStarsPerRedemption)) issues.push('MIN_STARS_INVALID')
  if (!isSafePositiveInteger(v.maxStarsPerRedemption)) issues.push('MAX_STARS_INVALID')

  if (issues.length > 0) return { status: 'invalid', issues }

  // Cross-field constraint: max >= min
  const min = v.minStarsPerRedemption as number
  const max = v.maxStarsPerRedemption as number
  if (max < min) return { status: 'invalid', issues: ['MAX_STARS_BELOW_MIN'] }

  return { status: 'valid', value: value as RewardConfig }
}

// ---------------------------------------------------------------------------
// RewardConfigSnapshot validation
// ---------------------------------------------------------------------------

export type RewardConfigSnapshotValidation =
  | { readonly status: 'valid'; readonly value: RewardConfigSnapshot }
  | { readonly status: 'invalid'; readonly issues: readonly string[] }

export function validateRewardConfigSnapshot(value: unknown): RewardConfigSnapshotValidation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'invalid', issues: ['NOT_AN_OBJECT'] }
  }
  const v = value as Record<string, unknown>
  if (!isSafePositiveInteger(v.rupiahPerStar)) {
    return { status: 'invalid', issues: ['RUPIAH_PER_STAR_INVALID'] }
  }
  return { status: 'valid', value: value as RewardConfigSnapshot }
}

// ---------------------------------------------------------------------------
// RewardTransaction validation
// ---------------------------------------------------------------------------

export type RewardTransactionValidation =
  | { readonly status: 'valid'; readonly value: RewardTransaction }
  | { readonly status: 'invalid'; readonly issues: readonly string[] }

/**
 * Validates a RewardTransaction record.
 *
 * Shared constraints (all statuses):
 * - transactionId must be a non-empty string.
 * - status must be 'pending' | 'confirmed' | 'cancelled'.
 * - requestedAt must be a valid non-negative timestamp.
 * - starsRedeemed must be a positive integer.
 * - rupiahValue must be a non-negative integer (0 allowed only if starsRedeemed=0, but
 *   starsRedeemed must be ≥1, so rupiahValue must be ≥1 in practice — validated separately).
 * - ruleSnapshotVersion must be a positive integer.
 * - ruleSnapshot must be a valid RewardConfigSnapshot.
 * - rupiahValue must equal starsRedeemed * ruleSnapshot.rupiahPerStar (consistency check).
 *
 * Status-specific constraints:
 * - 'pending': confirmedAt === null, cancelledAt === null.
 * - 'confirmed': confirmedAt is a valid timestamp >= requestedAt, cancelledAt === null.
 * - 'cancelled': cancelledAt is a valid timestamp >= requestedAt, confirmedAt === null.
 */
export function validateRewardTransaction(value: unknown): RewardTransactionValidation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'invalid', issues: ['NOT_AN_OBJECT'] }
  }

  const v = value as Record<string, unknown>
  const issues: string[] = []

  // Shared fields
  if (typeof v.transactionId !== 'string' || v.transactionId.trim().length === 0) {
    issues.push('TRANSACTION_ID_INVALID')
  }
  if (v.status !== 'pending' && v.status !== 'confirmed' && v.status !== 'cancelled') {
    issues.push('STATUS_INVALID')
  }
  if (!validTimestamp(v.requestedAt)) issues.push('REQUESTED_AT_INVALID')
  if (!isSafePositiveInteger(v.starsRedeemed)) issues.push('STARS_REDEEMED_INVALID')
  if (!isSafePositiveInteger(v.ruleSnapshotVersion)) issues.push('RULE_SNAPSHOT_VERSION_INVALID')

  const snapshotResult = validateRewardConfigSnapshot(v.ruleSnapshot)
  if (snapshotResult.status === 'invalid') {
    issues.push(...snapshotResult.issues.map(i => `SNAPSHOT_${i}`))
  }

  // rupiahValue: must be a non-negative safe integer and consistent with snapshot
  if (!isSafeNonNegativeInteger(v.rupiahValue)) {
    issues.push('RUPIAH_VALUE_INVALID')
  } else if (
    snapshotResult.status === 'valid' &&
    isSafePositiveInteger(v.starsRedeemed)
  ) {
    const expectedRupiah = (v.starsRedeemed as number) * snapshotResult.value.rupiahPerStar
    if (v.rupiahValue !== expectedRupiah) {
      issues.push('RUPIAH_VALUE_INCONSISTENT_WITH_SNAPSHOT')
    }
  }

  if (issues.length > 0) return { status: 'invalid', issues }

  const requestedAt = v.requestedAt as number
  const status = v.status as string

  if (status === 'pending') {
    if (v.confirmedAt !== null) issues.push('PENDING_CONFIRMED_AT_MUST_BE_NULL')
    if (v.cancelledAt !== null) issues.push('PENDING_CANCELLED_AT_MUST_BE_NULL')
  } else if (status === 'confirmed') {
    if (!validTimestamp(v.confirmedAt)) {
      issues.push('CONFIRMED_AT_INVALID')
    } else if ((v.confirmedAt as number) < requestedAt) {
      issues.push('CONFIRMED_AT_BEFORE_REQUESTED_AT')
    }
    if (v.cancelledAt !== null) issues.push('CONFIRMED_CANCELLED_AT_MUST_BE_NULL')
  } else if (status === 'cancelled') {
    if (!validTimestamp(v.cancelledAt)) {
      issues.push('CANCELLED_AT_INVALID')
    } else if ((v.cancelledAt as number) < requestedAt) {
      issues.push('CANCELLED_AT_BEFORE_REQUESTED_AT')
    }
    if (v.confirmedAt !== null) issues.push('CANCELLED_CONFIRMED_AT_MUST_BE_NULL')
  }

  if (issues.length > 0) return { status: 'invalid', issues }

  return { status: 'valid', value: value as RewardTransaction }
}
