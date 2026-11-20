/**
 * Stage 7B-A2 — Remote reward store (backend authoritative).
 *
 * Implements the existing `RewardControllerStore` contract on top of the
 * backend reward API, so the already-tested `RewardController` and the
 * ParentDashboard keep working unchanged while the *authority* moves to the
 * server:
 *
 *   - reads always come from the server (`/api/reward/state`);
 *   - writes are POSTed and only reported as successful when the server says
 *     so (a 409/400/401/network failure is surfaced as a typed failure);
 *   - nothing is cached in IndexedDB, so an origin can never overwrite the
 *     authoritative ledger with local state.
 *
 * The store never computes a balance and never invents a transaction: the
 * server returns the stored record.
 */

import type {
  PermissionBalanceContext,
  RewardConfigLoadResultLike,
  RewardConfigSaveResultLike,
  RewardControllerStore,
  RewardCorrectionListResult,
  RewardCorrectionSaveResultLike,
  RewardListResult,
  RewardPutResultLike,
} from '../reward/redemption/rewardController'
import type { RewardCorrection } from '../reward/redemption/correctionTypes'
import type { RewardConfig, RewardTransaction } from '../reward/redemption/redemptionTypes'
import type { CompletedSessionRecord } from '../persistence/completedSessionTypes'
import {
  cancelRewardTransaction,
  confirmRewardTransaction,
  createRewardCorrection,
  getRewardSessions,
  getRewardState,
  submitRewardTransaction,
  updateRewardConfig,
} from '../api/rewardApi'

function failureCode(httpStatus: number): string {
  if (httpStatus === 0) return 'backend-unavailable'
  if (httpStatus === 401 || httpStatus === 403) return 'unauthorized'
  return `backend-error-${httpStatus}`
}

/** Maps a server rejection onto the controller's storage-error vocabulary. */
function storageError(httpStatus: number): { readonly status: 'storage-error'; readonly code: string } {
  return { status: 'storage-error', code: failureCode(httpStatus) }
}

export interface RemoteRewardStoreOptions {
  /** Injectable for tests; defaults to the real reward API client. */
  readonly api?: {
    readonly getState: typeof getRewardState
    readonly getSessions: typeof getRewardSessions
    readonly submit: typeof submitRewardTransaction
    readonly confirm: typeof confirmRewardTransaction
    readonly cancel: typeof cancelRewardTransaction
    readonly updateConfig: typeof updateRewardConfig
    readonly createCorrection: typeof createRewardCorrection
  }
}

export function createRemoteRewardStore(options: RemoteRewardStoreOptions = {}): RewardControllerStore {
  const api = options.api ?? {
    getState: getRewardState,
    getSessions: getRewardSessions,
    submit: submitRewardTransaction,
    confirm: confirmRewardTransaction,
    cancel: cancelRewardTransaction,
    updateConfig: updateRewardConfig,
    createCorrection: createRewardCorrection,
  }

  return {
    async listTransactions(): Promise<RewardListResult> {
      const response = await api.getState()
      if (!response.ok) return storageError(response.httpStatus)
      return { status: 'success', transactions: response.value.transactions, invalidCount: 0 }
    },

    async listCorrections(): Promise<RewardCorrectionListResult> {
      const response = await api.getState()
      if (!response.ok) return storageError(response.httpStatus)
      return { status: 'success', corrections: response.value.corrections, invalidCount: 0 }
    },

    async loadConfig(): Promise<RewardConfigLoadResultLike> {
      const response = await api.getState()
      if (!response.ok) return storageError(response.httpStatus)
      if (response.value.configValid === false) return { status: 'invalid-config' }
      return { status: 'found', value: response.value.config }
    },

    /**
     * The controller uses a single `putTransaction` for both creation and
     * terminal transitions. The server owns the state machine, so the correct
     * endpoint is chosen from the status the controller is trying to persist:
     * `pending` -> create, `confirmed` -> confirm, `cancelled` -> cancel.
     */
    async putTransaction(transaction: RewardTransaction, _balanceContext?: PermissionBalanceContext): Promise<RewardPutResultLike> {
      if (transaction.status === 'confirmed') {
        const response = await api.confirm(transaction.transactionId)
        if (!response.ok) {
          if (response.httpStatus === 409) return { status: 'conflict', reason: 'conflicting-transaction-content' }
          return storageError(response.httpStatus)
        }
        return { status: 'success' }
      }
      if (transaction.status === 'cancelled') {
        const response = await api.cancel(transaction.transactionId)
        if (!response.ok) {
          if (response.httpStatus === 409) return { status: 'conflict', reason: 'conflicting-transaction-content' }
          return storageError(response.httpStatus)
        }
        return { status: 'success' }
      }

      const response = await api.submit({
        transactionId: transaction.transactionId,
        starsRedeemed: transaction.starsRedeemed,
      })
      if (!response.ok) {
        if (response.failure.reason === 'insufficient-balance') return { status: 'insufficient-balance' }
        if (response.httpStatus === 409) return { status: 'conflict', reason: 'conflicting-transaction-content' }
        return storageError(response.httpStatus)
      }
      return { status: 'success' }
    },

    async saveConfig(config: RewardConfig): Promise<RewardConfigSaveResultLike> {
      const response = await api.updateConfig({
        rupiahPerStar: config.rupiahPerStar,
        minStarsPerRedemption: config.minStarsPerRedemption,
        maxStarsPerRedemption: config.maxStarsPerRedemption,
      })
      if (!response.ok) {
        if (response.failure.reason === 'invalid-config') return { status: 'invalid-config', issues: [response.failure.reason] }
        return storageError(response.httpStatus)
      }
      return { status: 'success', config: response.value.config ?? config }
    },

    async saveCorrection(correction: RewardCorrection, _balanceContext?: PermissionBalanceContext): Promise<RewardCorrectionSaveResultLike> {
      const response = await api.createCorrection({
        correctionId: correction.correctionId,
        originalTransactionId: correction.originalTransactionId,
        ...(correction.parentId !== undefined ? { parentId: correction.parentId } : {}),
        starsDelta: correction.starsDelta,
        reason: correction.reason,
      })
      if (!response.ok) {
        switch (response.failure.reason) {
          case 'invalid-original-transaction':
            return { status: 'invalid-original-transaction' }
          case 'transaction-not-confirmed':
            return { status: 'transaction-not-confirmed' }
          case 'insufficient-balance':
            return { status: 'insufficient-balance' }
          case 'conflicting-correction-content':
            return { status: 'conflict', reason: 'conflicting-correction-content' }
          default:
            return storageError(response.httpStatus)
        }
      }
      return { status: 'success', correction: response.value.correction ?? correction }
    },
  }
}

/**
 * Completed sessions that feed the balance come from the backend, never from
 * local cache.
 *
 * A failed read **throws** instead of resolving to an empty list: an empty list
 * would make the canonical engine report a balance of 0, which is a *false*
 * authoritative number (it looks like "everything was redeemed"). The
 * controller treats a rejected provider as a storage error, so the dashboard
 * shows "reward storage unavailable" and no balance at all.
 */
export class RewardSessionsUnavailableError extends Error {
  readonly httpStatus: number
  constructor(httpStatus: number) {
    super(`reward sessions unavailable (http ${httpStatus})`)
    this.name = 'RewardSessionsUnavailableError'
    this.httpStatus = httpStatus
  }
}

export function createRemoteCompletedSessionSource(
  api: { readonly getSessions: typeof getRewardSessions } = { getSessions: getRewardSessions },
): () => Promise<readonly unknown[]> {
  return async () => {
    const response = await api.getSessions()
    if (!response.ok) throw new RewardSessionsUnavailableError(response.httpStatus)
    return response.value.sessions as readonly CompletedSessionRecord[]
  }
}
