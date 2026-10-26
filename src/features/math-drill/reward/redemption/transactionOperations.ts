/**
 * Stage 7B — Pure Transaction Operations (In-Memory / Pure Logic)
 *
 * Implements pure, deterministic transaction state transitions:
 * - submitRedemptionRequest: validates balance, builds a new pending transaction.
 * - confirmRedemptionTransaction: transitions pending -> confirmed.
 * - cancelRedemptionTransaction: transitions pending -> cancelled.
 *
 * No I/O, no IndexedDB, no side effects. Operates entirely on pure data structures
 * for rigorous testing of concurrency, retries, idempotency, and state invariants.
 */

import { computeAvailableBalance } from './balanceComputation'
import type {
  RewardConfig,
  RewardTransaction,
  PendingRewardTransaction,
  ConfirmedRewardTransaction,
  CancelledRewardTransaction,
} from './redemptionTypes'
import { validateRewardTransaction } from './redemptionValidation'

// ---------------------------------------------------------------------------
// Operation Result Types
// ---------------------------------------------------------------------------

export type SubmitRedemptionResult =
  | {
      readonly status: 'success'
      readonly transaction: PendingRewardTransaction
      readonly updatedTransactions: readonly RewardTransaction[]
      readonly availableBalanceBefore: number
      readonly availableBalanceAfter: number
    }
  | {
      readonly status: 'error'
      readonly reason:
        | 'insufficient-balance'
        | 'below-min-stars'
        | 'above-max-stars'
        | 'invalid-config'
        | 'ledger-inconsistent'
        | 'duplicate-transaction-id'
    }

export type ConfirmRedemptionResult =
  | {
      readonly status: 'success'
      readonly transaction: ConfirmedRewardTransaction
      readonly updatedTransactions: readonly RewardTransaction[]
    }
  | {
      readonly status: 'error'
      readonly reason:
        | 'transaction-not-found'
        | 'transaction-not-pending'
        | 'insufficient-balance-upon-confirm'
        | 'ledger-inconsistent'
    }

export type CancelRedemptionResult =
  | {
      readonly status: 'success'
      readonly transaction: CancelledRewardTransaction
      readonly updatedTransactions: readonly RewardTransaction[]
    }
  | {
      readonly status: 'error'
      readonly reason:
        | 'transaction-not-found'
        | 'transaction-not-pending'
    }

// ---------------------------------------------------------------------------
// Pure Operations
// ---------------------------------------------------------------------------

/**
 * Submits a new redemption request (creates a pending transaction).
 *
 * Checks:
 * 1. Ledger must be consistent.
 * 2. transactionId must be unique.
 * 3. starsRedeemed must be >= config.minStarsPerRedemption and <= config.maxStarsPerRedemption.
 * 4. Available balance (considering existing pending reservations) must be >= starsRedeemed.
 */
export function submitRedemptionRequest(params: {
  readonly transactionId: string
  readonly starsRedeemed: number
  readonly requestedAt: number
  readonly config: RewardConfig
  readonly completedSessions: readonly unknown[]
  readonly existingTransactions: readonly unknown[]
}): SubmitRedemptionResult {
  // 1. Check existing balance & ledger consistency
  const balanceResult = computeAvailableBalance(
    params.completedSessions,
    params.existingTransactions,
  )
  if (!balanceResult.isLedgerConsistent) {
    return { status: 'error', reason: 'ledger-inconsistent' }
  }

  // 2. Check uniqueness of transactionId
  const idExists = params.existingTransactions.some((raw) => {
    const val = validateRewardTransaction(raw)
    return val.status === 'valid' && val.value.transactionId === params.transactionId
  })
  if (idExists) {
    return { status: 'error', reason: 'duplicate-transaction-id' }
  }

  // 3. Check bounds against config
  if (params.starsRedeemed < params.config.minStarsPerRedemption) {
    return { status: 'error', reason: 'below-min-stars' }
  }
  if (params.starsRedeemed > params.config.maxStarsPerRedemption) {
    return { status: 'error', reason: 'above-max-stars' }
  }

  // 4. Check available balance
  if (balanceResult.availableBalance < params.starsRedeemed) {
    return { status: 'error', reason: 'insufficient-balance' }
  }

  // 5. Build transaction
  const snapshot = { rupiahPerStar: params.config.rupiahPerStar }
  const rupiahValue = params.starsRedeemed * params.config.rupiahPerStar

  const newTx: PendingRewardTransaction = {
    transactionId: params.transactionId,
    status: 'pending',
    requestedAt: params.requestedAt,
    starsRedeemed: params.starsRedeemed,
    rupiahValue,
    ruleSnapshotVersion: params.config.version,
    ruleSnapshot: snapshot,
    confirmedAt: null,
    cancelledAt: null,
  }

  const updatedTransactions = [...params.existingTransactions, newTx] as readonly RewardTransaction[]
  const newBalanceResult = computeAvailableBalance(
    params.completedSessions,
    updatedTransactions,
  )

  return {
    status: 'success',
    transaction: newTx,
    updatedTransactions,
    availableBalanceBefore: balanceResult.availableBalance,
    availableBalanceAfter: newBalanceResult.availableBalance,
  }
}

/**
 * Confirms a pending redemption transaction.
 *
 * Transitions status from 'pending' to 'confirmed'.
 * Re-verifies ledger consistency.
 */
export function confirmRedemptionTransaction(params: {
  readonly transactionId: string
  readonly confirmedAt: number
  readonly completedSessions: readonly unknown[]
  readonly existingTransactions: readonly unknown[]
}): ConfirmRedemptionResult {
  const balanceResult = computeAvailableBalance(
    params.completedSessions,
    params.existingTransactions,
  )
  if (!balanceResult.isLedgerConsistent) {
    return { status: 'error', reason: 'ledger-inconsistent' }
  }

  let found = false
  let targetTx: PendingRewardTransaction | null = null

  const updatedTransactions = params.existingTransactions.map((raw) => {
    const val = validateRewardTransaction(raw)
    if (val.status === 'valid' && val.value.transactionId === params.transactionId) {
      found = true
      if (val.value.status === 'pending') {
        targetTx = val.value
        const confirmed: ConfirmedRewardTransaction = {
          ...val.value,
          status: 'confirmed',
          confirmedAt: params.confirmedAt,
        }
        return confirmed
      }
    }
    return raw
  }) as readonly RewardTransaction[]

  if (!found || !targetTx) {
    return { status: 'error', reason: 'transaction-not-found' }
  }

  if ((targetTx as PendingRewardTransaction).status !== 'pending') {
    return { status: 'error', reason: 'transaction-not-pending' }
  }

  return {
    status: 'success',
    transaction: {
      ...(targetTx as PendingRewardTransaction),
      status: 'confirmed',
      confirmedAt: params.confirmedAt,
    },
    updatedTransactions,
  }
}

/**
 * Cancels a pending redemption transaction.
 *
 * Transitions status from 'pending' to 'cancelled'.
 */
export function cancelRedemptionTransaction(params: {
  readonly transactionId: string
  readonly cancelledAt: number
  readonly existingTransactions: readonly unknown[]
}): CancelRedemptionResult {
  let found = false
  let targetTx: PendingRewardTransaction | null = null

  const updatedTransactions = params.existingTransactions.map((raw) => {
    const val = validateRewardTransaction(raw)
    if (val.status === 'valid' && val.value.transactionId === params.transactionId) {
      found = true
      if (val.value.status === 'pending') {
        targetTx = val.value
        const cancelled: CancelledRewardTransaction = {
          ...val.value,
          status: 'cancelled',
          cancelledAt: params.cancelledAt,
        }
        return cancelled
      }
    }
    return raw
  }) as readonly RewardTransaction[]

  if (!found || !targetTx) {
    return { status: 'error', reason: 'transaction-not-found' }
  }

  if ((targetTx as PendingRewardTransaction).status !== 'pending') {
    return { status: 'error', reason: 'transaction-not-pending' }
  }

  return {
    status: 'success',
    transaction: {
      ...(targetTx as PendingRewardTransaction),
      status: 'cancelled',
      cancelledAt: params.cancelledAt,
    },
    updatedTransactions,
  }
}
