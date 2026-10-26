import { createDistributionTask, initialDistributionState, reduceDistribution, evaluateDistributionAttempt } from '../src/learning/distribution'
import { MemoryDistributionEvidenceStore } from '../src/learning/distributionEvidenceStore'

function completeState() {
  let state = initialDistributionState(createDistributionTask())
  for (let i = 1; i <= 5; i += 1) {
    state = reduceDistribution(state, { type: 'select-item', itemId: `item-${i}` })
    state = reduceDistribution(state, { type: 'assign', recipientId: `recipient-${i}` })
  }
  return state
}

describe('00.1-B memory evidence adapter', () => {
  it('assigns unique attempt identities and appends completed attempts', () => {
    const store = new MemoryDistributionEvidenceStore()
    const draft = evaluateDistributionAttempt(completeState())
    const first = store.saveAttempt(draft)
    const second = store.saveAttempt(draft)
    expect(first).toMatchObject({ attemptId: '00.1-B-attempt-1', taskId: '00.1-B', variantId: 'sufficient' })
    expect(second.attemptId).toBe('00.1-B-attempt-2')
    expect(store.getAttempts()).toHaveLength(2)
  })

  it('does not create evidence when only a checkpoint is saved', () => {
    const store = new MemoryDistributionEvidenceStore()
    store.saveCheckpoint(completeState())
    expect(store.getAttempts()).toHaveLength(0)
    expect(store.loadCheckpoint()?.stock).toHaveLength(0)
  })

  it('deep-clones a checkpoint so resume and undo remain stable', () => {
    const store = new MemoryDistributionEvidenceStore()
    let state = initialDistributionState(createDistributionTask())
    state = reduceDistribution(state, { type: 'select-item', itemId: 'item-1' })
    state = reduceDistribution(state, { type: 'assign', recipientId: 'recipient-1' })
    store.saveCheckpoint(state)
    const resumed = store.loadCheckpoint()!
    const undone = reduceDistribution(resumed, { type: 'undo' })
    expect(undone.stock).toContain('item-1')
    expect(undone.allocations['recipient-1']).toEqual([])
    expect(store.loadCheckpoint()?.allocations['recipient-1']).toEqual(['item-1'])
  })
})
