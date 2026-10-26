import type { DistributionAttemptDraft, DistributionState } from './distribution'

export type DistributionAttemptEvidence = Readonly<DistributionAttemptDraft & { attemptId: string }>

export interface DistributionEvidenceStore {
  saveAttempt(attempt: DistributionAttemptDraft): DistributionAttemptEvidence
  getAttempts(): readonly DistributionAttemptEvidence[]
  saveCheckpoint(state: DistributionState | null): void
  loadCheckpoint(): DistributionState | null
}

function cloneState(state: DistributionState): DistributionState {
  return {
    ...state,
    task: { ...state.task, recipients: [...state.task.recipients], items: [...state.task.items] },
    stock: [...state.stock],
    allocations: Object.fromEntries(Object.entries(state.allocations).map(([id, items]) => [id, [...items]])),
    history: state.history.map(snapshot => ({
      stock: [...snapshot.stock],
      allocations: Object.fromEntries(Object.entries(snapshot.allocations).map(([id, items]) => [id, [...items]])),
    })),
  }
}

// Attempt dan checkpoint hanya hidup selama halaman aplikasi tetap terbuka.
export class MemoryDistributionEvidenceStore implements DistributionEvidenceStore {
  private attempts: DistributionAttemptEvidence[] = []
  private checkpoint: DistributionState | null = null
  private nextAttemptNumber = 1

  saveAttempt(attempt: DistributionAttemptDraft): DistributionAttemptEvidence {
    const saved = { ...attempt, attemptId: `00.1-B-attempt-${this.nextAttemptNumber++}` }
    this.attempts.push(saved)
    return { ...saved }
  }

  getAttempts(): readonly DistributionAttemptEvidence[] {
    return this.attempts.map(attempt => ({ ...attempt }))
  }

  saveCheckpoint(state: DistributionState | null): void {
    this.checkpoint = state ? cloneState(state) : null
  }

  loadCheckpoint(): DistributionState | null {
    return this.checkpoint ? cloneState(this.checkpoint) : null
  }
}
