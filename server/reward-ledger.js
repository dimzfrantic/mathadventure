/**
 * Stage 7B-A2 — Authoritative reward ledger for the local backend.
 *
 * Design constraints taken from the A1 audit (Option B, restricted):
 *   - ONE writer for the reward ledger: this module, in the server process.
 *   - ONE writer for completed sessions: `sessions.json` via POST /api/sessions.
 *   - The reward ALGORITHM is not re-implemented here: every computation and
 *     state transition is delegated to the canonical frontend implementation
 *     (`src/features/math-drill/reward/rewardCore.ts`), loaded through Node's
 *     built-in TypeScript type stripping.
 *
 * Persistence model: a single JSON document (`reward-ledger.json`) in the
 * server data directory, written atomically (tmp file + rename) and mutated
 * only inside a process-wide serialized queue. That is enough to make
 * concurrent HTTP requests linearizable *within one server process*, which is
 * the deployment model of this app (one local Node process). It is NOT a
 * multi-process/multi-host guarantee — see the A2 report, "Limitations".
 */

import fs from 'fs'
import path from 'path'

import { readSessionsDocument } from './session-store.js'

const CORE_URL = new URL('../src/features/math-drill/reward/rewardCore.ts', import.meta.url)

let corePromise = null

/**
 * Loads the canonical reward core. Kept lazy so a broken/missing core fails
 * with a clear diagnostic instead of crashing the whole server at import time.
 */
export function loadRewardCore() {
  if (!corePromise) {
    corePromise = import(CORE_URL.href).catch((error) => {
      corePromise = null
      throw new Error(`reward-core-unavailable: ${error.message}`)
    })
  }
  return corePromise
}

export const LEDGER_SCHEMA_VERSION = 1

export const DEFAULT_REWARD_CONFIG = Object.freeze({
  configId: 'active',
  version: 1,
  updatedAt: 0,
  rupiahPerStar: 500,
  minStarsPerRedemption: 1,
  maxStarsPerRedemption: 100,
})

function emptyLedger() {
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    updatedAt: 0,
    config: { ...DEFAULT_REWARD_CONFIG },
    transactions: [],
    corrections: [],
  }
}

/**
 * Reads the completed-session collection that feeds reward computation.
 * These records are written by POST /api/sessions — this module never writes
 * them, so there is exactly one writer for each data set.
 *
 * A missing file is an empty collection (fresh install). An unreadable or
 * corrupt file THROWS: swallowing the error here used to turn corruption into a
 * confident balance of 0, which is the one failure mode that silently deletes a
 * child's earned stars from the parent's view.
 */
export function readCompletedSessions(sessionsFilePath) {
  return readSessionsDocument(sessionsFilePath).sessions
}

const UUID_V4_PATTERN = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i

function isValidLegacyInstanceId(id) {
  if (typeof id !== 'string') return false
  if (id.length < 1 || id.length > 512) return false
  if (id.trim().length === 0) return false
  for (let i = 0; i < id.length; i++) {
    const code = id.charCodeAt(i)
    // Printable ASCII only: 32..126, rejecting control chars (<= 31, 127) and non-ASCII (>= 127)
    if (code <= 31 || code >= 127) return false
  }
  return true
}

function isValidLegacySessionId(id) {
  if (typeof id !== 'string') return false
  const trimmed = id.trim()
  if (trimmed.length === 0 || trimmed.length > 512) return false
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i)
    if (code <= 31 || code === 127) return false
  }
  return true
}

/**
 * Safely resolves a historical recording timestamp from legitimate candidate fields.
 * Validates that the timestamp represents a safe non-negative integer or an ISO/numeric
 * timestamp string convertible without loss of meaning.
 * Never guesses or falls back to Date.now().
 */
function resolveLegacyTimestamp(raw) {
  const candidates = [raw.recordedAt, raw.createdAt, raw.completedAt, raw.timestamp]
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue
    if (Number.isSafeInteger(candidate) && candidate >= 0) {
      return candidate
    }
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      const trimmed = candidate.trim()
      if (/^\d+$/.test(trimmed)) {
        const num = Number(trimmed)
        if (Number.isSafeInteger(num) && num >= 0) {
          return num
        }
      }
      const parsed = Date.parse(trimmed)
      if (Number.isSafeInteger(parsed) && parsed >= 0) {
        return parsed
      }
    }
  }
  return null
}

const FORBIDDEN_V2_TIMER_FIELDS = Object.freeze([
  'endReason',
  'plannedCount',
  'completedCount',
  'startedAt',
  'durationMs',
  'deadlineAt',
  'endedAt',
  'remainingMs',
])

/**
 * Stage 7B Legacy Compatibility Adapter (Read-only / in-memory projection).
 *
 * Evaluates whether an unversioned record matches the verified historical
 * contract. If valid, projects it into a canonical V1 record with
 * `provenance: 'legacy-last-result'` and `completedAt: null`.
 *
 * Never mutates input, never writes to storage. Returns the adapted canonical
 * record if valid, or the original raw record if not an unversioned candidate
 * or if rejected by validation.
 */
export function adaptLegacyCompletedSession(raw, core) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw
  }

  // 1. If historySchemaVersion property is present on the object (even if null,
  // undefined, string, or wrong type), do NOT adapt.
  // The canonical validator will inspect and reject non-integer/unsupported versions.
  if (Object.hasOwn(raw, 'historySchemaVersion')) {
    return raw
  }

  // 2. Reject unversioned records that carry any V2 timer metadata
  if (FORBIDDEN_V2_TIMER_FIELDS.some(field => Object.hasOwn(raw, field))) {
    return raw
  }

  // 3. Strict legacy shape and identity checks
    if (!isValidLegacyInstanceId(raw.instanceId)) {
      return raw
    }
  if (!isValidLegacySessionId(raw.sessionId)) {
    return raw
  }
  if (raw.mode !== 'regular' && raw.mode !== 'challenge') {
    return raw
  }

  const recordedAt = resolveLegacyTimestamp(raw)
  if (recordedAt === null) {
    return raw
  }

  if (!Array.isArray(raw.outcomes) || raw.outcomes.length < 1 || raw.outcomes.length > 500) {
    return raw
  }

  // 4. Project outcomes to canonical shape without mutating input or losing scoring facts
  const projectedOutcomes = []
  for (const item of raw.outcomes) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return raw
    }
    if (!Object.hasOwn(item, 'level') || !Object.hasOwn(item, 'operation') || !Object.hasOwn(item, 'points')) {
      return raw
    }
    const projected = {
      level: item.level,
      operation: item.operation,
      points: item.points,
    }
    if (Object.hasOwn(item, 'level5Sublevel') && item.level5Sublevel !== undefined) {
      projected.level5Sublevel = item.level5Sublevel
    }
    projectedOutcomes.push(projected)
  }

  // 5. Resolve operationMode (either present or deduced from outcomes)
  let opMode = raw.operationMode
  if (opMode === undefined) {
    const ops = new Set(projectedOutcomes.map(item => item.operation))
    if (ops.size === 1 && (ops.has('addition') || ops.has('subtraction'))) {
      opMode = ops.values().next().value
    } else if (ops.size > 1 && [...ops].every(op => op === 'addition' || op === 'subtraction')) {
      opMode = 'mixed'
    } else {
      return raw
    }
  } else if (opMode !== 'addition' && opMode !== 'subtraction' && opMode !== 'mixed') {
    return raw
  }

  // 6. Fail-closed: require core and its canonical validator to project legacy candidate.
  // If core or validator is unavailable, never produce an unverified adapted record.
  if (!core || typeof core.validateCompletedSession !== 'function') {
    return raw
  }

  // 7. Build canonical V1 candidate
  const candidateV1 = {
    historySchemaVersion: 1,
    instanceId: raw.instanceId,
    sessionId: raw.sessionId,
    mode: raw.mode,
    operationMode: opMode,
    completedAt: null,
    recordedAt,
    provenance: 'legacy-last-result',
    outcomes: projectedOutcomes,
  }

  // 8. Final verification via canonical validator
  const validation = core.validateCompletedSession(candidateV1)
  if (validation.status === 'valid') {
    return validation.value
  }

  return raw
}

export class RewardLedger {
  /**
   * @param {object} options
   * @param {string} options.ledgerFilePath absolute path of reward-ledger.json
   * @param {string} options.sessionsFilePath absolute path of sessions.json
   * @param {{list: () => any[]}} [options.sessionStore] shared reader for
   *   sessions.json, so reward computation and session writes use one object
   *   with one strict-read policy
   * @param {() => number} [options.now]
   */
  constructor({ ledgerFilePath, sessionsFilePath, sessionStore = null, now = () => Date.now() }) {
    this.ledgerFilePath = ledgerFilePath
    this.sessionsFilePath = sessionsFilePath
    this.sessionStore = sessionStore
    this.now = now
    this.queue = Promise.resolve()
  }

  /**
   * Serializes every read-modify-write cycle. Concurrent HTTP requests are
   * therefore applied one after another, which is what prevents two requests
   * from spending the same stars (no optimistic double-spend window).
   */
  withLock(operation) {
    const run = this.queue.then(operation, operation)
    // Keep the chain alive even if an operation rejects.
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * Reads the ledger. A MISSING file is a legitimate empty ledger (fresh
   * install). An UNREADABLE or CORRUPT file is never treated as empty: doing so
   * would report a confident balance of 0 and let the next mutation overwrite
   * the only copy of acknowledged transactions. Corruption therefore throws,
   * and every caller turns it into an error response.
   */
  read() {
    let raw
    try {
      raw = fs.readFileSync(this.ledgerFilePath, 'utf-8')
    } catch (error) {
      if (error && error.code === 'ENOENT') return emptyLedger()
      throw new Error(`ledger-unreadable: ${error && error.message ? error.message : 'unknown'}`)
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('ledger-corrupt: invalid JSON')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('ledger-corrupt: unexpected root value')
    }
    return {
      schemaVersion: LEDGER_SCHEMA_VERSION,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      config: parsed.config && typeof parsed.config === 'object' ? parsed.config : { ...DEFAULT_REWARD_CONFIG },
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
    }
  }

  /** Atomic write: never leaves a truncated ledger behind. */
  write(ledger) {
    const payload = { ...ledger, schemaVersion: LEDGER_SCHEMA_VERSION, updatedAt: this.now() }
    const temporary = `${this.ledgerFilePath}.tmp`
    try {
      fs.mkdirSync(path.dirname(this.ledgerFilePath), { recursive: true })
      fs.writeFileSync(temporary, JSON.stringify(payload, null, 2))
      fs.renameSync(temporary, this.ledgerFilePath)
      return true
    } catch (error) {
      try { fs.unlinkSync(temporary) } catch { /* best effort cleanup */ }
      console.error('[reward-ledger] write failed:', error.message)
      return false
    }
  }

  sessions(core = null) {
    const rawSessions = this.sessionStore ? this.sessionStore.list() : readCompletedSessions(this.sessionsFilePath)
    return rawSessions.map(session => adaptLegacyCompletedSession(session, core))
  }

  /** Builds the authoritative view returned to clients (never trusts client numbers). */
  async snapshot() {
    const core = await loadRewardCore()
    const ledger = this.read()
    const sessions = this.sessions(core)
    const configValidation = core.validateRewardConfig(ledger.config)
    const config = configValidation.status === 'valid' ? configValidation.value : { ...DEFAULT_REWARD_CONFIG }
    const balance = core.computeAvailableBalance(sessions, ledger.transactions, ledger.corrections)
    return {
      config,
      configValid: configValidation.status === 'valid',
      transactions: ledger.transactions,
      corrections: ledger.corrections,
      balance,
      sessions,
    }
  }

  async getState() {
    const snapshot = await this.snapshot()
    return { status: 'success', ...snapshot }
  }

  /**
   * Submits a redemption request.
   *
   * Idempotency: replaying the SAME transactionId with the SAME substantive
   * content returns the stored transaction (no second record). Reusing the id
   * with DIFFERENT content is a conflict, never a silent overwrite.
   */
  async submitTransaction({ transactionId, starsRedeemed }, { childRequest = false } = {}) {
    return this.withLock(async () => {
      const core = await loadRewardCore()
      const ledger = this.read()
      const existing = ledger.transactions.find(transaction => transaction.transactionId === transactionId)

      if (existing) {
        // The only substantive client input is `starsRedeemed`; an identical
        // replay is idempotent, anything else is a conflict (never overwrite).
        if (existing.starsRedeemed === starsRedeemed) {
          return { status: 'success', transaction: existing, idempotent: true }
        }
        return { status: 'conflict', reason: 'conflicting-transaction-content', transaction: existing }
      }

      const configValidation = core.validateRewardConfig(ledger.config)
      // Child submissions must not silently fall back to defaults or spend
      // stars removed by corrections. Keep this check inside the same lock.
      if (childRequest && configValidation.status !== 'valid') return { status: 'error', reason: 'invalid-config' }
      const config = configValidation.status === 'valid' ? configValidation.value : { ...DEFAULT_REWARD_CONFIG }
      const sessions = this.sessions(core)
      if (childRequest) {
        const balance = core.computeAvailableBalance(sessions, ledger.transactions, ledger.corrections)
        if (!balance.isLedgerConsistent) return { status: 'error', reason: 'ledger-inconsistent' }
        if (balance.availableBalance < starsRedeemed) return { status: 'error', reason: 'insufficient-balance' }
      }

      const result = core.submitRedemptionRequest({
        transactionId,
        starsRedeemed,
        requestedAt: this.now(),
        config,
        completedSessions: sessions,
        existingTransactions: ledger.transactions,
      })
      if (result.status !== 'success') return result

      const next = { ...ledger, transactions: [...ledger.transactions, result.transaction] }
      if (!this.write(next)) return { status: 'error', reason: 'storage-error' }
      return { status: 'success', transaction: result.transaction }
    })
  }

  async confirmTransaction(transactionId) {
    return this.transition(transactionId, 'confirmed')
  }

  async cancelTransaction(transactionId) {
    return this.transition(transactionId, 'cancelled')
  }

  /**
   * Shared confirm/cancel transition. Terminal states are immutable: repeating
   * the SAME terminal transition is idempotent, the OPPOSITE one is a conflict.
   */
  async transition(transactionId, target) {
    return this.withLock(async () => {
      const core = await loadRewardCore()
      const ledger = this.read()
      const existing = ledger.transactions.find(transaction => transaction.transactionId === transactionId)
      if (!existing) return { status: 'error', reason: 'transaction-not-found' }

      if (existing.status === target) return { status: 'success', transaction: existing, idempotent: true }
      if (existing.status !== 'pending') {
        return { status: 'error', reason: 'transaction-not-pending', transaction: existing }
      }

      const sessions = this.sessions(core)
      const result = target === 'confirmed'
        ? core.confirmRedemptionTransaction({
            transactionId,
            confirmedAt: this.now(),
            completedSessions: sessions,
            existingTransactions: ledger.transactions,
          })
        : core.cancelRedemptionTransaction({
            transactionId,
            cancelledAt: this.now(),
            existingTransactions: ledger.transactions,
          })
      if (result.status !== 'success') return result

      const transactions = ledger.transactions.map(transaction =>
        transaction.transactionId === transactionId ? result.transaction : transaction)
      const next = { ...ledger, transactions }
      if (!this.write(next)) return { status: 'error', reason: 'storage-error' }
      return { status: 'success', transaction: result.transaction }
    })
  }

  async saveConfig(updates) {
    return this.withLock(async () => {
      const core = await loadRewardCore()
      const ledger = this.read()
      const currentValidation = core.validateRewardConfig(ledger.config)
      const current = currentValidation.status === 'valid' ? currentValidation.value : { ...DEFAULT_REWARD_CONFIG }
      const candidate = {
        ...current,
        ...updates,
        configId: 'active',
        version: current.version + 1,
        updatedAt: this.now(),
      }
      const validation = core.validateRewardConfig(candidate)
      if (validation.status !== 'valid') return { status: 'error', reason: 'invalid-config', issues: validation.issues }

      const next = { ...ledger, config: validation.value }
      if (!this.write(next)) return { status: 'error', reason: 'storage-error' }
      return { status: 'success', config: validation.value }
    })
  }

  async applyCorrection(params) {
    return this.withLock(async () => {
      const core = await loadRewardCore()
      const ledger = this.read()
      const correction = {
        correctionId: params.correctionId,
        originalTransactionId: params.originalTransactionId,
        ...(params.parentId !== undefined ? { parentId: params.parentId } : {}),
        starsDelta: params.starsDelta,
        reason: params.reason,
        createdAt: this.now(),
      }
      const validation = core.validateRewardCorrection(correction)
      if (validation.status !== 'valid') return { status: 'error', reason: 'invalid-correction', issues: validation.issues }

      const duplicate = ledger.corrections.find(entry => entry.correctionId === params.correctionId)
      if (duplicate) {
        const identical = JSON.stringify(duplicate) === JSON.stringify(validation.value)
        return identical
          ? { status: 'success', correction: duplicate, idempotent: true }
          : { status: 'error', reason: 'conflicting-correction-content' }
      }

      const original = ledger.transactions.find(transaction => transaction.transactionId === params.originalTransactionId)
      if (!original) return { status: 'error', reason: 'invalid-original-transaction' }
      if (original.status !== 'confirmed') return { status: 'error', reason: 'transaction-not-confirmed' }

      const sessions = this.sessions(core)
      const balance = core.computeAvailableBalance(sessions, ledger.transactions, ledger.corrections)
      if (!balance.isLedgerConsistent) return { status: 'error', reason: 'ledger-inconsistent' }
      if (params.starsDelta < 0 && balance.availableBalance + params.starsDelta < 0) {
        return { status: 'error', reason: 'insufficient-balance' }
      }

      const next = { ...ledger, corrections: [...ledger.corrections, validation.value] }
      if (!this.write(next)) return { status: 'error', reason: 'storage-error' }
      return { status: 'success', correction: validation.value }
    })
  }
}

/** HTTP status mapping for ledger result objects (kept next to the contract). */
export function statusForResult(result) {
  if (!result) return 500
  if (result.status === 'success') return 200
  switch (result.reason) {
    case 'transaction-not-found':
      return 404
    case 'storage-error':
    case 'ledger-inconsistent':
    case 'invalid-config':
      return 500
    case 'insufficient-balance':
    case 'insufficient-balance-upon-confirm':
    case 'conflict':
    case 'conflicting-transaction-content':
    case 'conflicting-correction-content':
    case 'transaction-not-pending':
    case 'transaction-not-confirmed':
    case 'invalid-original-transaction':
    case 'duplicate-transaction-id':
      return 409
    case 'below-min-stars':
    case 'above-max-stars':
    case 'invalid-transaction-id':
    case 'invalid-correction':
      return 400
    default:
      return 400
  }
}
