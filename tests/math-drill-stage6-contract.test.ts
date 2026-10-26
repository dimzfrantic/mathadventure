import { describe, expect, it } from 'vitest'
import { answerQuestion, createScoreState, generateChallengeSession, generateSession } from '../src/features/math-drill/domain'
import { validateSavedSession } from '../src/features/math-drill/persistence/sessionCodec'
import { validateCompletedSession } from '../src/features/math-drill/persistence/completedSessionCodec'
import { projectCompletedSession } from '../src/features/math-drill/persistence/completedSessionProjection'
import { createSessionTiming, finishSessionTiming } from '../src/features/math-drill/persistence/sessionTimer'

const instanceId = '550e8400-e29b-41d4-a716-446655440000'
const challengeInstanceId = '550e8400-e29b-41d4-a716-446655440001'

function regular(count = 4) {
  const result = generateSession({ level: 1, mode: 'addition', count, seed: 6101, roundSize: 2 })
  if (!result.ok) throw new Error(result.error.code)
  return result.session
}
function challenge() {
  const result = generateChallengeSession({ selectedLevels: [1], selectedLevel5Sublevels: [], mode: 'mixed', count: 10, seed: 6102, roundSize: 5 })
  if (!result.ok) throw new Error(result.error.code)
  return result.session
}
function scored(session: ReturnType<typeof regular> | ReturnType<typeof challenge>, points: readonly (0 | 0.5 | 1)[]) {
  let score = createScoreState(session)
  for (let index = 0; index < points.length; index += 1) {
    const question = session.questions[index]
    const wrong = question.choices.findIndex((_choice, choiceIndex) => choiceIndex !== question.correctChoiceIndex)
    const anotherWrong = question.choices.findIndex((_choice, choiceIndex) => choiceIndex !== question.correctChoiceIndex && choiceIndex !== wrong)
    const choices = points[index] === 1 ? [question.correctChoiceIndex]
      : points[index] === 0.5 ? [wrong, question.correctChoiceIndex] : [wrong, anotherWrong]
    for (const choice of choices) {
      const answer = answerQuestion(score, session, question.key, choice)
      if (!answer.ok) throw new Error(answer.error.code)
      score = answer.state
    }
  }
  return score
}
function timedSnapshot(mode: 'regular' | 'challenge', count: number, points: readonly (0 | 0.5 | 1)[], endReason: 'completed' | 'timeout', durationMs = 300_000) {
  const session = mode === 'regular' ? regular(count) : challenge()
  const timingStart = 1_000
  const endedAt = endReason === 'timeout' ? timingStart + durationMs : timingStart + durationMs - 51_000
  const timing = finishSessionTiming(createSessionTiming(durationMs as never, timingStart), endReason, endedAt)
  const questionIndex = endReason === 'completed' ? session.questions.length - 1 : Math.max(0, points.length - 1)
  return {
    schemaVersion: 2,
    mode,
    instanceId: mode === 'regular' ? instanceId : challengeInstanceId,
    sessionId: session.id,
    revision: 5,
    createdAt: timingStart,
    updatedAt: endedAt,
    session,
    score: scored(session, points),
    cursor: { questionIndex, phase: endReason === 'timeout' ? 'timeout' : 'result', pendingAdvanceAt: null },
    timing,
  }
}
function project(snapshot: unknown) {
  const result = projectCompletedSession(snapshot)
  if (result.status !== 'valid') throw new Error(`Projection failed: ${result.status}`)
  return result.value
}

describe('Stage 6 versioned snapshot/history contract', () => {
  it('keeps a complete V1 snapshot and V1 history readable without rewriting it', () => {
    const session = regular(2)
    const score = scored(session, [1, 0.5])
    const snapshot = { schemaVersion: 1, mode: 'regular', instanceId, sessionId: session.id, revision: 3, createdAt: 100, updatedAt: 200, session, score, cursor: { questionIndex: 1, phase: 'result', pendingAdvanceAt: null } }
    const projected = projectCompletedSession(snapshot, { completedAt: 210, recordedAt: 220, provenance: 'new-atomic' })
    expect(validateSavedSession(snapshot)).toMatchObject({ status: 'valid', value: { schemaVersion: 1 } })
    expect(projected).toMatchObject({ status: 'valid', value: { historySchemaVersion: 1, outcomes: [{ points: 1 }, { points: 0.5 }] } })
  })

  it('projects a normal V2 Regular completion with full coverage and explicit timer metadata', () => {
    const record = project(timedSnapshot('regular', 4, [1, 0.5, 0, 1], 'completed'))
    expect(validateCompletedSession(record)).toMatchObject({ status: 'valid' })
    expect(record).toMatchObject({
      historySchemaVersion: 2, mode: 'regular', endReason: 'completed', plannedCount: 4, completedCount: 4,
      startedAt: 1_000, durationMs: 300_000, deadlineAt: 301_000, endedAt: 250_000, remainingMs: 51_000,
    })
    expect(record.outcomes.map(outcome => outcome.points)).toEqual([1, 0.5, 0, 1])
  })

  it('projects only completed outcomes for a partial Regular timeout', () => {
    const snapshot = timedSnapshot('regular', 4, [1, 0.5], 'timeout')
    expect(validateSavedSession(snapshot)).toMatchObject({ status: 'valid', value: { cursor: { phase: 'timeout' } } })
    const record = project(snapshot)
    expect(record).toMatchObject({ historySchemaVersion: 2, endReason: 'timeout', plannedCount: 4, completedCount: 2, remainingMs: 0 })
    expect(record.outcomes).toHaveLength(2)
    expect(record.outcomes.map(outcome => outcome.points)).toEqual([1, 0.5])
  })

  it('represents a timeout before any question is completed without inventing an outcome or accuracy', () => {
    const snapshot = timedSnapshot('regular', 4, [], 'timeout')
    const result = projectCompletedSession(snapshot)
    expect(result).toMatchObject({ status: 'valid', value: { historySchemaVersion: 2, endReason: 'timeout', plannedCount: 4, completedCount: 0, outcomes: [] } })
  })

  it('supports a partial Challenge timeout while retaining its configured planned count and ordered metadata', () => {
    const record = project(timedSnapshot('challenge', 10, [1, 0.5, 0], 'timeout'))
    expect(record).toMatchObject({ historySchemaVersion: 2, mode: 'challenge', endReason: 'timeout', plannedCount: 10, completedCount: 3 })
    expect(record.outcomes.map(outcome => outcome.points)).toEqual([1, 0.5, 0])
    expect(record.outcomes).toHaveLength(3)
  })

  it('preserves a custom timeout duration and its absolute deadline in V2 snapshot and history metadata', () => {
    const snapshot = timedSnapshot('regular', 4, [1], 'timeout', 7 * 60_000)
    expect(validateSavedSession(snapshot)).toMatchObject({
      status: 'valid', value: { schemaVersion: 2, timing: { durationMs: 420_000, startedAt: 1_000, deadlineAt: 421_000 } },
    })
    const projection = projectCompletedSession(snapshot)
    expect(projection).toMatchObject({
      status: 'valid', value: { historySchemaVersion: 2, endReason: 'timeout', durationMs: 420_000, startedAt: 1_000, deadlineAt: 421_000, remainingMs: 0 },
    })
  })

  it('rejects V2 records whose coverage, outcomes, deadline, or end reason disagree', () => {
    const valid = project(timedSnapshot('regular', 4, [1, 0.5], 'timeout'))
    expect(validateCompletedSession({ ...valid, completedCount: 3 }).status).toBe('corrupt')
    expect(validateCompletedSession({ ...valid, outcomes: [...valid.outcomes, { ...valid.outcomes[0] }] }).status).toBe('corrupt')
    expect(validateCompletedSession({ ...valid, deadlineAt: null }).status).toBe('corrupt')
    expect(validateCompletedSession({ ...valid, endReason: 'completed' }).status).toBe('corrupt')
    const snapshot = timedSnapshot('regular', 4, [1], 'timeout')
    expect(validateSavedSession({ ...snapshot, timing: { ...snapshot.timing, deadlineAt: 999_999 } }).status).toBe('corrupt')
  })
})