/**
 * Stage 7B — Reward Correction Types (Phase 2)
 *
 * A correction is a compensating ledger entry that adjusts the available
 * balance for a transaction that was already confirmed.
 *
 * Design rationale:
 * - Confirmed transactions are immutable. Cancelling them directly would
 *   destroy the audit trail ("was this reward actually given?").
 * - Instead, a correction is a separate, signed, append-only entry that
 *   references the original transaction.
 *
 * Sign convention:
 * - starsDelta > 0  -> stars are RETURNED to the child (available balance grows).
 * - starsDelta < 0  -> additional stars are DEDUCTED (available balance shrinks).
 *
 * Pure domain types only — no I/O, no storage.
 */

export interface RewardCorrection {
  /** Unique identity of the correction entry. */
  readonly correctionId: string
  /** The confirmed transaction this correction compensates. */
  readonly originalTransactionId: string
  /** Optional parent/operator identity who authorized the correction. */
  readonly parentId?: string
  /** Signed star adjustment. Must be a non-zero safe integer. */
  readonly starsDelta: number
  /** Timestamp of the correction. Non-negative integer. */
  readonly createdAt: number
  /** Human-readable justification, shown to the parent in the dashboard. */
  readonly reason: string
}

export type RewardCorrectionValidation =
  | { readonly status: 'valid'; readonly value: RewardCorrection }
  | { readonly status: 'invalid'; readonly issues: readonly string[] }

function isSafeNonZeroInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value !== 0
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Validates a correction entry in isolation (field-level contract).
 *
 * This does NOT check that the referenced transaction exists — that requires
 * the surrounding ledger and is enforced by the correction operation and by
 * the balance computation.
 */
export function validateRewardCorrection(value: unknown): RewardCorrectionValidation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'invalid', issues: ['NOT_AN_OBJECT'] }
  }

  const v = value as Record<string, unknown>
  const issues: string[] = []

  if (typeof v.correctionId !== 'string' || v.correctionId.trim().length === 0) {
    issues.push('CORRECTION_ID_INVALID')
  }
  if (
    typeof v.originalTransactionId !== 'string' ||
    v.originalTransactionId.trim().length === 0
  ) {
    issues.push('ORIGINAL_TRANSACTION_ID_INVALID')
  }
  if (v.parentId !== undefined && (typeof v.parentId !== 'string' || v.parentId.trim().length === 0)) {
    issues.push('PARENT_ID_INVALID')
  }
  if (!isSafeNonZeroInteger(v.starsDelta)) {
    issues.push('STARS_DELTA_INVALID')
  }
  if (!isSafeNonNegativeInteger(v.createdAt)) {
    issues.push('CREATED_AT_INVALID')
  }
  if (typeof v.reason !== 'string' || v.reason.trim().length === 0) {
    issues.push('REASON_INVALID')
  }

  if (issues.length > 0) return { status: 'invalid', issues }
  return { status: 'valid', value: value as RewardCorrection }
}
