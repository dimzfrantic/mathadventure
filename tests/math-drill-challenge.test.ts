import { describe, expect, it } from 'vitest'
import { answerQuestion, createScoreState, generateChallengeSession, generateSession, getCapacity, getChallengeCapacity, getChallengeSummary, getScoreMetrics, validateChallengeRequest } from '../src/features/math-drill/domain'

const base = { selectedLevels: [1, 2, 5] as const, selectedLevel5Sublevels: ['dasar', 'menengah'] as const, mode: 'mixed' as const, count: 10 as const, seed: 17 }

describe('Tantangan Campuran domain', () => {
  it('generates a separate versioned session with balanced levels and unique prompts', () => {
    const result = generateChallengeSession(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const s = result.session
    expect(s).toMatchObject({ kind: 'challenge', version: 1, policyVersion: 1, selectedLevels: [1, 2, 5], selectedLevel5Sublevels: ['dasar', 'menengah'], mode: 'mixed' })
    expect(s.questions).toHaveLength(10)
    expect(new Set(s.questions.map(q => q.semanticKey)).size).toBe(10)
    expect(new Set(s.questions.map(q => q.key)).size).toBe(10)
    expect(s.rounds.flat().map(q => q.key)).toEqual(s.questions.map(q => q.key))
    const counts = [1, 2, 5].map(level => s.questions.filter(q => q.level === level).length)
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    expect(s.questions.filter(q => q.operation === 'addition')).toHaveLength(5)
    expect(s.questions.filter(q => q.operation === 'subtraction')).toHaveLength(5)
    expect(s.questions.filter(q => q.level === 5).every(q => q.level5Sublevel === 'dasar' || q.level5Sublevel === 'menengah')).toBe(true)
    for (const q of s.questions) {
      expect(q.choices).toHaveLength(4)
      expect(new Set(q.choices).size).toBe(4)
      expect(q.choices[q.correctChoiceIndex]).toBe(q.answer)
      const min = q.level === 5 && q.level5Sublevel === 'lanjutan' ? 10 : 1
      const max = q.level === 1 ? 10 : q.level === 2 ? 20 : q.level === 5 && q.level5Sublevel === 'dasar' ? 10 : q.level === 5 && q.level5Sublevel === 'menengah' ? 20 : 99
      expect(q.choices.every(value => Number.isInteger(value) && value >= min && value <= max)).toBe(true)
    }
    expect(generateChallengeSession(base)).toEqual(result)
  })

  it('requires explicit Level 5 sublevels and validates selected levels', () => {
    expect(validateChallengeRequest({ ...base, selectedLevel5Sublevels: [] })).toMatchObject({ ok: false, error: { code: 'MISSING_SUBLEVEL' } })
    expect(validateChallengeRequest({ ...base, selectedLevels: [] })).toMatchObject({ ok: false, error: { code: 'INVALID_LEVELS' } })
  })

  it.each([10, 20, 30, 50] as const)('fills %i questions across all levels without semantic duplicates', count => {
    const selectedLevel5Sublevels = count === 10 ? ['dasar', 'menengah'] as const : ['dasar', 'menengah', 'lanjutan'] as const
    const result = generateChallengeSession({ selectedLevels: [5, 1, 4, 2, 3], selectedLevel5Sublevels, mode: 'mixed', count, seed: 104 + count })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const s = result.session
    expect(s.questions).toHaveLength(count)
    expect(new Set(s.questions.map(q => q.semanticKey)).size).toBe(count)
    expect(new Set(s.questions.map(q => q.key)).size).toBe(count)
    expect(s.quota.byOperation).toEqual({ addition: count / 2, subtraction: count / 2 })
    expect(Math.max(...Object.values(s.quota.byLevel)) - Math.min(...Object.values(s.quota.byLevel))).toBeLessThanOrEqual(1)
    expect(s.questions.every(q => [1, 2, 3, 4, 5].includes(q.level))).toBe(true)
    expect(s.questions.filter(q => q.level === 5).every(q => q.level5Sublevel !== undefined)).toBe(true)
    expect(s.rounds.flat()).toEqual(s.questions)
    expect(s.questions.some((q, i) => i > 0 && q.level !== s.questions[i - 1].level)).toBe(true)
  })

  it('does not let seed rotation falsely reject a feasible fair three-sublevel selection', () => {
    for (const seed of [0, 1, 2, 3, 4]) {
      const result = generateChallengeSession({ selectedLevels: [1, 2, 3, 5], selectedLevel5Sublevels: ['dasar', 'menengah', 'lanjutan'], mode: 'mixed', count: 10, seed })
      expect(result.ok, `seed=${seed} ${JSON.stringify(result)}`).toBe(true)
      if (result.ok) expect(result.session.selectedLevel5Sublevels.every(sublevel => result.session.questions.some(q => q.level5Sublevel === sublevel))).toBe(true)
    }
  })

  it('rejects selecting more sublevels than the fair Level 5 quota can represent', () => {
    const request = { selectedLevels: [1, 2, 3, 4, 5] as const, selectedLevel5Sublevels: ['dasar', 'menengah', 'lanjutan'] as const, mode: 'mixed' as const, count: 10 as const, seed: 1 }
    expect(generateChallengeSession(request)).toMatchObject({ ok: false, error: { code: 'UNSATISFIABLE_ALLOCATION', requested: 10 } })
  })

  it('deduplicates overlapping Level 5 pools and keeps explicit source sublevels', () => {
    const selection = { selectedLevels: [5] as const, selectedLevel5Sublevels: ['dasar', 'menengah'] as const, mode: 'mixed' as const }
    expect(getChallengeCapacity(selection).uniqueByOperation).toEqual({ addition: 190, subtraction: 380 })
    expect(getChallengeCapacity({ ...selection, selectedLevel5Sublevels: ['menengah', 'lanjutan'] }).uniqueByOperation).toEqual({ addition: 3510, subtraction: 8280 })
    const result = generateChallengeSession({ ...selection, count: 50, seed: 11 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.session.quota.bySublevel.dasar).toBe(25)
    expect(result.session.quota.bySublevel.menengah).toBe(25)
    expect(new Set(result.session.questions.map(q => q.semanticKey)).size).toBe(50)
    expect(result.session.questions.some(q => q.sourceSublevels?.length === 2)).toBe(true)
  })

  it('keeps feasibility stable across seeds for representative overlapping selections', () => {
    for (const selectedLevels of [[1, 2], [1, 5], [1, 2, 3, 5], [1, 2, 3, 4, 5]] as const) {
      const selectedLevel5Sublevels = selectedLevels.includes(5) ? ['dasar', 'menengah', 'lanjutan'] as const : [] as const
      for (const mode of ['addition', 'subtraction', 'mixed'] as const) {
        const selection = { selectedLevels, selectedLevel5Sublevels, mode }
        const capacity = getChallengeCapacity(selection)
        for (const count of [10, 20, 30, 50] as const) for (const seed of [0, 1, 2]) {
          const result = generateChallengeSession({ ...selection, count, seed })
          expect(result.ok, `levels=${selectedLevels} mode=${mode} count=${count} seed=${seed} ${JSON.stringify(result.ok ? '' : result.error)}`).toBe(capacity.feasibleCounts.includes(count))
        }
      }
    }
  }, 60_000)

  it('separates shared arithmetic facts when another question is available', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const result = generateChallengeSession({ selectedLevels: [5], selectedLevel5Sublevels: ['dasar'], mode: 'subtraction', count: 50, seed })
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const questions = result.session.questions
      expect(questions.some((q, i) => i > 0 && q.factKey === questions[i - 1].factKey)).toBe(false)
    }
  })

  it('fills overlapping Level 1 and Level 2 pools at the fair addition boundary', () => {
    const result = generateChallengeSession({ selectedLevels: [1, 2], selectedLevel5Sublevels: [], mode: 'addition', count: 50, seed: 9 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.session.quota.byLevel[1]).toBe(25)
    expect(result.session.quota.byLevel[2]).toBe(25)
    expect(new Set(result.session.questions.map(q => q.semanticKey)).size).toBe(50)
    expect(result.session.questions.filter(q => q.level === 1)).toHaveLength(25)
    expect(getCapacity(1, 'addition')).toBe(25)
  })

  it('retains practice Level 1–5 seeded sessions and legacy Level 5 capacity', () => {
    for (const level of [1, 2, 3, 4, 5] as const) {
      expect(generateSession({ level, mode: 'mixed', count: 10, seed: 33 })).toEqual(generateSession({ level, mode: 'mixed', count: 10, seed: 33 }))
    }
    expect(getCapacity(5, 'addition')).toBe(3321)
    expect(getCapacity(5, 'mixed')).toBe(6643)
  })

  it('preserves Level 2 flexible bridge target locally without changing operation balance', () => {
    const result = generateChallengeSession({ selectedLevels: [2], selectedLevel5Sublevels: [], mode: 'mixed', count: 50, seed: 3 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const quota = result.session.quota
    expect(quota.byOperation).toEqual({ addition: 25, subtraction: 25 })
    expect(quota.level2Bridge.target).toBe(35)
    expect(quota.level2Bridge.actual).toBe(result.session.questions.filter(q => q.skillTags.includes('bridge-over-10')).length)
    expect(quota.level2Bridge.actual).toBe(35)
    expect(quota.level2Bridge.actual + quota.level2Bridge.reinforcement).toBe(50)
  })

  it('honors single-operation constraints and rejects bottleneck without substituting another operation', () => {
    for (const mode of ['addition', 'subtraction'] as const) {
      const result = generateChallengeSession({ selectedLevels: [1, 5], selectedLevel5Sublevels: ['dasar'], mode, count: 20, seed: 4 })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.session.questions.every(q => q.operation === mode)).toBe(true)
    }
    const impossible = generateChallengeSession({ selectedLevels: [5], selectedLevel5Sublevels: ['dasar'], mode: 'addition', count: 50, seed: 4 })
    expect(impossible).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_CAPACITY', capacity: 30, requested: 50 } })
  })

  it('rejects invalid request values and keeps the legacy generator unchanged', () => {
    expect(validateChallengeRequest({ ...base, count: 11 as 10 })).toMatchObject({ ok: false, error: { code: 'INVALID_COUNT' } })
    expect(validateChallengeRequest({ ...base, selectedLevels: [1, 1] })).toMatchObject({ ok: false, error: { code: 'INVALID_LEVELS' } })
    expect(validateChallengeRequest({ ...base, selectedLevels: [1], selectedLevel5Sublevels: ['dasar'] })).toMatchObject({ ok: false, error: { code: 'INVALID_SUBLEVELS' } })
    expect(validateChallengeRequest({ ...base, selectedLevel5Sublevels: ['unknown' as 'dasar'] })).toMatchObject({ ok: false, error: { code: 'INVALID_SUBLEVELS' } })
    expect(validateChallengeRequest({ ...base, mode: 'divide' as 'mixed' })).toMatchObject({ ok: false, error: { code: 'INVALID_MODE' } })
    expect(validateChallengeRequest({ ...base, seed: -1 })).toMatchObject({ ok: false, error: { code: 'INVALID_SEED' } })
    expect(validateChallengeRequest({ ...base, roundSize: 21 })).toMatchObject({ ok: false, error: { code: 'INVALID_ROUND_SIZE' } })
  })

  it('uses versioned session IDs and custom rounds without accepting another session score state', () => {
    const a = generateChallengeSession({ ...base, count: 20, seed: 1, roundSize: 7 })
    const b = generateChallengeSession({ ...base, count: 20, seed: 2, roundSize: 7 })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.session.rounds.map(round => round.length)).toEqual([7, 7, 6])
    expect(a.session.id).not.toBe(b.session.id)
    const foreign = createScoreState(a.session)
    expect(answerQuestion(foreign, b.session, b.session.questions[0].key, 0)).toMatchObject({ ok: false, error: { code: 'SESSION_MISMATCH' } })
  })

  it('aggregates read-only partial scoring with explicit denominators and N/A empty groups', () => {
    const result = generateChallengeSession(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const session = result.session
    let state = createScoreState(session)
    const initial = getChallengeSummary(state, session)
    expect(initial.overall).toMatchObject({ planned: 10, attempted: 0, unanswered: 10, firstTryAccuracy: { numerator: 0, denominator: 0, value: null }, weightedScore: { numerator: 0, denominator: 10, value: 0 } })
    const [first, second, third, fourth] = session.questions
    for (const [question, choice] of [
      [first, first.correctChoiceIndex],
      [second, (second.correctChoiceIndex + 1) % 4],
      [second, second.correctChoiceIndex],
      [third, (third.correctChoiceIndex + 1) % 4],
      [third, (third.correctChoiceIndex + 2) % 4],
      [fourth, (fourth.correctChoiceIndex + 1) % 4],
    ] as const) {
      const answered = answerQuestion(state, session, question.key, choice)
      expect(answered.ok).toBe(true)
      if (answered.ok) state = answered.state
    }
    const before = structuredClone(state)
    const summary = getChallengeSummary(state, session)
    expect(getScoreMetrics(state, session).weightedScore).toBe(summary.overall.weightedScore.value)
    expect(getScoreMetrics(state, session).firstTryAccuracy).toBe(summary.overall.firstTryAccuracy.value)
    expect(state).toEqual(before)
    expect(summary.overall).toMatchObject({ planned: 10, attempted: 4, completed: 3, unanswered: 6, inProgress: 1, firstTryCorrect: 1, secondTryCorrect: 1, wrongTwice: 1, firstTryAccuracy: { numerator: 1, denominator: 4, value: 25 }, weightedScore: { numerator: 1.5, denominator: 10, value: 15 } })
    expect(summary.byLevel[3]).toMatchObject({ planned: 0, weightedScore: { denominator: 0, value: null } })
    expect(summary.bySublevel.lanjutan.firstTryAccuracy.value).toBeNull()
    expect(summary.bySublevel[first.level5Sublevel ?? 'dasar'].planned).toBeGreaterThanOrEqual(0)
    expect(summary.byOperation.addition.planned + summary.byOperation.subtraction.planned).toBe(10)
    expect(() => getChallengeSummary({ ...state, sessionId: 'other' }, session)).toThrow()
  })

  it('reports capacity from a feasible allocation, not summed pool sizes', () => {
    expect(getChallengeCapacity({ selectedLevels: [1], selectedLevel5Sublevels: [], mode: 'addition' })).toMatchObject({ feasibleCounts: [10, 20], maxCount: 20 })
    expect(validateChallengeRequest({ selectedLevels: [1], selectedLevel5Sublevels: [], mode: 'addition', count: 30, seed: 17 })).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_CAPACITY' } })
  })
})
