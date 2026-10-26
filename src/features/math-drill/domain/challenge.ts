import { challengeCandidatePool, instantiateChallengeCandidate } from './generator'
import type { Candidate } from './generator'
import { createSeededRng, shuffle } from './random'
import type { DrillLevel, Level5Sublevel, Operation, OperationMode, RandomSource } from './types'
import type { ChallengeCapacity, ChallengeError, ChallengeQuestion, ChallengeQuota, ChallengeRequest, ChallengeResult, ChallengeSelection, ChallengeValidation } from './challenge-types'

const counts = [10, 20, 30, 50] as const
const allLevels: readonly DrillLevel[] = [1, 2, 3, 4, 5]
const allSublevels: readonly Level5Sublevel[] = ['dasar', 'menengah', 'lanjutan']
const operations: readonly Operation[] = ['addition', 'subtraction']
const defaultRoundSize = 10

type Bucket = { level: DrillLevel; sublevel?: Level5Sublevel; count: number; pools: Record<Operation, Candidate[]> }
type Slot = { bucket: Bucket; pool: Candidate[] }
type Plan = { ok: true; questions: ChallengeQuestion[]; quota: ChallengeQuota } | { ok: false; reason: string }

function error(code: ChallengeError['code'], message: string, requested: number, capacity = 0, detail?: ChallengeError['detail']): ChallengeError {
  return { code, message, capacity, requested, ...(detail ? { detail } : {}) }
}

function selectionError(request: ChallengeSelection, requested: number): ChallengeError | null {
  if (!Array.isArray(request.selectedLevels) || request.selectedLevels.length === 0 || new Set(request.selectedLevels).size !== request.selectedLevels.length || request.selectedLevels.some(level => !allLevels.includes(level))) return error('INVALID_LEVELS', 'Pilih satu atau lebih level unik dari 1 sampai 5.', requested)
  if (!operations.includes(request.mode as Operation) && request.mode !== 'mixed') return error('INVALID_MODE', 'Operasi tidak dikenal.', requested)
  if (!Array.isArray(request.selectedLevel5Sublevels)) return error('INVALID_SUBLEVELS', 'Daftar sublevel harus tersedia.', requested)
  if (request.selectedLevels.includes(5) && request.selectedLevel5Sublevels.length === 0) return error('MISSING_SUBLEVEL', 'Pilih sublevel Cari Angka secara eksplisit.', requested)
  if ((!request.selectedLevels.includes(5) && request.selectedLevel5Sublevels.length > 0) || new Set(request.selectedLevel5Sublevels).size !== request.selectedLevel5Sublevels.length || request.selectedLevel5Sublevels.some(sublevel => !allSublevels.includes(sublevel))) return error('INVALID_SUBLEVELS', 'Sublevel tidak sesuai dengan pilihan level.', requested)
  return null
}

function divide(count: number, parts: number, offset: number): number[] {
  const result = Array<number>(parts).fill(Math.floor(count / parts))
  for (let i = 0; i < count % parts; i += 1) result[(offset + i) % parts] += 1
  return result
}

function buildBuckets(request: ChallengeSelection, count: number, seed: number): Bucket[] {
  const levels = [...request.selectedLevels].sort((a, b) => a - b)
  const sublevels = allSublevels.filter(item => request.selectedLevel5Sublevels.includes(item))
  const allocations = divide(count, levels.length, seed % levels.length)
  const level5Index = levels.indexOf(5)
  if (level5Index >= 0 && allocations[level5Index] < sublevels.length) {
    const donor = allocations.findIndex((quota, index) => index !== level5Index && quota > Math.floor(count / levels.length))
    if (donor >= 0) {
      allocations[donor] -= 1
      allocations[level5Index] += 1
    }
  }
  const buckets: Bucket[] = []
  for (let i = 0; i < levels.length; i += 1) {
    const level = levels[i]
    const bucketSublevels: readonly (Level5Sublevel | undefined)[] = level === 5 ? sublevels : [undefined]
    const portions = divide(allocations[i], bucketSublevels.length, seed % bucketSublevels.length)
    for (let j = 0; j < bucketSublevels.length; j += 1) {
      const sublevel = bucketSublevels[j]
      buckets.push({ level, sublevel, count: portions[j], pools: {
        addition: request.mode === 'subtraction' ? [] : challengeCandidatePool(level, 'addition', sublevel),
        subtraction: request.mode === 'addition' ? [] : challengeCandidatePool(level, 'subtraction', sublevel),
      } })
    }
  }
  return buckets
}

// Minimize the deviation from an even split per bucket while meeting an exact global half/half target.
function operationCounts(buckets: readonly Bucket[], mode: OperationMode, total: number): number[] | null {
  if (mode === 'addition') return buckets.map(bucket => bucket.count)
  if (mode === 'subtraction') return buckets.map(() => 0)
  const target = total / 2
  let states = new Map<number, { cost: number; values: number[] }>([[0, { cost: 0, values: [] }]])
  for (const bucket of buckets) {
    const next = new Map<number, { cost: number; values: number[] }>()
    const min = Math.max(0, bucket.count - bucket.pools.subtraction.length)
    const max = Math.min(bucket.count, bucket.pools.addition.length)
    for (const [sum, prior] of states) for (let add = min; add <= max; add += 1) {
      const newSum = sum + add
      if (newSum > target) continue
      const cost = prior.cost + (2 * add - bucket.count) ** 2
      if (!next.has(newSum) || next.get(newSum)!.cost > cost) next.set(newSum, { cost, values: [...prior.values, add] })
    }
    states = next
  }
  return states.get(target)?.values ?? null
}

function bridgeCounts(buckets: readonly Bucket[], additions: readonly number[]): number[] | null {
  const indices = buckets.map((bucket, index) => bucket.level === 2 ? index : -1).filter(index => index >= 0)
  const target = Math.floor(0.7 * indices.reduce((sum, index) => sum + buckets[index].count, 0) + 0.5)
  let states = new Map<number, { cost: number; values: number[] }>([[0, { cost: 0, values: [] }]])
  for (const index of indices) for (const operation of operations) {
    const count = operation === 'addition' ? additions[index] : buckets[index].count - additions[index]
    const pool = buckets[index].pools[operation]
    const bridge = pool.filter(candidate => candidate.skillTags.includes('bridge-over-10')).length
    const min = Math.max(0, count - (pool.length - bridge))
    const max = Math.min(count, bridge)
    const next = new Map<number, { cost: number; values: number[] }>()
    for (const [sum, prior] of states) for (let value = min; value <= max; value += 1) {
      const newSum = sum + value
      const cost = prior.cost + (value - 0.7 * count) ** 2
      if (!next.has(newSum) || next.get(newSum)!.cost > cost) next.set(newSum, { cost, values: [...prior.values, value] })
    }
    states = next
  }
  const best = [...states.entries()].sort((a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target) || a[1].cost - b[1].cost)[0]
  return best?.[1].values ?? null
}

function factKey(candidate: Candidate): string {
  const [a, b, c] = candidate.operands
  return candidate.operation === 'addition' ? `add:${Math.min(a, b)}:${Math.max(a, b)}:${c}` : `sub:${a}:${b}:${c}`
}

function matchSlots(slots: readonly Slot[], rng: RandomSource): { slot: Slot; candidate: Candidate }[] | null {
  const shuffled = slots.map(slot => ({ ...slot, pool: shuffle(slot.pool, rng) }))
  const order = shuffled.map((_, i) => i).sort((a, b) => shuffled[a].pool.length - shuffled[b].pool.length)
  const owners = new Map<string, number>()
  const picked = new Map<number, Candidate>()
  function assign(index: number, visitedSlots: Set<number>, visitedKeys: Set<string>): boolean {
    if (visitedSlots.has(index)) return false
    visitedSlots.add(index)
    for (const candidate of shuffled[index].pool) {
      const semanticKey = candidate.prompt
      if (visitedKeys.has(semanticKey)) continue
      visitedKeys.add(semanticKey)
      const owner = owners.get(semanticKey)
      if (owner === undefined || assign(owner, visitedSlots, visitedKeys)) {
        owners.set(semanticKey, index)
        picked.set(index, candidate)
        return true
      }
    }
    return false
  }
  for (const index of order) if (!assign(index, new Set(), new Set())) return null
  return shuffled.map((slot, index) => ({ slot, candidate: picked.get(index)! }))
}

function orderQuestions(items: ChallengeQuestion[], rng: RandomSource): ChallengeQuestion[] {
  const remaining = shuffle(items, rng)
  const ordered: ChallengeQuestion[] = []
  while (remaining.length) {
    const previous = ordered.at(-1)
    let best = 0
    let lowest = Infinity
    for (let i = 0; i < remaining.length; i += 1) {
      const q = remaining[i]
      const penalty = (previous?.factKey === q.factKey ? 100 : 0) + (previous?.level === q.level ? 10 : 0) + (previous?.operation === q.operation ? 1 : 0)
      if (penalty < lowest) { lowest = penalty; best = i }
      if (penalty === 0) break
    }
    ordered.push(remaining.splice(best, 1)[0])
  }
  return ordered
}

function plan(request: ChallengeSelection, count: number, seed: number): Plan {
  const buckets = buildBuckets(request, count, seed)
  if (buckets.some(bucket => bucket.count === 0)) return { ok: false, reason: 'Tidak semua sublevel terpilih mendapat satu soal dalam kuota level.' }
  const additions = operationCounts(buckets, request.mode, count)
  if (!additions) return { ok: false, reason: 'Kuota operasi seimbang tidak dapat dipenuhi dari pool terpilih.' }
  const bridges = bridgeCounts(buckets, additions)
  if (!bridges) return { ok: false, reason: 'Kuota Level 2 tidak dapat dipenuhi.' }
  const slots: Slot[] = []
  let bridgeIndex = 0
  for (let i = 0; i < buckets.length; i += 1) for (const operation of operations) {
    const bucket = buckets[i]
    const quota = operation === 'addition' ? additions[i] : bucket.count - additions[i]
    if (bucket.level !== 2) {
      for (let j = 0; j < quota; j += 1) slots.push({ bucket, pool: bucket.pools[operation] })
      continue
    }
    const targetBridge = bridges[bridgeIndex++]
    const bridgePool = bucket.pools[operation].filter(item => item.skillTags.includes('bridge-over-10'))
    const reinforcementPool = bucket.pools[operation].filter(item => !item.skillTags.includes('bridge-over-10'))
    for (let j = 0; j < targetBridge; j += 1) slots.push({ bucket, pool: bridgePool })
    for (let j = targetBridge; j < quota; j += 1) slots.push({ bucket, pool: reinforcementPool })
  }
  const rng = createSeededRng(seed)
  const matched = matchSlots(slots, rng)
  if (!matched) return { ok: false, reason: 'Pool unik tidak memenuhi alokasi level, sublevel, dan operasi.' }
  const positions = shuffle(Array.from({ length: count }, (_, i) => i % 4), rng)
  const sublevelSources = new Map<string, Level5Sublevel[]>()
  for (const bucket of buckets) if (bucket.sublevel) for (const operation of operations) for (const candidate of bucket.pools[operation]) {
    const sources = sublevelSources.get(candidate.prompt) ?? []
    if (!sources.includes(bucket.sublevel)) sources.push(bucket.sublevel)
    sublevelSources.set(candidate.prompt, sources)
  }
  let questions: ChallengeQuestion[]
  try {
    questions = matched.map(({ slot, candidate }, index) => ({
      ...instantiateChallengeCandidate(candidate, rng, positions[index]),
      semanticKey: candidate.prompt,
      factKey: factKey(candidate),
      ...(slot.bucket.sublevel ? { level5Sublevel: slot.bucket.sublevel, sourceSublevels: sublevelSources.get(candidate.prompt)! } : {}),
    }))
  } catch {
    return { ok: false, reason: 'Tidak cukup distractor sah untuk salah satu soal.' }
  }
  questions = orderQuestions(questions, rng)
  const byLevel = Object.fromEntries(allLevels.map(level => [level, questions.filter(q => q.level === level).length])) as Record<DrillLevel, number>
  const bySublevel = Object.fromEntries(allSublevels.map(sublevel => [sublevel, questions.filter(q => q.level5Sublevel === sublevel).length])) as Record<Level5Sublevel, number>
  const byOperation = Object.fromEntries(operations.map(operation => [operation, questions.filter(q => q.operation === operation).length])) as Record<Operation, number>
  const level2Bridge = questions.filter(q => q.level === 2 && q.skillTags.includes('bridge-over-10')).length
  const quota: ChallengeQuota = { byLevel, bySublevel, byOperation, level2Bridge: { target: Math.floor(0.7 * byLevel[2] + 0.5), actual: level2Bridge, reinforcement: byLevel[2] - level2Bridge } }
  return { ok: true, questions, quota }
}

export function getChallengeCapacity(selection: ChallengeSelection): ChallengeCapacity {
  if (selectionError(selection, 0)) return { feasibleCounts: [], maxCount: 0, uniqueByOperation: { addition: 0, subtraction: 0 } }
  const buckets = buildBuckets(selection, 50, 0)
  const uniqueByOperation = Object.fromEntries(operations.map(operation => [operation, new Set(buckets.flatMap(bucket => bucket.pools[operation].map(q => q.prompt))).size])) as Record<Operation, number>
  const feasibleCounts = counts.filter(count => plan(selection, count, 0).ok)
  return { feasibleCounts, maxCount: feasibleCounts.at(-1) ?? 0, uniqueByOperation }
}

export function validateChallengeRequest(request: ChallengeRequest): ChallengeValidation {
  const invalid = selectionError(request, request.count)
  if (invalid) return { ok: false, error: invalid }
  if (!counts.includes(request.count)) return { ok: false, error: error('INVALID_COUNT', 'Jumlah harus 10, 20, 30, atau 50.', request.count) }
  if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffffffff) return { ok: false, error: error('INVALID_SEED', 'Seed harus integer uint32.', request.count) }
  const roundSize = request.roundSize ?? defaultRoundSize
  if (!Number.isInteger(roundSize) || roundSize < 1 || roundSize > 20) return { ok: false, error: error('INVALID_ROUND_SIZE', 'Ukuran ronde harus 1 sampai 20.', request.count) }
  const capacity = getChallengeCapacity(request)
  const allocated = plan(request, request.count, request.seed)
  if (!allocated.ok) return { ok: false, error: error(capacity.maxCount >= request.count ? 'UNSATISFIABLE_ALLOCATION' : 'INSUFFICIENT_CAPACITY', allocated.reason, request.count, capacity.maxCount, { uniqueAddition: capacity.uniqueByOperation.addition, uniqueSubtraction: capacity.uniqueByOperation.subtraction }) }
  return { ok: true, capacity: capacity.maxCount, quota: allocated.quota }
}

export function generateChallengeSession(request: ChallengeRequest): ChallengeResult {
  const validation = validateChallengeRequest(request)
  if (!validation.ok) return validation
  const allocated = plan(request, request.count, request.seed)
  if (!allocated.ok) return { ok: false, error: error('UNSATISFIABLE_ALLOCATION', allocated.reason, request.count, validation.capacity) }
  const levels = [...request.selectedLevels].sort((a, b) => a - b)
  const sublevels = allSublevels.filter(sublevel => request.selectedLevel5Sublevels.includes(sublevel))
  const roundSize = request.roundSize ?? defaultRoundSize
  const rounds: ChallengeQuestion[][] = []
  for (let i = 0; i < allocated.questions.length; i += roundSize) rounds.push(allocated.questions.slice(i, i + roundSize))
  return { ok: true, session: {
    kind: 'challenge', version: 1, policyVersion: 1,
    id: `math-challenge-v1-${request.seed}-${levels.join('')}-${sublevels.join('.')}-${request.mode}-${request.count}-${roundSize}`,
    seed: request.seed, selectedLevels: levels, selectedLevel5Sublevels: sublevels, mode: request.mode,
    questions: allocated.questions, rounds, roundSize, quota: allocated.quota,
  } }
}
