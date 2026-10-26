import type { RandomSource } from './types'

export function createSeededRng(seed: number): RandomSource {
  let state = seed >>> 0
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0
      let value = state
      value = Math.imul(value ^ (value >>> 15), value | 1)
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    },
    intBelow(maxExclusive: number) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new RangeError('maxExclusive must be a positive integer')
      const range = 4294967296
      const limit = Math.floor(range / maxExclusive) * maxExclusive
      let value: number
      do value = Math.floor(this.next() * range); while (value >= limit)
      return value % maxExclusive
    },
  }
}

export function shuffle<T>(items: readonly T[], rng: RandomSource): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = rng.intBelow(i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
