import { describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import {
  createDisposableRewardStore,
  type RewardControllerStore,
} from '../src/features/math-drill/reward/redemption/rewardPersistence'
import {
  createDisposableRewardController,
  createRewardController,
} from '../src/features/math-drill/reward/redemption/rewardController'
import type { CompletedSessionRecord } from '../src/features/math-drill/persistence/completedSessionTypes'
import { UNIFIED_DISPOSABLE_DATABASE_PREFIX } from '../src/features/math-drill/persistence/indexedDbSessionStore'

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
  return `${UNIFIED_DISPOSABLE_DATABASE_PREFIX}phase7a-${suffix}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
}

describe('Stage 7B Phase 7A — RewardController & Persistence Store', () => {
  // Helper to seed a confirmed transaction
  async function seedConfirmedTransaction(store, txId: string, stars: number) {
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

  // 1. Koreksi penambahan valid
  it('1. applies a valid positive correction (credit)', async () => {
    const dbName = makeDbName('credit')
    const store = createDisposableRewardStore(dbName)
    const completedSessions = async () => sessionsWithStars(10)
    const controller = createRewardController({ store, completedSessions })
    await controller.load()

    // Check initial balance before seeding transaction
    const initialBalance = controller.getState()
    if (initialBalance.status !== 'ready') throw new Error('Controller not ready')
    expect(initialBalance.balance.availableBalance).toBe(12)

    // Seed source transaction (per spec: correction requires original tx to exist and be confirmed)
    await seedConfirmedTransaction(store, 'tx-1', 5)

    const result = await controller.applyCorrection({
      correctionId: 'corr-1',
      originalTransactionId: 'tx-1',
      starsDelta: 5,
      reason: 'Bonus untuk prestasi khusus',
      parentId: 'parent-123',
    })

    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.correction.starsDelta).toBe(5)
      expect(result.correction.parentId).toBe('parent-123')
    }

    const stateAfter = controller.getState()
    if (stateAfter.status !== 'ready') throw new Error('Controller not ready')
    // Balance = earned 12 - confirmed 5 + correction +5 = 12
    expect(stateAfter.balance.availableBalance).toBe(12)
  })

  // 2. Koreksi pengurangan valid
  it('2. applies a valid negative correction (debit)', async () => {
    const dbName = makeDbName('debit')
    const store = createDisposableRewardStore(dbName)
    const completedSessions = async () => sessionsWithStars(20)
    const controller = createRewardController({ store, completedSessions })
    await controller.load()

    // Check initial balance before seeding transaction
    const initialBalance = controller.getState()
    if (initialBalance.status !== 'ready') throw new Error('Controller not ready')
    expect(initialBalance.balance.availableBalance).toBe(21)

    // Seed source transaction after initial load
    await seedConfirmedTransaction(store, 'tx-2', 5)

    const result = await controller.applyCorrection({
      correctionId: 'corr-2',
      originalTransactionId: 'tx-2',
      starsDelta: -5,
      reason: 'Koreksi kelebihan kalkulasi bintang',
    })

    expect(result.status).toBe('success')
    const state = controller.getState()
    if (state.status !== 'ready') throw new Error('Controller not ready')
    // Balance = earned (21) - confirmed (5) + correction (-5) = 11
    // Correction -5 (debit) means user loses 5 stars, so balance decreases
    expect(state.balance.availableBalance).toBe(11)
  })

  // 3. Jumlah nol, pecahan, nilai tidak valid, dan alasan kosong
  it('3. rejects invalid correction parameters (zero, fraction, empty reason)', async () => {
    const dbName = makeDbName('invalid-corr')
    const store = createDisposableRewardStore(dbName)
    const controller = createRewardController({ store })
    await controller.load()

    // Stars delta = 0
    const resZero = await controller.applyCorrection({
      correctionId: 'c-zero',
      originalTransactionId: 'tx-1',
      starsDelta: 0,
      reason: 'Koreksi 0',
    })
    expect(resZero.status).toBe('error')

    // Fractional stars
    const resFraction = await controller.applyCorrection({
      correctionId: 'c-frac',
      originalTransactionId: 'tx-1',
      starsDelta: 2.5,
      reason: 'Koreksi pecahan',
    })
    expect(resFraction.status).toBe('error')

    // Empty reason
    const resEmptyReason = await controller.applyCorrection({
      correctionId: 'c-empty-reason',
      originalTransactionId: 'tx-1',
      starsDelta: 5,
      reason: '   ',
    })
    expect(resEmptyReason.status).toBe('error')
  })

  // 4. Pengurangan melebihi saldo tersedia
  it('4. rejects negative correction exceeding available balance', async () => {
    const dbName = makeDbName('exceed-bal')
    const store = createDisposableRewardStore(dbName)
    const completedSessions = async () => sessionsWithStars(10)
    const controller = createRewardController({ store, completedSessions })
    await controller.load()

    // Available balance = 10, attempt to deduct 15
    const result = await controller.applyCorrection({
      correctionId: 'corr-exceed',
      originalTransactionId: 'tx-1',
      starsDelta: -15,
      reason: 'Pengurangan melebihi saldo',
    })

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.reason).toBe('insufficient-balance')
    }

    // Balance must remain unchanged at 12
    const state = controller.getState()
    if (state.status !== 'ready') throw new Error('Controller not ready')
    expect(state.balance.availableBalance).toBe(12)
  })

  // 5. Saldo dengan transaksi pending dan confirmed
  it('5. computes balance correctly with pending, confirmed transactions and corrections', async () => {
    const dbName = makeDbName('complex-balance')
    const store = createDisposableRewardStore(dbName)
    const completedSessions = async () => sessionsWithStars(50)
    const controller = createRewardController({ store, completedSessions })
    await controller.load()

    // 50 stars earned.
    // Submit 10 stars redemption (pending) -> remaining 40
    await controller.submitRedemption({ transactionId: 'tx-pending', starsRedeemed: 10 })

    // Confirm another redemption of 15 stars -> remaining 25
    await controller.submitRedemption({ transactionId: 'tx-confirm', starsRedeemed: 15 })
    await controller.confirmRedemption('tx-confirm')

    // Apply positive correction of +5 stars -> remaining 30
    await controller.applyCorrection({
      correctionId: 'corr-plus',
      originalTransactionId: 'tx-confirm',
      starsDelta: 5,
      reason: 'Koreksi tambah',
    })

    const state = controller.getState()
    if (state.status !== 'ready') throw new Error('Controller not ready')
    expect(state.balance.availableBalance).toBe(31)
    expect(state.balance.totalCollectibleStarsEarned).toBe(51)
    expect(state.balance.totalPendingStars).toBe(10)
    expect(state.balance.totalConfirmedRedeemedStars).toBe(15)
  })

  // 6. Koreksi tersimpan dan terbaca kembali dari store (persistence round-trip)
  it('6. persists corrections and reads them back on new controller instance', async () => {
    const dbName = makeDbName('persistence-roundtrip')
    const store1 = createDisposableRewardStore(dbName)
    const completedSessions = async () => sessionsWithStars(20)

    const controller1 = createRewardController({ store: store1, completedSessions })
    await controller1.load()

    // Seed source transaction after initial load
    await seedConfirmedTransaction(store1, 'tx-ref', 5)

    await controller1.applyCorrection({
      correctionId: 'persisted-corr-1',
      originalTransactionId: 'tx-ref',
      starsDelta: 10,
      reason: 'Bonus persisten',
    })

    // Re-instantiate controller with fresh store pointing to same database
    const store2 = createDisposableRewardStore(dbName)
    const controller2 = createRewardController({ store: store2, completedSessions })
    await controller2.load()

    const state2 = controller2.getState()
    if (state2.status !== 'ready') throw new Error('Controller 2 not ready')

    // Balance = earned (21) - confirmed (5) + correction (+10) = 26
    expect(state2.balance.availableBalance).toBe(26)
    expect(state2.corrections.length).toBe(1)
    expect(state2.corrections[0].correctionId).toBe('persisted-corr-1')
    expect(state2.corrections[0].reason).toBe('Bonus persisten')
  })

  // 7. ID duplikat atau operasi berulang
  it('7. handles duplicate correction IDs or repeated operations cleanly', async () => {
    const dbName = makeDbName('duplicate-id')
    const store = createDisposableRewardStore(dbName)
    // Seed source transaction first
    await seedConfirmedTransaction(store, 'tx-1', 5)
    const completedSessions = async () => sessionsWithStars(20)
    const controller = createRewardController({ store, completedSessions })
    await controller.load()

    // First correction
    const res1 = await controller.applyCorrection({
      correctionId: 'corr-dup-1',
      originalTransactionId: 'tx-1',
      starsDelta: 5,
      reason: 'Koreksi pertama',
    })
    expect(res1.status).toBe('success')

    // Second correction with SAME ID but DIFFERENT content
    // Per spec: ID sama + content berbeda = conflict, harus ditolak
    const res2 = await controller.applyCorrection({
      correctionId: 'corr-dup-1',
      originalTransactionId: 'tx-1',
      starsDelta: 5,  // Different from +10
      reason: 'Koreksi pertama (diperbarui)',
    })
    expect(res2.status).toBe('error')
    expect(res2.reason).toBe('conflicting-correction-content')

    const state = controller.getState()
    if (state.status !== 'ready') throw new Error('Controller not ready')
    // Update was rejected (conflict), so corrections length remains 1 with ORIGINAL reason
    expect(state.corrections.length).toBe(1)
    expect(state.corrections[0].reason).toBe('Koreksi pertama')
  })

  // 8. Kegagalan persistensi
  it('8. handles storage error when applying correction', async () => {
    const failingStore: RewardControllerStore = {
      async listTransactions() {
        return { status: 'success', transactions: [], invalidCount: 0 }
      },
      async listCorrections() {
        return { status: 'success', corrections: [], invalidCount: 0 }
      },
      async loadConfig() {
        return { status: 'not-found' }
      },
      async putTransaction() {
        return { status: 'success' }
      },
      async saveConfig() {
        return { status: 'success', config: { configId: 'active', version: 1, updatedAt: 0, rupiahPerStar: 500, minStarsPerRedemption: 1, maxStarsPerRedemption: 100 } }
      },
      async saveCorrection() {
        return { status: 'storage-error', code: 'transaction-failed' }
      },
    }

    const controller = createRewardController({ store: failingStore })
    await controller.load()

    const result = await controller.applyCorrection({
      correctionId: 'fail-corr',
      originalTransactionId: 'tx-1',
      starsDelta: 5,
      reason: 'Koreksi gagal simpan',
    })

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.reason).toBe('storage-error')
    }
  })

  // 9. Update konfigurasi valid dan parsial
  it('9. updates config partially and persists new config', async () => {
    const dbName = makeDbName('config-update')
    const store = createDisposableRewardStore(dbName)
    const controller = createRewardController({ store })
    await controller.load()

    const initial = controller.getState()
    if (initial.status !== 'ready') throw new Error('Not ready')
    expect(initial.config.rupiahPerStar).toBe(500)

    // Update rupiahPerStar to 1000
    const res = await controller.updateConfig({ rupiahPerStar: 1000 })
    expect(res.status).toBe('success')
    if (res.status === 'success') {
      expect(res.config.rupiahPerStar).toBe(1000)
      expect(res.config.minStarsPerRedemption).toBe(1) // preserved
      expect(res.config.version).toBe(2)
    }

    const stateAfter = controller.getState()
    if (stateAfter.status !== 'ready') throw new Error('Not ready')
    expect(stateAfter.config.rupiahPerStar).toBe(1000)
  })

  // 10. Konfigurasi tidak valid
  it('10. rejects invalid config updates (negative rate or min > max)', async () => {
    const dbName = makeDbName('config-invalid')
    const store = createDisposableRewardStore(dbName)
    const controller = createRewardController({ store })
    await controller.load()

    // Negative rupiah per star
    const resNegative = await controller.updateConfig({ rupiahPerStar: -100 })
    expect(resNegative.status).toBe('error')

    // minStars > maxStars
    const resMinMax = await controller.updateConfig({ minStarsPerRedemption: 200, maxStarsPerRedemption: 50 })
    expect(resMinMax.status).toBe('error')

    // Config must stay unchanged
    const state = controller.getState()
    if (state.status !== 'ready') throw new Error('Not ready')
    expect(state.config.rupiahPerStar).toBe(500)
  })

  // 11. Kegagalan penyimpanan konfigurasi
  it('11. handles storage failure during config update without corrupting in-memory state', async () => {
    const failingStore: RewardControllerStore = {
      async listTransactions() {
        return { status: 'success', transactions: [], invalidCount: 0 }
      },
      async listCorrections() {
        return { status: 'success', corrections: [], invalidCount: 0 }
      },
      async loadConfig() {
        return { status: 'not-found' }
      },
      async putTransaction() {
        return { status: 'success' }
      },
      async saveConfig() {
        return { status: 'storage-error', code: 'quota-exceeded' }
      },
      async saveCorrection() {
        return { status: 'storage-error', code: 'quota-exceeded' }
      },
    }

    const controller = createRewardController({ store: failingStore })
    await controller.load()

    const res = await controller.updateConfig({ rupiahPerStar: 2000 })
    expect(res.status).toBe('error')

    const state = controller.getState()
    if (state.status !== 'ready') throw new Error('Not ready')
    expect(state.config.rupiahPerStar).toBe(500)
  })

  // 12. Snapshot nilai tukar transaksi lama tidak terpengaruh updateConfig
  it('12. ensures existing transaction snapshots are preserved when config changes', async () => {
    const dbName = makeDbName('config-snapshot')
    const store = createDisposableRewardStore(dbName)
    const completedSessions = async () => sessionsWithStars(100)

    const controller = createRewardController({ store, completedSessions })
    await controller.load()

    // Initial config rupiahPerStar: 500
    const txRes = await controller.submitRedemption({ transactionId: 'tx-old', starsRedeemed: 10 })
    expect(txRes.status).toBe('success')
    if (txRes.status === 'success') {
      expect(txRes.transaction.rupiahValue).toBe(5000) // 10 * 500
      expect(txRes.transaction.ruleSnapshot.rupiahPerStar).toBe(500)
    }

    // Now update config to 1000 IDR per star
    await controller.updateConfig({ rupiahPerStar: 1000 })

    // Existing transaction in ledger must keep its original snapshot
    const state = controller.getState()
    if (state.status !== 'ready') throw new Error('Not ready')
    const oldTx = state.transactions.find((t: RewardTransaction) => t.transactionId === 'tx-old')
    expect(oldTx).toBeDefined()
    expect(oldTx?.rupiahValue).toBe(5000)
    expect(oldTx?.ruleSnapshot.rupiahPerStar).toBe(500)

    // New transaction uses updated config (1000 IDR per star)
    const newTxRes = await controller.submitRedemption({ transactionId: 'tx-new', starsRedeemed: 10 })
    expect(newTxRes.status).toBe('success')
    if (newTxRes.status === 'success') {
      expect(newTxRes.transaction.rupiahValue).toBe(10000) // 10 * 1000
      expect(newTxRes.transaction.ruleSnapshot.rupiahPerStar).toBe(1000)
    }
  })

  // 13. State re-readability on controller restart
  it('13. re-reads full state accurately after controller recreation', async () => {
    const dbName = makeDbName('full-recreation')
    const store1 = createDisposableRewardStore(dbName)
    // Seed source transaction first (confirmed status required for corrections)
    await seedConfirmedTransaction(store1, 'tx-1', 20)
    const completedSessions = async () => sessionsWithStars(50)

    const ctrl1 = createRewardController({ store: store1, completedSessions })
    await ctrl1.load()

    await ctrl1.updateConfig({ rupiahPerStar: 750 })
    await ctrl1.applyCorrection({
      correctionId: 'c-1',
      originalTransactionId: 'tx-1',
      starsDelta: -5,
      reason: 'Koreksi debit 5 bintang',
    })

    // Recreate store and controller
    const store2 = createDisposableRewardStore(dbName)
    const ctrl2 = createRewardController({ store: store2, completedSessions })
    await ctrl2.load()

    const state2 = ctrl2.getState()
    if (state2.status !== 'ready') throw new Error('Not ready')

    expect(state2.config.rupiahPerStar).toBe(750)
    expect(state2.transactions.length).toBe(1)
    expect(state2.corrections.length).toBe(1)
    // Earned 51 - 20 (pending tx) - 5 (correction) = 26
    expect(state2.balance.availableBalance).toBe(26)
  })
})