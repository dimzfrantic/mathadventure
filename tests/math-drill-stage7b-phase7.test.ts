import { describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { createDisposableRewardStore } from '../src/features/math-drill/reward/redemption/rewardPersistence'
import { UNIFIED_DISPOSABLE_DATABASE_PREFIX } from '../src/features/math-drill/persistence/indexedDbSessionStore'
import { createDisposableRewardController, type RewardControllerStore } from '../src/features/math-drill/reward/redemption/rewardController'

function uniqueName(label: string): string {
  return `${UNIFIED_DISPOSABLE_DATABASE_PREFIX}phase7-${Date.now()}-${Math.floor(Math.random() * 1e9)}-${label}`
}

// Helper to create sessions with target stars (mirrors phase7a helper)
function sessionsWithStars(targetStars: number) {
  const sessions = []
  let remaining = targetStars
  while (remaining > 0) {
    const chunk = Math.min(3, remaining)
    remaining -= chunk
    const instanceId = crypto.randomUUID()
    sessions.push({
      historySchemaVersion: 2,
      instanceId,
      sessionId: 'session-' + instanceId,
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

describe('Stage 7B Phase 7 — Config Update & Corrections', () => {
  it('updates reward configuration successfully via controller', async () => {
    const store = createDisposableRewardStore(uniqueName('config'))
    await store.listTransactions()

    const controller = createDisposableRewardController({
      stores: {
        reward: store as RewardControllerStore,
        completedSessions: async () => [],
      },
    })

    await controller.load()
    const res = await controller.updateConfig({ rupiahPerStar: 1000, minStarsPerRedemption: 5 })
    expect(res.status).toBe('success')
    if (res.status === 'success') {
      expect(res.config.rupiahPerStar).toBe(1000)
      expect(res.config.minStarsPerRedemption).toBe(5)
    }

    const currentState = controller.getState()
    if (currentState.status === 'ready') {
      expect(currentState.config.rupiahPerStar).toBe(1000)
    }

    store.close()
  })

  it('applies balance correction successfully via controller', async () => {
    const store = createDisposableRewardStore(uniqueName('corr'))
    await store.listTransactions()

    // Seed a confirmed transaction for the correction to reference
    await store.putTransaction({
      transactionId: 'tx-none',
      status: 'confirmed',
      requestedAt: 1000,
      starsRedeemed: 5,
      rupiahValue: 5000,
      ruleSnapshotVersion: 1,
      ruleSnapshot: { rupiahPerStar: 1000 },
      confirmedAt: 1500,
      cancelledAt: null,
    })

    // Need sessions with stars for earned balance (otherwise balance = 0 - 5 < 0 fails)
    const mockSessions = async () => sessionsWithStars(10)

    const controller = createDisposableRewardController({
      stores: {
        reward: store as RewardControllerStore,
        completedSessions: mockSessions,
      },
    })

    await controller.load()
    const res = await controller.applyCorrection({
      correctionId: 'corr-1',
      originalTransactionId: 'tx-none',
      starsDelta: 5,
      reason: 'Bonus keaktifan',
    })

    expect(res.status).toBe('success')
    if (res.status === 'success') {
      expect(res.correction.starsDelta).toBe(5)
      expect(res.correction.reason).toBe('Bonus keaktifan')
    }

    store.close()
  })
})
