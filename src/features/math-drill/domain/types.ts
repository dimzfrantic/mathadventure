export type DrillLevel = 1 | 2 | 3 | 4 | 5
export type Level5Sublevel = 'dasar' | 'menengah' | 'lanjutan'
export type Operation = 'addition' | 'subtraction'
export type OperationMode = Operation | 'mixed'
export type SkillTag = 'basic-fact' | 'bridge-over-10' | 'crosses-10' | 'two-digit-no-regroup' | 'carry' | 'borrow' | 'missing-addend' | 'missing-minuend' | 'missing-subtrahend'

export interface DrillQuestion {
  readonly key: string
  readonly level: DrillLevel
  readonly operation: Operation
  readonly prompt: string
  readonly operands: readonly number[]
  readonly answer: number
  readonly choices: readonly number[]
  readonly correctChoiceIndex: number
  readonly skillTags: readonly SkillTag[]
}

export interface DrillSession {
  readonly id: string
  readonly seed: number
  readonly level: DrillLevel
  readonly mode: OperationMode
  readonly questions: readonly DrillQuestion[]
  readonly level5Sublevel?: Level5Sublevel
  readonly rounds: readonly (readonly DrillQuestion[])[]
  readonly roundSize: number
  readonly quota?: { readonly targetBridge: number; readonly actualBridge: number; readonly actualReinforcement: number; readonly actualBridgeRatio: number; readonly byOperation: Readonly<Record<Operation, { readonly targetBridge: number; readonly actualBridge: number }>> }
}

export interface GenerateRequest {
  readonly level: DrillLevel
  readonly level5Sublevel?: Level5Sublevel
  readonly mode: OperationMode
  readonly count: number
  readonly seed: number
  readonly roundSize?: number
}

export interface GeneratorError {
  readonly code: 'INVALID_COUNT' | 'INVALID_SEED' | 'INVALID_ROUND_SIZE' | 'INSUFFICIENT_CAPACITY' | 'UNSATISFIABLE_SKILL_QUOTA' | 'INSUFFICIENT_DISTRACTORS' | 'INVALID_REQUEST'
  readonly message: string
  readonly capacity: number
  readonly requested: number
  readonly detail?: Readonly<Record<string, number | string>>
}

export type GenerateResult = { readonly ok: true; readonly session: DrillSession } | { readonly ok: false; readonly error: GeneratorError }
export type ValidationResult = { readonly ok: true; readonly capacity: number; readonly quotas?: { readonly targetBridge: number; readonly actualBridge: number; readonly reinforcement: number } } | { readonly ok: false; readonly error: GeneratorError }

export interface RandomSource {
  next(): number
  intBelow(maxExclusive: number): number
}

export type ResponseStatus = 'awaiting-second-attempt' | 'completed'
export interface QuestionResponse {
  readonly status: ResponseStatus
  readonly attempts: readonly number[]
  readonly points: 0 | 0.5 | 1
}
export interface ScoreState {
  readonly sessionId: string
  readonly responses: Readonly<Record<string, QuestionResponse>>
}
export interface ScoreMetrics {
  readonly planned: number
  readonly completed: number
  readonly firstTryCorrect: number
  readonly secondTryCorrect: number
  readonly wrongTwice: number
  readonly unanswered: number
  readonly inProgress: number
  readonly firstTryAccuracy: number
  readonly successWithinTwoAttempts: number
  readonly weightedScore: number
  readonly errorsBySkillTag: Readonly<Record<string, number>>
}
export type ScoreErrorCode = 'QUESTION_NOT_IN_SESSION' | 'INVALID_CHOICE_INDEX' | 'DUPLICATE_ANSWER' | 'QUESTION_ALREADY_COMPLETED' | 'NO_ATTEMPT_AVAILABLE' | 'SESSION_MISMATCH'
export type AnswerResult = { readonly ok: true; readonly state: ScoreState } | { readonly ok: false; readonly error: { readonly code: ScoreErrorCode; readonly message: string } }
