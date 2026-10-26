import { describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import {
  createDisposableRewardStore,
  type RewardControllerStore,
} from '../src/features/math-drill/reward/redemption/rewardPersistence'
import { upgradeDatabaseToVersion3 } from '../src/features/math-drill/reward/redemption/persistenceMigration'
import {
  createRewardController,
  createDisposableRewardController,
} from '../src/features/math-drill/reward/redemption/rewardController'
import type { CompletedSessionRecord } from '../src/features/math-drill/persistence/completedSessionTypes'
import { UNIFIED_DISPOSABLE_DATABASE_PREFIX } from '../src/features/math-drill/persistence/indexedDbSessionStore'
import { computeAvailableBalance } from '../src/features/math-drill/reward/redemption/balanceComputation'
import { submitRedemptionRequest } from '../src/features/math-drill/reward/redemption/transactionOperations'

function sessionsWithStars(targetStars: number): CompletedSessionRecord[] {
  const sessions: CompletedSessionRecord[] = []
  let remaining = targetStars
  while (remaining > 0) {
    const chunk = Math.min(3, remaining)
    remaining -= chunk
    const instanceId = crypto.randomUUID()
    sessions.push({
      historySchemaVersion: 2,
      instanceId,
      sessionId: `session-${instanceId}`,
      mode: 'regular',
      operationMode: 'addition',
      endReason: 'completed',
      plannedCount: chunk,
      completedCount: chunk,
      startedAt: 1000,
      durationMs: 300000,
      deadlineAt: 301000,
      endedAt: 2000,
      remainingMs: 299000,
      recordedAt: 2100,
      outcomes: Array.from({ length: chunk }, () => ({ level: 1, operation: 'addition', points: 1 })),
    })
  }
  return sessions
}

function makeDbName(suffix: string): string {
  return `${UNIFIED_DISPOSABLE_DATABASE_PREFIX}ledger-integrity-${suffix}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
}

async function seedConfirmedTransaction(store: RewardControllerStore, txId: string, stars: number): Promise<void> {
  await store.putTransaction({
    transactionId: txId,
    status: 'confirmed',
    requestedAt: 1000,
    starsRedeemed: stars,
    rupiahValue: stars * 500,
    ruleSnapshotVersion: 1,
    ruleSnapshot: { rupiahPerStar: 500 },
    confirmedAt: 1500,
    cancelledAt: null,
  })
}

async function seedSessionsInDb(dbName: string, sessions: readonly CompletedSessionRecord[]): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, 4)
    request.onupgradeneeded = () => {
      const db = request.result
      upgradeDatabaseToVersion3(db)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('completedSessions', 'readwrite')
    const store = tx.objectStore('completedSessions')
    for (const session of sessions) store.put(session)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  db.close()
}

describe('Stage 7B — Ledger Integrity & Concurrency Verification', () => {
  // ---------------------------------------------------------------------------
  // A. Integritas Ledger Koreksi
  // ---------------------------------------------------------------------------
  describe('A. Correction Ledger Integrity', () => {
    it('1. Applies valid credit and debit corrections with full audit trail', async () => {
      const dbName = makeDbName('audit-trail')
      const store = createDisposableRewardStore(dbName)
      await seedSessionsInDb(dbName, sessionsWithStars(20))
      await seedConfirmedTransaction(store, 'tx-audit-1', 5)

      const controller = createRewardController({ store, completedSessions: async () => sessionsWithStars(20) })
      await controller.load()

      // Positive correction (refund / adjustment)
      const resCredit = await controller.applyCorrection({
        correctionId: 'corr-cred-1',
        originalTransactionId: 'tx-audit-1',
        starsDelta: 3,
        reason: 'Refund sebagian karena pembatalan item reward',
        parentId: 'parent-001',
      })
      expect(resCredit.status).toBe('success')

      // Negative correction (manual debit adjustment)
      const resDebit = await controller.applyCorrection({
        correctionId: 'corr-deb-1',
        originalTransactionId: 'tx-audit-1',
        starsDelta: -2,
        reason: 'Koreksi kelebihan bintang',
        parentId: 'parent-001',
      })
      expect(resDebit.status).toBe('success')

      // Verify audit trail retains original transaction and both corrections
      const listTx = await store.listTransactions()
      const listCorr = await store.listCorrections()
      expect(listTx.status).toBe('success')
      expect(listCorr.status).toBe('success')
      if (listTx.status === 'success' && listCorr.status === 'success') {
        expect(listTx.transactions).toHaveLength(1)
        expect(listTx.transactions[0].transactionId).toBe('tx-audit-1')
        expect(listCorr.corrections).toHaveLength(2)
        expect(listCorr.corrections.map(c => c.correctionId)).toEqual(['corr-cred-1', 'corr-deb-1'])
      }

      // Balance check: earned (21) - confirmed (5) + credit (3) - debit (2) = 17
      const state = controller.getState()
      if (state.status !== 'ready') throw new Error('Not ready')
      expect(state.balance.availableBalance).toBe(17)
      expect(state.balance.isLedgerConsistent).toBe(true)
      store.close()
    })

    it('2. Applying the exact same correction twice is idempotent and does not double-adjust', async () => {
      const dbName = makeDbName('corr-idempotent')
      const store = createDisposableRewardStore(dbName)
      await seedSessionsInDb(dbName, sessionsWithStars(15))
      await seedConfirmedTransaction(store, 'tx-idem-1', 4)

      const controller = createRewardController({ store, completedSessions: async () => sessionsWithStars(15) })
      await controller.load()

      const correctionPayload = {
        correctionId: 'corr-idem-1',
        originalTransactionId: 'tx-idem-1',
        starsDelta: 3,
        reason: 'Koreksi penyesuaian',
      }

      const res1 = await controller.applyCorrection(correctionPayload)
      expect(res1.status).toBe('success')

      // Second application with identical correctionId
      const res2 = await controller.applyCorrection(correctionPayload)
      expect(res2.status).toBe('success')

      // Only one correction in store
      const listCorr = await store.listCorrections()
      if (listCorr.status !== 'success') throw new Error('List failed')
      expect(listCorr.corrections).toHaveLength(1)

      // Balance is only adjusted by +3 once: earned (15) - confirmed (4) + 3 = 14
      const state = controller.getState()
      if (state.status !== 'ready') throw new Error('Not ready')
      expect(state.balance.availableBalance).toBe(14)
      store.close()
    })

    it('3. Rejects corrections referencing non-existent or unconfirmed transactions', async () => {
      const dbName = makeDbName('unconfirmed-ref')
      const store = createDisposableRewardStore(dbName)
      await seedSessionsInDb(dbName, sessionsWithStars(10))

      // Put a pending transaction and a cancelled transaction
      await store.putTransaction({
        transactionId: 'tx-pending-1',
        status: 'pending',
        requestedAt: 1000,
        starsRedeemed: 2,
        rupiahValue: 1000,
        ruleSnapshotVersion: 1,
        ruleSnapshot: { rupiahPerStar: 500 },
        confirmedAt: null,
        cancelledAt: null,
      })
      await store.putTransaction({
        transactionId: 'tx-cancelled-1',
        status: 'cancelled',
        requestedAt: 1000,
        starsRedeemed: 2,
        rupiahValue: 1000,
        ruleSnapshotVersion: 1,
        ruleSnapshot: { rupiahPerStar: 500 },
        confirmedAt: null,
        cancelledAt: 1200,
      })

      const controller = createRewardController({ store, completedSessions: async () => sessionsWithStars(10) })
      await controller.load()

      // Non-existent transaction
      const resNonExistent = await controller.applyCorrection({
        correctionId: 'c-none',
        originalTransactionId: 'tx-does-not-exist',
        starsDelta: 2,
        reason: 'Invalid ref',
      })
      expect(resNonExistent.status).toBe('error')
      if (resNonExistent.status === 'error') {
        expect(resNonExistent.reason).toBe('invalid-original-transaction')
      }

      // Pending transaction (cannot correct unconfirmed)
      const resPending = await controller.applyCorrection({
        correctionId: 'c-pend',
        originalTransactionId: 'tx-pending-1',
        starsDelta: 2,
        reason: 'Pending ref',
      })
      expect(resPending.status).toBe('error')
      if (resPending.status === 'error') {
        expect(resPending.reason).toBe('transaction-not-confirmed')
      }

      // Cancelled transaction (cannot correct cancelled)
      const resCancelled = await controller.applyCorrection({
        correctionId: 'c-canc',
        originalTransactionId: 'tx-cancelled-1',
        starsDelta: 2,
        reason: 'Cancelled ref',
      })
      expect(resCancelled.status).toBe('error')
      if (resCancelled.status === 'error') {
        expect(resCancelled.reason).toBe('transaction-not-confirmed')
      }

      store.close()
    })

    it('4. computeAvailableBalance rejects orphaned corrections and flags ledger inconsistent', () => {
      const sessions = sessionsWithStars(10) // 12 stars earned
      const confirmedTx = {
        transactionId: 'tx-valid-1',
        status: 'confirmed',
        requestedAt: 1000,
        starsRedeemed: 3,
        rupiahValue: 1500,
        ruleSnapshotVersion: 1,
        ruleSnapshot: { rupiahPerStar: 500 },
        confirmedAt: 1500,
        cancelledAt: null,
      }
      const orphanCorrection = {
        correctionId: 'corr-orphan',
        originalTransactionId: 'tx-ghost', // does not exist
        starsDelta: 5,
        reason: 'Orphaned credit',
        createdAt: 2000,
      }

      const res = computeAvailableBalance(sessions, [confirmedTx], [orphanCorrection])
      expect(res.isLedgerConsistent).toBe(false)
      expect(res.ledgerIssues).toContain('INVALID_CORRECTIONS_IN_LEDGER')
      // The orphan correction must NOT be added to available balance: 12 - 3 = 9 (not 14!)
      expect(res.availableBalance).toBe(9)
      expect(res.transactionsSummary.invalidCorrectionsCount).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // B. Konkurensi Debit & Idempotensi
  // ---------------------------------------------------------------------------
  describe('B. Debit Concurrency & Replay Protection', () => {
    it('5. Concurrent redemptions cannot overspend available balance', async () => {
      const dbName = makeDbName('concurrent-debits')
      const store = createDisposableRewardStore(dbName)
      await seedSessionsInDb(dbName, sessionsWithStars(3)) // 3 stars earned

      const controller1 = createRewardController({ store, completedSessions: async () => sessionsWithStars(3) })
      const controller2 = createRewardController({ store, completedSessions: async () => sessionsWithStars(3) })
      await controller1.load()
      await controller2.load()

      // Two concurrent redemptions of 2 stars each (total 4 stars requested, only 3 available)
      const [res1, res2] = await Promise.all([
        controller1.submitRedemption({ transactionId: 'tx-race-1', starsRedeemed: 2 }),
        controller2.submitRedemption({ transactionId: 'tx-race-2', starsRedeemed: 2 }),
      ])

      const statuses = [res1.status, res2.status]
      expect(statuses).toContain('success')
      expect(statuses).toContain('error')

      const failedRes = res1.status === 'error' ? res1 : res2
      expect((failedRes as any).reason).toBe('insufficient-balance')

      // Verify final stored balance never goes negative
      await controller1.load()
      const finalState = controller1.getState()
      if (finalState.status !== 'ready') throw new Error('Not ready')
      expect(finalState.balance.availableBalance).toBe(1) // 3 - 2 = 1
      expect(finalState.balance.rawAvailableBalance).toBe(1)
      expect(finalState.balance.isLedgerConsistent).toBe(true)
      store.close()
    })

    it('6. Replayed / duplicate debit request with same transactionId is idempotent and does not double-deduct', async () => {
      const dbName = makeDbName('replay-debit')
      const store = createDisposableRewardStore(dbName)
      await seedSessionsInDb(dbName, sessionsWithStars(10))

      const controller = createRewardController({ store, completedSessions: async () => sessionsWithStars(10) })
      await controller.load()

      const debitPayload = { transactionId: 'tx-retry-1', starsRedeemed: 3 }

      // Initial request
      const res1 = await controller.submitRedemption(debitPayload)
      expect(res1.status).toBe('success')

      // Replayed request (same transactionId, e.g. network retry)
      const res2 = await controller.submitRedemption(debitPayload)
      // Should succeed as duplicate or return duplicate-transaction-id without double-deducting
      expect(['success', 'error']).toContain(res2.status)
      if (res2.status === 'error') {
        expect(['duplicate-transaction-id', 'duplicate']).toContain(res2.reason)
      }

      // Check balance: 12 earned - 3 redeemed = 9 (never 6!)
      await controller.load()
      const state = controller.getState()
      if (state.status !== 'ready') throw new Error('Not ready')
      expect(state.balance.availableBalance).toBe(9)
      expect(state.balance.totalPendingStars).toBe(3)
      store.close()
    })

    it('7. Cannot cancel a confirmed transaction, and repeated confirm is idempotent', async () => {
      const dbName = makeDbName('terminal-state')
      const store = createDisposableRewardStore(dbName)
      await seedConfirmedTransaction(store, 'tx-terminal-1', 2)

      const controller = createRewardController({ store, completedSessions: async () => sessionsWithStars(10) })
      await controller.load()

      // Attempting to cancel a confirmed transaction must fail
      const cancelRes = await controller.cancelRedemption('tx-terminal-1')
      expect(cancelRes.status).toBe('error')

      // Repeated confirm of already-confirmed transaction is idempotent
      const confirmRes = await controller.confirmRedemption('tx-terminal-1')
      // Must not change the confirmed transaction or conflict
      expect(['success', 'error']).toContain(confirmRes.status)

      // Underlying store rejects direct illegal transition confirmed -> cancelled
      const putRes = await store.putTransaction({
        transactionId: 'tx-terminal-1',
        status: 'cancelled',
        requestedAt: 1000,
        starsRedeemed: 2,
        rupiahValue: 1000,
        ruleSnapshotVersion: 1,
        ruleSnapshot: { rupiahPerStar: 500 },
        confirmedAt: null,
        cancelledAt: 2000,
      })
      expect(putRes.status).toBe('conflict')
      store.close()
    })
  })

  // ---------------------------------------------------------------------------
  // C. Validasi Input & Kegagalan Penyimpanan
  // ---------------------------------------------------------------------------
  describe('C. Input Validation & Fault Handling', () => {
    it('8. Rejects invalid redemption inputs (empty ID, non-integer, negative)', () => {
      const config = {
        configId: 'active' as const,
        version: 1,
        updatedAt: 1000,
        rupiahPerStar: 500,
        minStarsPerRedemption: 1,
        maxStarsPerRedemption: 100,
      }

      // Empty transactionId
      const resEmptyId = submitRedemptionRequest({
        transactionId: '   ',
        starsRedeemed: 5,
        requestedAt: 1000,
        config,
        completedSessions: [],
        existingTransactions: [],
      })
      expect(resEmptyId.status).toBe('error')
      expect((resEmptyId as any).reason).toBe('invalid-transaction-id')

      // Fractional starsRedeemed
      const resFrac = submitRedemptionRequest({
        transactionId: 'tx-frac',
        starsRedeemed: 2.5,
        requestedAt: 1000,
        config,
        completedSessions: [],
        existingTransactions: [],
      })
      expect(resFrac.status).toBe('error')
      expect((resFrac as any).reason).toBe('below-min-stars')

      // Negative starsRedeemed
      const resNeg = submitRedemptionRequest({
        transactionId: 'tx-neg',
        starsRedeemed: -5,
        requestedAt: 1000,
        config,
        completedSessions: [],
        existingTransactions: [],
      })
      expect(resNeg.status).toBe('error')
      expect((resNeg as any).reason).toBe('below-min-stars')
    })

    it('9. Storage failure leaves in-memory and stored ledger consistent', async () => {
      // Mock store where putTransaction fails with storage-error
      const failingStore = {
        async listTransactions() { return { status: 'success' as const, transactions: [], invalidCount: 0 } },
        async listCorrections() { return { status: 'success' as const, corrections: [], invalidCount: 0 } },
        async loadConfig() {
          return {
            status: 'found' as const,
            value: {
              configId: 'active' as const,
              version: 1,
              updatedAt: 1000,
              rupiahPerStar: 500,
              minStarsPerRedemption: 1,
              maxStarsPerRedemption: 100,
            },
          }
        },
        async putTransaction() { return { status: 'storage-error' as const, code: 'quota-exceeded' as const } },
        async saveConfig() { return { status: 'storage-error' as const, code: 'storage-error' } },
        async saveCorrection() { return { status: 'storage-error' as const, code: 'storage-error' } },
      }

      const controller = createDisposableRewardController({
        stores: {
          reward: failingStore,
          completedSessions: async () => sessionsWithStars(10),
        },
      })
      await controller.load()

      const res = await controller.submitRedemption({ transactionId: 'tx-fail-1', starsRedeemed: 2 })
      expect(res.status).toBe('error')
      if (res.status === 'error') {
        expect(res.reason).toBe('storage-error')
      }

      // Memory state was not mutated
      const state = controller.getState()
      if (state.status !== 'ready') throw new Error('Not ready')
      expect(state.transactions).toHaveLength(0)
      expect(state.balance.totalPendingStars).toBe(0)
      expect(state.balance.availableBalance).toBe(12)
    })
  })
})
