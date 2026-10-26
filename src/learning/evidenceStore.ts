import type { MatchState, Outcome, Side } from './matching'

export type AttemptEvidence = Readonly<{
  attemptId: string
  taskId: string
  variantId: string
  outcome: Outcome
  valid: boolean | null
  hintLevel: 0 | 1 | 2
  hintHistoryLevel: 0 | 1 | 2
  pairCount: number
  identifiedRemainder: Side | null
  repeatedVariant: boolean
  countsAsFreshIndependent: boolean
}>

export type AttemptDraft = Omit<AttemptEvidence, 'attemptId'>

export interface EvidenceStore {
  saveAttempt(attempt: AttemptDraft): AttemptEvidence
  getAttempts(): readonly AttemptEvidence[]
  saveCheckpoint(state: MatchState | null): void
  loadCheckpoint(): MatchState | null
}

function cloneState(state: MatchState): MatchState {
  return {
    ...state,
    task: { ...state.task, astronauts: [...state.task.astronauts], rockets: [...state.task.rockets] },
    pairs: state.pairs.map(pair => ({ ...pair })),
    history: state.history.map(snapshot => ({ ...snapshot, pairs: snapshot.pairs.map(pair => ({ ...pair })) })),
  }
}

// Keadaan hanya hidup selama komponen/aplikasi ini terbuka. Refresh meniadakannya.
export class MemoryEvidenceStore implements EvidenceStore {
  private attempts: AttemptEvidence[] = []
  private checkpoint: MatchState | null = null
  private nextAttemptNumber = 1

  saveAttempt(attempt: AttemptDraft): AttemptEvidence {
    const saved = { ...attempt, attemptId: `attempt-${this.nextAttemptNumber++}` }
    this.attempts.push(saved)
    return { ...saved }
  }
  getAttempts(): readonly AttemptEvidence[] {
    return this.attempts.map(attempt => ({ ...attempt }))
  }
  saveCheckpoint(state: MatchState | null): void {
    if (!state) { this.checkpoint = null; return }
    this.checkpoint = cloneState(state)
  }
  loadCheckpoint(): MatchState | null {
    return this.checkpoint ? cloneState(this.checkpoint) : null
  }
}
