import { describe, expect, it } from 'vitest'
import { generateSession, getCapacity, getLevel2SkillCapacity, validateRequest } from '../src/features/math-drill/domain/generator'
import { createSeededRng } from '../src/features/math-drill/domain/random'
import type { DrillLevel, OperationMode } from '../src/features/math-drill/domain/types'

const levels: DrillLevel[] = [1, 2, 3, 4, 5]
const modes: OperationMode[] = ['addition', 'subtraction', 'mixed']

describe('Math Drill generator', () => {
  it.each([[1, 25, 45, 51], [2, 100, 190, 201], [3, 1000, 2385, 2001], [4, 640, 1620, 1281], [5, 3321, 8010, 6643]] as const)(
    'reports level %i capacities for supported pools', (level, add, subtract, mixed) => {
      expect(getCapacity(level, 'addition')).toBe(add)
      expect(getCapacity(level, 'subtraction')).toBe(subtract)
      expect(getCapacity(level, 'mixed')).toBe(mixed)
    },
  )

  it('reports enumerated Level 2 bridge and reinforcement pools', () => {
    expect(getLevel2SkillCapacity('addition')).toEqual({ bridge: 20, reinforcement: 80, total: 100 })
    expect(getLevel2SkillCapacity('subtraction')).toEqual({ bridge: 36, reinforcement: 154, total: 190 })
    expect(getCapacity(2, 'addition')).toBe(100)
    expect(getCapacity(2, 'subtraction')).toBe(190)
    expect(validateRequest({ level: 2, mode: 'addition', count: 10 })).toMatchObject({ ok: true, quotas: { targetBridge: 7, actualBridge: 7, reinforcement: 3 } })
    expect(validateRequest({ level: 2, mode: 'subtraction', count: 10 })).toMatchObject({ ok: true, quotas: { targetBridge: 7, actualBridge: 7, reinforcement: 3 } })
    const allAddition = generateSession({ level: 2, mode: 'addition', count: 100, seed: 2026 })
    const allSubtraction = generateSession({ level: 2, mode: 'subtraction', count: 190, seed: 2026 })
    expect(allAddition.ok && allAddition.session.quota).toMatchObject({ targetBridge: 70, actualBridge: 20, actualReinforcement: 80, actualBridgeRatio: 0.2 })
    expect(allSubtraction.ok && allSubtraction.session.quota).toMatchObject({ targetBridge: 133, actualBridge: 36, actualReinforcement: 154 })
  })

  it.each([1, 2, 3, 10, 20, 50, 100])('supports Level 2 count %i with flexible bridge target and metadata', count => {
    const target = Math.floor(0.7 * count + 0.5)
    for (const [mode, poolBridge] of [['addition', 20], ['subtraction', 36]] as const) {
      const result = generateSession({ level: 2, mode, count, seed: count })
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const bridgeCount = result.session.questions.filter(q => q.skillTags.includes('bridge-over-10')).length
      expect(result.session.quota).toMatchObject({ targetBridge: target, actualBridge: bridgeCount })
      expect(bridgeCount).toBe(Math.min(target, poolBridge))
      expect(result.session.questions).toHaveLength(count)
    }
  })

  it('fills with reinforcement when bridge target exceeds the addition bridge pool', () => {
    const result = generateSession({ level: 2, mode: 'addition', count: 50, seed: 50 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.session.quota).toMatchObject({ targetBridge: 35, actualBridge: 20, actualReinforcement: 30, actualBridgeRatio: 0.4 })
  })

  it('distributes mixed Level 2 bridge quota proportionally while keeping operations balanced', () => {
    const result = generateSession({ level: 2, mode: 'mixed', count: 100, seed: 100 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const addition = result.session.questions.filter(q => q.operation === 'addition')
    const subtraction = result.session.questions.filter(q => q.operation === 'subtraction')
    expect(addition).toHaveLength(50)
    expect(subtraction).toHaveLength(50)
    expect(result.session.quota?.targetBridge).toBe(70)
    expect(result.session.quota?.actualBridge).toBe(56)
    expect(result.session.quota?.byOperation).toEqual({ addition: { targetBridge: 35, actualBridge: 20 }, subtraction: { targetBridge: 35, actualBridge: 36 } })
  })

  it.each(levels.flatMap(level => modes.map(mode => [level, mode] as const)))(
    'builds valid unique items with four choices (level %i, %s)', (level, mode) => {
      const capacity = getCapacity(level, mode)
      const request = Math.min(30, capacity)
      const result = generateSession({ level, mode, count: request, seed: 941 })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.session.questions).toHaveLength(request)
      expect(new Set(result.session.questions.map(q => q.key)).size).toBe(request)
      for (const q of result.session.questions) {
        expect(q.choices).toHaveLength(4)
        expect(new Set(q.choices).size).toBe(4)
        expect(q.choices.filter(v => v === q.answer)).toHaveLength(1)
        expect(q.choices[q.correctChoiceIndex]).toBe(q.answer)
      }
      expect(result.session.rounds.flat().map(q => q.key)).toEqual(result.session.questions.map(q => q.key))
    },
  )

  it('is reproducible for the same seed and rejects over-capacity with actual capacity', () => {
    expect(generateSession({ level: 4, mode: 'mixed', count: 30, seed: 17 })).toEqual(generateSession({ level: 4, mode: 'mixed', count: 30, seed: 17 }))
    expect(generateSession({ level: 1, mode: 'addition', count: 26, seed: 1 })).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_CAPACITY', capacity: 25 } })
    expect(generateSession({ level: 2, mode: 'addition', count: 1, seed: 1 }).ok).toBe(true)
  })

  it('supports technical request boundaries and balanced odd mixed counts', () => {
    for (const count of [1, 10, 20, 30, 50, 100, 500]) {
      const level = count <= 50 ? 3 : 5
      const result = generateSession({ level, mode: 'mixed', count, seed: count })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.session.questions).toHaveLength(count)
    }
    const odd = generateSession({ level: 3, mode: 'mixed', count: 11, seed: 2 })
    expect(odd.ok).toBe(true)
    if (odd.ok) expect(Math.abs(odd.session.questions.filter(q => q.operation === 'addition').length - odd.session.questions.filter(q => q.operation === 'subtraction').length)).toBeLessThanOrEqual(1)
  })

  it('handles 1, 10, 20, 30, 50, 100, and 500 consistently across levels and modes', () => {
    for (const level of levels) for (const mode of modes) for (const count of [1, 10, 20, 30, 50, 100, 500]) {
      const capacity = getCapacity(level, mode)
      const result = generateSession({ level, mode, count, seed: level * 10_000 + count })
      expect(result.ok).toBe(count <= Math.min(capacity, 500))
      if (result.ok) expect(result.session.questions).toHaveLength(count)
      else expect(result.error).toMatchObject({ code: count > 500 ? 'INVALID_COUNT' : 'INSUFFICIENT_CAPACITY', capacity })
    }
  }, 20_000)

  it.each(levels.flatMap(level => modes.map(mode => [level, mode] as const)))('rejects capacity+1 with actual capacity (level %i, %s)', (level, mode) => {
    const capacity = getCapacity(level, mode)
    const count = Math.min(capacity + 1, 501)
    const result = generateSession({ level, mode, count, seed: 8 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatchObject({ code: count > 500 ? 'INVALID_COUNT' : 'INSUFFICIENT_CAPACITY', capacity })
    if (capacity <= 500) {
      expect(generateSession({ level, mode, count: capacity, seed: 9 }).ok).toBe(true)
      expect(generateSession({ level, mode, count: capacity - 1, seed: 10 }).ok).toBe(true)
    }
  })

  it.each([1, 2, 3, 10, 20, 50, 100])('keeps Level 2 mixed count %i balanced and reports rounded aggregate bridge target', count => {
    const result = generateSession({ level: 2, mode: 'mixed', count, seed: 600 + count })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const additions = result.session.questions.filter(q => q.operation === 'addition').length
    const subtractions = result.session.questions.length - additions
    expect(Math.abs(additions - subtractions)).toBeLessThanOrEqual(1)
    expect(result.session.quota?.targetBridge).toBe(Math.floor(0.7 * count + 0.5))
    expect(result.session.quota?.actualBridge).toBe(result.session.questions.filter(q => q.skillTags.includes('bridge-over-10')).length)
  })

  it('uses one blank-slot key per Level 5 inverse equation', () => {
    const result = generateSession({ level: 5, mode: 'mixed', count: 50, seed: 88 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.session.questions.every(q => q.prompt.includes('□'))).toBe(true)
    expect(result.session.questions.every(q => q.answer > 0 && q.answer <= 99)).toBe(true)
    expect(result.session.rounds).toHaveLength(5)
  })

  it('handles deterministic RNG bounds without yielding invalid indices', () => {
    const rng = createSeededRng(0)
    for (let i = 0; i < 100; i += 1) expect(rng.intBelow(7)).toBeGreaterThanOrEqual(0)
    expect(() => rng.intBelow(0)).toThrow()
  })

  it('balances correct-option positions within one count for every requested session', () => {
    for (const count of [1, 2, 3, 10, 20, 50, 100, 500]) {
      const result = generateSession({ level: count < 100 ? 3 : 5, mode: 'mixed', count, seed: 20261011 })
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const counts = [0, 0, 0, 0]
      for (const q of result.session.questions) counts[q.correctChoiceIndex] += 1
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    }
  })

  it('satisfies generator invariants across a fixed set of seeds', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const result = generateSession({ level: 4, mode: 'mixed', count: 50, seed })
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(new Set(result.session.questions.map(q => q.key)).size).toBe(50)
      for (const q of result.session.questions) {
        expect(q.answer).toBe(q.operation === 'addition' ? q.operands[0] + q.operands[1] : q.operands[0] - q.operands[1])
        expect(q.answer).toBeGreaterThan(0)
        expect(q.answer).toBeLessThanOrEqual(99)
      }
    }
  })

  it('revalidates equations and choice domains for complete candidate pools', () => {
    for (const level of levels) for (const mode of modes) {
      const capacity = getCapacity(level, mode)
      const requested = Math.min(capacity, 500)
      const result = generateSession({ level, mode, count: requested, seed: 314159 })
      expect(result.ok, `level=${level}, mode=${mode}, capacity=${capacity}, requested=${requested}, result=${JSON.stringify(result)}`).toBe(true)
      if (!result.ok) continue
      for (const q of result.session.questions) {
        const [a, b, c] = q.operands
        if (level === 5 && q.skillTags[0] === 'missing-addend') expect(a + b).toBe(c)
        else if (level === 5 && q.skillTags[0] === 'missing-minuend') expect(a - b).toBe(c)
        else if (level === 5 && q.skillTags[0] === 'missing-subtrahend') expect(a - b).toBe(c)
        else expect(q.answer).toBe(q.operation === 'addition' ? a + b : a - b)
        expect(q.choices.every(choice => Number.isInteger(choice) && choice >= (level === 5 ? 10 : 1) && choice <= (level === 1 ? 10 : level === 2 ? 20 : 99))).toBe(true)
      }
    }
  }, 20_000)
})
