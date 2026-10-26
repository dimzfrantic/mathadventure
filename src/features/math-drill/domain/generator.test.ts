import { describe, expect, it } from 'vitest'
import { generateSession, getCapacity, validateRequest } from './generator'
import { createSeededRng } from './random'
import type { DrillLevel, OperationMode } from './types'

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

  it('uses the flexible rounded Level 2 bridge target', () => {
    expect(validateRequest({ level: 2, mode: 'addition', count: 10 })).toMatchObject({ ok: true, quotas: { targetBridge: 7, actualBridge: 7, reinforcement: 3 } })
    expect(validateRequest({ level: 2, mode: 'subtraction', count: 10 })).toMatchObject({ ok: true, quotas: { targetBridge: 7, actualBridge: 7, reinforcement: 3 } })
    expect(generateSession({ level: 2, mode: 'addition', count: 1, seed: 1 }).ok).toBe(true)
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
    expect(generateSession({ level: 2, mode: 'addition', count: 1, seed: 1 })).toMatchObject({ ok: false, error: { code: 'UNSATISFIABLE_SKILL_QUOTA' } })
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
})
