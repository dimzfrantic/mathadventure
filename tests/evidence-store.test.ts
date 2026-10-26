import { describe, expect, it } from 'vitest'
import { MemoryEvidenceStore } from '../src/learning/evidenceStore'
import { createTask, initialState, evaluateAttempt, reduceMatch } from '../src/learning/matching'

describe('in-memory evidence boundary', () => {
  it('saves a minimum result and checkpoint without UI event history', () => {
    const store = new MemoryEvidenceStore()
    const state = reduceMatch(initialState(createTask('balanced', 3, 3)), { type: 'pair', astronaut: 'a1', rocket: 'r1' })
    store.saveCheckpoint(state)
    expect(store.loadCheckpoint()?.pairs).toHaveLength(1)
    store.saveAttempt(evaluateAttempt(state, false))
    expect(store.getAttempts()).toHaveLength(1)
    expect(store.getAttempts()[0].outcome).toBe('inconclusive')
    expect(JSON.stringify(store.getAttempts())).not.toContain('history')
    store.saveCheckpoint(null)
    expect(store.loadCheckpoint()).toBeNull()
  })
})
