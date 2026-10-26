import { describe, expect, it } from 'vitest'
import { answerQuestion, createScoreState, generateChallengeSession, generateSession } from '../src/features/math-drill/domain'
import { validateSavedSession } from '../src/features/math-drill/persistence/sessionCodec'

type Mode = 'regular' | 'challenge'

function fixture(mode: Mode) {
  const generated = mode === 'regular'
    ? generateSession({ level: 1, mode: 'addition', count: 2, seed: 41, roundSize: 1 })
    : generateChallengeSession({ selectedLevels: [1], selectedLevel5Sublevels: [], mode: 'mixed', count: 10, seed: 42, roundSize: 2 })
  if (!generated.ok) throw new Error(`Fixture generation failed: ${generated.error.code}`)
  const session = generated.session
  return {
    schemaVersion: 1,
    mode,
    instanceId: '550e8400-e29b-41d4-a716-446655440000',
    sessionId: session.id,
    revision: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    session,
    score: createScoreState(session),
    cursor: { questionIndex: 0, phase: 'answering', pendingAdvanceAt: null },
  }
}

function changed(mode: Mode, mutate: (record: Record<string, unknown>) => void) {
  const record = structuredClone(fixture(mode)) as unknown as Record<string, unknown>
  mutate(record)
  return record
}

function questionOf(record: Record<string, unknown>, index = 0): Record<string, unknown> {
  const session = record.session as { questions: Record<string, unknown>[] }
  return session.questions[index]
}

function cursorOf(record: Record<string, unknown>): Record<string, unknown> {
  return record.cursor as Record<string, unknown>
}

function scoreOf(record: Record<string, unknown>): Record<string, unknown> {
  return record.score as Record<string, unknown>
}

function responsesOf(record: Record<string, unknown>): Record<string, unknown> {
  return scoreOf(record).responses as Record<string, unknown>
}

function expectCorrupt(value: unknown) {
  const result = validateSavedSession(value)
  expect(result.status).toBe('corrupt')
}

describe('SavedSessionV1 runtime codec', () => {
  it('accepts a generated Regular record without regenerating it', () => {
    const record = fixture('regular')
    const result = validateSavedSession(record)
    expect(result.status).toBe('valid')
    if (result.status === 'valid') expect(result.value).toEqual(record)
  })

  it('accepts a generated Challenge record and retains its domain versions', () => {
    const record = fixture('challenge')
    const result = validateSavedSession(record)
    expect(result.status).toBe('valid')
    if (result.status === 'valid') {
      expect(result.value.session).toMatchObject({ kind: 'challenge', version: 1, policyVersion: 1 })
      expect(result.value.session).toEqual(record.session)
    }
  })

  it('classifies an unknown positive storage schema version as unsupported', () => {
    const result = validateSavedSession({ ...fixture('regular'), schemaVersion: 3 })
    expect(result).toMatchObject({ status: 'unsupported-version', version: 3, versionKind: 'schema' })
  })

  it.each([null, undefined, 0, 'record', [], { schemaVersion: 1 }])('returns corrupt rather than throwing for malformed top-level data %#', value => {
    expect(() => validateSavedSession(value)).not.toThrow()
    expectCorrupt(value)
  })

  it('rejects a mode that does not match the stored session shape', () => {
    expectCorrupt(changed('regular', record => { record.mode = 'challenge' }))
    expectCorrupt(changed('challenge', record => { record.mode = 'regular' }))
  })

  it.each(['', 'not-an-instance-id', '550e8400-e29b-11d4-a716-446655440000', '550e8400-e29b-41d4-c716-446655440000'])('rejects invalid instanceId %s', instanceId => {
    expectCorrupt(changed('regular', record => { record.instanceId = instanceId }))
  })

  it('rejects missing or mismatched domain session IDs', () => {
    expectCorrupt(changed('regular', record => { record.sessionId = '' }))
    expectCorrupt(changed('regular', record => { record.sessionId = 'another-session' }))
    expectCorrupt(changed('challenge', record => {
      const score = scoreOf(record)
      score.sessionId = 'another-session'
    }))
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid revision %s', revision => {
    expectCorrupt(changed('regular', record => { record.revision = revision }))
  })

  it('rejects non-finite or reversed timestamps', () => {
    expectCorrupt(changed('regular', record => { record.createdAt = Number.NaN }))
    expectCorrupt(changed('regular', record => { record.updatedAt = Number.POSITIVE_INFINITY }))
    expectCorrupt(changed('regular', record => { record.updatedAt = 1 }))
  })

  it('rejects an empty question list and duplicate question keys', () => {
    expectCorrupt(changed('regular', record => {
      (record.session as { questions: unknown[] }).questions = []
      ;(record.session as { rounds: unknown[] }).rounds = []
    }))
    expectCorrupt(changed('regular', record => {
      const questions = (record.session as { questions: Record<string, unknown>[] }).questions
      questions[1].key = questions[0].key
    }))
  })

  it('requires four distinct finite numeric choices and a valid answer index', () => {
    expectCorrupt(changed('regular', record => { questionOf(record).choices = [1, 2, 3] }))
    expectCorrupt(changed('regular', record => { questionOf(record).choices = [1, 2, 2, 4] }))
    expectCorrupt(changed('regular', record => { questionOf(record).choices = [1, 2, 3, Number.NaN] }))
    expectCorrupt(changed('regular', record => { questionOf(record).correctChoiceIndex = 4 }))
    expectCorrupt(changed('regular', record => { questionOf(record).answer = -999 }))
  })

  it('requires the flattened rounds to match question order and round boundaries', () => {
    expectCorrupt(changed('regular', record => {
      const session = record.session as { rounds: Record<string, unknown>[][] }
      session.rounds[0][0] = session.rounds[0][1]
    }))
    expectCorrupt(changed('challenge', record => {
      const session = record.session as { rounds: Record<string, unknown>[][] }
      session.rounds.reverse()
    }))
    expectCorrupt(changed('challenge', record => {
      const session = record.session as { rounds: Record<string, unknown>[][] }
      session.rounds[0].pop()
    }))
    expectCorrupt(changed('regular', record => {
      const session = record.session as { rounds: Record<string, unknown>[][] }
      session.rounds[0][0] = structuredClone(session.rounds[0][0])
      session.rounds[0][0].operands = [999, 999]
    }))
  })

  it('rejects score responses for question keys outside the session', () => {
    expectCorrupt(changed('regular', record => {
      responsesOf(record).outside = { status: 'completed', attempts: [0], points: 1 }
    }))
  })

  it('rejects attempts that are empty, over limit, repeated, or out of range', () => {
    const base = fixture('regular')
    const q = base.session.questions[0]
    const wrong = q.choices.findIndex((_, index) => index !== q.correctChoiceIndex)
    const otherWrong = q.choices.findIndex((_, index) => index !== q.correctChoiceIndex && index !== wrong)
    for (const attempts of [[], [wrong, wrong], [wrong, otherWrong, 0], [4]]) {
      expectCorrupt(changed('regular', record => {
        responsesOf(record)[q.key] = { status: 'completed', attempts, points: 0 }
        cursorOf(record).phase = 'manual-advance'
      }))
    }
  })

  it('checks response points and status against the actual answer choices', () => {
    const record = fixture('regular')
    const q = record.session.questions[0]
    const wrong = q.choices.findIndex((_, index) => index !== q.correctChoiceIndex)
    const secondWrong = q.choices.findIndex((_, index) => index !== q.correctChoiceIndex && index !== wrong)
    const firstWrongState = answerQuestion(record.score, record.session, q.key, wrong)
    if (!firstWrongState.ok) throw new Error(firstWrongState.error.code)
    const oneWrong = structuredClone(record) as typeof record
    oneWrong.score = firstWrongState.state
    oneWrong.cursor.phase = 'retry-prompt'
    expect(validateSavedSession(oneWrong).status).toBe('valid')

    const wrongTwiceState = answerQuestion(firstWrongState.state, record.session, q.key, secondWrong)
    if (!wrongTwiceState.ok) throw new Error(wrongTwiceState.error.code)
    const wrongTwice = structuredClone(record) as typeof record
    wrongTwice.score = wrongTwiceState.state
    wrongTwice.cursor.phase = 'manual-advance'
    expect(validateSavedSession(wrongTwice).status).toBe('valid')

    const invalidPoints = structuredClone(wrongTwice) as typeof wrongTwice
    ;(invalidPoints.score.responses[q.key] as { points: number }).points = 1
    expectCorrupt(invalidPoints)
  })

  it('accepts a correct response with a pending deadline and rejects deadlines in other phases', () => {
    const record = fixture('regular')
    const q = record.session.questions[0]
    const answered = answerQuestion(record.score, record.session, q.key, q.correctChoiceIndex)
    if (!answered.ok) throw new Error(answered.error.code)
    record.score = answered.state
    record.cursor.phase = 'auto-advance'
    record.cursor.pendingAdvanceAt = record.updatedAt + 700
    expect(validateSavedSession(record).status).toBe('valid')

    const misplaced = structuredClone(record)
    misplaced.cursor.phase = 'answering'
    expectCorrupt(misplaced)
    const absent = structuredClone(record)
    absent.cursor.pendingAdvanceAt = null
    expectCorrupt(absent)
  })

  it('rejects cursor positions and phases that contradict question progress', () => {
    expectCorrupt(changed('regular', record => { cursorOf(record).questionIndex = 2 }))
    expectCorrupt(changed('regular', record => { cursorOf(record).phase = 'retry-prompt' }))
    expectCorrupt(changed('regular', record => { cursorOf(record).phase = 'manual-advance' }))
    expectCorrupt(changed('regular', record => { cursorOf(record).phase = 'auto-advance'; cursorOf(record).pendingAdvanceAt = 1 }))
    expectCorrupt(changed('regular', record => { cursorOf(record).phase = 'round' }))
  })

  it('accepts a round cursor only at a completed non-final round boundary', () => {
    const record = fixture('regular')
    const q = record.session.questions[0]
    const answered = answerQuestion(record.score, record.session, q.key, q.correctChoiceIndex)
    if (!answered.ok) throw new Error(answered.error.code)
    record.score = answered.state
    record.cursor.phase = 'round'
    expect(validateSavedSession(record).status).toBe('valid')

    const invalid = structuredClone(record)
    invalid.cursor.questionIndex = 1
    expectCorrupt(invalid)
  })

  it('accepts result only when every question is completed', () => {
    const record = fixture('regular')
    let score = record.score
    for (const q of record.session.questions) {
      const answered = answerQuestion(score, record.session, q.key, q.correctChoiceIndex)
      if (!answered.ok) throw new Error(answered.error.code)
      score = answered.state
    }
    record.score = score
    record.cursor.questionIndex = record.session.questions.length - 1
    record.cursor.phase = 'result'
    expect(validateSavedSession(record).status).toBe('valid')

    const incomplete = fixture('regular')
    incomplete.cursor.phase = 'result'
    incomplete.cursor.questionIndex = incomplete.session.questions.length - 1
    expectCorrupt(incomplete)
  })
})
