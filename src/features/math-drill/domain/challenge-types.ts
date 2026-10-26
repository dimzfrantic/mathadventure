import type { DrillLevel, DrillQuestion, Level5Sublevel, Operation, OperationMode } from './types'

export interface ChallengeSelection {
  readonly selectedLevels: readonly DrillLevel[]
  readonly selectedLevel5Sublevels: readonly Level5Sublevel[]
  readonly mode: OperationMode
}

export interface ChallengeRequest extends ChallengeSelection {
  readonly count: 10 | 20 | 30 | 50
  readonly seed: number
  readonly roundSize?: number
}

export interface ChallengeQuestion extends DrillQuestion {
  readonly semanticKey: string
  readonly factKey: string
  readonly level5Sublevel?: Level5Sublevel
  readonly sourceSublevels?: readonly Level5Sublevel[]
}

export interface ChallengeQuota {
  readonly byLevel: Readonly<Record<DrillLevel, number>>
  readonly bySublevel: Readonly<Record<Level5Sublevel, number>>
  readonly byOperation: Readonly<Record<Operation, number>>
  readonly level2Bridge: { readonly target: number; readonly actual: number; readonly reinforcement: number }
}

export interface ChallengeSession {
  readonly kind: 'challenge'
  readonly version: 1
  readonly policyVersion: 1
  readonly id: string
  readonly seed: number
  readonly selectedLevels: readonly DrillLevel[]
  readonly selectedLevel5Sublevels: readonly Level5Sublevel[]
  readonly mode: OperationMode
  readonly questions: readonly ChallengeQuestion[]
  readonly rounds: readonly (readonly ChallengeQuestion[])[]
  readonly roundSize: number
  readonly quota: ChallengeQuota
}

export interface ChallengeError {
  readonly code: 'INVALID_LEVELS' | 'MISSING_SUBLEVEL' | 'INVALID_SUBLEVELS' | 'INVALID_MODE' | 'INVALID_COUNT' | 'INVALID_SEED' | 'INVALID_ROUND_SIZE' | 'INSUFFICIENT_CAPACITY' | 'UNSATISFIABLE_ALLOCATION' | 'INSUFFICIENT_DISTRACTORS'
  readonly message: string
  readonly capacity: number
  readonly requested: number
  readonly detail?: Readonly<Record<string, number | string>>
}

export type ChallengeResult = { readonly ok: true; readonly session: ChallengeSession } | { readonly ok: false; readonly error: ChallengeError }
export type ChallengeValidation = { readonly ok: true; readonly capacity: number; readonly quota: ChallengeQuota } | { readonly ok: false; readonly error: ChallengeError }
export interface ChallengeCapacity {
  readonly feasibleCounts: readonly (10 | 20 | 30 | 50)[]
  readonly maxCount: number
  readonly uniqueByOperation: Readonly<Record<Operation, number>>
}

export interface ChallengeRate {
  readonly numerator: number
  readonly denominator: number
  readonly value: number | null
}
export interface ChallengeMetrics {
  readonly planned: number
  readonly attempted: number
  readonly completed: number
  readonly unanswered: number
  readonly inProgress: number
  readonly firstTryCorrect: number
  readonly secondTryCorrect: number
  readonly wrongTwice: number
  readonly firstTryAccuracy: ChallengeRate
  readonly weightedScore: ChallengeRate
  readonly successWithinTwoAttempts: ChallengeRate
}
export interface ChallengeSummary {
  readonly overall: ChallengeMetrics
  readonly byLevel: Readonly<Record<DrillLevel, ChallengeMetrics>>
  readonly bySublevel: Readonly<Record<Level5Sublevel, ChallengeMetrics>>
  readonly byOperation: Readonly<Record<Operation, ChallengeMetrics>>
}
