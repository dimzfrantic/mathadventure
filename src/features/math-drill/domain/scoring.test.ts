import { describe, expect, it } from 'vitest'
import { answerQuestion, createScoreState, getScoreMetrics } from './scoring'
import type { DrillQuestion, DrillSession } from './types'

const question: DrillQuestion = {
  key: '1:add:2:3', level: 1, operation: 'addition', prompt: '2 + 3', operands: [2, 3], answer: 5,
  choices: [4, 5, 6, 7], correctChoiceIndex: 1, skillTags: ['basic-fact'],
}
const session: DrillSession = { id: 's1', seed: 1, level: 1, mode: 'addition', questions: [question, { ...question, key: '1:add:1:1', prompt: '1 + 1', operands: [1, 1], answer: 2, choices: [1, 2, 3, 4], correctChoiceIndex: 1, skillTags: ['basic-fact'] }], rounds: [], roundSize: 10 }

describe('Math Drill scoring', () => {
  it('scores first-try correct as one point and rejects duplicate submissions', () => {
    const state = createScoreState(session)
    const once = answerQuestion(state, session, '1:add:2:3', 1)
    expect(once.ok).toBe(true)
    if (!once.ok) return
    expect(once.state.responses['1:add:2:3']).toMatchObject({ status: 'completed', attempts: [1], points: 1 })
    expect(answerQuestion(once.state, session, '1:add:2:3', 1)).toMatchObject({ ok: false, error: { code: 'QUESTION_ALREADY_COMPLETED' } })
  })

  it('awards half credit on second-try correct and zero after two wrong attempts', () => {
    let state = createScoreState(session)
    const wrong = answerQuestion(state, session, '1:add:2:3', 0)
    expect(wrong.ok).toBe(true)
    if (!wrong.ok) return
    expect(wrong.state.responses['1:add:2:3'].status).toBe('awaiting-second-attempt')
    const second = answerQuestion(wrong.state, session, '1:add:2:3', 1)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.state.responses['1:add:2:3']).toMatchObject({ status: 'completed', attempts: [0, 1], points: 0.5 })
    const firstWrong = answerQuestion(state, session, '1:add:1:1', 0)
    if (!firstWrong.ok) throw new Error('expected first wrong attempt to be accepted')
    const twoWrong = answerQuestion(firstWrong.state, session, '1:add:1:1', 2)
    expect(twoWrong.ok).toBe(true)
    if (twoWrong.ok) expect(twoWrong.state.responses['1:add:1:1']).toMatchObject({ status: 'completed', attempts: [0, 2], points: 0 })
  })

  it('rejects invalid option, unknown question, and a third attempt without mutating state', () => {
    const initial = createScoreState(session)
    expect(answerQuestion(initial, session, '1:add:2:3', -1)).toMatchObject({ ok: false, error: { code: 'INVALID_CHOICE_INDEX' } })
    expect(answerQuestion(initial, session, 'unknown', 0)).toMatchObject({ ok: false, error: { code: 'QUESTION_NOT_IN_SESSION' } })
    const a = answerQuestion(initial, session, '1:add:2:3', 0)
    if (!a.ok) throw new Error('expected first attempt to be accepted')
    const b = answerQuestion(a.state, session, '1:add:2:3', 2)
    if (!b.ok) throw new Error('expected second attempt to be accepted')
    expect(answerQuestion(b.state, session, '1:add:2:3', 1)).toMatchObject({ ok: false, error: { code: 'QUESTION_ALREADY_COMPLETED' } })
    expect(initial.responses).toEqual({})
  })

  it('separates completion, first-try accuracy, success within two tries, and weighted score', () => {
    let state = createScoreState(session)
    for (const [key, index] of [['1:add:2:3', 1], ['1:add:1:1', 0]] as const) {
      const result = answerQuestion(state, session, key, index)
      if (!result.ok) throw new Error('expected accepted answer')
      state = result.state
    }
    const metrics = getScoreMetrics(state, session)
    expect(metrics).toMatchObject({ planned: 2, completed: 1, firstTryCorrect: 1, secondTryCorrect: 0, wrongTwice: 0, unanswered: 1, firstTryAccuracy: 50, successWithinTwoAttempts: 50, weightedScore: 50 })
  })
})
