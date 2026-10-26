import type { ChallengeSession } from '../domain/challenge-types'
import type { DrillSession, ScoreState } from '../domain/types'
import type { SessionTiming } from './sessionTimer'

export type SavedSessionMode = 'regular' | 'challenge'

export type SavedSessionPhase =
  | 'answering'
  | 'retry-prompt'
  | 'auto-advance'
  | 'manual-advance'
  | 'round'
  | 'result'
  | 'timeout'

export interface SavedSessionCursor {
  readonly questionIndex: number
  readonly phase: SavedSessionPhase
  readonly pendingAdvanceAt: number | null
}

interface SavedSessionBaseV1 {
  readonly schemaVersion: 1
  readonly instanceId: string
  readonly sessionId: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly score: ScoreState
  readonly cursor: SavedSessionCursor
}

interface SavedSessionBaseV2 {
  readonly schemaVersion: 2
  readonly instanceId: string
  readonly sessionId: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly score: ScoreState
  readonly cursor: SavedSessionCursor
  readonly timing: SessionTiming
}

export interface SavedRegularSessionV1 extends SavedSessionBaseV1 {
  readonly mode: 'regular'
  readonly session: DrillSession
}
export interface SavedChallengeSessionV1 extends SavedSessionBaseV1 {
  readonly mode: 'challenge'
  readonly session: ChallengeSession
}
export type SavedSessionV1 = SavedRegularSessionV1 | SavedChallengeSessionV1

export interface SavedRegularSessionV2 extends SavedSessionBaseV2 {
  readonly mode: 'regular'
  readonly session: DrillSession
}
export interface SavedChallengeSessionV2 extends SavedSessionBaseV2 {
  readonly mode: 'challenge'
  readonly session: ChallengeSession
}
export type SavedSessionV2 = SavedRegularSessionV2 | SavedChallengeSessionV2
export type SavedSession = SavedSessionV1 | SavedSessionV2

export type SavedSessionValidation =
  | { readonly status: 'valid'; readonly value: SavedSession }
  | {
      readonly status: 'unsupported-version'
      readonly versionKind: 'schema' | 'challenge-session' | 'challenge-policy'
      readonly version: number
    }
  | { readonly status: 'corrupt'; readonly issues: readonly string[] }
