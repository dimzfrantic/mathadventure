/**
 * Stage 7B Phase 5 — Reward Persistence Adapter (IndexedDB v3)
 *
 * Owns the `rewardTransactions` and `rewardConfig` stores inside the shared
 * `math-adventure` database. Opens the database at STAGE7B_DATABASE_VERSION (3);
 * the upgrade handler delegates to the additive-only migration helper from
 * Phase 3, so existing v2 stores (`activeSessions`, `completedSessions`) and
 * their data are never touched or re-created.
 *
 * Safety contract (mirrors the session store discipline):
 * - Disposable test databases must use the UNIFIED_DISPOSABLE_DATABASE_PREFIX.
 * - The exact live database name requires REWARD_LIVE_AUTHORITY (fail closed).
 * - All results are typed discriminated unions; nothing throws.
 */

import {
  SESSION_DATABASE_NAME,
  UNIFIED_DISPOSABLE_DATABASE_PREFIX,
} from '../../persistence/indexedDbSessionStore'
import {
  STAGE7B_DATABASE_VERSION,
  upgradeDatabaseToVersion3,
} from './persistenceMigration'
import type {
  RewardConfig,
  RewardTransaction,
} from './redemptionTypes'
import {
  validateRewardConfig,
  validateRewardTransaction,
} from './redemptionValidation'
import { validateRewardCorrection, type RewardCorrection } from './correctionTypes'
import { computeAvailableBalance } from './balanceComputation'

export const REWARD_TRANSACTIONS_STORE = 'rewardTransactions'
export const REWARD_CONFIG_STORE = 'rewardConfig'
export const REWARD_CONFIG_KEY = 'active' as const
export const REWARD_CORRECTIONS_STORE = 'rewardCorrections'

export type RewardStoreError =
  | 'unavailable'
  | 'unsafe-database-name'
  | 'open-failed'
  | 'blocked'
  | 'unsupported-database-version'
  | 'incompatible-database'
  | 'transaction-failed'
  | 'quota-exceeded'
  | 'unexpected'

export type RewardLoadAllResult =
  | { readonly status: 'success'; readonly transactions: readonly RewardTransaction[]; readonly invalidCount: number }
  | { readonly status: 'storage-error'; readonly code: RewardStoreError }

export type RewardPutResult =
  | { readonly status: 'success' }
  | { readonly status: 'duplicate' }
  | { readonly status: 'conflict'; readonly reason: 'conflicting-transaction-content' }
  | { readonly status: 'insufficient-balance' }
  | { readonly status: 'storage-error'; readonly code: RewardStoreError }

export type RewardConfigLoadResult =
  | { readonly status: 'found'; readonly value: RewardConfig }
  | { readonly status: 'not-found' }
  | { readonly status: 'invalid-config' }
  | { readonly status: 'storage-error'; readonly code: RewardStoreError }

export type RewardConfigSaveResult =
  | { readonly status: 'success'; readonly value: RewardConfig }
  | { readonly status: 'invalid-config' }
  | { readonly status: 'version-mismatch' }
  | { readonly status: 'storage-error'; readonly code: RewardStoreError }

export type RewardCorrectionSaveResult =
  | { readonly status: 'success'; readonly correction: RewardCorrection }
  | { readonly status: 'duplicate'; readonly correction: RewardCorrection }
  | { readonly status: 'conflict'; readonly reason: 'conflicting-correction-content' }
  | { readonly status: 'invalid-original-transaction' }
  | { readonly status: 'transaction-not-confirmed' }
  | { readonly status: 'insufficient-balance' }
  | { readonly status: 'invalid-config'; readonly issues?: readonly string[] }
  | { readonly status: 'storage-error'; readonly code: RewardStoreError }

export interface RewardPersistenceOptions {
  readonly indexedDB?: IDBFactory | null
  readonly databaseName?: string
}

/**
 * Balance context supplied by the controller (which has read access to the
 * completed-session store) when performing an operation that can spend stars.
 * The store still serializes via a single readwrite IndexedDB transaction and
 * reads the LATEST transactions/corrections from the database inside it, so
 * concurrent operations across controller instances cannot double-spend.
 */
export interface RewardBalanceContext {
  readonly completedSessions: readonly unknown[]
}

function storageError<T>(code: RewardStoreError): T {
  return { status: 'storage-error', code } as unknown as T
}

/**
 * Substantive content fingerprint — excludes the status lifecycle fields
 * (`status`, `confirmedAt`, `cancelledAt`) so that a legitimate state
 * transition (pending -> confirmed / cancelled) is NOT treated as a content
 * conflict. Only genuinely different economic content (stars, value, rule
 * snapshot, request time) is a conflict.
 */
function transactionSubstantiveFingerprint(tx: RewardTransaction): string {
  return JSON.stringify([
    tx.transactionId,
    tx.starsRedeemed,
    tx.rupiahValue,
    tx.ruleSnapshotVersion,
    tx.ruleSnapshot.rupiahPerStar,
  ])
}

function correctionFingerprint(c: RewardCorrection): string {
  return JSON.stringify([
    c.correctionId,
    c.originalTransactionId,
    c.parentId ?? null,
    c.starsDelta,
    c.reason,
  ])
}

/**
 * Owns the reward stores of the shared database. Disposable by default;
 * the exact live database name requires the dedicated live owner symbol,
 * mirroring how the v2 session store guards its live authority.
 */
export class RewardIndexedDbStore {
  private readonly factory: IDBFactory | null
  private readonly databaseName: string
  private readonly liveAuthorization: symbol | undefined
  private database: IDBDatabase | null = null
  private opening: Promise<IDBDatabase> | null = null
  private closed = false

  constructor(options: RewardPersistenceOptions = {}, liveAuthorization?: symbol) {
    const browserIndexedDB = (globalThis as typeof globalThis & { indexedDB?: IDBFactory }).indexedDB
    this.factory = options.indexedDB === undefined ? browserIndexedDB ?? null : options.indexedDB
    this.databaseName = options.databaseName ?? SESSION_DATABASE_NAME
    this.liveAuthorization = liveAuthorization
  }

  private assertUsableName(): boolean {
    const disposable = this.databaseName.startsWith(UNIFIED_DISPOSABLE_DATABASE_PREFIX)
    const authorizedLive = this.databaseName === SESSION_DATABASE_NAME && this.liveAuthorization === REWARD_LIVE_AUTHORITY
    return disposable || authorizedLive
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (!this.assertUsableName()) return Promise.reject(new Error('unsafe-database-name'))
    if (this.closed || !this.factory) return Promise.reject(new Error('unavailable'))
    if (this.database) return Promise.resolve(this.database)
    if (this.opening) return this.opening
    this.opening = new Promise((resolve, reject) => {
      let settled = false
      const fail = (code: RewardStoreError) => { if (!settled) { settled = true; this.opening = null; reject(new Error(code)) } }
      let request: IDBOpenDBRequest
      try { request = this.factory!.open(this.databaseName, STAGE7B_DATABASE_VERSION) }
      catch { fail('open-failed'); return }
      request.onupgradeneeded = () => {
        try { upgradeDatabaseToVersion3(request.result) }
        catch {
          try { request.transaction?.abort() } catch { /* open request reports failure */ }
        }
      }
      request.onerror = () => fail(request.error?.name === 'VersionError' ? 'unsupported-database-version' : 'open-failed')
      request.onblocked = () => fail('blocked')
      request.onsuccess = () => {
        const db = request.result
        if (settled || this.closed) { db.close(); return }
        try {
          if (
            db.version !== STAGE7B_DATABASE_VERSION ||
            !db.objectStoreNames.contains(REWARD_TRANSACTIONS_STORE) ||
            !db.objectStoreNames.contains(REWARD_CONFIG_STORE) ||
            !db.objectStoreNames.contains(REWARD_CORRECTIONS_STORE)
          ) {
            db.close(); fail('incompatible-database'); return
          }
          const txStore = db.transaction(REWARD_TRANSACTIONS_STORE, 'readonly').objectStore(REWARD_TRANSACTIONS_STORE)
          if (txStore.keyPath !== 'transactionId' || !txStore.indexNames.contains('status') || !txStore.indexNames.contains('requestedAt')) {
            db.close(); fail('incompatible-database'); return
          }
          db.onversionchange = () => { db.close(); this.database = null; this.opening = null }
          this.database = db; settled = true; resolve(db)
        } catch { db.close(); fail('incompatible-database') }
      }
    })
    return this.opening
  }

  /**
   * Runs `work` inside a single IndexedDB transaction and resolves when the
   * transaction commits. `work(tx, decide, failed)`:
   *   - call `decide(value)` inside a request success/oncomplete handler to set
   *     the resolved value for the *success* case;
   *   - call `failed()` inside a request error handler to force a
   *     `storage-error` result on abort/complete instead of the pending value.
   * `mode` must be 'readonly' or 'readwrite'. This overload accepts a single
   * store name as input stores.
   */
  private async transact<T>(stores: string | readonly string[], mode: 'readonly' | 'readwrite', work: (tx: IDBTransaction, decide: (value: T) => void, failed: () => void) => void): Promise<T | { readonly status: 'storage-error'; readonly code: RewardStoreError }> {
    const storeList = typeof stores === 'string' ? [stores] : stores
    let db: IDBDatabase
    try { db = await this.openDatabase() }
    catch (error) {
      const code = error instanceof Error && (error as { message?: string }).message
      const known = (['unsafe-database-name', 'unavailable', 'blocked', 'unsupported-database-version', 'incompatible-database'] as const).find(known => known === code)
      return storageError(known ?? 'open-failed')
    }
    return new Promise(resolve => {
      let decision: T | undefined, settled = false
      let failedCode: RewardStoreError | null = null
      const end = (value: T | { readonly status: 'storage-error'; readonly code: RewardStoreError }) => { if (!settled) { settled = true; resolve(value) } }
      const failed = (event?: Event) => {
        const error = (event?.target as { error?: DOMException | null } | null)?.error
        failedCode ??= error?.name === 'QuotaExceededError' ? 'quota-exceeded' : 'transaction-failed'
      }
      try {
        const tx = db.transaction([...storeList], mode)
        tx.oncomplete = () => end(failedCode ? storageError(failedCode) : decision === undefined ? storageError('unexpected') : decision)
        tx.onerror = () => undefined
        tx.onabort = () => end(storageError(failedCode ?? (tx.error?.name === 'QuotaExceededError' ? 'quota-exceeded' : 'transaction-failed')))
        work(tx, value => { decision = value }, failed)
      } catch { end(storageError('transaction-failed')) }
    })
  }

  /** Loads every stored reward transaction; invalid records are skipped and counted. */
  async listTransactions(): Promise<RewardLoadAllResult> {
    const result = await this.transact<{ readonly transactions: readonly RewardTransaction[]; readonly invalidCount: number }>([REWARD_TRANSACTIONS_STORE], 'readonly', (tx, decide, failed) => {
      const request = tx.objectStore(REWARD_TRANSACTIONS_STORE).getAll()
      request.onerror = failed
      request.onsuccess = () => {
        const transactions: RewardTransaction[] = []
        let invalidCount = 0
        for (const raw of request.result as unknown[]) {
          const checked = validateRewardTransaction(raw)
          if (checked.status === 'valid') transactions.push(checked.value)
          else invalidCount += 1
        }
        transactions.sort((a, b) => a.requestedAt - b.requestedAt || a.transactionId.localeCompare(b.transactionId))
        decide({ transactions, invalidCount })
      }
    })
    return 'status' in result && result.status === 'storage-error' ? result : { status: 'success', ...(result as { readonly transactions: readonly RewardTransaction[]; readonly invalidCount: number }) }
  }

  /** Upserts one transaction with deduplication, conflict detection, and atomic balance enforcement. */
  async putTransaction(transaction: RewardTransaction, balanceContext?: RewardBalanceContext): Promise<RewardPutResult> {
    const checked = validateRewardTransaction(transaction)
    if (checked.status !== 'valid') return storageError('unexpected')
    return this.transact<RewardPutResult>(
      [REWARD_TRANSACTIONS_STORE, REWARD_CORRECTIONS_STORE],
      'readwrite',
      (tx, decide, failed) => {
        const store = tx.objectStore(REWARD_TRANSACTIONS_STORE)
        const corrStore = tx.objectStore(REWARD_CORRECTIONS_STORE)

        const txReqAll = store.getAll()
        txReqAll.onerror = failed
        txReqAll.onsuccess = () => {
          const allTransactions = txReqAll.result
          const corrReqAll = corrStore.getAll()
          corrReqAll.onerror = failed
          corrReqAll.onsuccess = () => {
            const corrections = corrReqAll.result

            // Check existing transaction against the LATEST stored ledger
            const existingRaw = allTransactions.find((t: any) => t.transactionId === checked.value.transactionId)
            if (existingRaw) {
              const existingChecked = validateRewardTransaction(existingRaw)
              if (existingChecked.status === 'valid') {
                const existingSubstantive = transactionSubstantiveFingerprint(existingChecked.value)
                const newSubstantive = transactionSubstantiveFingerprint(checked.value)
                if (existingSubstantive !== newSubstantive) {
                  // Same ID but different economic content -> conflict, never overwrite silently
                  decide({ status: 'conflict', reason: 'conflicting-transaction-content' })
                  return
                }

                // If existing transaction is already in a terminal state (confirmed or cancelled)
                if (existingChecked.value.status !== 'pending') {
                  if (existingChecked.value.status === checked.value.status) {
                    // Already in this terminal status (e.g. repeated confirm/cancel) -> idempotent duplicate
                    decide({ status: 'duplicate' })
                    return
                  }
                  // Attempting an illegal transition out of terminal status (confirmed <-> cancelled or terminal -> pending)
                  decide({ status: 'conflict', reason: 'conflicting-transaction-content' })
                  return
                }

                // If existing transaction is pending, and new transaction is also pending -> duplicate submission
                if (checked.value.status === 'pending') {
                  decide({ status: 'duplicate' })
                  return
                }

                // Legitimate transition from pending -> confirmed or pending -> cancelled
              }
            }

            // Check balance if submitting or confirming a new redemption and a
            // balance context (earned sessions) is available from the controller
            if (
              balanceContext &&
              (checked.value.status === 'pending' || checked.value.status === 'confirmed')
            ) {
              const tempTxs = [...allTransactions.filter((t: any) => t.transactionId !== checked.value.transactionId), checked.value]
              const balanceRes = computeAvailableBalance(balanceContext.completedSessions, tempTxs, corrections)
              if (balanceRes.rawAvailableBalance < 0) {
                decide({ status: 'insufficient-balance' })
                return
              }
            }

            const putReq = store.put(checked.value)
            putReq.onerror = failed
            putReq.onsuccess = () => decide({ status: 'success' })
          }
        }
      }
    )
  }

  /** Loads the active reward configuration; `not-found` means first-run defaults apply. */
  async loadConfig(): Promise<RewardConfigLoadResult> {
    const result = await this.transact<{ readonly found: boolean; readonly raw?: unknown }>([REWARD_CONFIG_STORE], 'readonly', (tx, decide) => {
      const request = tx.objectStore(REWARD_CONFIG_STORE).get(REWARD_CONFIG_KEY)
      request.onerror = () => { try { tx.abort() } catch { /* abort resolves */ } }
      request.onsuccess = () => decide({ raw: request.result, found: request.result !== undefined })
    })
    if ('status' in result && result.status === 'storage-error') return result
    const raw = (result as { readonly raw?: unknown }).raw
    if (raw === undefined) return { status: 'not-found' }
    const checked = validateRewardConfig(raw)
    return checked.status === 'valid' ? { status: 'found', value: checked.value } : { status: 'invalid-config' }
  }

  /** Upserts the active config with monotonically increasing version check. */
  async saveConfig(value: RewardConfig): Promise<RewardConfigSaveResult> {
    const checked = validateRewardConfig(value)
    if (checked.status !== 'valid') return { status: 'invalid-config' }
    return this.transact<RewardConfigSaveResult>(REWARD_CONFIG_STORE, 'readwrite', (tx, decide, failed) => {
      const store = tx.objectStore(REWARD_CONFIG_STORE)
      const existingReq = store.get(REWARD_CONFIG_KEY)
      existingReq.onerror = failed
      existingReq.onsuccess = () => {
        const existingRaw = existingReq.result
        if (existingRaw) {
          const existingChecked = validateRewardConfig(existingRaw)
          if (existingChecked.status === 'valid') {
            if (checked.value.version !== existingChecked.value.version + 1) {
              decide({ status: 'version-mismatch' })
              return
            }
          }
        }
        const putReq = store.put(checked.value)
        putReq.onerror = failed
        putReq.onsuccess = () => decide({ status: 'success', value: checked.value })
      }
    })
  }

  /** Loads every stored reward correction entry. */
  async listCorrections(): Promise<
    | { readonly status: 'success'; readonly corrections: readonly RewardCorrection[]; readonly invalidCount: number }
    | { readonly status: 'storage-error'; readonly code: RewardStoreError }
  > {
    const result = await this.transact<{ readonly corrections: readonly RewardCorrection[]; readonly invalidCount: number }>([REWARD_CORRECTIONS_STORE], 'readonly', (tx, decide, failed) => {
      const request = tx.objectStore(REWARD_CORRECTIONS_STORE).getAll()
      request.onerror = failed
      request.onsuccess = () => {
        const corrections: RewardCorrection[] = []
        let invalidCount = 0
        for (const raw of request.result as unknown[]) {
          const checked = validateRewardCorrection(raw)
          if (checked.status === 'valid') corrections.push(checked.value)
          else invalidCount += 1
        }
        corrections.sort((a, b) => a.createdAt - b.createdAt || a.correctionId.localeCompare(b.correctionId))
        decide({ corrections, invalidCount })
      }
    })
    return 'status' in result && result.status === 'storage-error' ? result : { status: 'success', ...(result as { readonly corrections: readonly RewardCorrection[]; readonly invalidCount: number }) }
  }

  /** Upserts a validated correction entry with strict validation, conflict detection, and atomic balance enforcement. */
  async saveCorrection(correction: RewardCorrection, balanceContext?: RewardBalanceContext): Promise<RewardCorrectionSaveResult> {
    const checked = validateRewardCorrection(correction)
    if (checked.status !== 'valid') return { status: 'invalid-config', issues: checked.issues }
    return this.transact<RewardCorrectionSaveResult>(
      [REWARD_CORRECTIONS_STORE, REWARD_TRANSACTIONS_STORE],
      'readwrite',
      (tx, decide, failed) => {
        const txStore = tx.objectStore(REWARD_TRANSACTIONS_STORE)
        const corrStore = tx.objectStore(REWARD_CORRECTIONS_STORE)

        const txReqAll = txStore.getAll()
        txReqAll.onerror = failed
        txReqAll.onsuccess = () => {
          const transactions = txReqAll.result
          const corrReqAll = corrStore.getAll()
          corrReqAll.onerror = failed
          corrReqAll.onsuccess = () => {
            const corrections = corrReqAll.result

            // 1. Verify original transaction exists and is confirmed (vs LATEST ledger)
            const origRaw = transactions.find((t: any) => t.transactionId === checked.value.originalTransactionId)
            if (!origRaw) {
              decide({ status: 'invalid-original-transaction' })
              return
            }
            const origChecked = validateRewardTransaction(origRaw)
            if (origChecked.status !== 'valid' || origChecked.value.status !== 'confirmed') {
              decide({ status: 'transaction-not-confirmed' })
              return
            }

            // 2. Check if correction ID already exists (vs LATEST ledger)
            const existingRaw = corrections.find((c: any) => c.correctionId === checked.value.correctionId)
            if (existingRaw) {
              const existingChecked = validateRewardCorrection(existingRaw)
              if (existingChecked.status === 'valid') {
                const existingFp = correctionFingerprint(existingChecked.value)
                const newFp = correctionFingerprint(checked.value)
                if (existingFp === newFp) {
                  decide({ status: 'duplicate', correction: existingChecked.value })
                  return
                } else {
                  decide({ status: 'conflict', reason: 'conflicting-correction-content' })
                  return
                }
              }
            }

            // 3. Check balance if negative correction and balance context available
            if (checked.value.starsDelta < 0 && balanceContext) {
              const tempCorrs = [...corrections.filter((c: any) => c.correctionId !== checked.value.correctionId), checked.value]
              const balanceRes = computeAvailableBalance(balanceContext.completedSessions, transactions, tempCorrs)
              if (balanceRes.rawAvailableBalance < 0) {
                decide({ status: 'insufficient-balance' })
                return
              }
            }

            // 4. Store new correction
            const putReq = corrStore.put(checked.value)
            putReq.onerror = failed
            putReq.onsuccess = () => decide({ status: 'success', correction: checked.value })
          }
        }
      }
    )
  }

  close(): void {
    this.closed = true
    this.database?.close()
    this.database = null
    this.opening = null
  }
}

/** Live access requires explicit composition; no arbitrary name can claim it. */
const REWARD_LIVE_AUTHORITY = Symbol('reward-live-explicit-composition')

/** Live adapter for the real `math-adventure` database at version 3. */
export function createLiveRewardStore(): RewardIndexedDbStore {
  return new RewardIndexedDbStore({ databaseName: SESSION_DATABASE_NAME }, REWARD_LIVE_AUTHORITY)
}

export function createDisposableRewardStore(databaseName: string, indexedDB?: IDBFactory | null): RewardIndexedDbStore {
  return new RewardIndexedDbStore({ databaseName, indexedDB })
}
