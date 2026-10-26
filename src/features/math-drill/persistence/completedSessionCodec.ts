import { isValidSessionDurationMs } from './sessionTimer'
import type { CompletedSessionRecord } from './completedSessionTypes'

export type CompletedSessionValidation =
  | { readonly status: 'valid'; readonly value: CompletedSessionRecord }
  | { readonly status: 'corrupt'; readonly issues: readonly string[] }
  | { readonly status: 'unsupported-version'; readonly version: number }

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fail(issue: string): CompletedSessionValidation {
  return { status: 'corrupt', issues: [issue] }
}

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

const topFieldsV1 = ['historySchemaVersion', 'instanceId', 'sessionId', 'mode', 'operationMode', 'completedAt', 'recordedAt', 'provenance', 'outcomes']
const topFieldsV2 = ['historySchemaVersion', 'instanceId', 'sessionId', 'mode', 'operationMode', 'endReason', 'plannedCount', 'completedCount', 'startedAt', 'durationMs', 'deadlineAt', 'endedAt', 'remainingMs', 'recordedAt', 'outcomes']
const outcomeFields = ['level', 'operation', 'level5Sublevel', 'points']

/** Validate client-clock metadata without treating legacy timestamps as completion time. */
export function validateCompletionTiming(value: unknown): readonly string[] {
  if (!record(value)) return ['TIMING_INVALID']
  if (!validTimestamp(value.recordedAt)) return ['RECORDED_AT_INVALID']
  if (value.provenance === 'new-atomic') {
    if (!validTimestamp(value.completedAt) || value.completedAt > value.recordedAt) return ['COMPLETED_AT_INVALID']
  } else if (value.provenance === 'legacy-last-result') {
    if (value.completedAt !== null) return ['LEGACY_COMPLETION_TIME_UNKNOWN']
  } else return ['PROVENANCE_INVALID']
  return []
}

function validateV2Timing(value: Record<string, unknown>): string | null {
  if (!validTimestamp(value.recordedAt) || !validTimestamp(value.startedAt) || !validTimestamp(value.endedAt)) return 'TIMING_INVALID'
  if ((value.startedAt as number) > (value.endedAt as number) || (value.endedAt as number) > (value.recordedAt as number)) return 'TIMESTAMP_ORDER_INVALID'
  const duration = value.durationMs
  if (!isValidSessionDurationMs(duration)) return 'DURATION_INVALID'
  const expectedDeadline = duration === null ? null : (value.startedAt as number) + (duration as number)
  if (value.deadlineAt !== expectedDeadline || (expectedDeadline !== null && !Number.isSafeInteger(expectedDeadline))) return 'DEADLINE_INVALID'
  if (duration === null) {
    if (value.remainingMs !== null || value.endReason !== 'completed') return 'UNLIMITED_TIMING_INVALID'
  } else if (value.endReason === 'completed') {
    if ((value.endedAt as number) >= (expectedDeadline as number) || value.remainingMs !== (expectedDeadline as number) - (value.endedAt as number)) return 'REMAINING_TIME_INVALID'
  } else if (value.endReason === 'timeout') {
    if ((value.endedAt as number) < (expectedDeadline as number) || value.remainingMs !== 0) return 'TIMEOUT_TIMING_INVALID'
  } else return 'END_REASON_INVALID'
  return null
}

/** Classify untrusted history records; never repair, mutate, or regenerate domain questions. */
export function validateCompletedSession(value: unknown): CompletedSessionValidation {
  if (!record(value)) return fail('RECORD_INVALID')
  if (!Number.isSafeInteger(value.historySchemaVersion) || (value.historySchemaVersion as number) < 1) return fail('SCHEMA_VERSION_INVALID')
  const version = value.historySchemaVersion
  if (version !== 1 && version !== 2) return { status: 'unsupported-version', version: version as number }
  const fields = version === 1 ? topFieldsV1 : topFieldsV2
  if (Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(value, key))) return fail('FIELDS_INVALID')
  if (typeof value.instanceId !== 'string' || !uuidV4.test(value.instanceId)) return fail('INSTANCE_ID_INVALID')
  if (typeof value.sessionId !== 'string' || !value.sessionId.trim() || value.sessionId.length > 512 || Array.from(value.sessionId).some(char => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127)) return fail('SESSION_ID_INVALID')
  if (value.mode !== 'regular' && value.mode !== 'challenge') return fail('MODE_INVALID')
  if (value.operationMode !== 'addition' && value.operationMode !== 'subtraction' && value.operationMode !== 'mixed') return fail('OPERATION_MODE_INVALID')
  if (version === 1) {
    const timingIssues = validateCompletionTiming(value)
    if (timingIssues.length) return { status: 'corrupt', issues: timingIssues }
    if (!Array.isArray(value.outcomes) || value.outcomes.length < 1 || value.outcomes.length > 500) return fail('OUTCOMES_INVALID')
    if (value.mode === 'challenge' && ![10, 20, 30, 50].includes(value.outcomes.length)) return fail('CHALLENGE_COUNT_INVALID')
  } else {
    if (value.endReason !== 'completed' && value.endReason !== 'timeout') return fail('END_REASON_INVALID')
    if (!Number.isSafeInteger(value.plannedCount) || (value.plannedCount as number) < 1 || (value.plannedCount as number) > 500) return fail('PLANNED_COUNT_INVALID')
    if (value.mode === 'challenge' && ![10, 20, 30, 50].includes(value.plannedCount as number)) return fail('CHALLENGE_COUNT_INVALID')
    if (!Number.isSafeInteger(value.completedCount) || (value.completedCount as number) < 0 || (value.completedCount as number) > (value.plannedCount as number)) return fail('COMPLETED_COUNT_INVALID')
    if (!Array.isArray(value.outcomes) || value.outcomes.length !== value.completedCount) return fail('OUTCOMES_COUNT_MISMATCH')
    if (value.endReason === 'completed' && value.completedCount !== value.plannedCount) return fail('NORMAL_COMPLETION_INCOMPLETE')
    if (value.endReason === 'timeout' && value.durationMs === null) return fail('UNLIMITED_TIMEOUT_INVALID')
    const timingIssue = validateV2Timing(value)
    if (timingIssue) return fail(timingIssue)
  }
  let regularLevel: number | undefined
  let regularSublevel: unknown
  for (const outcome of value.outcomes as unknown[]) {
    if (!record(outcome) || Object.keys(outcome).some(key => !outcomeFields.includes(key)) || !['level', 'operation', 'points'].every(key => Object.hasOwn(outcome, key))) return fail('OUTCOME_INVALID')
    if (![1, 2, 3, 4, 5].includes(outcome.level as number)) return fail('LEVEL_INVALID')
    if (outcome.operation !== 'addition' && outcome.operation !== 'subtraction') return fail('OPERATION_INVALID')
    if (value.operationMode !== 'mixed' && outcome.operation !== value.operationMode) return fail('OPERATION_MODE_MISMATCH')
    if (outcome.points !== 0 && outcome.points !== 0.5 && outcome.points !== 1) return fail('POINTS_INVALID')
    const hasSublevel = Object.hasOwn(outcome, 'level5Sublevel')
    if (hasSublevel && !['dasar', 'menengah', 'lanjutan'].includes(outcome.level5Sublevel as string)) return fail('SUBLEVEL_INVALID')
    if (outcome.level !== 5 && hasSublevel) return fail('SUBLEVEL_LEVEL_MISMATCH')
    if (value.mode === 'challenge' && outcome.level === 5 && !hasSublevel) return fail('CHALLENGE_SUBLEVEL_REQUIRED')
    if (value.mode === 'regular') {
      regularLevel ??= outcome.level as number
      if (regularLevel !== outcome.level) return fail('REGULAR_LEVEL_MISMATCH')
      if (regularSublevel === undefined && outcome === (value.outcomes as unknown[])[0]) regularSublevel = hasSublevel ? outcome.level5Sublevel : null
      if (regularSublevel !== (hasSublevel ? outcome.level5Sublevel : null)) return fail('REGULAR_SUBLEVEL_MISMATCH')
    }
  }
  return { status: 'valid', value: value as unknown as CompletedSessionRecord }
}

export type CompletionComparison = 'equivalent' | 'different-instance' | 'conflict' | 'invalid'

/** Facts-only comparison for a future idempotent insert; timestamps are deliberately excluded. */
export function compareCompletionContent(left: unknown, right: unknown): CompletionComparison {
  const a = validateCompletedSession(left)
  const b = validateCompletedSession(right)
  if (a.status !== 'valid' || b.status !== 'valid') return 'invalid'
  if (a.value.instanceId !== b.value.instanceId) return 'different-instance'
  const facts = (entry: CompletedSessionRecord) => entry.historySchemaVersion === 1
    ? JSON.stringify([entry.historySchemaVersion, entry.sessionId, entry.mode, entry.operationMode, entry.provenance, entry.outcomes.map(item => [item.level, item.operation, item.level5Sublevel ?? null, item.points])])
    : JSON.stringify([entry.historySchemaVersion, entry.sessionId, entry.mode, entry.operationMode, entry.endReason, entry.plannedCount, entry.completedCount, entry.startedAt, entry.durationMs, entry.deadlineAt, entry.endedAt, entry.remainingMs, entry.outcomes.map(item => [item.level, item.operation, item.level5Sublevel ?? null, item.points])])
  return facts(a.value) === facts(b.value) ? 'equivalent' : 'conflict'
}
