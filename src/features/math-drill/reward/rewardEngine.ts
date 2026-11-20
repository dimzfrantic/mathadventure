import type { CompletedSessionRecord } from '../persistence/completedSessionTypes'
import { compareCompletionContent, validateCompletedSession, classifyLegacySessionUnscorable } from '../persistence/completedSessionCodec.ts'
import type {
  ConflictedSessionReward,
  ExcludedLegacySessionReward,
  RewardCollectionSummaryV1,
  SessionRewardEvaluation,
  SessionRewardV1,
  SessionRewardV2Extended,
} from './rewardTypes'
import { calculateSessionRewardV1 } from './rewardRulesV1.ts'
import { calculateSessionRewardV2Extended } from './rewardRulesV2Extended.ts'

function extractInstanceId(record: unknown): string | undefined {
  if (record && typeof record === 'object' && 'instanceId' in record && typeof (record as { instanceId?: unknown }).instanceId === 'string') {
    return (record as { instanceId: string }).instanceId
  }
  return undefined
}

/**
 * Evaluates a single completed session record (V1 or V2) against Reward Rules.
 * - V1 sessions: use calculateSessionRewardV1() (no timer metadata)
 * - V2 sessions: use calculateSessionRewardV2Extended() with timer metadata
 * Returns a typed evaluation result without throwing.
 */
export function evaluateCompletedSessionRewardV1(record: unknown): SessionRewardEvaluation {
  const validation = validateCompletedSession(record)

  if (validation.status === 'unsupported-version') {
    return {
      status: 'unsupported-version',
      instanceId: extractInstanceId(record),
      version: validation.version,
    }
  }

  if (validation.status === 'corrupt') {
    return {
      status: 'invalid',
      instanceId: extractInstanceId(record),
      issues: validation.issues,
    }
  }

  const validRecord: CompletedSessionRecord = validation.value
  const completedCount = validRecord.outcomes.length
  const plannedCount = validRecord.historySchemaVersion === 1
    ? validRecord.outcomes.length
    : validRecord.plannedCount
  const totalPoints = validRecord.outcomes.reduce((sum, o) => sum + o.points, 0)

  try {
    let reward: SessionRewardV1 | SessionRewardV2Extended

    // V2 sessions use extended formula with timer metadata
    if (validRecord.historySchemaVersion === 2) {
      reward = calculateSessionRewardV2Extended({
        mode: validRecord.mode === 'challenge' ? 'challenge' : 'regular',
        plannedCount,
        completedCount,
        totalPoints,
        endReason: validRecord.endReason,
        remainingMs: validRecord.remainingMs,
        deadlineAt: validRecord.deadlineAt,
        startedAt: validRecord.startedAt,
      })
    } else {
      // V1 sessions use base formula (no timer metadata available)
      reward = calculateSessionRewardV1({
        plannedCount,
        completedCount,
        totalPoints,
      })
    }

    return {
      status: 'valid',
      instanceId: validRecord.instanceId,
      mode: validRecord.mode,
      reward,
    }
  } catch (err) {
    return {
      status: 'invalid',
      instanceId: validRecord.instanceId,
      issues: [err instanceof Error ? err.message : 'CALCULATION_FAILED'],
    }
  }
}

/**
 * Aggregates lifetime collectible stars and session stars across stored history records.
 *
 * Rules:
 * - Deterministic, pure aggregation.
 * - Deduplicates by instanceId.
 * - Equivalent duplicate records (identical canonical facts) are counted once without error.
 * - Conflicting duplicate records (same instanceId with differing content) are excluded from
 *   totals and reported in `conflicts` rather than arbitrarily picking one.
 * - Corrupt or unsupported records are counted in `invalidRecordsCount` without yielding stars.
 * - Available balance in Stage 7A equals totalCollectibleStars.
 */
export function aggregateRewardCollectionV1(records: readonly unknown[]): RewardCollectionSummaryV1 {
  const validSessions = new Map<string, { record: CompletedSessionRecord; reward: SessionRewardV1 }>()
  const excludedSessions = new Map<string, { record: unknown; exclusion: ExcludedLegacySessionReward }>()
  const conflictedIds = new Set<string>()
  const conflicts: ConflictedSessionReward[] = []
  let duplicatesIgnoredCount = 0
  let invalidRecordsCount = 0

  for (const raw of records) {
    const validation = validateCompletedSession(raw)
    if (validation.status === 'valid') {
      const rec = validation.value
      const id = rec.instanceId

      if (conflictedIds.has(id)) {
        continue
      }

      // If an excluded legacy session already claimed this ID:
      if (excludedSessions.has(id)) {
        // Conflicting record with same instanceId: disqualify both!
        excludedSessions.delete(id)
        conflictedIds.add(id)
        conflicts.push({
          instanceId: id,
          reason: 'conflicting-content',
        })
        continue
      }

      const existing = validSessions.get(id)
      if (existing) {
        const comparison = compareCompletionContent(existing.record, rec)
        if (comparison === 'equivalent') {
          duplicatesIgnoredCount++
        } else {
          // Conflicting record with same instanceId: disqualify both!
          validSessions.delete(id)
          conflictedIds.add(id)
          conflicts.push({
          instanceId: id,
          reason: 'conflicting-content',
        })
        }
        continue
      }

      const evalResult = evaluateCompletedSessionRewardV1(rec)
      if (evalResult.status === 'valid') {
        validSessions.set(id, { record: rec, reward: evalResult.reward })
      } else {
        invalidRecordsCount++
      }
      continue
    }

    // Validation failed: check if it qualifies as an excluded legacy session
    const exclusion = classifyLegacySessionUnscorable(raw)
    if (exclusion.isUnscorable && exclusion.instanceId) {
      const id = exclusion.instanceId

      if (conflictedIds.has(id)) {
        continue
      }

      // If a valid session already claimed this ID:
      if (validSessions.has(id)) {
        validSessions.delete(id)
        conflictedIds.add(id)
        conflicts.push({
          instanceId: id,
          reason: 'conflicting-content',
        })
        continue
      }

      const existingExcluded = excludedSessions.get(id)
      if (existingExcluded) {
        // Compare raw facts for duplicate vs conflict
        const leftFacts = JSON.stringify(existingExcluded.record)
        const rightFacts = JSON.stringify(raw)
        if (leftFacts === rightFacts) {
          duplicatesIgnoredCount++
        } else {
          excludedSessions.delete(id)
          conflictedIds.add(id)
          conflicts.push({
            instanceId: id,
            reason: 'conflicting-content',
          })
        }
        continue
      }

      excludedSessions.set(id, {
        record: raw,
        exclusion: {
          instanceId: id,
          reason: 'LEGACY_SESSION_UNSCORABLE',
        },
      })
      continue
    }

    invalidRecordsCount++
  }

  let totalSessionStars = 0
  let totalCollectibleStars = 0
  let qualifyingSessionCount = 0

  for (const item of validSessions.values()) {
    totalSessionStars += item.reward.sessionStars
    
    // V2Extended rewards use finalStars (includes multiplier + bonus)
    // V1 rewards use collectibleStars only
    const rewardStars = 'finalStars' in item.reward 
      ? (item.reward as SessionRewardV2Extended).finalStars 
      : item.reward.collectibleStars
    
    totalCollectibleStars += rewardStars
    if (rewardStars > 0) {
      qualifyingSessionCount++
    }
  }

  const excludedLegacySessions: ExcludedLegacySessionReward[] = Array.from(
    excludedSessions.values(),
    item => item.exclusion
  )

  return {
    totalSessionStars,
    totalCollectibleStars,
    availableBalance: totalCollectibleStars,
    qualifyingSessionCount,
    totalValidSessions: validSessions.size,
    duplicatesIgnoredCount,
    invalidRecordsCount,
    conflicts,
    excludedLegacySessionsCount: excludedLegacySessions.length,
    excludedLegacySessions,
  }
}
