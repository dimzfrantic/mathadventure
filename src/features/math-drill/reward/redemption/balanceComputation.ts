/**
 * Stage 7B — Available Balance Computation
 *
 * Pure, deterministic calculation of available star balance by combining:
 * 1. Lifetime collectible stars earned (from Stage 7A `aggregateRewardCollectionV1`)
 * 2. Deductions from confirmed redemptions (permanent spending)
 * 3. Deductions from pending redemptions (reservations)
 *
 * Cancelled transactions do NOT deduct from the available balance.
 *
 * Conceptual invariant:
 *   availableBalance = totalEarned - totalConfirmed - totalPending
 *
 * If the resulting balance is negative (e.g. corrupted ledger where more stars
 * were redeemed than earned), this function does NOT silently mask it.
 * It flags `isLedgerConsistent: false`, records the diagnostic issue, and exposes
 * `rawAvailableBalance` alongside the display-clamped `availableBalance`.
 */

import { aggregateRewardCollectionV1 } from '../rewardEngine.ts'
import type { RewardCollectionSummaryV1 } from '../rewardTypes'
import type { RewardTransaction } from './redemptionTypes'
import { validateRewardTransaction } from './redemptionValidation.ts'
import { validateRewardCorrection, type RewardCorrection } from './correctionTypes.ts'

// ---------------------------------------------------------------------------
// Result Interfaces
// ---------------------------------------------------------------------------

export interface TransactionConflictInfo {
  readonly transactionId: string
  readonly reason: 'conflicting-transaction-content'
}

export interface CorrectionConflictInfo {
  readonly correctionId: string
  readonly reason: 'conflicting-correction-content'
}

export interface TransactionLedgerSummary {
  /** Total stars in confirmed redemptions (permanent deduction). */
  readonly totalConfirmedRedeemedStars: number
  /** Total stars in pending redemptions (active reservation). */
  readonly totalPendingStars: number
  /** Total stars in cancelled redemptions (no deduction). */
  readonly totalCancelledStars: number
  /** Count of valid confirmed transactions. */
  readonly confirmedTransactionsCount: number
  /** Count of valid pending transactions. */
  readonly pendingTransactionsCount: number
  /** Count of valid cancelled transactions. */
  readonly cancelledTransactionsCount: number
  /** Count of transactions rejected due to schema/validation failure. */
  readonly invalidTransactionsCount: number
  /** Count of duplicate transactions with identical content (ignored safely). */
  readonly duplicateTransactionsCount: number
  /** List of transactions disqualified due to conflicting content. */
  readonly transactionConflicts: readonly TransactionConflictInfo[]
  /** Count of invalid correction records. */
  readonly invalidCorrectionsCount?: number
  /** Count of duplicate correction records (ignored safely). */
  readonly duplicateCorrectionsCount?: number
  /** List of corrections disqualified due to conflicting content. */
  readonly correctionConflicts?: readonly CorrectionConflictInfo[]
}

export interface AvailableBalanceResult {
  /**
   * Safe available balance for UI display (clamped at 0).
   * IMPORTANT: Always check `isLedgerConsistent` before authorizing new redemptions.
   */
  readonly availableBalance: number
  /**
   * Unclamped raw balance: totalEarned - totalConfirmed - totalPending.
   * Can be negative if ledger is corrupt/overspent.
   */
  readonly rawAvailableBalance: number
  /** Total collectible stars earned across all valid completed sessions (Stage 7A). */
  readonly totalCollectibleStarsEarned: number
  /** Total stars deducted by confirmed transactions. */
  readonly totalConfirmedRedeemedStars: number
  /** Total stars reserved by pending transactions. */
  readonly totalPendingStars: number
  /**
   * True only if:
   * - rawAvailableBalance >= 0
   * - no transaction conflicts were detected
   * - no invalid transactions were encountered
   */
  readonly isLedgerConsistent: boolean
  /** Diagnostic issues describing ledger anomalies. */
  readonly ledgerIssues: readonly string[]
  /** Detailed breakdown of the transaction ledger. */
  readonly transactionsSummary: TransactionLedgerSummary
  /** Full Stage 7A session collection summary (contains session conflict info). */
  readonly sessionSummary: RewardCollectionSummaryV1
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function transactionContentFingerprint(tx: RewardTransaction): string {
  return JSON.stringify([
    tx.transactionId,
    tx.status,
    tx.requestedAt,
    tx.starsRedeemed,
    tx.rupiahValue,
    tx.ruleSnapshotVersion,
    tx.ruleSnapshot.rupiahPerStar,
    tx.confirmedAt,
    tx.cancelledAt,
  ])
}

function correctionContentFingerprint(c: RewardCorrection): string {
  return JSON.stringify([
    c.correctionId,
    c.originalTransactionId,
    c.parentId ?? null,
    c.starsDelta,
    c.reason,
  ])
}

// ---------------------------------------------------------------------------
// Main Pure Computation
// ---------------------------------------------------------------------------

/**
 * Computes the available star balance deterministically.
 *
 * @param completedSessions Array of raw completed session records (V1/V2)
 * @param rewardTransactions Array of raw reward transaction records
 * @returns AvailableBalanceResult with full diagnostic breakdown
 */
export function computeAvailableBalance(
  completedSessions: readonly unknown[],
  rewardTransactions: readonly unknown[],
  rewardCorrections: readonly unknown[] = [],
): AvailableBalanceResult {
  // 1. Calculate earned stars using Stage 7A engine (pure, unchanged)
  const sessionSummary = aggregateRewardCollectionV1(completedSessions)
  const totalEarned = sessionSummary.totalCollectibleStars

  // 2. Process transactions ledger with deduplication and conflict detection
  const validTxMap = new Map<string, { tx: RewardTransaction; fingerprint: string }>()
  const conflictedTxIds = new Set<string>()
  const transactionConflicts: TransactionConflictInfo[] = []
  let duplicateTransactionsCount = 0
  let invalidTransactionsCount = 0

  for (const raw of rewardTransactions) {
    const validation = validateRewardTransaction(raw)
    if (validation.status !== 'valid') {
      invalidTransactionsCount++
      continue
    }

    const tx = validation.value
    const id = tx.transactionId

    if (conflictedTxIds.has(id)) {
      continue
    }

    const fingerprint = transactionContentFingerprint(tx)
    const existing = validTxMap.get(id)

    if (existing) {
      if (existing.fingerprint === fingerprint) {
        // Idempotent duplicate: identical content, ignore second occurrence
        duplicateTransactionsCount++
      } else {
        // Conflicting content for the same transactionId: disqualify both!
        validTxMap.delete(id)
        conflictedTxIds.add(id)
        transactionConflicts.push({
          transactionId: id,
          reason: 'conflicting-transaction-content',
        })
      }
      continue
    }

    validTxMap.set(id, { tx, fingerprint })
  }

  // 3. Tally deductions from valid non-conflicting transactions
  let totalConfirmedRedeemedStars = 0
  let totalPendingStars = 0
  let totalCancelledStars = 0
  let confirmedTransactionsCount = 0
  let pendingTransactionsCount = 0
  let cancelledTransactionsCount = 0

  for (const { tx } of validTxMap.values()) {
    if (tx.status === 'confirmed') {
      totalConfirmedRedeemedStars += tx.starsRedeemed
      confirmedTransactionsCount++
    } else if (tx.status === 'pending') {
      totalPendingStars += tx.starsRedeemed
      pendingTransactionsCount++
    } else if (tx.status === 'cancelled') {
      totalCancelledStars += tx.starsRedeemed
      cancelledTransactionsCount++
    }
  }

  // 3.5. Tally valid reward corrections with deduplication and conflict detection
  const validCorrMap = new Map<string, { corr: RewardCorrection; fingerprint: string }>()
  const conflictedCorrIds = new Set<string>()
  const correctionConflicts: CorrectionConflictInfo[] = []
  let duplicateCorrectionsCount = 0
  let invalidCorrectionsCount = 0

  for (const raw of rewardCorrections) {
    const val = validateRewardCorrection(raw)
    if (val.status !== 'valid') {
      invalidCorrectionsCount++
      continue
    }

    const corr = val.value
    const id = corr.correctionId

    if (conflictedCorrIds.has(id)) {
      continue
    }

    const fingerprint = correctionContentFingerprint(corr)
    const existing = validCorrMap.get(id)

    if (existing) {
      if (existing.fingerprint === fingerprint) {
        duplicateCorrectionsCount++
      } else {
        validCorrMap.delete(id)
        conflictedCorrIds.add(id)
        correctionConflicts.push({
          correctionId: id,
          reason: 'conflicting-correction-content',
        })
      }
      continue
    }

    validCorrMap.set(id, { corr, fingerprint })
  }

  let totalCorrectionDelta = 0
  for (const { corr } of validCorrMap.values()) {
    const origTx = validTxMap.get(corr.originalTransactionId)
    if (!origTx || origTx.tx.status !== 'confirmed') {
      invalidCorrectionsCount++
      continue
    }
    totalCorrectionDelta += corr.starsDelta
  }

  const transactionsSummary: TransactionLedgerSummary = {
    totalConfirmedRedeemedStars,
    totalPendingStars,
    totalCancelledStars,
    confirmedTransactionsCount,
    pendingTransactionsCount,
    cancelledTransactionsCount,
    invalidTransactionsCount,
    duplicateTransactionsCount,
    transactionConflicts,
    invalidCorrectionsCount,
    duplicateCorrectionsCount,
    correctionConflicts,
  }

  // 4. Compute balance
  const rawAvailableBalance = totalEarned - totalConfirmedRedeemedStars - totalPendingStars + totalCorrectionDelta
  const availableBalance = Math.max(0, rawAvailableBalance)

  // 5. Audit ledger consistency
  const ledgerIssues: string[] = []
  if (rawAvailableBalance < 0) {
    ledgerIssues.push('NEGATIVE_BALANCE_DETECTED')
  }
  if (transactionConflicts.length > 0) {
    ledgerIssues.push('TRANSACTION_CONFLICT_DETECTED')
  }
  if (invalidTransactionsCount > 0) {
    ledgerIssues.push('INVALID_TRANSACTIONS_IN_LEDGER')
  }
  if (correctionConflicts.length > 0) {
    ledgerIssues.push('CORRECTION_CONFLICT_DETECTED')
  }
  if (invalidCorrectionsCount > 0) {
    ledgerIssues.push('INVALID_CORRECTIONS_IN_LEDGER')
  }
  if (sessionSummary.conflicts.length > 0) {
    ledgerIssues.push('SESSION_CONFLICT_DETECTED')
  }
  if (sessionSummary.invalidRecordsCount > 0) {
    ledgerIssues.push('INVALID_SESSIONS_IN_HISTORY')
  }

  const isLedgerConsistent = ledgerIssues.length === 0

  return {
    availableBalance,
    rawAvailableBalance,
    totalCollectibleStarsEarned: totalEarned,
    totalConfirmedRedeemedStars,
    totalPendingStars,
    isLedgerConsistent,
    ledgerIssues,
    transactionsSummary,
    sessionSummary,
  }
}
