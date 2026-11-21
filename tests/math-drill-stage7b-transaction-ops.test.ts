import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REWARD_CONFIG,
  submitRedemptionRequest,
  confirmRedemptionTransaction,
  cancelRedemptionTransaction,
  validateRewardCorrection,
} from '../src/features/math-drill/reward'

function makeSessionV2(instanceId: string, points: 0 | 0.5 | 1 = 1) {
  return {
    historySchemaVersion: 2 as const,
    instanceId,
    sessionId: `session-${instanceId}`,
    mode: 'regular' as const,
    operationMode: 'addition' as const,
    endReason: 'completed' as const,
    plannedCount: 10,
    completedCount: 10,
    startedAt: 1000,
    durationMs: 300000,
    deadlineAt: 301000,
    endedAt: 2000,
    remainingMs: 299000,
    recordedAt: 2100,
    outcomes: Array.from({ length: 10 }, () => ({
      level: 1 as const,
      operation: 'addition' as const,
      points,
    })),
  }
}

describe('Stage 7B — Phase 2: Transaction Operations & Corrections', () => {
  it('1. submits a valid pending redemption when balance is sufficient', () => {
    const s1 = makeSessionV2('11111111-1111-4111-8111-111111111111', 1) // 3 collectible stars
    const res = submitRedemptionRequest({
      transactionId: 'tx-100',
      starsRedeemed: 2,
      requestedAt: 5000,
      config: DEFAULT_REWARD_CONFIG,
      completedSessions: [s1],
      existingTransactions: [],
    })

    expect(res.status).toBe('success')
    if (res.status === 'success') {
      expect(res.transaction.status).toBe('pending')
      expect(res.transaction.starsRedeemed).toBe(2)
      expect(res.transaction.rupiahValue).toBe(1000)
      expect(res.availableBalanceBefore).toBe(3)
      expect(res.availableBalanceAfter).toBe(1)
      expect(res.updatedTransactions).toHaveLength(1)
    }
  })

  it('2. rejects submission when balance is insufficient', () => {
    const s1 = makeSessionV2('11111111-1111-4111-8111-111111111111', 0.5) // 1 collectible star
    const res = submitRedemptionRequest({
      transactionId: 'tx-101',
      starsRedeemed: 3,
      requestedAt: 5000,
      config: DEFAULT_REWARD_CONFIG,
      completedSessions: [s1],
      existingTransactions: [],
    })

    expect(res.status).toBe('error')
    if (res.status === 'error') {
      expect(res.reason).toBe('insufficient-balance')
    }
  })

  it('3. rejects submission below minStars or above maxStars', () => {
    const s1 = makeSessionV2('11111111-1111-4111-8111-111111111111', 1) // 3 stars
    const strictConfig = { ...DEFAULT_REWARD_CONFIG, minStarsPerRedemption: 2, maxStarsPerRedemption: 2 }

    const resBelow = submitRedemptionRequest({
      transactionId: 'tx-102',
      starsRedeemed: 1,
      requestedAt: 5000,
      config: strictConfig,
      completedSessions: [s1],
      existingTransactions: [],
    })
    expect(resBelow.status).toBe('error')
    if (resBelow.status === 'error') expect(resBelow.reason).toBe('below-min-stars')

    const resAbove = submitRedemptionRequest({
      transactionId: 'tx-103',
      starsRedeemed: 3,
      requestedAt: 5000,
      config: strictConfig,
      completedSessions: [s1],
      existingTransactions: [],
    })
    expect(resAbove.status).toBe('error')
    if (resAbove.status === 'error') expect(resAbove.reason).toBe('above-max-stars')
  })

  it('4. rejects duplicate transactionId during submission', () => {
    const s1 = makeSessionV2('11111111-1111-4111-8111-111111111111', 1)
    const firstRes = submitRedemptionRequest({
      transactionId: 'tx-dup-id',
      starsRedeemed: 1,
      requestedAt: 5000,
      config: DEFAULT_REWARD_CONFIG,
      completedSessions: [s1],
      existingTransactions: [],
    })
    expect(firstRes.status).toBe('success')
    if (firstRes.status !== 'success') return

    const secondRes = submitRedemptionRequest({
      transactionId: 'tx-dup-id',
      starsRedeemed: 1,
      requestedAt: 5001,
      config: DEFAULT_REWARD_CONFIG,
      completedSessions: [s1],
      existingTransactions: firstRes.updatedTransactions,
    })
    expect(secondRes.status).toBe('error')
    if (secondRes.status === 'error') {
      expect(secondRes.reason).toBe('duplicate-transaction-id')
    }
  })

  it('5. confirms a pending transaction successfully', () => {
    const s1 = makeSessionV2('11111111-1111-4111-8111-111111111111', 1) // 3 stars
    const sub = submitRedemptionRequest({
      transactionId: 'tx-conf',
      starsRedeemed: 2,
      requestedAt: 5000,
      config: DEFAULT_REWARD_CONFIG,
      completedSessions: [s1],
      existingTransactions: [],
    })
    expect(sub.status).toBe('success')
    if (sub.status !== 'success') return

    const confRes = confirmRedemptionTransaction({
      transactionId: 'tx-conf',
      confirmedAt: 6000,
      completedSessions: [s1],
      existingTransactions: sub.updatedTransactions,
    })

    expect(confRes.status).toBe('success')
    if (confRes.status === 'success') {
      expect(confRes.transaction.status).toBe('confirmed')
      expect(confRes.transaction.confirmedAt).toBe(6000)
    }
  })

  it('6. cancels a pending transaction successfully', () => {
    const s1 = makeSessionV2('11111111-1111-4111-8111-111111111111', 1) // 3 stars
    const sub = submitRedemptionRequest({
      transactionId: 'tx-canc',
      starsRedeemed: 2,
      requestedAt: 5000,
      config: DEFAULT_REWARD_CONFIG,
      completedSessions: [s1],
      existingTransactions: [],
    })
    expect(sub.status).toBe('success')
    if (sub.status !== 'success') return

    const cancRes = cancelRedemptionTransaction({
      transactionId: 'tx-canc',
      cancelledAt: 5500,
      existingTransactions: sub.updatedTransactions,
    })

    expect(cancRes.status).toBe('success')
    if (cancRes.status === 'success') {
      expect(cancRes.transaction.status).toBe('cancelled')
      expect(cancRes.transaction.cancelledAt).toBe(5500)
    }
  })

  it('7. validates reward corrections correctly', () => {
    const valid = {
      correctionId: 'corr-1',
      originalTransactionId: 'tx-conf',
      starsDelta: -1,
      createdAt: 7000,
      reason: 'Adjustment due to gift error',
    }
    const valRes = validateRewardCorrection(valid)
    expect(valRes.status).toBe('valid')

    // Invalid: zero delta
    const invalidZero = { ...valid, starsDelta: 0 }
    expect(validateRewardCorrection(invalidZero).status).toBe('invalid')

    // Invalid: missing reason
    const invalidReason = { ...valid, reason: '   ' }
    expect(validateRewardCorrection(invalidReason).status).toBe('invalid')
  })

  it('8. allows redemption using balance increased by reward correction', () => {
    const s1 = makeSessionV2('11111111-1111-4111-8111-111111111111', 1) // 3 stars
    const confirmedTx = {
      transactionId: 'tx-orig',
      status: 'confirmed' as const,
      requestedAt: 2000,
      confirmedAt: 3000,
      cancelledAt: null,
      starsRedeemed: 3,
      rupiahValue: 1500,
      ruleSnapshotVersion: 1,
      ruleSnapshot: { rupiahPerStar: 500 },
    }
    const correction = {
      correctionId: 'corr-100',
      originalTransactionId: 'tx-orig',
      starsDelta: 12,
      createdAt: 4000,
      reason: 'Manual correction bonus',
    }

    // Submitting without correction fails because net available balance is 0
    const failRes = submitRedemptionRequest({
      transactionId: 'tx-sub-fail',
      starsRedeemed: 12,
      requestedAt: 5000,
      config: DEFAULT_REWARD_CONFIG,
      completedSessions: [s1],
      existingTransactions: [confirmedTx],
      existingCorrections: [],
    })
    expect(failRes.status).toBe('error')
    if (failRes.status === 'error') {
      expect(failRes.reason).toBe('insufficient-balance')
    }

    // Submitting with correction succeeds for 12 stars
    const succRes = submitRedemptionRequest({
      transactionId: 'tx-sub-succ',
      starsRedeemed: 12,
      requestedAt: 5000,
      config: DEFAULT_REWARD_CONFIG,
      completedSessions: [s1],
      existingTransactions: [confirmedTx],
      existingCorrections: [correction],
    })
    expect(succRes.status).toBe('success')
    if (succRes.status === 'success') {
      expect(succRes.availableBalanceBefore).toBe(12)
      expect(succRes.availableBalanceAfter).toBe(0)
      expect(succRes.transaction.starsRedeemed).toBe(12)
    }
  })
})
