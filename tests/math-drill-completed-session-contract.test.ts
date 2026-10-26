import { describe, expect, it } from 'vitest'
import { answerQuestion, createScoreState, generateChallengeSession, generateSession, getChallengeSummary } from '../src/features/math-drill/domain'
import { validateSavedSession } from '../src/features/math-drill/persistence/sessionCodec'
import type { ChallengeSession, DrillSession, ScoreState } from '../src/features/math-drill/domain'
import { projectCompletedSession } from '../src/features/math-drill/persistence/completedSessionProjection'
import { validateCompletedSession, compareCompletionContent } from '../src/features/math-drill/persistence/completedSessionCodec'

const instanceId = '550e8400-e29b-41d4-a716-446655440000'

function regularResult() {
  const generated = generateSession({ level: 1, mode: 'mixed', count: 3, seed: 97, roundSize: 2 })
  if (!generated.ok) throw new Error(generated.error.code)
  const session = generated.session
  let score = createScoreState(session)
  for (const question of session.questions) {
    const answer = answerQuestion(score, session, question.key, question.correctChoiceIndex)
    if (!answer.ok) throw new Error(answer.error.code)
    score = answer.state
  }
  return {
    schemaVersion: 1 as const, mode: 'regular' as const, instanceId, sessionId: session.id,
    revision: 5, createdAt: 1000, updatedAt: 2000, session, score,
    cursor: { questionIndex: 2, phase: 'result' as const, pendingAdvanceAt: null },
  }
}

function completedSnapshot(session: DrillSession | ChallengeSession, outcomes: readonly (0 | 0.5 | 1)[], id = instanceId) {
  let score: ScoreState = createScoreState(session)
  session.questions.forEach((question, index) => {
    const wrong = question.choices.findIndex((_choice, choiceIndex) => choiceIndex !== question.correctChoiceIndex)
    const anotherWrong = question.choices.findIndex((_choice, choiceIndex) => choiceIndex !== question.correctChoiceIndex && choiceIndex !== wrong)
    const choices = outcomes[index] === 1 ? [question.correctChoiceIndex]
      : outcomes[index] === 0.5 ? [wrong, question.correctChoiceIndex] : [wrong, anotherWrong]
    for (const choice of choices) {
      const answer = answerQuestion(score, session, question.key, choice)
      if (!answer.ok) throw new Error(answer.error.code)
      score = answer.state
    }
  })
  return {
    schemaVersion: 1 as const, mode: ('kind' in session ? 'challenge' : 'regular') as 'challenge' | 'regular',
    instanceId: id, sessionId: session.id, revision: 5, createdAt: 1000, updatedAt: 2000,
    session, score, cursor: { questionIndex: session.questions.length - 1, phase: 'result' as const, pendingAdvanceAt: null },
  }
}

function projectValid(snapshot: unknown, timing = { completedAt: 2200, recordedAt: 2200, provenance: 'new-atomic' as const }) {
  const result = projectCompletedSession(snapshot, timing)
  if (result.status !== 'valid') throw new Error(`Projection failed: ${result.status}`)
  return result.value
}

describe('completed-session pure contract', () => {
  it('projects a completed Regular snapshot without losing its instance identity', () => {
    const snapshot = regularResult()
    const result = projectCompletedSession(snapshot, { completedAt: 2200, recordedAt: 2200, provenance: 'new-atomic' })
    expect(result.status).toBe('valid')
    if (result.status !== 'valid') return
    expect(result.value).toMatchObject({
      historySchemaVersion: 1, instanceId, sessionId: snapshot.sessionId,
      mode: 'regular', operationMode: 'mixed',
      completedAt: 2200, recordedAt: 2200, provenance: 'new-atomic',
    })
    expect(result.value.outcomes).toEqual(snapshot.session.questions.map(question => ({
      level: question.level, operation: question.operation, points: 1,
    })))
  })

  it('accepts a projected completed record and rejects a non-UUID identity', () => {
    const projection = projectCompletedSession(regularResult(), { completedAt: 2200, recordedAt: 2200, provenance: 'new-atomic' })
    if (projection.status !== 'valid') throw new Error('projection failed')
    expect(validateCompletedSession(projection.value)).toEqual({ status: 'valid', value: projection.value })
    expect(validateCompletedSession({ ...projection.value, instanceId: 'not-a-uuid' }).status).toBe('corrupt')
  })

  it('projects Challenge outcomes by played level, sublevel and operation without confusing mixed with an operation', () => {
    const generated = generateChallengeSession({ selectedLevels: [1, 5], selectedLevel5Sublevels: ['dasar'], mode: 'mixed', count: 10, seed: 97 })
    if (!generated.ok) throw new Error(generated.error.code)
    const points = [1, 0.5, 0, 1, 0.5, 0, 1, 1, 1, 1] as const
    const snapshot = completedSnapshot(generated.session, points)
    const projected = projectValid(snapshot)
    expect(projected.mode).toBe('challenge')
    expect(projected.operationMode).toBe('mixed')
    expect(projected.outcomes.map(item => item.points)).toEqual(points)
    expect(projected.outcomes.map(item => item.operation)).toEqual(generated.session.questions.map(item => item.operation))
    expect(projected.outcomes.map(item => item.level)).toEqual(generated.session.questions.map(item => item.level))
    expect(projected.outcomes.filter(item => item.level === 5).every(item => item.level5Sublevel === 'dasar')).toBe(true)
    expect(projected.outcomes.filter(item => item.level !== 5).every(item => item.level5Sublevel === undefined)).toBe(true)
    expect(projected.outcomes.reduce((sum, item) => sum + item.points, 0)).toBe(7)
    expect(validateCompletedSession(projected).status).toBe('valid')
  })

  it('keeps Regular Level 5 sublevel but does not invent one when absent', () => {
    const generated = generateSession({ level: 5, level5Sublevel: 'dasar', mode: 'addition', count: 2, seed: 20 })
    if (!generated.ok) throw new Error(generated.error.code)
    const withSublevel = projectValid(completedSnapshot(generated.session, [1, 0.5]))
    expect(withSublevel.outcomes.map(item => item.level5Sublevel)).toEqual(['dasar', 'dasar'])
    const legacy = { ...generated.session, level5Sublevel: undefined }
    const withoutSublevel = projectValid(completedSnapshot(legacy, [1, 0]))
    expect(withoutSublevel.outcomes.every(item => !Object.hasOwn(item, 'level5Sublevel'))).toBe(true)
  })

  it('rejects invalid timestamp combinations in both record validation and projection', () => {
    const saved = regularResult()
    const base = projectValid(saved)
    for (const changed of [
      { ...base, completedAt: Number.NaN },
      { ...base, completedAt: Number.POSITIVE_INFINITY },
      { ...base, completedAt: -1 },
      { ...base, completedAt: null },
      { ...base, recordedAt: Number.NaN },
      { ...base, recordedAt: -1 },
      { ...base, completedAt: 2300, recordedAt: 2200 },
      { ...base, provenance: 'legacy-last-result' },
    ]) expect(validateCompletedSession(changed).status).toBe('corrupt')
    expect(projectCompletedSession(saved, { completedAt: Number.NaN, recordedAt: 2200, provenance: 'new-atomic' }).status).toBe('invalid-timing')
    expect(projectCompletedSession(saved, { completedAt: null, recordedAt: 2200, provenance: 'legacy-last-result' }).status).toBe('valid')
  })

  it('distinguishes unsupported history versions from invalid schema fields', () => {
    const base = projectValid(regularResult())
    expect(validateCompletedSession({ ...base, historySchemaVersion: 3 })).toEqual({ status: 'unsupported-version', version: 3 })
    for (const version of [0, -1, 1.5, Number.NaN, '2', undefined]) {
      expect(validateCompletedSession({ ...base, historySchemaVersion: version }).status).toBe('corrupt')
    }
  })

  it('rejects incomplete results and score mismatches without repairing Stage 3', () => {
    const complete = regularResult()
    const timing = { completedAt: 2200, recordedAt: 2200, provenance: 'new-atomic' as const }
    expect(projectCompletedSession({ ...complete, cursor: { ...complete.cursor, phase: 'answering' } }, timing).status).toBe('invalid-snapshot')
    expect(projectCompletedSession({ ...complete, score: createScoreState(complete.session) }, timing).status).toBe('invalid-snapshot')
    const changed = structuredClone(complete)
    const question = changed.session.questions[0]
    const score = { ...changed.score, responses: {
      ...changed.score.responses,
      [question.key]: { status: 'completed', attempts: [question.correctChoiceIndex], points: 0 },
    } }
    expect(projectCompletedSession({ ...changed, score }, timing).status).toBe('invalid-snapshot')
  })

  it('rejects impossible outcome points, counts, modes and categories', () => {
    const base = projectValid(regularResult())
    const first = base.outcomes[0]
    const replaceFirst = (changed: Record<string, unknown>) => ({ ...base, outcomes: [{ ...first, ...changed }, ...base.outcomes.slice(1)] })
    for (const point of [Number.NaN, Number.POSITIVE_INFINITY, 0.25, -1, 2]) {
      expect(validateCompletedSession(replaceFirst({ points: point })).status).toBe('corrupt')
    }
    expect(validateCompletedSession({ ...base, outcomes: [] }).status).toBe('corrupt')
    expect(validateCompletedSession({ ...base, mode: 'other' }).status).toBe('corrupt')
    expect(validateCompletedSession({ ...base, sessionId: '\u0000' }).status).toBe('corrupt')
    expect(validateCompletedSession(replaceFirst({ level: 6 })).status).toBe('corrupt')
    expect(validateCompletedSession(replaceFirst({ operation: 'mixed' })).status).toBe('corrupt')
    expect(validateCompletedSession(replaceFirst({ level5Sublevel: 'dasar' })).status).toBe('corrupt')
    expect(validateCompletedSession({ ...base, operationMode: 'addition' }).status).toBe('corrupt')
    expect(validateCompletedSession({ ...base, unapprovedField: true }).status).toBe('corrupt')
  })

  it('uses raw Challenge points to reproduce existing weighted and two-attempt metrics', () => {
    const generated = generateChallengeSession({ selectedLevels: [1], selectedLevel5Sublevels: [], mode: 'addition', count: 10, seed: 21 })
    if (!generated.ok) throw new Error(generated.error.code)
    const saved = completedSnapshot(generated.session, [1, 0.5, 0, 1, 1, 1, 1, 1, 1, 1])
    const history = projectValid(saved)
    const summary = getChallengeSummary(saved.score, generated.session)
    expect(summary.overall.weightedScore.value).toBe(history.outcomes.reduce((sum, item) => sum + item.points, 0) / history.outcomes.length * 100)
    expect(summary.overall.successWithinTwoAttempts.value).toBe(history.outcomes.filter(item => item.points > 0).length / history.outcomes.length * 100)
    expect(history.outcomes.filter(item => item.points === 0.5)).toHaveLength(1)
    expect(history.outcomes.filter(item => item.points === 0)).toHaveLength(1)
  })

  it('preserves instanceId across a saved snapshot validation and structured-clone resume boundary', () => {
    const original = regularResult()
    const resumed = validateSavedSession(structuredClone(original))
    expect(resumed.status).toBe('valid')
    if (resumed.status !== 'valid') return
    expect(resumed.value.instanceId).toBe(original.instanceId)
    expect(projectValid(resumed.value).instanceId).toBe(original.instanceId)
    const challenge = generateChallengeSession({ selectedLevels: [1], selectedLevel5Sublevels: [], mode: 'addition', count: 10, seed: 21 })
    if (!challenge.ok) throw new Error(challenge.error.code)
    const challengeSaved = completedSnapshot(challenge.session, Array(10).fill(1))
    const resumedChallenge = validateSavedSession(structuredClone(challengeSaved))
    expect(resumedChallenge.status).toBe('valid')
    if (resumedChallenge.status === 'valid') expect(projectValid(resumedChallenge.value).instanceId).toBe(instanceId)
  })

  it('compares canonical completion facts while preserving original timestamps on replay', () => {
    const saved = regularResult()
    const original = projectValid(saved)
    expect(projectValid(structuredClone(saved))).toEqual(original)
    const replay = projectValid(structuredClone(saved), { completedAt: 3000, recordedAt: 3000, provenance: 'new-atomic' })
    expect(compareCompletionContent(original, replay)).toBe('equivalent')
    expect(original.completedAt).toBe(2200)
    expect(original.recordedAt).toBe(2200)
  })

  it('reports conflicts for the same instance when outcomes, session ID, or provenance differ', () => {
    const original = projectValid(regularResult())
    const conflicting = { ...original, outcomes: [{ ...original.outcomes[0], points: 0 }, ...original.outcomes.slice(1)] }
    expect(compareCompletionContent(original, conflicting)).toBe('conflict')
    expect(compareCompletionContent(original, { ...original, sessionId: 'another-session' })).toBe('conflict')
    expect(compareCompletionContent(original, { ...original, completedAt: null, provenance: 'legacy-last-result' })).toBe('conflict')
  })

  it('does not collapse different instances with an identical deterministic session ID', () => {
    const saved = regularResult()
    const first = projectValid(saved)
    const second = projectValid({ ...saved, instanceId: '550e8400-e29b-41d4-a716-446655440001' })
    expect(first.sessionId).toBe(second.sessionId)
    expect(compareCompletionContent(first, second)).toBe('different-instance')
    expect(compareCompletionContent(first, { ...second, instanceId: 'bad' })).toBe('invalid')
  })
})
