/**
 * Stage 7B Phase 6 — Reward Persistence Controller (integration adapter)
 *
 * Bridges the pure redemption domain (transactionOperations + balanceComputation)
 * with the preserved IndexedDB reward stores (RewardIndexedDbStore). The controller
 * is the single source of truth an owner component talks to; it does NOT write to
 * any UI and does not dictate React integration.
 *
 * Safety contract:
 * - Only drives an existing RewardIndexedDbStore; never touches session/history
 *   stores. Live database requires REWARD_LIVE_AUTHORITY via createLiveRewardStore().
 * - All public methods return typed discriminated unions; nothing throws.
 */

import type {
  CancelRedemptionResult,
  ConfirmRedemptionResult,
  SubmitRedemptionResult,
} from './transactionOperations'
import type {
  RewardConfig,
  RewardTransaction,
} from './redemptionTypes'
import { validateRewardConfig } from './redemptionValidation'
import { validateRewardCorrection, type RewardCorrection } from './correctionTypes'
import {
  cancelRedemptionTransaction,
  confirmRedemptionTransaction,
  submitRedemptionRequest,
} from './transactionOperations'
import { computeAvailableBalance } from './balanceComputation'
import type { AvailableBalanceResult } from './balanceComputation'

export type RewardControllerState =
  | { readonly status: 'not-ready' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      readonly config: RewardConfig
      readonly transactions: readonly RewardTransaction[]
      readonly corrections: readonly RewardCorrection[]
      readonly balance: AvailableBalanceResult
    }
  | { readonly status: 'storage-error'; readonly code: string }

/** Injectable minimal store API the controller needs. Tests supply a fake. */
export interface RewardControllerStore {
  /** Lists all reward transactions (status success or storage-error). */
  listTransactions(): Promise<RewardListResult>
  /** Lists all reward corrections (status success or storage-error). */
  listCorrections(): Promise<RewardCorrectionListResult>
  /** Loads active config (status found/not-found/invalid/storage-error). */
  loadConfig(): Promise<RewardConfigLoadResultLike>
  /** Upserts a validated reward transaction; balanceContext enables atomic balance enforcement. */
  putTransaction(transaction: RewardTransaction, balanceContext?: PermissionBalanceContext): Promise<RewardPutResultLike>
  /** Upserts the active reward config with monotonically increasing version. */
  saveConfig(config: RewardConfig): Promise<RewardConfigSaveResultLike>
  /** Upserts a reward correction entry; balanceContext enables atomic balance enforcement. */
  saveCorrection(correction: RewardCorrection, balanceContext?: PermissionBalanceContext): Promise<RewardCorrectionSaveResultLike>
}

/** Balance context shape the controller passes to the store for atomic enforcement. */
export interface PermissionBalanceContext {
  readonly completedSessions: readonly unknown[]
}

export type RewardListResult =
  | { readonly status: 'success'; readonly transactions: readonly RewardTransaction[]; readonly invalidCount: number }
  | { readonly status: 'storage-error'; readonly code: string }

export type RewardCorrectionListResult =
  | { readonly status: 'success'; readonly corrections: readonly RewardCorrection[]; readonly invalidCount: number }
  | { readonly status: 'storage-error'; readonly code: string }

export type RewardConfigLoadResultLike =
  | { readonly status: 'found'; readonly value: RewardConfig }
  | { readonly status: 'not-found' }
  | { readonly status: 'invalid-config' }
  | { readonly status: 'storage-error'; readonly code: string }

export type RewardPutResultLike =
  | { readonly status: 'success' }
  | { readonly status: 'duplicate' }
  | { readonly status: 'conflict'; readonly reason: 'conflicting-transaction-content' }
  | { readonly status: 'insufficient-balance' }
  | { readonly status: 'storage-error'; readonly code: string }

export type RewardConfigSaveResultLike =
  | { readonly status: 'success'; readonly config: RewardConfig }
  | { readonly status: 'invalid-config'; readonly issues: readonly string[] }
  | { readonly status: 'storage-error'; readonly code: string }

export type RewardCorrectionSaveResultLike =
  | { readonly status: 'success'; readonly correction: RewardCorrection }
  | { readonly status: 'duplicate'; readonly correction: RewardCorrection }
  | { readonly status: 'conflict'; readonly reason: 'conflicting-correction-content' }
  | { readonly status: 'invalid-original-transaction' }
  | { readonly status: 'transaction-not-confirmed' }
  | { readonly status: 'insufficient-balance' }
  | { readonly status: 'storage-error'; readonly code: string }

/** The minimal contract a real RewardIndexedDbStore satisfies. */
export interface StoresShape {
  readonly reward: RewardControllerStore
  /** Provides completed session records used to compute the earned-star balance. */
  readonly completedSessions: () => Promise<readonly unknown[]>
}

export interface RewardControllerOptions {
  readonly stores: StoresShape
  readonly now?: () => number
}

/** Convenience builder: wraps a single reward store + completed-session provider into the stores shape. */
export function createRewardController(options: {
  readonly store: RewardControllerStore
  readonly completedSessions?: () => Promise<readonly unknown[]>
  readonly now?: () => number
}): RewardController {
  return createDisposableRewardController({
    stores: {
      reward: options.store,
      completedSessions: options.completedSessions ?? (async () => []),
    },
    now: options.now,
  })
}

export type RewardControllerSubmitResult =
  | SubmitRedemptionResult
  | { readonly status: 'error'; readonly reason: 'not-ready' | 'conflicting-transaction-content' | 'storage-error' }

export type RewardControllerConfirmResult =
  | ConfirmRedemptionResult
  | { readonly status: 'error'; readonly reason: 'not-ready' | 'conflicting-transaction-content' | 'storage-error' | 'insufficient-balance' }

export type RewardControllerCancelResult =
  | CancelRedemptionResult
  | { readonly status: 'error'; readonly reason: 'not-ready' | 'conflicting-transaction-content' | 'storage-error' | 'insufficient-balance' | 'ledger-inconsistent' }

export interface RewardController {
  getState(): RewardControllerState
  load(): Promise<RewardControllerState>
  submitRedemption(params: { readonly transactionId: string; readonly starsRedeemed: number }): Promise<RewardControllerSubmitResult>
  confirmRedemption(transactionId: string): Promise<RewardControllerConfirmResult>
  cancelRedemption(transactionId: string): Promise<RewardControllerCancelResult>
  updateConfig(updates: {
    readonly rupiahPerStar?: number
    readonly minStarsPerRedemption?: number
    readonly maxStarsPerRedemption?: number
  }): Promise<
    | { readonly status: 'success'; readonly config: RewardConfig }
    | { readonly status: 'error'; readonly reason: string }
  >
  applyCorrection(params: {
    readonly correctionId: string
    readonly originalTransactionId: string
    readonly parentId?: string
    readonly starsDelta: number
    readonly reason: string
  }): Promise<
    | { readonly status: 'success'; readonly correction: RewardCorrection }
    | { readonly status: 'error'; readonly reason: string }
  >
}

export function createDisposableRewardController(options: RewardControllerOptions): RewardController {
  let state: RewardControllerState = { status: 'not-ready' }
  const setState = (next: RewardControllerState): RewardControllerState => { state = next; return state }

  async function load(): Promise<RewardControllerState> {
    setState({ status: 'loading' })
    const [transactionsResult, correctionsResult, configResult] = await Promise.all([
      options.stores.reward.listTransactions(),
      options.stores.reward.listCorrections(),
      options.stores.reward.loadConfig(),
    ])
    if (transactionsResult.status === 'storage-error') return setState({ status: 'storage-error', code: transactionsResult.code })
    if (correctionsResult.status === 'storage-error') return setState({ status: 'storage-error', code: correctionsResult.code })
    if (configResult.status === 'storage-error') return setState({ status: 'storage-error', code: configResult.code })
    if (configResult.status === 'invalid-config') return setState({ status: 'storage-error', code: 'invalid-config' })
    const rawSessions = await options.stores.completedSessions()
    const transactions = transactionsResult.transactions as readonly RewardTransaction[]
    const corrections = correctionsResult.corrections as readonly RewardCorrection[]
    const balance = computeAvailableBalance(rawSessions, transactions, corrections)
    const config = configResult.status === 'found'
      ? configResult.value
      : { configId: 'active' as const, version: 1, updatedAt: 0, rupiahPerStar: 500, minStarsPerRedemption: 1, maxStarsPerRedemption: 100 }
    return setState({ status: 'ready', config, transactions, corrections, balance })
  }

  return {
    getState: () => state,
    load,
    async submitRedemption(params) {
      await load()
      const current = state
      if (current.status !== 'ready') return { status: 'error', reason: 'not-ready' }
      if (!current.balance.isLedgerConsistent) return { status: 'error', reason: 'ledger-inconsistent' }
      const existing = current.transactions as readonly unknown[]
      const sessions = await options.stores.completedSessions()
      const result = submitRedemptionRequest({
        transactionId: params.transactionId,
        starsRedeemed: params.starsRedeemed,
        requestedAt: (options.now ?? Date.now)(),
        config: current.config,
        completedSessions: sessions as readonly unknown[],
        existingTransactions: existing,
      })
      if (result.status !== 'success') return result
      const persist = await options.stores.reward.putTransaction(result.transaction, { completedSessions: sessions })
      if (persist.status === 'storage-error') return { status: 'error', reason: 'storage-error' }
      if (persist.status === 'conflict') return { status: 'error', reason: 'conflicting-transaction-content' }
      if (persist.status === 'duplicate') {
        const reloaded = await load()
        if (reloaded.status === 'storage-error') return { status: 'error', reason: 'storage-error' }
        return result
      }
      if (persist.status === 'insufficient-balance') return { status: 'error', reason: 'insufficient-balance' }
      const reloaded = await load()
      if (reloaded.status === 'storage-error') return { status: 'error', reason: 'storage-error' }
      return result
    },
    async confirmRedemption(transactionId) {
      await load()
      const current = state
      if (current.status !== 'ready') return { status: 'error', reason: 'not-ready' }
      if (!current.balance.isLedgerConsistent) return { status: 'error', reason: 'ledger-inconsistent' }
      const existing = current.transactions as readonly unknown[]
      const sessions = await options.stores.completedSessions()
      const result = confirmRedemptionTransaction({
        transactionId,
        confirmedAt: (options.now ?? Date.now)(),
        completedSessions: sessions as readonly unknown[],
        existingTransactions: existing,
      })
      if (result.status !== 'success') return result
      const persist = await options.stores.reward.putTransaction(result.transaction, { completedSessions: sessions })
      if (persist.status === 'storage-error') return { status: 'error', reason: 'storage-error' }
      if (persist.status === 'conflict') return { status: 'error', reason: 'conflicting-transaction-content' }
      if (persist.status === 'insufficient-balance') return { status: 'error', reason: 'insufficient-balance' }
      const reloaded = await load()
      if (reloaded.status === 'storage-error') return { status: 'error', reason: 'storage-error' }
      return result
    },
    async cancelRedemption(transactionId) {
      await load()
      const current = state
      if (current.status !== 'ready') return { status: 'error', reason: 'not-ready' }
      if (!current.balance.isLedgerConsistent) return { status: 'error', reason: 'ledger-inconsistent' }
      const existing = current.transactions as readonly unknown[]
      const result = cancelRedemptionTransaction({
        transactionId,
        cancelledAt: (options.now ?? Date.now)(),
        existingTransactions: existing,
      })
      if (result.status !== 'success') return result
      // Pass balanceContext for atomic balance enforcement consistency
      const sessions = await options.stores.completedSessions()
      const persist = await options.stores.reward.putTransaction(result.transaction, { completedSessions: sessions })
      if (persist.status === 'storage-error') return { status: 'error', reason: 'storage-error' }
      if (persist.status === 'conflict') return { status: 'error', reason: 'conflicting-transaction-content' }
      if (persist.status === 'insufficient-balance') return { status: 'error', reason: 'insufficient-balance' }
      if (persist.status === 'duplicate') {
        const reloaded = await load()
        if (reloaded.status === 'storage-error') return { status: 'error', reason: 'storage-error' }
        return result
      }
      const reloaded = await load()
      if (reloaded.status === 'storage-error') return { status: 'error', reason: 'storage-error' }
      return result
    },
    async updateConfig(updates) {
      await load()
      const current = state
      if (current.status !== 'ready') return { status: 'error', reason: 'not-ready' }
      if (!current.balance.isLedgerConsistent) return { status: 'error', reason: 'ledger-inconsistent' }
      const newConfig: RewardConfig = {
        ...current.config,
        ...updates,
        version: current.config.version + 1,
        updatedAt: (options.now ?? Date.now)(),
      }
      const checked = validateRewardConfig(newConfig)
      if (checked.status !== 'valid') return { status: 'error', reason: 'invalid-config' }
      const persist = await options.stores.reward.saveConfig(checked.value)
      if (persist.status === 'storage-error') return { status: 'error', reason: 'storage-error' }
      if ((persist as { readonly status: string }).status === 'version-mismatch') return { status: 'error', reason: 'version-mismatch' }
      if (persist.status !== 'success') return { status: 'error', reason: persist.status }
      const reloaded = await load()
      if (reloaded.status === 'storage-error') return { status: 'error', reason: 'storage-error' }
      return { status: 'success', config: checked.value }
    },
    async applyCorrection(params) {
      await load()
      const current = state
      if (current.status !== 'ready') return { status: 'error', reason: 'not-ready' }
      if (!current.balance.isLedgerConsistent) return { status: 'error', reason: 'ledger-inconsistent' }
      if (params.starsDelta < 0 && current.balance.availableBalance + params.starsDelta < 0) {
        return { status: 'error', reason: 'insufficient-balance' }
      }
      const correction: RewardCorrection = {
        correctionId: params.correctionId,
        originalTransactionId: params.originalTransactionId,
        ...(params.parentId !== undefined ? { parentId: params.parentId } : {}),
        starsDelta: params.starsDelta,
        reason: params.reason,
        createdAt: (options.now ?? Date.now)(),
      }
      const validation = validateRewardCorrection(correction)
      if (validation.status !== 'valid') return { status: 'error', reason: 'invalid-correction' }
      const sessions = await options.stores.completedSessions()
      const persist = await options.stores.reward.saveCorrection(validation.value, { completedSessions: sessions })
      if (persist.status === 'storage-error') return { status: 'error', reason: 'storage-error' }
      if (persist.status === 'conflict') return { status: 'error', reason: 'conflicting-correction-content' }
      if (persist.status === 'invalid-original-transaction') return { status: 'error', reason: 'invalid-original-transaction' }
      if (persist.status === 'transaction-not-confirmed') return { status: 'error', reason: 'transaction-not-confirmed' }
      if (persist.status === 'insufficient-balance') return { status: 'error', reason: 'insufficient-balance' }
      if (persist.status === 'duplicate') {
        await load()
        return { status: 'success', correction: persist.correction }
      }
      const reloaded = await load()
      if (reloaded.status === 'storage-error') return { status: 'error', reason: 'storage-error' }
      return { status: 'success', correction: validation.value }
    },
  }
}
