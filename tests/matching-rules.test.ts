import { describe, expect, it } from 'vitest'
import { createTask, initialState, reduceMatch, remainingSide, evaluateAttempt } from '../src/learning/matching'
import { MemoryEvidenceStore } from '../src/learning/evidenceStore'

const balanced = createTask('balanced', 3, 3)

function pairAll(state: ReturnType<typeof initialState>) {
  let next = state
  for (let i = 1; i <= Math.min(next.task.astronauts.length, next.task.rockets.length); i++) {
    next = reduceMatch(next, { type: 'pair', astronaut: `a${i}`, rocket: `r${i}` })
  }
  return next
}

describe('00.1-A rules', () => {
  it('pairs exactly one astronaut and one rocket, refusing reused objects', () => {
    const state = reduceMatch(initialState(balanced), { type: 'pair', astronaut: 'a1', rocket: 'r1' })
    expect(state.pairs).toEqual([{ astronaut: 'a1', rocket: 'r1' }])
    expect(reduceMatch(state, { type: 'pair', astronaut: 'a1', rocket: 'r2' })).toEqual(state)
    expect(reduceMatch(state, { type: 'pair', astronaut: 'a2', rocket: 'r1' })).toEqual(state)
    expect(reduceMatch(state, { type: 'pair', astronaut: 'a9', rocket: 'r9' })).toEqual(state)
  })

  it('accepts a balanced set only when all pairs and no remainder are confirmed', () => {
    const state = pairAll(initialState(balanced))
    expect(remainingSide(state)).toBe('none')
    expect(evaluateAttempt({ ...state, answer: 'none' }, true).outcome).toBe('independent')
    expect(evaluateAttempt(state, true).outcome).toBe('inconclusive')
  })

  it('identifies leftover astronauts and rockets, without hiding either side', () => {
    const extraAstronaut = pairAll(initialState(createTask('extra-a', 4, 3)))
    const extraRocket = pairAll(initialState(createTask('extra-r', 3, 4)))
    expect(remainingSide(extraAstronaut)).toBe('astronaut')
    expect(remainingSide(extraRocket)).toBe('rocket')
    expect(evaluateAttempt({ ...extraAstronaut, answer: 'astronaut' }, true).outcome).toBe('independent')
    expect(evaluateAttempt({ ...extraRocket, answer: 'rocket' }, true).outcome).toBe('independent')
    expect(evaluateAttempt({ ...extraRocket, answer: 'none' }, true).outcome).toBe('interpretable_incorrect')
  })

  it('undo restores the last pairing and retry clears the board', () => {
    const one = reduceMatch(initialState(balanced), { type: 'pair', astronaut: 'a1', rocket: 'r1' })
    expect(reduceMatch(one, { type: 'undo' }).pairs).toEqual([])
    expect(reduceMatch(one, { type: 'retry' }).pairs).toEqual([])
  })

  it('shows two staged hints but never highlights a rocket', () => {
    const one = reduceMatch(initialState(balanced), { type: 'hint' })
    const two = reduceMatch(one, { type: 'hint' })
    expect(one.hintLevel).toBe(1)
    expect(two.hintLevel).toBe(2)
    expect(two.highlightedAstronaut).toBe('a1')
    expect(two).not.toHaveProperty('highlightedRocket')
    expect(reduceMatch(two, { type: 'hint' }).hintLevel).toBe(2)
  })

  it('records guided success after a hint, including after retry on same task', () => {
    const state = pairAll(reduceMatch(initialState(balanced), { type: 'hint' }))
    expect(evaluateAttempt({ ...state, answer: 'none' }, true).outcome).toBe('guided')
    const retried = reduceMatch(state, { type: 'retry' })
    expect(retried.hintLevel).toBe(0)
    expect(retried.hintHistoryLevel).toBe(1)
    expect(retried.repeatedVariant).toBe(true)
  })

  it('does not count a retried identical variant as fresh independent evidence', () => {
    const first = pairAll(initialState(balanced))
    const retried = pairAll(reduceMatch(first, { type: 'retry' }))
    const evidence = evaluateAttempt({ ...retried, answer: 'none' }, true)
    expect(evidence.outcome).toBe('independent')
    expect(evidence.repeatedVariant).toBe(true)
    expect(evidence.countsAsFreshIndependent).toBe(false)
  })

  it('records interaction difficulty while pairing is incomplete as inconclusive', () => {
    const state = reduceMatch(initialState(balanced), { type: 'pair', astronaut: 'a1', rocket: 'r1' })
    const attempt = evaluateAttempt(state, false)
    expect(attempt.outcome).toBe('inconclusive')
    expect(attempt.valid).toBeNull()
    expect(attempt.pairCount).toBe(1)
  })

  it('allocates a unique attempt identifier separate from task and variant', () => {
    const state = pairAll(initialState(balanced))
    const store = new MemoryEvidenceStore()
    const first = store.saveAttempt(evaluateAttempt({ ...state, answer: 'none' }, true))
    const second = store.saveAttempt(evaluateAttempt({ ...state, answer: 'none', repeatedVariant: true }, true))
    expect(first.taskId).toBe('00.1-A')
    expect(first.variantId).toBe('balanced')
    expect(first.taskId).toBe(second.taskId)
    expect(first.variantId).toBe(second.variantId)
    expect(first.attemptId).not.toBe(second.attemptId)
  })

  it('does not treat an incomplete board as interpretable concept evidence', () => {
    const state = reduceMatch(initialState(balanced), { type: 'answer', side: 'none' })
    expect(evaluateAttempt(state, true).outcome).toBe('inconclusive')
  })

  it('treats inability to interpret an attempt as inconclusive, not a concept error', () => {
    const state = initialState(balanced)
    expect(evaluateAttempt(state, false).outcome).toBe('inconclusive')
  })
})
