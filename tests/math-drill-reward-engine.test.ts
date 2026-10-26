import { describe, expect, it } from 'vitest'
import { calculateSessionRewardV1 } from '../src/features/math-drill/reward/rewardRulesV1'
import { aggregateRewardCollectionV1, evaluateCompletedSessionRewardV1 } from '../src/features/math-drill/reward/rewardEngine'

describe('calculateSessionRewardV1', () => {
  it('gives 0 sessionStars and 0 collectibleStars when completedQuestions = 0 (Case A)', () => {
    const result = calculateSessionRewardV1({
      plannedCount: 10,
      completedCount: 0,
      totalPoints: 0,
    })

    expect(result).toEqual({
      sessionStars: 0,
      collectibleStars: 0,
      ruleTier: 'none',
      coverageRatio: { numerator: 0, denominator: 10 },
      accuracyRatio: { numerator: 0, denominator: 0 },
    })
  })

  it('1/10 sempurna gives 1 sessionStar and 0 collectibleStars (Case B, coverage < 70%)', () => {
    const result = calculateSessionRewardV1({
      plannedCount: 10,
      completedCount: 1,
      totalPoints: 1,
    })

    expect(result).toEqual({
      sessionStars: 1,
      collectibleStars: 0,
      ruleTier: 'partial-low-coverage',
      coverageRatio: { numerator: 1, denominator: 10 },
      accuracyRatio: { numerator: 1, denominator: 1 },
    })
  })

  it('6/10 sempurna gives 1 sessionStar and 0 collectibleStars (Case B, 60% < 70%)', () => {
    const result = calculateSessionRewardV1({
      plannedCount: 10,
      completedCount: 6,
      totalPoints: 6,
    })

    expect(result).toEqual({
      sessionStars: 1,
      collectibleStars: 0,
      ruleTier: 'partial-low-coverage',
      coverageRatio: { numerator: 6, denominator: 10 },
      accuracyRatio: { numerator: 6, denominator: 6 },
    })
  })

  it('7/10 dengan akurasi 60% (points=4.2 or 4) gives 1 collectibleStar (Case C, coverage >= 70%, accuracy < 70%)', () => {
    // 4.2 / 7 = 60%
    const result = calculateSessionRewardV1({
      plannedCount: 10,
      completedCount: 7,
      totalPoints: 4.2,
    })

    expect(result.sessionStars).toBe(1)
    expect(result.collectibleStars).toBe(1)
    expect(result.ruleTier).toBe('passing-low-accuracy')
  })

  it('7/10 dengan akurasi 70% (points=4.9) gives 2 collectibleStars (Case D, coverage >= 70%, accuracy >= 70%)', () => {
    // 4.9 / 7 = 70%
    const result = calculateSessionRewardV1({
      plannedCount: 10,
      completedCount: 7,
      totalPoints: 4.9,
    })

    expect(result.sessionStars).toBe(2)
    expect(result.collectibleStars).toBe(2)
    expect(result.ruleTier).toBe('passing-good-accuracy')
  })

  it('10/10 dengan akurasi 89% (points=8.9) gives 2 collectibleStars (Case D, coverage=100%, accuracy 89% < 90%)', () => {
    const result = calculateSessionRewardV1({
      plannedCount: 10,
      completedCount: 10,
      totalPoints: 8.9,
    })

    expect(result.sessionStars).toBe(2)
    expect(result.collectibleStars).toBe(2)
    expect(result.ruleTier).toBe('passing-good-accuracy')
  })

  it('10/10 dengan akurasi 90% (points=9.0) gives 3 collectibleStars (Case E, coverage=100%, accuracy >= 90%)', () => {
    const result = calculateSessionRewardV1({
      plannedCount: 10,
      completedCount: 10,
      totalPoints: 9,
    })

    expect(result.sessionStars).toBe(3)
    expect(result.collectibleStars).toBe(3)
    expect(result.ruleTier).toBe('perfect-high-accuracy')
  })

  it('10/10 sempurna (points=10) gives 3 collectibleStars (Case E, coverage=100%, accuracy 100%)', () => {
    const result = calculateSessionRewardV1({
      plannedCount: 10,
      completedCount: 10,
      totalPoints: 10,
    })

    expect(result.sessionStars).toBe(3)
    expect(result.collectibleStars).toBe(3)
    expect(result.ruleTier).toBe('perfect-high-accuracy')
  })

  it('rejects invalid inputs with appropriate TypeErrors', () => {
    expect(() => calculateSessionRewardV1({ plannedCount: 0, completedCount: 0, totalPoints: 0 })).toThrow('PLANNED_COUNT_INVALID')
    expect(() => calculateSessionRewardV1({ plannedCount: 10, completedCount: -1, totalPoints: 0 })).toThrow('COMPLETED_COUNT_INVALID')
    expect(() => calculateSessionRewardV1({ plannedCount: 10, completedCount: 11, totalPoints: 0 })).toThrow('COMPLETED_COUNT_INVALID')
    expect(() => calculateSessionRewardV1({ plannedCount: 10, completedCount: 5, totalPoints: -0.5 })).toThrow('TOTAL_POINTS_INVALID')
    expect(() => calculateSessionRewardV1({ plannedCount: 10, completedCount: 5, totalPoints: 5.5 })).toThrow('TOTAL_POINTS_INVALID')
    expect(() => calculateSessionRewardV1({ plannedCount: 10, completedCount: 5, totalPoints: NaN })).toThrow('TOTAL_POINTS_INVALID')
  })
})

describe('evaluateCompletedSessionRewardV1', () => {
  it('correctly evaluates a legacy V1 completed session without timer metadata', () => {
    const v1Record = {
      historySchemaVersion: 1,
      instanceId: '11111111-1111-4111-8111-111111111111',
      sessionId: 'regular-s1',
      mode: 'regular',
      operationMode: 'addition',
      completedAt: 1000,
      recordedAt: 2000,
      provenance: 'new-atomic',
      outcomes: [
        { level: 1, operation: 'addition', points: 1 },
        { level: 1, operation: 'addition', points: 1 },
        { level: 1, operation: 'addition', points: 1 },
        { level: 1, operation: 'addition', points: 1 },
        { level: 1, operation: 'addition', points: 1 },
        { level: 1, operation: 'addition', points: 1 },
        { level: 1, operation: 'addition', points: 1 },
        { level: 1, operation: 'addition', points: 1 },
        { level: 1, operation: 'addition', points: 1 },
        { level: 1, operation: 'addition', points: 1 },
      ],
    }

    const evaluation = evaluateCompletedSessionRewardV1(v1Record)
    expect(evaluation.status).toBe('valid')
    if (evaluation.status === 'valid') {
      expect(evaluation.instanceId).toBe('11111111-1111-4111-8111-111111111111')
      expect(evaluation.reward.sessionStars).toBe(3)
      expect(evaluation.reward.collectibleStars).toBe(3)
      expect(evaluation.reward.ruleTier).toBe('perfect-high-accuracy')
    }
  })

  it('correctly evaluates a V2 timeout session with partial completion', () => {
    const v2Timeout = {
      historySchemaVersion: 2,
      instanceId: '22222222-2222-4222-8222-222222222222',
      sessionId: 'challenge-s2',
      mode: 'challenge',
      operationMode: 'mixed',
      endReason: 'timeout',
      plannedCount: 10,
      completedCount: 7,
      startedAt: 1000,
      durationMs: 300000,
      deadlineAt: 301000,
      endedAt: 301050,
      remainingMs: 0,
      recordedAt: 302000,
      outcomes: [
        { level: 1, operation: 'addition', points: 1 },
        { level: 1, operation: 'subtraction', points: 1 },
        { level: 1, operation: 'addition', points: 1 },
        { level: 1, operation: 'subtraction', points: 1 },
        { level: 1, operation: 'addition', points: 1 },
        { level: 1, operation: 'subtraction', points: 0.5 },
        { level: 1, operation: 'addition', points: 0.5 },
      ], // total points = 6.0 out of 7 completed = 85.7% accuracy, coverage = 7/10 = 70% -> Case D
    }

    const evaluation = evaluateCompletedSessionRewardV1(v2Timeout)
    expect(evaluation.status).toBe('valid')
    if (evaluation.status === 'valid') {
      expect(evaluation.instanceId).toBe('22222222-2222-4222-8222-222222222222')
      expect(evaluation.reward.sessionStars).toBe(2)
      expect(evaluation.reward.collectibleStars).toBe(2)
      expect(evaluation.reward.ruleTier).toBe('passing-good-accuracy')
    }
  })

  it('evaluates a V2 timeout with 0 completed questions to 0 stars (Case A)', () => {
    const v2EmptyTimeout = {
      historySchemaVersion: 2,
      instanceId: '33333333-3333-4333-8333-333333333333',
      sessionId: 'regular-s3',
      mode: 'regular',
      operationMode: 'addition',
      endReason: 'timeout',
      plannedCount: 10,
      completedCount: 0,
      startedAt: 1000,
      durationMs: 300000,
      deadlineAt: 301000,
      endedAt: 301050,
      remainingMs: 0,
      recordedAt: 302000,
      outcomes: [],
    }

    const evaluation = evaluateCompletedSessionRewardV1(v2EmptyTimeout)
    expect(evaluation.status).toBe('valid')
    if (evaluation.status === 'valid') {
      expect(evaluation.reward.sessionStars).toBe(0)
      expect(evaluation.reward.collectibleStars).toBe(0)
      expect(evaluation.reward.ruleTier).toBe('none')
    }
  })

  it('rejects invalid or corrupt records safely without throwing', () => {
    const corruptRecord = { historySchemaVersion: 2, instanceId: 'invalid-id' }
    const evaluation = evaluateCompletedSessionRewardV1(corruptRecord)
    expect(evaluation.status).toBe('invalid')

    const unsupportedRecord = { historySchemaVersion: 99, instanceId: '44444444-4444-4444-8444-444444444444' }
    const unsupportedEval = evaluateCompletedSessionRewardV1(unsupportedRecord)
    expect(unsupportedEval.status).toBe('unsupported-version')
  })
})

describe('aggregateRewardCollectionV1', () => {
  const baseSession1 = {
    historySchemaVersion: 2,
    instanceId: '55555555-5555-4555-8555-555555555555',
    sessionId: 'chal-1',
    mode: 'challenge',
    operationMode: 'addition',
    endReason: 'completed',
    plannedCount: 10,
    completedCount: 10,
    startedAt: 1000,
    durationMs: 300000,
    deadlineAt: 301000,
    endedAt: 250000,
    remainingMs: 51000,
    recordedAt: 250100,
    outcomes: Array.from({ length: 10 }, () => ({ level: 1, operation: 'addition', points: 1 })),
  } // Challenge 100% -> Rule E (3) * 1.5 = 4.5 floor = 4 collectibleStars

  const baseSession2 = {
    historySchemaVersion: 2,
    instanceId: '66666666-6666-4666-8666-666666666666',
    sessionId: 'reg-2',
    mode: 'regular',
    operationMode: 'addition',
    endReason: 'timeout',
    plannedCount: 10,
    completedCount: 6,
    startedAt: 1000,
    durationMs: 300000,
    deadlineAt: 301000,
    endedAt: 301100,
    remainingMs: 0,
    recordedAt: 301200,
    outcomes: Array.from({ length: 6 }, () => ({ level: 1, operation: 'addition', points: 1 })),
  } // 6/10 = 60% coverage -> 1 sessionStar, 0 collectibleStars

  it('aggregates stars and ignores equivalent duplicates (refresh resilience)', () => {
    // baseSession1 repeated twice (equivalent duplicate)
    // baseSession1 is Challenge with 100% accuracy -> Rule E (3) * 1.5 = 4.5 -> floor = 4
    // baseSession2 is Regular with 60% coverage -> Rule B (1 session, 0 collectible)
    const records = [baseSession1, baseSession1, baseSession2]
    const summary = aggregateRewardCollectionV1(records)

    expect(summary.totalValidSessions).toBe(2)
    expect(summary.duplicatesIgnoredCount).toBe(1)
    expect(summary.invalidRecordsCount).toBe(0)
    expect(summary.conflicts).toHaveLength(0)
    expect(summary.totalSessionStars).toBe(3 + 1) // 4
    expect(summary.totalCollectibleStars).toBe(4 + 0) // Challenge (4) + Regular (0) = 4
    expect(summary.availableBalance).toBe(4)
    expect(summary.qualifyingSessionCount).toBe(1) // only baseSession1 gave > 0 stars
  })

  it('safely handles conflicting content for same instanceId by disqualifying both', () => {
    const conflictedSession1 = {
      ...baseSession1,
      outcomes: Array.from({ length: 10 }, () => ({ level: 1, operation: 'addition', points: 0 })), // different points
    }

    const records = [baseSession1, conflictedSession1, baseSession2]
    const summary = aggregateRewardCollectionV1(records)

    // baseSession1 had conflict with conflictedSession1 -> excluded!
    expect(summary.conflicts).toHaveLength(1)
    expect(summary.conflicts[0].instanceId).toBe(baseSession1.instanceId)
    // Only baseSession2 remains valid (Regular with 60% coverage = 1 session, 0 collectible)
    expect(summary.totalValidSessions).toBe(1)
    expect(summary.totalSessionStars).toBe(1)
    expect(summary.totalCollectibleStars).toBe(0)
    expect(summary.availableBalance).toBe(0)
    expect(summary.qualifyingSessionCount).toBe(0)
  })

  it('safely skips invalid records and tallies invalidRecordsCount', () => {
    const invalidRecord = { bad: 'data' }
    const records = [baseSession1, invalidRecord]
    const summary = aggregateRewardCollectionV1(records)

    expect(summary.totalValidSessions).toBe(1)
    expect(summary.invalidRecordsCount).toBe(1)
    expect(summary.totalCollectibleStars).toBe(4) // baseSession1 is Challenge: 3 * 1.5 = 4.5 floor = 4
  })

  it('supports Challenge mode with mixed operations and level retention', () => {
    const challengeSession = {
      historySchemaVersion: 2,
      instanceId: '77777777-7777-4777-8777-777777777777',
      sessionId: 'challenge-1',
      mode: 'challenge',
      operationMode: 'mixed',
      endReason: 'completed',
      plannedCount: 10,
      completedCount: 10,
      startedAt: 1000,
      durationMs: 300000,
      deadlineAt: 301000,
      endedAt: 200000,
      remainingMs: 101000,
      recordedAt: 200100,
      outcomes: [
        { level: 3, operation: 'addition', points: 1 },
        { level: 2, operation: 'subtraction', points: 1 },
        { level: 4, operation: 'addition', points: 1 },
        { level: 1, operation: 'subtraction', points: 1 },
        { level: 2, operation: 'addition', points: 1 },
        { level: 3, operation: 'subtraction', points: 1 },
        { level: 2, operation: 'addition', points: 1 },
        { level: 1, operation: 'subtraction', points: 1 },
        { level: 4, operation: 'addition', points: 1 },
        { level: 2, operation: 'subtraction', points: 1 },
      ],
    }

    const evaluation = evaluateCompletedSessionRewardV1(challengeSession)
    expect(evaluation.status).toBe('valid')
    if (evaluation.status === 'valid') {
      expect(evaluation.mode).toBe('challenge')
      expect(evaluation.reward.sessionStars).toBe(3)
      expect(evaluation.reward.collectibleStars).toBe(3)
    }
  })

  it('supports unlimited duration sessions (durationMs: null)', () => {
    const unlimitedSession = {
      historySchemaVersion: 2,
      instanceId: '88888888-8888-4888-8888-888888888888',
      sessionId: 'unlimited-1',
      mode: 'regular',
      operationMode: 'addition',
      endReason: 'completed',
      plannedCount: 10,
      completedCount: 10,
      startedAt: 1000,
      durationMs: null,
      deadlineAt: null,
      endedAt: 200000,
      remainingMs: null,
      recordedAt: 200100,
      outcomes: Array.from({ length: 10 }, () => ({ level: 1, operation: 'addition', points: 1 })),
    }

    const evaluation = evaluateCompletedSessionRewardV1(unlimitedSession)
    expect(evaluation.status).toBe('valid')
    if (evaluation.status === 'valid') {
      expect(evaluation.reward.sessionStars).toBe(3)
      expect(evaluation.reward.collectibleStars).toBe(3)
    }
  })

  it('accurately evaluates exact discrete half-point combinations', () => {
    // 8 full points + one 0.5 point = 8.5/10 = 85% -> 2 stars
    const session85 = {
      historySchemaVersion: 2,
      instanceId: '99999999-9999-4999-8999-999999999999',
      sessionId: 'reg-85',
      mode: 'regular',
      operationMode: 'addition',
      endReason: 'completed',
      plannedCount: 10,
      completedCount: 10,
      startedAt: 1000,
      durationMs: 300000,
      deadlineAt: 301000,
      endedAt: 200000,
      remainingMs: 101000,
      recordedAt: 200100,
      outcomes: [
        ...Array.from({ length: 8 }, () => ({ level: 1, operation: 'addition', points: 1 as const })),
        { level: 1, operation: 'addition', points: 0.5 as const },
        { level: 1, operation: 'addition', points: 0 as const },
      ],
    }

    const eval85 = evaluateCompletedSessionRewardV1(session85)
    expect(eval85.status).toBe('valid')
    if (eval85.status === 'valid') {
      expect(eval85.reward.sessionStars).toBe(2)
      expect(eval85.reward.collectibleStars).toBe(2)
      expect(eval85.reward.ruleTier).toBe('passing-good-accuracy')
    }

    // 8 full points + two 0.5 points = 9.0/10 = 90% -> 3 stars
    const session90 = {
      ...session85,
      instanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      outcomes: [
        ...Array.from({ length: 8 }, () => ({ level: 1, operation: 'addition', points: 1 as const })),
        { level: 1, operation: 'addition', points: 0.5 as const },
        { level: 1, operation: 'addition', points: 0.5 as const },
      ],
    }

    const eval90 = evaluateCompletedSessionRewardV1(session90)
    expect(eval90.status).toBe('valid')
    if (eval90.status === 'valid') {
      expect(eval90.reward.sessionStars).toBe(3)
      expect(eval90.reward.collectibleStars).toBe(3)
      expect(eval90.reward.ruleTier).toBe('perfect-high-accuracy')
    }
  })
})
