import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REWARD_CONFIG,
  validateRewardConfig,
  validateRewardTransaction,
  computeAvailableBalance,
  type RewardConfig,
  type RewardTransaction,
} from '../src/features/math-drill/reward'

// ---------------------------------------------------------------------------
// Helpers & Fixtures
// ---------------------------------------------------------------------------

function makeSessionV2(params: {
  instanceId: string
  mode?: 'regular' | 'challenge'
  completedCount?: number
  plannedCount?: number
  points?: 0 | 0.5 | 1
  endReason?: 'completed' | 'timeout'
  durationMs?: number | null
}) {
  const mode = params.mode ?? 'regular'
  const plannedCount = params.plannedCount ?? 10
  const completedCount = params.completedCount ?? plannedCount
  const points = params.points ?? 1
  const endReason = params.endReason ?? 'completed'
  const durationMs = params.durationMs !== undefined ? params.durationMs : 300000
  const startedAt = 1000
  const deadlineAt = durationMs === null ? null : startedAt + durationMs
  const endedAt = durationMs === null ? 50000 : startedAt + 200000
  const remainingMs = durationMs === null ? null : (deadlineAt! - endedAt)

  return {
    historySchemaVersion: 2 as const,
    instanceId: params.instanceId,
    sessionId: `session-${params.instanceId}`,
    mode,
    operationMode: (mode === 'challenge' ? 'mixed' : 'addition') as 'mixed' | 'addition',
    endReason,
    plannedCount,
    completedCount,
    startedAt,
    durationMs,
    deadlineAt,
    endedAt,
    remainingMs,
    recordedAt: endedAt + 100,
    outcomes: Array.from({ length: completedCount }, () => ({
      level: 1 as const,
      operation: 'addition' as const,
      points,
    })),
  }
}

function makePendingTx(params: {
  transactionId: string
  starsRedeemed: number
  rupiahPerStar?: number
  requestedAt?: number
}): RewardTransaction {
  const rupiahPerStar = params.rupiahPerStar ?? 500
  const requestedAt = params.requestedAt ?? 1000
  return {
    transactionId: params.transactionId,
    status: 'pending',
    requestedAt,
    starsRedeemed: params.starsRedeemed,
    rupiahValue: params.starsRedeemed * rupiahPerStar,
    ruleSnapshotVersion: 1,
    ruleSnapshot: { rupiahPerStar },
    confirmedAt: null,
    cancelledAt: null,
  }
}

function makeConfirmedTx(params: {
  transactionId: string
  starsRedeemed: number
  rupiahPerStar?: number
  requestedAt?: number
  confirmedAt?: number
}): RewardTransaction {
  const rupiahPerStar = params.rupiahPerStar ?? 500
  const requestedAt = params.requestedAt ?? 1000
  const confirmedAt = params.confirmedAt ?? requestedAt + 500
  return {
    transactionId: params.transactionId,
    status: 'confirmed',
    requestedAt,
    starsRedeemed: params.starsRedeemed,
    rupiahValue: params.starsRedeemed * rupiahPerStar,
    ruleSnapshotVersion: 1,
    ruleSnapshot: { rupiahPerStar },
    confirmedAt,
    cancelledAt: null,
  }
}

function makeCancelledTx(params: {
  transactionId: string
  starsRedeemed: number
  rupiahPerStar?: number
  requestedAt?: number
  cancelledAt?: number
}): RewardTransaction {
  const rupiahPerStar = params.rupiahPerStar ?? 500
  const requestedAt = params.requestedAt ?? 1000
  const cancelledAt = params.cancelledAt ?? requestedAt + 200
  return {
    transactionId: params.transactionId,
    status: 'cancelled',
    requestedAt,
    starsRedeemed: params.starsRedeemed,
    rupiahValue: params.starsRedeemed * rupiahPerStar,
    ruleSnapshotVersion: 1,
    ruleSnapshot: { rupiahPerStar },
    confirmedAt: null,
    cancelledAt,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Stage 7B — RewardConfig and Transaction Validators', () => {
  // Test 1: Default configuration uses Rp500 per star
  it('1. Default configuration uses Rp500 per star', () => {
    expect(DEFAULT_REWARD_CONFIG.rupiahPerStar).toBe(500)
    expect(DEFAULT_REWARD_CONFIG.configId).toBe('active')
    expect(DEFAULT_REWARD_CONFIG.minStarsPerRedemption).toBe(1)
    expect(DEFAULT_REWARD_CONFIG.version).toBe(1)
    const result = validateRewardConfig(DEFAULT_REWARD_CONFIG)
    expect(result.status).toBe('valid')
  })

  // Test 2: Valid configuration is accepted
  it('2. Valid configuration is accepted', () => {
    const validConfig: RewardConfig = {
      configId: 'active',
      version: 2,
      updatedAt: 1700000000000,
      rupiahPerStar: 1000,
      minStarsPerRedemption: 2,
      maxStarsPerRedemption: 50,
    }
    const result = validateRewardConfig(validConfig)
    expect(result.status).toBe('valid')
    if (result.status === 'valid') {
      expect(result.value.rupiahPerStar).toBe(1000)
      expect(result.value.version).toBe(2)
    }
  })

  // Test 3: Exchange rate zero, negative, non-integer, NaN, or Infinity is rejected
  it('3. Exchange rate zero, negative, non-integer, NaN, or Infinity is rejected', () => {
    const base = { ...DEFAULT_REWARD_CONFIG }

    expect(validateRewardConfig({ ...base, rupiahPerStar: 0 }).status).toBe('invalid')
    expect(validateRewardConfig({ ...base, rupiahPerStar: -500 }).status).toBe('invalid')
    expect(validateRewardConfig({ ...base, rupiahPerStar: 500.5 }).status).toBe('invalid')
    expect(validateRewardConfig({ ...base, rupiahPerStar: NaN }).status).toBe('invalid')
    expect(validateRewardConfig({ ...base, rupiahPerStar: Infinity }).status).toBe('invalid')

    // Also verify minStars and maxStars
    expect(validateRewardConfig({ ...base, minStarsPerRedemption: 0 }).status).toBe('invalid')
    expect(validateRewardConfig({ ...base, maxStarsPerRedemption: 0 }).status).toBe('invalid')
    expect(validateRewardConfig({ ...base, minStarsPerRedemption: 10, maxStarsPerRedemption: 5 }).status).toBe('invalid')
  })

  // Test 4: Stars redeemed zero, negative, or non-integer is rejected
  it('4. Stars redeemed zero, negative, or non-integer is rejected in transactions', () => {
    const base = makePendingTx({ transactionId: 'tx-1', starsRedeemed: 2 })

    expect(validateRewardTransaction({ ...base, starsRedeemed: 0 }).status).toBe('invalid')
    expect(validateRewardTransaction({ ...base, starsRedeemed: -1 }).status).toBe('invalid')
    expect(validateRewardTransaction({ ...base, starsRedeemed: 2.5 }).status).toBe('invalid')
    expect(validateRewardTransaction({ ...base, starsRedeemed: NaN }).status).toBe('invalid')
  })

  // Test 5: Inconsistent rupiahValue and snapshot is rejected
  it('5. Inconsistent rupiahValue and snapshot is rejected', () => {
    const base = makePendingTx({ transactionId: 'tx-1', starsRedeemed: 3, rupiahPerStar: 500 })
    // Expected rupiahValue is 3 * 500 = 1500; pass inconsistent 1000
    const inconsistent = { ...base, rupiahValue: 1000 }
    const result = validateRewardTransaction(inconsistent)
    expect(result.status).toBe('invalid')
    if (result.status === 'invalid') {
      expect(result.issues).toContain('RUPIAH_VALUE_INCONSISTENT_WITH_SNAPSHOT')
    }

    // Invalid snapshot
    const badSnapshot = { ...base, ruleSnapshot: { rupiahPerStar: -100 } }
    expect(validateRewardTransaction(badSnapshot).status).toBe('invalid')
  })

  // Test 6: Inconsistent status and timestamps are rejected
  it('6. Inconsistent status and timestamps are rejected', () => {
    // pending must have null confirmedAt and null cancelledAt
    const pendingWithConfirm = {
      ...makePendingTx({ transactionId: 'tx-1', starsRedeemed: 1 }),
      confirmedAt: 1500,
    }
    expect(validateRewardTransaction(pendingWithConfirm).status).toBe('invalid')

    // confirmed must have confirmedAt >= requestedAt and null cancelledAt
    const confirmedBeforeRequest = {
      ...makeConfirmedTx({ transactionId: 'tx-2', starsRedeemed: 1, requestedAt: 2000, confirmedAt: 1000 }),
    }
    expect(validateRewardTransaction(confirmedBeforeRequest).status).toBe('invalid')

    const confirmedWithCancel = {
      ...makeConfirmedTx({ transactionId: 'tx-2', starsRedeemed: 1 }),
      cancelledAt: 3000,
    }
    expect(validateRewardTransaction(confirmedWithCancel).status).toBe('invalid')

    // cancelled must have cancelledAt >= requestedAt and null confirmedAt
    const cancelledBeforeRequest = {
      ...makeCancelledTx({ transactionId: 'tx-3', starsRedeemed: 1, requestedAt: 2000, cancelledAt: 1000 }),
    }
    expect(validateRewardTransaction(cancelledBeforeRequest).status).toBe('invalid')
  })
})

describe('Stage 7B — computeAvailableBalance', () => {
  // Test 7: No completed sessions yields zero stars and zero balance
  it('7. No completed sessions yields zero stars and zero balance', () => {
    const result = computeAvailableBalance([], [])
    expect(result.totalCollectibleStarsEarned).toBe(0)
    expect(result.totalConfirmedRedeemedStars).toBe(0)
    expect(result.totalPendingStars).toBe(0)
    expect(result.availableBalance).toBe(0)
    expect(result.rawAvailableBalance).toBe(0)
    expect(result.isLedgerConsistent).toBe(true)
    expect(result.ledgerIssues).toHaveLength(0)
  })

  // Test 8: Sessions yielding stars calculate total earned per Stage 7A
  it('8. Sessions yielding stars calculate total earned per Stage 7A', () => {
    // 10/10 perfect session -> 3 collectible stars
    const s1 = makeSessionV2({ instanceId: '11111111-1111-4111-8111-111111111111', points: 1 })
    // 7/10 with 70% accuracy -> 2 collectible stars
    const s2 = makeSessionV2({
      instanceId: '22222222-2222-4222-8222-222222222222',
      completedCount: 10,
      points: 0.5, // 5 / 10 = 50% < 70% -> 1 collectible star
    })

    const result = computeAvailableBalance([s1, s2], [])
    // s1 gives 3, s2 gives 1 -> total earned = 4
    expect(result.totalCollectibleStarsEarned).toBe(4)
    expect(result.availableBalance).toBe(4)
    expect(result.rawAvailableBalance).toBe(4)
    expect(result.isLedgerConsistent).toBe(true)
  })

  // Test 9: Pending transaction reduces available balance
  it('9. Pending transaction reduces available balance', () => {
    const s1 = makeSessionV2({ instanceId: '11111111-1111-4111-8111-111111111111', points: 1 }) // 3 stars
    const pendingTx = makePendingTx({ transactionId: 'tx-p1', starsRedeemed: 2 })

    const result = computeAvailableBalance([s1], [pendingTx])
    expect(result.totalCollectibleStarsEarned).toBe(3)
    expect(result.totalPendingStars).toBe(2)
    expect(result.totalConfirmedRedeemedStars).toBe(0)
    expect(result.availableBalance).toBe(1)
    expect(result.rawAvailableBalance).toBe(1)
    expect(result.isLedgerConsistent).toBe(true)
  })

  // Test 10: Confirmed transaction reduces available balance permanently
  it('10. Confirmed transaction reduces available balance permanently', () => {
    const s1 = makeSessionV2({ instanceId: '11111111-1111-4111-8111-111111111111', points: 1 }) // 3 stars
    const confirmedTx = makeConfirmedTx({ transactionId: 'tx-c1', starsRedeemed: 3 })

    const result = computeAvailableBalance([s1], [confirmedTx])
    expect(result.totalCollectibleStarsEarned).toBe(3)
    expect(result.totalConfirmedRedeemedStars).toBe(3)
    expect(result.totalPendingStars).toBe(0)
    expect(result.availableBalance).toBe(0)
    expect(result.rawAvailableBalance).toBe(0)
    expect(result.isLedgerConsistent).toBe(true)
  })

  // Test 11: Cancelled transaction does NOT reduce available balance
  it('11. Cancelled transaction does NOT reduce available balance', () => {
    const s1 = makeSessionV2({ instanceId: '11111111-1111-4111-8111-111111111111', points: 1 }) // 3 stars
    const cancelledTx = makeCancelledTx({ transactionId: 'tx-x1', starsRedeemed: 3 })

    const result = computeAvailableBalance([s1], [cancelledTx])
    expect(result.totalCollectibleStarsEarned).toBe(3)
    expect(result.totalConfirmedRedeemedStars).toBe(0)
    expect(result.totalPendingStars).toBe(0)
    expect(result.transactionsSummary.totalCancelledStars).toBe(3)
    expect(result.transactionsSummary.cancelledTransactionsCount).toBe(1)
    expect(result.availableBalance).toBe(3)
    expect(result.rawAvailableBalance).toBe(3)
  })

  // Test 12: Combination of pending, confirmed, and cancelled produces correct balance
  it('12. Combination of pending, confirmed, and cancelled produces correct balance', () => {
    // 3 sessions with 3 stars each = 9 collectible stars earned
    const s1 = makeSessionV2({ instanceId: '11111111-1111-4111-8111-111111111111', points: 1 })
    const s2 = makeSessionV2({ instanceId: '22222222-2222-4222-8222-222222222222', points: 1 })
    const s3 = makeSessionV2({ instanceId: '33333333-3333-4333-8333-333333333333', points: 1 })

    // Confirmed 4 stars, Pending 2 stars, Cancelled 3 stars
    const txConfirmed = makeConfirmedTx({ transactionId: 'tx-1', starsRedeemed: 4 })
    const txPending = makePendingTx({ transactionId: 'tx-2', starsRedeemed: 2 })
    const txCancelled = makeCancelledTx({ transactionId: 'tx-3', starsRedeemed: 3 })

    const result = computeAvailableBalance([s1, s2, s3], [txConfirmed, txPending, txCancelled])
    expect(result.totalCollectibleStarsEarned).toBe(9)
    expect(result.totalConfirmedRedeemedStars).toBe(4)
    expect(result.totalPendingStars).toBe(2)
    // 9 - 4 - 2 = 3
    expect(result.availableBalance).toBe(3)
    expect(result.rawAvailableBalance).toBe(3)
    expect(result.isLedgerConsistent).toBe(true)
  })

  // Test 13: Challenge mode has 1.5x multiplier applied + speed bonus
  it('13. Challenge mode applies 1.5x multiplier to reward', () => {
    const regSession = makeSessionV2({
      instanceId: '11111111-1111-4111-8111-111111111111',
      mode: 'regular',
      points: 1,
    }) // Regular: 3 stars (no multiplier, no speed bonus)
    const chalSession = makeSessionV2({
      instanceId: '22222222-2222-4222-8222-222222222222',
      mode: 'challenge',
      points: 1,
    }) // Challenge: 3 * 1.5 = 4.5 with multiplier, but also has speed bonus
       // Speed bonus applies: 100% coverage, 100% accuracy, 33% time remaining > 20%
       // Final: floor((3 collectible + 1 speed) * 1.5) = floor(6) = 6 stars

    const result = computeAvailableBalance([regSession, chalSession], [])
    expect(result.totalCollectibleStarsEarned).toBe(9) // 3 (regular) + 6 (challenge with speed + multiplier)
    expect(result.availableBalance).toBe(9)
  })

  // Test 14: History V1 and V2 records are both respected per Stage 7A support
  it('14. History V1 and V2 records are both respected per Stage 7A support', () => {
    const v1Record = {
      historySchemaVersion: 1 as const,
      instanceId: '11111111-1111-4111-8111-111111111111',
      sessionId: 'reg-v1',
      mode: 'regular' as const,
      operationMode: 'addition' as const,
      completedAt: 1000,
      recordedAt: 2000,
      provenance: 'new-atomic' as const,
      outcomes: Array.from({ length: 10 }, () => ({
        level: 1 as const,
        operation: 'addition' as const,
        points: 1 as const,
      })),
    } // 3 stars

    const v2Record = makeSessionV2({
      instanceId: '22222222-2222-4222-8222-222222222222',
      points: 1,
    }) // 3 stars

    const result = computeAvailableBalance([v1Record, v2Record], [])
    expect(result.totalCollectibleStarsEarned).toBe(6)
    expect(result.availableBalance).toBe(6)
  })

  // Test 15: Conflict/invalid records from aggregation are not silently masked
  it('15. Conflict/invalid records from aggregation are not silently masked', () => {
    const s1 = makeSessionV2({ instanceId: '11111111-1111-4111-8111-111111111111', points: 1 })
    // Conflicting session with same instanceId but different points
    const s1Conflict = {
      ...s1,
      outcomes: Array.from({ length: 10 }, () => ({
        level: 1 as const,
        operation: 'addition' as const,
        points: 0 as const,
      })),
    }
    const invalidSession = { corrupt: 'data' }

    const result = computeAvailableBalance([s1, s1Conflict, invalidSession], [])
    // s1 was disqualified due to conflict, invalidSession was skipped
    expect(result.sessionSummary.conflicts).toHaveLength(1)
    expect(result.sessionSummary.invalidRecordsCount).toBe(1)
    expect(result.isLedgerConsistent).toBe(false)
    expect(result.ledgerIssues).toContain('SESSION_CONFLICT_DETECTED')
    expect(result.ledgerIssues).toContain('INVALID_SESSIONS_IN_HISTORY')
  })

  // Test 16: Ledger with negative balance is reported as inconsistent
  it('16. Ledger with negative balance is reported as inconsistent', () => {
    // 3 stars earned
    const s1 = makeSessionV2({ instanceId: '11111111-1111-4111-8111-111111111111', points: 1 })
    // Overspend: confirmed 5 stars
    const overspendTx = makeConfirmedTx({ transactionId: 'tx-over', starsRedeemed: 5 })

    const result = computeAvailableBalance([s1], [overspendTx])
    expect(result.totalCollectibleStarsEarned).toBe(3)
    expect(result.totalConfirmedRedeemedStars).toBe(5)
    expect(result.rawAvailableBalance).toBe(-2)
    // Clamped for UI safety
    expect(result.availableBalance).toBe(0)
    expect(result.isLedgerConsistent).toBe(false)
    expect(result.ledgerIssues).toContain('NEGATIVE_BALANCE_DETECTED')
  })

  // Test 17: Function does not mutate inputs
  it('17. Function does not mutate inputs', () => {
    const s1 = makeSessionV2({ instanceId: '11111111-1111-4111-8111-111111111111', points: 1 })
    const tx = makePendingTx({ transactionId: 'tx-1', starsRedeemed: 1 })

    const sessions = Object.freeze([Object.freeze(s1)])
    const transactions = Object.freeze([Object.freeze(tx)])

    expect(() => computeAvailableBalance(sessions, transactions)).not.toThrow()
  })

  // Test 18: Repeated calls with identical inputs produce identical outputs (pure & deterministic)
  it('18. Repeated calls with identical inputs produce identical outputs', () => {
    const s1 = makeSessionV2({ instanceId: '11111111-1111-4111-8111-111111111111', points: 1 })
    const tx1 = makeConfirmedTx({ transactionId: 'tx-1', starsRedeemed: 2 })
    const tx2 = makePendingTx({ transactionId: 'tx-2', starsRedeemed: 1 })

    const res1 = computeAvailableBalance([s1], [tx1, tx2])
    const res2 = computeAvailableBalance([s1], [tx1, tx2])

    expect(res1).toEqual(res2)
  })

  // Test 19: Duplicate transactions with identical content are handled idempotently
  it('19. Duplicate transactions with identical content are handled idempotently', () => {
    const s1 = makeSessionV2({ instanceId: '11111111-1111-4111-8111-111111111111', points: 1 }) // 3 stars
    const tx = makeConfirmedTx({ transactionId: 'tx-dup', starsRedeemed: 1 })

    // Same transaction passed twice
    const result = computeAvailableBalance([s1], [tx, tx])
    expect(result.totalConfirmedRedeemedStars).toBe(1) // Not 2!
    expect(result.transactionsSummary.duplicateTransactionsCount).toBe(1)
    expect(result.availableBalance).toBe(2)
  })

  // Test 20: Conflicting transactions with same ID but different content are disqualified
  it('20. Conflicting transactions with same ID but different content are disqualified', () => {
    const s1 = makeSessionV2({ instanceId: '11111111-1111-4111-8111-111111111111', points: 1 }) // 3 stars
    const txA = makeConfirmedTx({ transactionId: 'tx-conflict', starsRedeemed: 1 })
    const txB = makeConfirmedTx({ transactionId: 'tx-conflict', starsRedeemed: 2 }) // conflicting stars!

    const result = computeAvailableBalance([s1], [txA, txB])
    // Neither txA nor txB is counted!
    expect(result.totalConfirmedRedeemedStars).toBe(0)
    expect(result.transactionsSummary.transactionConflicts).toHaveLength(1)
    expect(result.transactionsSummary.transactionConflicts[0].transactionId).toBe('tx-conflict')
    expect(result.isLedgerConsistent).toBe(false)
    expect(result.ledgerIssues).toContain('TRANSACTION_CONFLICT_DETECTED')
  })
})
