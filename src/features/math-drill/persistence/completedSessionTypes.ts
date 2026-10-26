import type { DrillLevel, Level5Sublevel, Operation, OperationMode } from '../domain/types'
import type { SavedSessionMode } from './sessionTypes'

export interface CompletedQuestionOutcome {
  readonly level: DrillLevel
  readonly operation: Operation
  readonly level5Sublevel?: Level5Sublevel
  readonly points: 0 | 0.5 | 1
}

/** Legacy immutable completion. Its shape and interpretation remain unchanged. */
export interface CompletedSessionRecordV1 {
  readonly historySchemaVersion: 1
  readonly instanceId: string
  readonly sessionId: string
  readonly mode: SavedSessionMode
  readonly operationMode: OperationMode
  /** Client clock at result commit, not practice duration. Null only for approved legacy backfill. */
  readonly completedAt: number | null
  /** Client clock when archival is attempted, not necessarily the practice date. */
  readonly recordedAt: number
  readonly provenance: 'new-atomic' | 'legacy-last-result'
  readonly outcomes: readonly CompletedQuestionOutcome[]
}

/** V2 terminal history retains planned coverage and timer facts without fabricating outcomes. */
export interface CompletedSessionRecordV2 {
  readonly historySchemaVersion: 2
  readonly instanceId: string
  readonly sessionId: string
  readonly mode: SavedSessionMode
  readonly operationMode: OperationMode
  readonly endReason: 'completed' | 'timeout'
  readonly plannedCount: number
  readonly completedCount: number
  readonly startedAt: number
  readonly durationMs: number | null
  readonly deadlineAt: number | null
  readonly endedAt: number
  readonly remainingMs: number | null
  /** Client clock when archival is attempted. */
  readonly recordedAt: number
  readonly outcomes: readonly CompletedQuestionOutcome[]
}

export type CompletedSessionRecord = CompletedSessionRecordV1 | CompletedSessionRecordV2
