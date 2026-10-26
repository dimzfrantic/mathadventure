import { describe, expect, it } from 'vitest'
import { generateSession, getCapacity, validateRequest } from '../src/features/math-drill/domain'
import type { Level5Sublevel, OperationMode } from '../src/features/math-drill/domain'

const sublevels: readonly [Level5Sublevel, number, number, number, number][] = [
  ['dasar', 10, 45, 90, 91],
  ['menengah', 20, 190, 380, 381],
  ['lanjutan', 99, 3321, 8010, 6643],
]
const modes: OperationMode[] = ['addition', 'subtraction', 'mixed']

describe('Level 5 sublevel contract', () => {
  it.each(sublevels)('enumerates %s capacity by operation', (sublevel, _max, add, sub, mixed) => {
    expect(getCapacity(5, 'addition', sublevel)).toBe(add)
    expect(getCapacity(5, 'subtraction', sublevel)).toBe(sub)
    expect(getCapacity(5, 'mixed', sublevel)).toBe(mixed)
  })

  it.each(sublevels.flatMap(([sublevel, max]) => modes.map(mode => [sublevel, max, mode] as const)))(
    '%s %s produces only valid equations and domain-valid distinct answers', (sublevel, max, mode) => {
      const count = Math.min(500, getCapacity(5, mode, sublevel))
      const result = generateSession({ level: 5, level5Sublevel: sublevel, mode, count, seed: 1945 })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.session.level5Sublevel).toBe(sublevel)
      expect(result.session.questions).toHaveLength(count)
      expect(new Set(result.session.questions.map(q => q.key)).size).toBe(count)
      expect(new Set(result.session.questions.map(q => q.prompt)).size).toBe(count)
      for (const q of result.session.questions) {
        const [a, b, c] = q.operands
        expect(q.operation === 'addition' ? a + b : a - b).toBe(c)
        expect(q.prompt).toBe(q.skillTags.includes('missing-addend') ? `□ + ${b} = ${c}` : q.skillTags.includes('missing-minuend') ? `□ − ${b} = ${c}` : `${a} − □ = ${c}`)
        expect(q.answer).toBe(q.skillTags.includes('missing-subtrahend') ? b : a)
        const min = sublevel === 'lanjutan' ? 10 : 1
        expect(q.choices).toHaveLength(4)
        expect(new Set(q.choices).size).toBe(4)
        expect(q.choices.filter(choice => choice === q.answer)).toHaveLength(1)
        expect(q.choices[q.correctChoiceIndex]).toBe(q.answer)
        expect(q.choices.every(choice => Number.isInteger(choice) && choice >= min && choice <= max)).toBe(true)
        if (sublevel !== 'lanjutan') expect([a, b, c].every(value => Number.isInteger(value) && value >= 1 && value <= max)).toBe(true)
      }
    },
  )

  it.each(['dasar', 'menengah'] as const)('%s accepts the exact addition boundary but rejects one above', sublevel => {
    const capacity = getCapacity(5, 'addition', sublevel)
    expect(validateRequest({ level: 5, level5Sublevel: sublevel, mode: 'addition', count: capacity })).toMatchObject({ ok: true, capacity })
    const full = generateSession({ level: 5, level5Sublevel: sublevel, mode: 'addition', count: capacity, seed: 18 })
    expect(full.ok).toBe(true)
    if (full.ok) expect(full.session.questions.some(q => q.prompt === `□ + ${sublevel === 'dasar' ? 9 : 19} = ${sublevel === 'dasar' ? 10 : 20}`)).toBe(true)
    expect(generateSession({ level: 5, level5Sublevel: sublevel, mode: 'addition', count: capacity + 1, seed: 18 })).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_CAPACITY', capacity } })
  })

  it.each(['dasar', 'menengah'] as const)('exhausts both %s subtraction forms at their capacity', sublevel => {
    const max = sublevel === 'dasar' ? 10 : 20
    const count = getCapacity(5, 'subtraction', sublevel)
    const result = generateSession({ level: 5, level5Sublevel: sublevel, mode: 'subtraction', count, seed: 9 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.session.questions.filter(q => q.skillTags.includes('missing-minuend'))).toHaveLength(count / 2)
    expect(result.session.questions.filter(q => q.skillTags.includes('missing-subtrahend'))).toHaveLength(count / 2)
    expect(new Set(result.session.questions.map(q => q.prompt)).size).toBe(count)
    expect(result.session.questions.some(q => q.prompt === `□ − ${max - 1} = 1`)).toBe(true)
    expect(result.session.questions.some(q => q.prompt === '2 − □ = 1')).toBe(true)
    expect(generateSession({ level: 5, level5Sublevel: sublevel, mode: 'subtraction', count: count + 1, seed: 9 })).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_CAPACITY', capacity: count } })
  })

  it('reaches and rejects the odd balanced mixed boundary in Dasar', () => {
    const result = generateSession({ level: 5, level5Sublevel: 'dasar', mode: 'mixed', count: 91, seed: 7 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.session.questions.filter(q => q.operation === 'addition')).toHaveLength(45)
    expect(result.session.questions.filter(q => q.operation === 'subtraction')).toHaveLength(46)
    expect(generateSession({ level: 5, level5Sublevel: 'dasar', mode: 'mixed', count: 92, seed: 7 })).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_CAPACITY', capacity: 91 } })
  })

  it('rejects a runtime-invalid sublevel in generation as well as validation', () => {
    expect(generateSession({ level: 5, level5Sublevel: 'unknown' as Level5Sublevel, mode: 'addition', count: 1, seed: 7 })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
  })

  it('retains legacy advanced results and seeded reproducibility', () => {
    const legacy = generateSession({ level: 5, mode: 'mixed', count: 25, seed: 71 })
    const advanced = generateSession({ level: 5, level5Sublevel: 'lanjutan', mode: 'mixed', count: 25, seed: 71 })
    expect(legacy.ok && advanced.ok).toBe(true)
    if (!legacy.ok || !advanced.ok) return
    expect(advanced.session.questions).toEqual(legacy.session.questions)
    expect(getCapacity(5, 'addition')).toBe(3321)
    expect(generateSession({ level: 5, level5Sublevel: 'dasar', mode: 'mixed', count: 25, seed: 71 })).toEqual(generateSession({ level: 5, level5Sublevel: 'dasar', mode: 'mixed', count: 25, seed: 71 }))
  })

  it('does not change Level 1–4 capacity, generation, or validation', () => {
    for (const level of [1, 2, 3, 4] as const) for (const mode of modes) {
      const request = { level, mode, count: 10, seed: 71 }
      expect(generateSession(request)).toEqual(generateSession({ ...request, level5Sublevel: 'dasar' }))
      expect(getCapacity(level, mode, 'dasar')).toBe(getCapacity(level, mode))
    }
  })

  it('rejects an invalid sublevel rather than silently using another pool', () => {
    expect(validateRequest({ level: 5, level5Sublevel: 'unknown' as Level5Sublevel, mode: 'addition', count: 10 })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
  })
})
