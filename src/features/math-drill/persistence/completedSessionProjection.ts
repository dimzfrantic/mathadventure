import type { CompletedQuestionOutcome, CompletedSessionRecord, CompletedSessionRecordV1, CompletedSessionRecordV2 } from './completedSessionTypes'
import { validateCompletionTiming, validateCompletedSession } from './completedSessionCodec'
import { validateSavedSession } from './sessionCodec'

export type CompletionTiming = Pick<CompletedSessionRecordV1, 'completedAt' | 'recordedAt' | 'provenance'>
export type V2CompletionTiming = Pick<CompletedSessionRecordV2, 'recordedAt'>
export type CompletionProjection =
  | { readonly status: 'valid'; readonly value: CompletedSessionRecord }
  | { readonly status: 'invalid-snapshot'; readonly issues: readonly string[] }
  | { readonly status: 'invalid-timing'; readonly issues: readonly string[] }

/** Projection only: never writes storage or finalizes an active session. */
export function projectCompletedSession(snapshot: unknown, timing?: CompletionTiming | V2CompletionTiming): CompletionProjection {
  const checked = validateSavedSession(snapshot)
  if (checked.status !== 'valid') return { status: 'invalid-snapshot', issues: checked.status === 'corrupt' ? checked.issues : ['UNSUPPORTED_SNAPSHOT_VERSION'] }
  const saved = checked.value

  if (saved.schemaVersion === 2) {
    if (saved.cursor.phase !== 'result' && saved.cursor.phase !== 'timeout') return { status: 'invalid-snapshot', issues: ['SESSION_NOT_TERMINAL'] }
    if (saved.timing.endReason !== (saved.cursor.phase === 'result' ? 'completed' : 'timeout')) return { status: 'invalid-snapshot', issues: ['TIMING_TERMINAL_MISMATCH'] }
    const outcomes: CompletedQuestionOutcome[] = []
    for (const question of saved.session.questions) {
      const response = saved.score.responses[question.key]
      if (!response || response.status !== 'completed') continue
      const sublevel = saved.mode === 'regular' ? saved.session.level5Sublevel : 'level5Sublevel' in question ? question.level5Sublevel : undefined
      outcomes.push({ level: question.level, operation: question.operation, ...(sublevel === undefined ? {} : { level5Sublevel: sublevel }), points: response.points })
    }
    const recordedAt = timing && 'recordedAt' in timing
      ? timing.recordedAt
      : Math.max(saved.updatedAt, saved.timing.endedAt as number)
    const candidate: CompletedSessionRecordV2 = {
      historySchemaVersion: 2, instanceId: saved.instanceId, sessionId: saved.sessionId,
      mode: saved.mode, operationMode: saved.session.mode,
      endReason: saved.timing.endReason, plannedCount: saved.session.questions.length, completedCount: outcomes.length,
      startedAt: saved.timing.startedAt, durationMs: saved.timing.durationMs, deadlineAt: saved.timing.deadlineAt,
      endedAt: saved.timing.endedAt as number, remainingMs: saved.timing.remainingMs,
      recordedAt, outcomes,
    }
    const validated = validateCompletedSession(candidate)
    return validated.status === 'valid' ? validated : { status: 'invalid-snapshot', issues: validated.status === 'corrupt' ? validated.issues : ['UNSUPPORTED_HISTORY_VERSION'] }
  }

  if (saved.cursor.phase !== 'result') return { status: 'invalid-snapshot', issues: ['SESSION_NOT_COMPLETE'] }
  if (!timing || !('completedAt' in timing)) return { status: 'invalid-timing', issues: ['COMPLETION_TIMING_REQUIRED'] }
  const timingIssues = validateCompletionTiming(timing)
  if (timingIssues.length) return { status: 'invalid-timing', issues: timingIssues }
  const outcomes: CompletedQuestionOutcome[] = saved.session.questions.map(question => {
    const response = saved.score.responses[question.key]
    if (!response || response.status !== 'completed') throw new Error('Validated result has incomplete response')
    const sublevel = saved.mode === 'regular' ? saved.session.level5Sublevel : 'level5Sublevel' in question ? question.level5Sublevel : undefined
    return { level: question.level, operation: question.operation, ...(sublevel === undefined ? {} : { level5Sublevel: sublevel }), points: response.points }
  })
  const candidate: CompletedSessionRecordV1 = {
    historySchemaVersion: 1, instanceId: saved.instanceId, sessionId: saved.sessionId,
    mode: saved.mode, operationMode: saved.session.mode,
    completedAt: timing.completedAt, recordedAt: timing.recordedAt, provenance: timing.provenance, outcomes,
  }
  const validated = validateCompletedSession(candidate)
  return validated.status === 'valid' ? validated : { status: 'invalid-snapshot', issues: validated.status === 'corrupt' ? validated.issues : ['UNSUPPORTED_HISTORY_VERSION'] }
}
