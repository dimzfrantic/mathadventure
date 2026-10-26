import {
  createDistributionTask,
  initialDistributionState,
  reduceDistribution,
  evaluateDistributionAttempt,
} from '../src/learning/distribution'

function allocate(state: ReturnType<typeof initialDistributionState>, item: string, recipient: string) {
  return reduceDistribution(reduceDistribution(state, { type: 'select-item', itemId: item }), { type: 'assign', recipientId: recipient })
}

function prepareCorrectDistribution() {
  let state = initialDistributionState(createDistributionTask())
  for (let i = 1; i <= 5; i += 1) state = allocate(state, `item-${i}`, `recipient-${i}`)
  return state
}

describe('00.1-B distribution rules', () => {
  it('creates the approved sufficient prototype with five recipients and five items', () => {
    const task = createDistributionTask()
    expect(task.taskId).toBe('00.1-B')
    expect(task.variantId).toBe('sufficient')
    expect(task.recipients).toHaveLength(5)
    expect(task.items).toHaveLength(5)
  })

  it('actively allocates one selected stock item to a chosen recipient', () => {
    const state = allocate(initialDistributionState(createDistributionTask()), 'item-1', 'recipient-2')
    expect(state.stock).not.toContain('item-1')
    expect(state.allocations['recipient-2']).toEqual(['item-1'])
  })

  it('keeps duplicate allocation visible and does not silently reject it', () => {
    let state = allocate(initialDistributionState(createDistributionTask()), 'item-1', 'recipient-1')
    state = allocate(state, 'item-2', 'recipient-1')
    expect(state.allocations['recipient-1']).toEqual(['item-1', 'item-2'])
    expect(state.stock).toHaveLength(3)
  })

  it('undo restores the prior allocation and return-to-stock repairs one item', () => {
    let state = allocate(initialDistributionState(createDistributionTask()), 'item-1', 'recipient-1')
    state = reduceDistribution(state, { type: 'undo' })
    expect(state.stock).toContain('item-1')
    expect(state.allocations['recipient-1']).toEqual([])
    state = allocate(state, 'item-1', 'recipient-1')
    state = reduceDistribution(state, { type: 'return-item', itemId: 'item-1' })
    expect(state.stock).toContain('item-1')
    expect(state.allocations['recipient-1']).toEqual([])
  })

  it('classifies correct distribution from the board snapshot without a separate learner report', () => {
    const result = evaluateDistributionAttempt(prepareCorrectDistribution())
    expect(result).toMatchObject({ taskId: '00.1-B', variantId: 'sufficient', valid: true, outcome: 'independent' })
    expect(result.countsAsFreshIndependent).toBe(true)
    expect(result).not.toHaveProperty('reviewAccurate')
    expect(result).not.toHaveProperty('reportedUnassignedItems')
  })

  it('classifies an uneven allocation from the board snapshot as incorrect', () => {
    let state = allocate(initialDistributionState(createDistributionTask()), 'item-1', 'recipient-1')
    state = allocate(state, 'item-2', 'recipient-1')
    for (let i = 3; i <= 5; i += 1) state = allocate(state, `item-${i}`, `recipient-${i}`)
    expect(evaluateDistributionAttempt(state)).toMatchObject({ valid: false, outcome: 'interpretable_incorrect' })
    expect(evaluateDistributionAttempt(state)).not.toHaveProperty('reviewAccurate')
  })

  it('keeps help history across retries and does not relabel assisted success as independent', () => {
    let state = reduceDistribution(initialDistributionState(createDistributionTask()), { type: 'hint' })
    state = reduceDistribution(state, { type: 'hint' })
    state = reduceDistribution(state, { type: 'retry' })
    expect(state).toMatchObject({ hintLevel: 0, hintHistoryLevel: 2, repeatedVariant: true })
    const corrected = { ...prepareCorrectDistribution(), repeatedVariant: true, hintHistoryLevel: 2 as const }
    expect(evaluateDistributionAttempt(corrected)).toMatchObject({ outcome: 'guided', hintLevel: 0, hintHistoryLevel: 2, countsAsFreshIndependent: false })
  })

  it('repairs one incorrect placement directly without clearing other allocations', () => {
    let state = allocate(initialDistributionState(createDistributionTask()), 'item-1', 'recipient-1')
    state = allocate(state, 'item-2', 'recipient-1')
    state = allocate(state, 'item-3', 'recipient-3')
    state = reduceDistribution(state, { type: 'return-item', itemId: 'item-2' })
    state = allocate(state, 'item-2', 'recipient-2')
    expect(state.allocations['recipient-1']).toEqual(['item-1'])
    expect(state.allocations['recipient-2']).toEqual(['item-2'])
    expect(state.allocations['recipient-3']).toEqual(['item-3'])
  })
})
