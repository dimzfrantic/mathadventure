import type { DrillLevel, DrillQuestion, Level5Sublevel, Operation, OperationMode, RandomSource, SkillTag } from './types'
import { createSeededRng, shuffle } from './random'

export interface Candidate {
  readonly key: string
  readonly level: DrillLevel
  readonly operation: Operation
  readonly prompt: string
  readonly operands: readonly number[]
  readonly answer: number
  readonly skillTags: readonly SkillTag[]
  readonly answerMin: number
  readonly answerMax: number
}

const modes: readonly OperationMode[] = ['addition', 'subtraction', 'mixed']
const levels: readonly DrillLevel[] = [1, 2, 3, 4, 5]
const level5Sublevels: readonly Level5Sublevel[] = ['dasar', 'menengah', 'lanjutan']
const ROUND_DEFAULT = 10
const ROUND_MAX = 20

function makeCandidate(level: DrillLevel, operation: Operation, prompt: string, operands: number[], answer: number, tags: SkillTag[], answerMin: number, answerMax: number, shape: string): Candidate {
  return { key: `${level}:${shape}`, level, operation, prompt, operands, answer, skillTags: tags, answerMin, answerMax }
}

function directCandidates(level: 1 | 2 | 3 | 4, operation: Operation, group?: 'bridge' | 'reinforcement'): Candidate[] {
  const result: Candidate[] = []
  if (level === 1 || level === 2) {
    const max = level === 1 ? 10 : 20
    if (operation === 'addition') {
      for (let a = 1; a <= max; a += 1) for (let b = a; b <= max; b += 1) {
        const sum = a + b
        if (sum > max) continue
        const bridge = a <= 9 && b <= 9 && sum > 10
        if (level === 2 && group && (group === 'bridge') !== bridge) continue
        const tags: SkillTag[] = level === 1 ? ['basic-fact'] : bridge ? ['bridge-over-10'] : ['basic-fact']
        result.push(makeCandidate(level, operation, `${a} + ${b}`, [a, b], sum, tags, 1, max, `add:${a}:${b}`))
      }
    } else {
      for (let a = 2; a <= max; a += 1) for (let b = 1; b < a; b += 1) {
        const answer = a - b
        const bridge = a >= 11 && a <= 19 && b >= 2 && b <= 9 && answer >= 1 && answer <= 9 && a % 10 < b
        if (level === 2 && group && (group === 'bridge') !== bridge) continue
        result.push(makeCandidate(level, operation, `${a} − ${b}`, [a, b], answer, level === 1 ? ['basic-fact'] : bridge ? ['bridge-over-10'] : ['basic-fact'], 1, max, `sub:${a}:${b}`))
      }
    }
    return result
  }

  if (operation === 'addition') {
    for (let a = 10; a <= 99; a += 1) for (let b = a; b <= 99; b += 1) {
      const sum = a + b
      if (sum > 99) continue
      const carriesUnits = a % 10 + b % 10 >= 10
      const carriesTens = Math.floor(a / 10) + Math.floor(b / 10) >= 10
      if (level === 3 ? carriesUnits || carriesTens : !carriesUnits) continue
      result.push(makeCandidate(level, operation, `${a} + ${b}`, [a, b], sum, level === 3 ? ['two-digit-no-regroup'] : ['carry'], 1, 99, `add:${a}:${b}`))
    }
  } else {
    for (let a = 10; a <= 99; a += 1) for (let b = 10; b < a; b += 1) {
      const borrow = a % 10 < b % 10
      if (level === 3 ? borrow : !borrow) continue
      result.push(makeCandidate(level, operation, `${a} − ${b}`, [a, b], a - b, level === 3 ? ['two-digit-no-regroup'] : ['borrow'], 1, 99, `sub:${a}:${b}`))
    }
  }
  return result
}

function level5Candidates(operation: Operation, sublevel: Level5Sublevel = 'lanjutan'): Candidate[] {
  const result: Candidate[] = []
  const min = sublevel === 'lanjutan' ? 10 : 1
  const max = sublevel === 'dasar' ? 10 : sublevel === 'menengah' ? 20 : 99
  const additionMax = sublevel === 'lanjutan' ? 100 : max
  if (operation === 'addition') {
    for (let known = min; known <= max; known += 1) for (let missing = min; missing <= max && missing + known <= additionMax; missing += 1) {
      const sum = known + missing
      result.push(makeCandidate(5, operation, `□ + ${known} = ${sum}`, [missing, known, sum], missing, ['missing-addend'], min, max, `missing-addend:${known}:${sum}`))
    }
  } else {
    for (let minuend = min + 1; minuend <= max; minuend += 1) for (let subtrahend = min; subtrahend < minuend; subtrahend += 1) {
      const difference = minuend - subtrahend
      result.push(makeCandidate(5, operation, `□ − ${subtrahend} = ${difference}`, [minuend, subtrahend, difference], minuend, ['missing-minuend'], min, max, `missing-minuend:${subtrahend}:${difference}`))
      result.push(makeCandidate(5, operation, `${minuend} − □ = ${difference}`, [minuend, subtrahend, difference], subtrahend, ['missing-subtrahend'], min, max, `missing-subtrahend:${minuend}:${difference}`))
    }
  }
  return result
}

function getCandidates(level: DrillLevel, operation: Operation, group?: 'bridge' | 'reinforcement', sublevel?: Level5Sublevel): Candidate[] {
  return level === 5 ? level5Candidates(operation, sublevel) : directCandidates(level, operation, group)
}

function level2Quotas(count: number, operation: Operation, requestedBridge = Math.floor(0.7 * count + 0.5)): { targetBridge: number; actualBridge: number; reinforcement: number } {
  const bridgePool = getCandidates(2, operation, 'bridge').length
  const reinforcementPool = getCandidates(2, operation, 'reinforcement').length
  const targetBridge = requestedBridge
  const actualBridge = Math.min(targetBridge, bridgePool)
  const remaining = count - actualBridge
  const reinforcement = Math.min(remaining, reinforcementPool)
  const extraBridge = Math.min(remaining - reinforcement, bridgePool - actualBridge)
  return { targetBridge, actualBridge: actualBridge + extraBridge, reinforcement }
}

function candidatePools(level: DrillLevel, mode: OperationMode, sublevel?: Level5Sublevel): { addition: Candidate[]; subtraction: Candidate[] } {
  const addition = mode === 'subtraction' ? [] : getCandidates(level, 'addition', undefined, sublevel)
  const subtraction = mode === 'addition' ? [] : getCandidates(level, 'subtraction', undefined, sublevel)
  return { addition, subtraction }
}

export function getCapacity(level: DrillLevel, mode: OperationMode, level5Sublevel?: Level5Sublevel): number {
  if (level === 5 && level5Sublevel !== undefined && !level5Sublevels.includes(level5Sublevel)) return 0
  if (level === 2) {
    if (mode === 'addition') return getCandidates(2, 'addition').length
    if (mode === 'subtraction') return getCandidates(2, 'subtraction').length
    return 2 * Math.min(getCandidates(2, 'addition').length, getCandidates(2, 'subtraction').length) + 1
  }
  const { addition, subtraction } = candidatePools(level, mode, level5Sublevel)
  if (mode === 'addition') return addition.length
  if (mode === 'subtraction') return subtraction.length
  return 2 * Math.min(addition.length, subtraction.length) + (addition.length === subtraction.length ? 0 : 1)
}

export function getLevel2SkillCapacity(operation: Operation): { readonly bridge: number; readonly reinforcement: number; readonly total: number } {
  const bridge = getCandidates(2, operation, 'bridge').length
  const reinforcement = getCandidates(2, operation, 'reinforcement').length
  return { bridge, reinforcement, total: bridge + reinforcement }
}

export function validateRequest(request: { level: DrillLevel; mode: OperationMode; count: number; level5Sublevel?: Level5Sublevel }): import('./types').ValidationResult {
  if (!levels.includes(request.level) || !modes.includes(request.mode)) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Level atau mode tidak dikenal.', capacity: 0, requested: request.count } }
  if (request.level === 5 && request.level5Sublevel !== undefined && !level5Sublevels.includes(request.level5Sublevel)) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Sublevel tidak dikenal.', capacity: 0, requested: request.count } }
  const capacity = getCapacity(request.level, request.mode, request.level5Sublevel)
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > 500) return { ok: false, error: { code: 'INVALID_COUNT', message: 'Jumlah harus integer dari 1 sampai 500.', capacity, requested: request.count } }
  if (request.count > capacity) return { ok: false, error: { code: 'INSUFFICIENT_CAPACITY', message: `Kapasitas valid ${capacity}; permintaan ${request.count}.`, capacity, requested: request.count } }
  if (request.level === 2 && request.mode !== 'mixed') return { ok: true, capacity, quotas: level2Quotas(request.count, request.mode) }
  return { ok: true, capacity }
}

function distractors(candidate: Candidate): number[] {
  const { answer, answerMin: min, answerMax: max } = candidate
  const proposals = [answer - 1, answer + 1]
  const [a, b] = candidate.operands
  if (candidate.operation === 'addition') proposals.push(a + b - Math.min(a, b), Math.abs(a - b), answer - 2, answer + 2)
  else proposals.push(a + b, Math.abs(a - b) + 1, answer - 2, answer + 2)
  const unique: number[] = []
  for (const value of proposals) if (value >= min && value <= max && value !== answer && !unique.includes(value)) unique.push(value)
  for (let delta = 3; unique.length < 3 && delta <= max - min + 1; delta += 1) {
    for (const value of [answer - delta, answer + delta]) if (value >= min && value <= max && value !== answer && !unique.includes(value)) unique.push(value)
  }
  return unique.slice(0, 3)
}

function instantiate(candidate: Candidate, rng: RandomSource, correctChoiceIndex: number): DrillQuestion {
  const values = distractors(candidate)
  if (values.length !== 3) throw new Error(`Insufficient legal distractors for ${candidate.key}`)
  const shuffledDistractors = shuffle(values, rng)
  const choices = [...shuffledDistractors]
  choices.splice(correctChoiceIndex, 0, candidate.answer)
  return { ...candidate, choices, correctChoiceIndex }
}

export function challengeCandidatePool(level: DrillLevel, operation: Operation, sublevel?: Level5Sublevel): Candidate[] {
  return getCandidates(level, operation, undefined, sublevel)
}

export function instantiateChallengeCandidate(candidate: Candidate, rng: RandomSource, correctChoiceIndex: number): DrillQuestion {
  return instantiate(candidate, rng, correctChoiceIndex)
}

function mixedCounts(additionCapacity: number, subtractionCapacity: number, count: number): { addition: number; subtraction: number } {
  const each = Math.floor(count / 2)
  if (count % 2 === 0) return { addition: each, subtraction: each }
  if (additionCapacity >= subtractionCapacity) return { addition: each + 1, subtraction: each }
  return { addition: each, subtraction: each + 1 }
}

function mixCandidates(addition: Candidate[], subtraction: Candidate[], count: number, rng: RandomSource): Candidate[] {
  const counts = mixedCounts(addition.length, subtraction.length, count)
  const chosenAdd = shuffle(addition, rng).slice(0, counts.addition)
  const chosenSub = shuffle(subtraction, rng).slice(0, counts.subtraction)
  const combined = shuffle([...chosenAdd, ...chosenSub], rng)
  const ordered: Candidate[] = []
  while (combined.length) {
    const last = ordered.at(-1)?.operation
    const nextIndex = combined.findIndex(item => item.operation !== last)
    ordered.push(combined.splice(nextIndex < 0 ? 0 : nextIndex, 1)[0])
  }
  return ordered
}

function distributeLevel2BridgeTarget(additionCount: number, subtractionCount: number, targetBridge: number): { addition: number; subtraction: number } {
  const additionPool = getCandidates(2, 'addition', 'bridge').length
  const subtractionPool = getCandidates(2, 'subtraction', 'bridge').length
  const totalCount = additionCount + subtractionCount
  const additionTarget = totalCount === 0 ? 0 : Math.floor(targetBridge * additionCount / totalCount + 0.5)
  const subtractionTarget = targetBridge - additionTarget
  let addition = Math.min(additionTarget, additionPool)
  let subtraction = Math.min(subtractionTarget, subtractionPool)
  let remaining = targetBridge - addition - subtraction
  const additionRoom = additionPool - addition
  const subtractionRoom = subtractionPool - subtraction
  if (subtractionRoom > additionRoom) {
    const extra = Math.min(remaining, subtractionRoom)
    subtraction += extra
    remaining -= extra
  }
  if (remaining > 0) {
    const extra = Math.min(remaining, additionRoom)
    addition += extra
    remaining -= extra
  }
  if (remaining > 0) subtraction += Math.min(remaining, subtractionPool - subtraction)
  return { addition, subtraction }
}

function level2Selection(operation: Operation, count: number, rng: RandomSource, requestedBridge?: number): Candidate[] {
  const quotas = level2Quotas(count, operation, requestedBridge)
  const bridgePool = shuffle(getCandidates(2, operation, 'bridge'), rng)
  const reinforcementPool = shuffle(getCandidates(2, operation, 'reinforcement'), rng)
  const bridgeCount = Math.min(quotas.actualBridge, bridgePool.length)
  const reinforcementCount = Math.min(count - bridgeCount, reinforcementPool.length)
  const extraBridge = count - bridgeCount - reinforcementCount
  return [...bridgePool.slice(0, bridgeCount + extraBridge), ...reinforcementPool.slice(0, reinforcementCount)]
}

export function generateSession(request: import('./types').GenerateRequest): import('./types').GenerateResult {
  const validSublevel = request.level !== 5 || request.level5Sublevel === undefined || level5Sublevels.includes(request.level5Sublevel)
  const capacity = levels.includes(request.level) && modes.includes(request.mode) && validSublevel ? getCapacity(request.level, request.mode, request.level5Sublevel) : 0
  const roundSize = request.roundSize ?? ROUND_DEFAULT
  if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffffffff) return { ok: false, error: { code: 'INVALID_SEED', message: 'Seed harus integer uint32.', capacity, requested: request.count } }
  if (!Number.isInteger(roundSize) || roundSize < 1 || roundSize > ROUND_MAX) return { ok: false, error: { code: 'INVALID_ROUND_SIZE', message: 'Ukuran ronde harus integer dari 1 sampai 20.', capacity, requested: request.count } }
  const validation = validateRequest(request)
  if (!validation.ok) return { ok: false, error: validation.error }
  const rng = createSeededRng(request.seed)
  let selected: Candidate[]
  if (request.level === 2 && request.mode !== 'mixed') selected = level2Selection(request.mode, request.count, rng)
  else if (request.level === 2 && request.mode === 'mixed') {
    const operationCounts = mixedCounts(getCandidates(2, 'addition').length, getCandidates(2, 'subtraction').length, request.count)
    const addCount = operationCounts.addition
    const subCount = operationCounts.subtraction
    const targetBridge = Math.floor(0.7 * request.count + 0.5)
    const bridgeTargets = distributeLevel2BridgeTarget(addCount, subCount, targetBridge)
    selected = [...level2Selection('addition', addCount, rng, bridgeTargets.addition), ...level2Selection('subtraction', subCount, rng, bridgeTargets.subtraction)]
    selected = interleave(selected, rng)
  } else {
    const pools = candidatePools(request.level, request.mode, request.level5Sublevel)
    selected = request.mode === 'mixed' ? mixCandidates(pools.addition, pools.subtraction, request.count, rng) : shuffle(request.mode === 'addition' ? pools.addition : pools.subtraction, rng).slice(0, request.count)
  }
  if (selected.length !== request.count || new Set(selected.map(q => q.key)).size !== selected.length) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Pool terpilih tidak memenuhi jumlah unik yang diminta.', capacity, requested: request.count } }
  const correctPositions = shuffle(Array.from({ length: request.count }, (_, index) => index % 4), rng)
  let questions: DrillQuestion[]
  try {
    questions = selected.map((candidate, index) => instantiate(candidate, rng, correctPositions[index]))
  } catch (error) {
    return { ok: false, error: { code: 'INSUFFICIENT_DISTRACTORS', message: error instanceof Error ? error.message : 'Tidak cukup pilihan jawaban yang sah.', capacity, requested: request.count } }
  }
  const rounds: DrillQuestion[][] = []
  for (let i = 0; i < questions.length; i += roundSize) rounds.push(questions.slice(i, i + roundSize))
  const quota = request.level === 2 ? makeSessionQuota(questions, request.count) : undefined
  return { ok: true, session: { id: `math-drill-${request.seed}-${request.level}-${request.mode}-${request.count}${request.level === 5 && request.level5Sublevel && request.level5Sublevel !== 'lanjutan' ? `-${request.level5Sublevel}` : ''}`, seed: request.seed, level: request.level, mode: request.mode, questions, rounds, roundSize, quota, ...(request.level === 5 && request.level5Sublevel ? { level5Sublevel: request.level5Sublevel } : {}) } }
}

function interleave(items: Candidate[], rng: RandomSource): Candidate[] {
  const shuffled = shuffle(items, rng)
  const result: Candidate[] = []
  while (shuffled.length) {
    const last = result.at(-1)?.operation
    const index = shuffled.findIndex(item => item.operation !== last)
    result.push(shuffled.splice(index < 0 ? 0 : index, 1)[0])
  }
  return result
}

function makeSessionQuota(questions: readonly DrillQuestion[], count: number) {
  const targetBridge = Math.floor(0.7 * count + 0.5)
  const actualBridge = questions.filter(q => q.skillTags.includes('bridge-over-10')).length
  const additionCount = questions.filter(q => q.operation === 'addition').length
  const additionTarget = count === 0 ? 0 : Math.floor(targetBridge * additionCount / count + 0.5)
  const byOperation = {
    addition: { targetBridge: additionTarget, actualBridge: questions.filter(q => q.operation === 'addition' && q.skillTags.includes('bridge-over-10')).length },
    subtraction: { targetBridge: targetBridge - additionTarget, actualBridge: questions.filter(q => q.operation === 'subtraction' && q.skillTags.includes('bridge-over-10')).length },
  }
  return { targetBridge, actualBridge, actualReinforcement: count - actualBridge, actualBridgeRatio: actualBridge / count, byOperation }
}
