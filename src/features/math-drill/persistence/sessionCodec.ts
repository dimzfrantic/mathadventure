import type { ChallengeQuota, ChallengeSession } from '../domain/challenge-types'
import type { DrillQuestion, DrillSession, Operation, OperationMode, QuestionResponse, ScoreState } from '../domain/types'
import type { SavedSessionValidation, SavedSession } from './sessionTypes'
import { isValidSessionDurationMs } from './sessionTimer'
import type { SessionTiming } from './sessionTimer'

type UnknownRecord = Record<string, unknown>
type QuestionLike = DrillQuestion & { readonly semanticKey?: string; readonly factKey?: string; readonly level5Sublevel?: string; readonly sourceSublevels?: readonly string[] }

const levels = [1, 2, 3, 4, 5] as const
const sublevels = ['dasar', 'menengah', 'lanjutan'] as const
const operations: readonly Operation[] = ['addition', 'subtraction']
const modes: readonly OperationMode[] = ['addition', 'subtraction', 'mixed']
const phases = ['answering', 'retry-prompt', 'auto-advance', 'manual-advance', 'round', 'result', 'timeout'] as const
const challengeCounts = [10, 20, 30, 50] as const
const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i

class InvalidRecord extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.code = code
  }
}

function invalid(code: string): never {
  throw new InvalidRecord(code)
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonEmptyString(value: unknown, maxLength = 512): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maxLength
    && !Array.from(value).some(character => {
      const code = character.charCodeAt(0)
      return code <= 0x1f || code === 0x7f
    })
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
}

function isOneOf<T extends string | number>(value: unknown, allowed: readonly T[]): value is T {
  return allowed.some(item => item === value)
}

function requireRecord(value: unknown, code: string): UnknownRecord {
  if (!isRecord(value)) invalid(code)
  return value
}

function validateRegularQuota(value: unknown): void {
  if (value === undefined) return
  const quota = requireRecord(value, 'REGULAR_QUOTA_INVALID')
  for (const key of ['targetBridge', 'actualBridge', 'actualReinforcement'] as const) {
    if (!isIntegerInRange(quota[key], 0, Number.MAX_SAFE_INTEGER)) invalid('REGULAR_QUOTA_INVALID')
  }
  if (!isFiniteNumber(quota.actualBridgeRatio) || quota.actualBridgeRatio < 0 || quota.actualBridgeRatio > 1) invalid('REGULAR_QUOTA_INVALID')
  const byOperation = requireRecord(quota.byOperation, 'REGULAR_QUOTA_INVALID')
  for (const operation of operations) {
    const item = requireRecord(byOperation[operation], 'REGULAR_QUOTA_INVALID')
    if (!isIntegerInRange(item.targetBridge, 0, Number.MAX_SAFE_INTEGER) || !isIntegerInRange(item.actualBridge, 0, Number.MAX_SAFE_INTEGER)) invalid('REGULAR_QUOTA_INVALID')
  }
}

function validateChallengeQuota(value: unknown): asserts value is ChallengeQuota {
  const quota = requireRecord(value, 'CHALLENGE_QUOTA_INVALID')
  const byLevel = requireRecord(quota.byLevel, 'CHALLENGE_QUOTA_INVALID')
  const bySublevel = requireRecord(quota.bySublevel, 'CHALLENGE_QUOTA_INVALID')
  const byOperation = requireRecord(quota.byOperation, 'CHALLENGE_QUOTA_INVALID')
  for (const level of levels) if (!isIntegerInRange(byLevel[level], 0, Number.MAX_SAFE_INTEGER)) invalid('CHALLENGE_QUOTA_INVALID')
  for (const sublevel of sublevels) if (!isIntegerInRange(bySublevel[sublevel], 0, Number.MAX_SAFE_INTEGER)) invalid('CHALLENGE_QUOTA_INVALID')
  for (const operation of operations) if (!isIntegerInRange(byOperation[operation], 0, Number.MAX_SAFE_INTEGER)) invalid('CHALLENGE_QUOTA_INVALID')
  const level2Bridge = requireRecord(quota.level2Bridge, 'CHALLENGE_QUOTA_INVALID')
  for (const key of ['target', 'actual', 'reinforcement'] as const) {
    if (!isIntegerInRange(level2Bridge[key], 0, Number.MAX_SAFE_INTEGER)) invalid('CHALLENGE_QUOTA_INVALID')
  }
}

function validateQuestion(value: unknown, challenge: boolean): asserts value is QuestionLike {
  const question = requireRecord(value, 'QUESTION_INVALID')
  if (!isNonEmptyString(question.key)) invalid('QUESTION_KEY_INVALID')
  if (!isIntegerInRange(question.level, 1, 5)) invalid('QUESTION_LEVEL_INVALID')
  if (!isOneOf(question.operation, operations)) invalid('QUESTION_OPERATION_INVALID')
  if (!isNonEmptyString(question.prompt)) invalid('QUESTION_PROMPT_INVALID')
  if (!Array.isArray(question.operands) || question.operands.length === 0 || !question.operands.every(isFiniteNumber)) invalid('QUESTION_OPERANDS_INVALID')
  if (!isFiniteNumber(question.answer)) invalid('QUESTION_ANSWER_INVALID')
  if (!Array.isArray(question.choices) || question.choices.length !== 4 || !question.choices.every(isFiniteNumber) || new Set(question.choices).size !== 4) invalid('QUESTION_CHOICES_INVALID')
  if (!isIntegerInRange(question.correctChoiceIndex, 0, 3) || question.choices[question.correctChoiceIndex] !== question.answer) invalid('QUESTION_CORRECT_CHOICE_INVALID')
  if (!Array.isArray(question.skillTags) || !question.skillTags.every(tag => isNonEmptyString(tag))) invalid('QUESTION_SKILL_TAGS_INVALID')

  if (challenge) {
    if (!isNonEmptyString(question.semanticKey) || !isNonEmptyString(question.factKey)) invalid('CHALLENGE_QUESTION_IDENTITY_INVALID')
    if (question.level5Sublevel !== undefined && !isOneOf(question.level5Sublevel, sublevels)) invalid('CHALLENGE_QUESTION_SUBLEVEL_INVALID')
    if (question.sourceSublevels !== undefined && (!Array.isArray(question.sourceSublevels) || !question.sourceSublevels.every(item => isOneOf(item, sublevels)) || new Set(question.sourceSublevels).size !== question.sourceSublevels.length)) invalid('CHALLENGE_QUESTION_SOURCES_INVALID')
    if (question.level === 5 && question.level5Sublevel === undefined) invalid('CHALLENGE_QUESTION_SUBLEVEL_INVALID')
    if (question.level !== 5 && (question.level5Sublevel !== undefined || question.sourceSublevels !== undefined)) invalid('CHALLENGE_QUESTION_SUBLEVEL_INVALID')
  }
}

function sameArray(left: readonly unknown[] | undefined, right: readonly unknown[] | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function sameQuestionInRound(roundQuestion: QuestionLike, question: QuestionLike): boolean {
  return roundQuestion.key === question.key
    && roundQuestion.level === question.level
    && roundQuestion.operation === question.operation
    && roundQuestion.prompt === question.prompt
    && sameArray(roundQuestion.operands, question.operands)
    && roundQuestion.answer === question.answer
    && roundQuestion.correctChoiceIndex === question.correctChoiceIndex
    && sameArray(roundQuestion.choices, question.choices)
    && sameArray(roundQuestion.skillTags, question.skillTags)
    && roundQuestion.semanticKey === question.semanticKey
    && roundQuestion.factKey === question.factKey
    && roundQuestion.level5Sublevel === question.level5Sublevel
    && sameArray(roundQuestion.sourceSublevels, question.sourceSublevels)
}

function validateRounds(session: UnknownRecord, questions: readonly QuestionLike[]): void {
  const roundSize = session.roundSize
  if (!isIntegerInRange(roundSize, 1, 20)) invalid('ROUND_SIZE_INVALID')
  const rounds = session.rounds
  const expectedRoundCount = Math.ceil(questions.length / roundSize)
  if (!Array.isArray(rounds) || rounds.length !== expectedRoundCount) invalid('ROUNDS_INVALID')
  let questionOffset = 0
  for (const roundValue of rounds) {
    if (!Array.isArray(roundValue) || roundValue.length === 0 || roundValue.length > roundSize) invalid('ROUNDS_INVALID')
    for (const roundQuestionValue of roundValue) {
      const question = questions[questionOffset]
      if (!question) invalid('ROUNDS_INVALID')
      validateQuestion(roundQuestionValue, session.kind === 'challenge')
      if (!sameQuestionInRound(roundQuestionValue, question)) invalid('ROUND_QUESTION_ORDER_INVALID')
      questionOffset += 1
    }
  }
  if (questionOffset !== questions.length) invalid('ROUNDS_INVALID')
}

function validateSession(value: unknown, mode: unknown): { session: DrillSession | ChallengeSession; questions: readonly QuestionLike[] } {
  const session = requireRecord(value, 'SESSION_INVALID')
  if (!isNonEmptyString(session.id)) invalid('SESSION_ID_INVALID')
  if (!isIntegerInRange(session.seed, 0, 0xffff_ffff)) invalid('SESSION_SEED_INVALID')
  if (!Array.isArray(session.questions) || session.questions.length === 0) invalid('SESSION_QUESTIONS_INVALID')
  if (!Array.isArray(session.questions)) invalid('SESSION_QUESTIONS_INVALID')

  const challenge = mode === 'challenge'
  if (challenge) {
    if (session.kind !== 'challenge') invalid('MODE_SESSION_MISMATCH')
    if (!isIntegerInRange(session.version, 1, Number.MAX_SAFE_INTEGER)) invalid('CHALLENGE_VERSION_INVALID')
    if (session.version !== 1) return { session: session as unknown as ChallengeSession, questions: [] }
    if (!isIntegerInRange(session.policyVersion, 1, Number.MAX_SAFE_INTEGER)) invalid('CHALLENGE_POLICY_VERSION_INVALID')
    if (session.policyVersion !== 1) return { session: session as unknown as ChallengeSession, questions: [] }
    if (!Array.isArray(session.selectedLevels) || session.selectedLevels.length === 0 || !session.selectedLevels.every(level => isIntegerInRange(level, 1, 5)) || new Set(session.selectedLevels).size !== session.selectedLevels.length) invalid('CHALLENGE_LEVELS_INVALID')
    if (!Array.isArray(session.selectedLevel5Sublevels) || !session.selectedLevel5Sublevels.every(item => isOneOf(item, sublevels)) || new Set(session.selectedLevel5Sublevels).size !== session.selectedLevel5Sublevels.length) invalid('CHALLENGE_SUBLEVELS_INVALID')
    if (session.selectedLevels.includes(5) !== (session.selectedLevel5Sublevels.length > 0)) invalid('CHALLENGE_SUBLEVELS_INVALID')
    if (!isOneOf(session.mode, modes)) invalid('SESSION_MODE_INVALID')
    if (!isOneOf(session.questions.length, challengeCounts)) invalid('SESSION_COUNT_INVALID')
    validateChallengeQuota(session.quota)
  } else {
    if (mode !== 'regular' || session.kind !== undefined) invalid('MODE_SESSION_MISMATCH')
    if (!isIntegerInRange(session.level, 1, 5) || !isOneOf(session.mode, modes)) invalid('SESSION_CONFIGURATION_INVALID')
    if (!isIntegerInRange(session.questions.length, 1, 500)) invalid('SESSION_COUNT_INVALID')
    if (session.level5Sublevel !== undefined && (!isOneOf(session.level5Sublevel, sublevels) || session.level !== 5)) invalid('SESSION_SUBLEVEL_INVALID')
    validateRegularQuota(session.quota)
  }

  const questions: QuestionLike[] = []
  const keys = new Set<string>()
  for (const questionValue of session.questions) {
    validateQuestion(questionValue, challenge)
    const question = questionValue as QuestionLike
    if (keys.has(question.key)) invalid('QUESTION_KEY_DUPLICATE')
    if (challenge && (!(session.selectedLevels as unknown[]).includes(question.level) || (question.level === 5 && !(session.selectedLevel5Sublevels as unknown[]).includes(question.level5Sublevel)))) invalid('CHALLENGE_QUESTION_SELECTION_MISMATCH')
    if (session.mode === 'addition' && question.operation !== 'addition') invalid('QUESTION_OPERATION_MODE_MISMATCH')
    if (session.mode === 'subtraction' && question.operation !== 'subtraction') invalid('QUESTION_OPERATION_MODE_MISMATCH')
    if (!challenge && question.level !== session.level) invalid('QUESTION_LEVEL_MISMATCH')
    keys.add(question.key)
    questions.push(question)
  }
  validateRounds(session, questions)
  return { session: session as unknown as DrillSession | ChallengeSession, questions }
}

function validateScore(value: unknown, sessionId: string, questions: readonly QuestionLike[]): ReadonlyMap<string, QuestionResponse> {
  const score = requireRecord(value, 'SCORE_INVALID')
  if (score.sessionId !== sessionId) invalid('SCORE_SESSION_MISMATCH')
  const responses = requireRecord(score.responses, 'SCORE_RESPONSES_INVALID')
  const byKey = new Map(questions.map(question => [question.key, question]))
  const responseByKey = new Map<string, QuestionResponse>()

  for (const key of Object.keys(responses)) {
    const question = byKey.get(key)
    if (!question) invalid('RESPONSE_QUESTION_UNKNOWN')
    const response = requireRecord(responses[key], 'RESPONSE_INVALID')
    const attempts = response.attempts
    if (!Array.isArray(attempts) || (attempts.length !== 1 && attempts.length !== 2)) invalid('RESPONSE_ATTEMPTS_INVALID')
    if (!attempts.every(index => isIntegerInRange(index, 0, question.choices.length - 1)) || new Set(attempts).size !== attempts.length) invalid('RESPONSE_ATTEMPTS_INVALID')

    const firstCorrect = attempts[0] === question.correctChoiceIndex
    const secondCorrect = attempts.length === 2 && attempts[1] === question.correctChoiceIndex
    const expectedStatus = attempts.length === 1 && !firstCorrect ? 'awaiting-second-attempt' : 'completed'
    const expectedPoints = firstCorrect ? 1 : secondCorrect ? 0.5 : 0
    if (attempts.length === 2 && firstCorrect) invalid('RESPONSE_ATTEMPTS_INVALID')
    if (response.status !== expectedStatus || response.points !== expectedPoints) invalid('RESPONSE_POINTS_STATUS_MISMATCH')
    responseByKey.set(key, response as unknown as QuestionResponse)
  }
  return responseByKey
}

function validateTiming(value: unknown, phase: unknown): asserts value is SessionTiming {
  const timing = requireRecord(value, 'TIMING_INVALID')
  const fields = ['durationMs', 'startedAt', 'deadlineAt', 'endedAt', 'remainingMs', 'endReason']
  if (Object.keys(timing).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(timing, key))) invalid('TIMING_FIELDS_INVALID')
  const durationMs = timing.durationMs
  if (!isValidSessionDurationMs(durationMs)) invalid('TIMING_DURATION_INVALID')
  if (!isIntegerInRange(timing.startedAt, 0, Number.MAX_SAFE_INTEGER)) invalid('TIMING_STARTED_AT_INVALID')
  const deadlineAt = durationMs === null ? null : (timing.startedAt as number) + (durationMs as number)
  if (timing.deadlineAt !== deadlineAt || (deadlineAt !== null && !Number.isSafeInteger(deadlineAt))) invalid('TIMING_DEADLINE_INVALID')
  if (timing.endReason === null) {
    if (timing.endedAt !== null || timing.remainingMs !== null || phase === 'result' || phase === 'timeout') invalid('TIMING_TERMINAL_MISMATCH')
    return
  }
  if (!isIntegerInRange(timing.endedAt, timing.startedAt as number, Number.MAX_SAFE_INTEGER)) invalid('TIMING_ENDED_AT_INVALID')
  if (phase === 'result' && timing.endReason !== 'completed') invalid('TIMING_TERMINAL_MISMATCH')
  if (phase === 'timeout' && timing.endReason !== 'timeout') invalid('TIMING_TERMINAL_MISMATCH')
  if (phase !== 'result' && phase !== 'timeout') invalid('TIMING_TERMINAL_MISMATCH')
  if (durationMs === null) {
    if (timing.endReason !== 'completed' || timing.deadlineAt !== null || timing.remainingMs !== null) invalid('TIMING_UNLIMITED_INVALID')
  } else if (timing.endReason === 'completed') {
    if ((timing.endedAt as number) >= (deadlineAt as number) || timing.remainingMs !== (deadlineAt as number) - (timing.endedAt as number)) invalid('TIMING_REMAINING_INVALID')
  } else if ((timing.endedAt as number) < (deadlineAt as number) || timing.remainingMs !== 0) invalid('TIMING_TIMEOUT_INVALID')
}

function validateCursor(value: unknown, questions: readonly QuestionLike[], roundSize: number, responses: ReadonlyMap<string, QuestionResponse>, schemaVersion: number): void {
  const cursor = requireRecord(value, 'CURSOR_INVALID')
  const index = cursor.questionIndex
  if (!isIntegerInRange(index, 0, questions.length - 1)) invalid('CURSOR_INDEX_INVALID')
  if (!isOneOf(cursor.phase, phases)) invalid('CURSOR_PHASE_INVALID')
  const phase = cursor.phase
  const deadline = cursor.pendingAdvanceAt
  if (phase === 'auto-advance') {
    if (!isFiniteNumber(deadline)) invalid('DEADLINE_PHASE_MISMATCH')
  } else if (deadline !== null) {
    invalid('DEADLINE_PHASE_MISMATCH')
  }

  for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
    const response = responses.get(questions[questionIndex].key)
    if (questionIndex < index && response?.status !== 'completed') invalid('CURSOR_PROGRESS_MISMATCH')
    if (questionIndex > index && response !== undefined) invalid('CURSOR_PROGRESS_MISMATCH')
  }

  const current = responses.get(questions[index].key)
  if (phase === 'timeout') {
    if (schemaVersion !== 2) invalid('TIMEOUT_SCHEMA_UNSUPPORTED')
    if (current && current.status !== 'completed' && current.status !== 'awaiting-second-attempt') invalid('CURSOR_PHASE_MISMATCH')
    return
  }
  if (phase === 'answering') {
    if (current && !(current.status === 'awaiting-second-attempt' && current.attempts.length === 1 && current.points === 0)) invalid('CURSOR_PHASE_MISMATCH')
  } else if (phase === 'retry-prompt') {
    if (!current || current.status !== 'awaiting-second-attempt' || current.attempts.length !== 1 || current.points !== 0) invalid('CURSOR_PHASE_MISMATCH')
  } else if (phase === 'auto-advance') {
    if (!current || current.status !== 'completed' || current.points <= 0) invalid('CURSOR_PHASE_MISMATCH')
  } else if (phase === 'manual-advance') {
    if (!current || current.status !== 'completed' || current.points !== 0) invalid('CURSOR_PHASE_MISMATCH')
  } else if (phase === 'round') {
    if ((index + 1) % roundSize !== 0 || index + 1 >= questions.length || current?.status !== 'completed') invalid('CURSOR_ROUND_INVALID')
  } else if (phase === 'result') {
    if (index !== questions.length - 1 || questions.some(question => responses.get(question.key)?.status !== 'completed')) invalid('CURSOR_RESULT_INCOMPLETE')
  }
}

/** Validates an untrusted persisted value without invoking domain generation or scoring. */
export function validateSavedSession(value: unknown): SavedSessionValidation {
  try {
    if (!isRecord(value)) return { status: 'corrupt', issues: ['RECORD_NOT_OBJECT'] }
    const schemaVersion = value.schemaVersion
    if (!Number.isSafeInteger(schemaVersion) || (schemaVersion as number) < 1) return { status: 'corrupt', issues: ['SCHEMA_VERSION_INVALID'] }
    if (schemaVersion !== 1 && schemaVersion !== 2) return { status: 'unsupported-version', versionKind: 'schema', version: schemaVersion as number }

    if (value.mode !== 'regular' && value.mode !== 'challenge') invalid('MODE_INVALID')
    if (typeof value.instanceId !== 'string' || !uuidV4.test(value.instanceId)) invalid('INSTANCE_ID_INVALID')
    if (!isNonEmptyString(value.sessionId)) invalid('SESSION_ID_INVALID')
    if (!isIntegerInRange(value.revision, 1, Number.MAX_SAFE_INTEGER)) invalid('REVISION_INVALID')
    if (!isFiniteNumber(value.createdAt) || !isFiniteNumber(value.updatedAt) || value.updatedAt < value.createdAt) invalid('TIMESTAMPS_INVALID')

    const validatedSession = validateSession(value.session, value.mode)
    if (validatedSession.questions.length === 0) {
      const session = value.session as UnknownRecord
      if (value.mode === 'challenge' && isIntegerInRange(session.version, 1, Number.MAX_SAFE_INTEGER) && session.version !== 1) {
        return { status: 'unsupported-version', versionKind: 'challenge-session', version: session.version }
      }
      if (value.mode === 'challenge' && isIntegerInRange(session.policyVersion, 1, Number.MAX_SAFE_INTEGER) && session.policyVersion !== 1) {
        return { status: 'unsupported-version', versionKind: 'challenge-policy', version: session.policyVersion }
      }
      invalid('SESSION_INVALID')
    }
    if (value.sessionId !== validatedSession.session.id) invalid('SESSION_ID_MISMATCH')
    const score = requireRecord(value.score, 'SCORE_INVALID') as unknown as ScoreState
    const responses = validateScore(score, value.sessionId, validatedSession.questions)
    validateCursor(value.cursor, validatedSession.questions, validatedSession.session.roundSize, responses, schemaVersion as number)
    if (schemaVersion === 2) validateTiming(value.timing, (value.cursor as UnknownRecord).phase)

    return { status: 'valid', value: value as unknown as SavedSession }
  } catch (error) {
    return { status: 'corrupt', issues: [error instanceof InvalidRecord ? error.code : 'MALFORMED_RECORD'] }
  }
}
