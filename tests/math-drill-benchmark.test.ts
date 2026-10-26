import { describe, expect, it } from 'vitest'
import { generateSession } from '../src/features/math-drill/domain/generator'

const benchmarkCases = [
  { name: 'L2 addition / 10', level: 2 as const, mode: 'addition' as const, count: 10 },
  { name: 'L2 addition / 50', level: 2 as const, mode: 'addition' as const, count: 50 },
  { name: 'L2 addition / 100', level: 2 as const, mode: 'addition' as const, count: 100 },
  { name: 'L5 mixed / 500', level: 5 as const, mode: 'mixed' as const, count: 500 },
]

describe('Math Drill generator benchmark', () => {
  it('measures supported 10, 50, 100, and 500 question requests and prints a seeded sample', () => {
    const timings: Record<string, number> = {}
    for (const item of benchmarkCases) {
      const start = performance.now()
      const result = generateSession({ ...item, seed: 20261011 })
      timings[item.name] = Number((performance.now() - start).toFixed(3))
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.session.questions).toHaveLength(item.count)
    }
    const sample = generateSession({ level: 1, mode: 'mixed', count: 10, seed: 20261011 })
    expect(sample.ok).toBe(true)
    if (sample.ok) console.info('MATH_DRILL_BENCHMARK', JSON.stringify({ timingsMs: timings, seed: 20261011, sample10: sample.session.questions.map(q => ({ prompt: q.prompt, answer: q.answer, choices: q.choices, correctChoiceIndex: q.correctChoiceIndex, key: q.key })) }))
  })
})
