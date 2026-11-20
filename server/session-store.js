/**
 * Stage 7B-A2 blocker remediation — single reader/writer for `sessions.json`.
 *
 * Why this module exists
 * ----------------------
 * `sessions.json` is the ONLY input of the authoritative reward balance. Before
 * this module it was read through a helper that turned every failure into
 * `{ sessions: [] }` (a confident balance of 0) and written with a plain
 * `writeFileSync` after an unserialized read-modify-write (lost updates and
 * truncated files under concurrency). Both failure modes silently destroy
 * earned stars, so the file now has the same two guarantees the reward ledger
 * already had:
 *
 *   1. STRICT READ. A missing file is a legitimate empty collection (fresh
 *      install). An unreadable or corrupt file THROWS (`sessions-unreadable:`
 *      / `sessions-corrupt:`) and is never reported as empty, so a corrupt file
 *      can neither produce a fake zero balance nor be silently overwritten by
 *      the next append.
 *   2. SERIALIZED, ATOMIC WRITE. Every mutation runs inside a process-wide
 *      queue (no read-modify-write interleaving, so no acknowledged update is
 *      lost) and lands through a tmp file + rename (no half-written JSON).
 *
 * Guarantee boundary (deliberately not overclaimed)
 * -------------------------------------------------
 * These guarantees are linearizable *within one server process*, which is the
 * deployment model of this app (a single local Node process). They are NOT a
 * multi-process lock and NOT a database transaction: two server processes
 * sharing one data directory can still interleave, and `sessions.json` and
 * `reward-ledger.json` are separate files, so writing a session and later
 * computing a balance is not one atomic step. The balance is derived on demand
 * from the session collection, which is what makes a retry safe: a crash after
 * the session is committed but before the response only causes the client to
 * retry, and the retry is rejected as a duplicate instead of being counted
 * twice.
 */

import fs from 'fs'
import path from 'path'

/**
 * Reads the session document strictly.
 *
 * @param {string} filePath absolute path of sessions.json
 * @returns {{ sessions: any[], lastUpdated: number }}
 */
export function readSessionsDocument(filePath) {
  let raw
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { sessions: [], lastUpdated: 0 }
    throw new Error(`sessions-unreadable: ${error && error.message ? error.message : 'unknown'}`)
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('sessions-corrupt: invalid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('sessions-corrupt: unexpected root value')
  }
  if (!Array.isArray(parsed.sessions)) {
    throw new Error('sessions-corrupt: sessions-not-array')
  }
  return {
    sessions: parsed.sessions,
    lastUpdated: typeof parsed.lastUpdated === 'number' ? parsed.lastUpdated : 0,
  }
}

/** True for the storage errors this module raises (used for HTTP mapping). */
export function isSessionStorageError(error) {
  const message = error instanceof Error ? error.message : ''
  return message.startsWith('sessions-unreadable:') || message.startsWith('sessions-corrupt:')
}

export class SessionStore {
  /**
   * @param {object} options
   * @param {string} options.filePath absolute path of sessions.json
   * @param {() => number} [options.now]
   */
  constructor({ filePath, now = () => Date.now() }) {
    this.filePath = filePath
    this.now = now
    this.queue = Promise.resolve()
  }

  /** Serializes every read-modify-write cycle (same contract as the ledger). */
  withLock(operation) {
    const run = this.queue.then(operation, operation)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  /** Strict read. Throws on corrupt/unreadable; never returns a fake empty list. */
  read() {
    return readSessionsDocument(this.filePath)
  }

  /** @returns {any[]} */
  list() {
    return this.read().sessions
  }

  /** @returns {any|null} */
  find(instanceId) {
    const match = this.list().find(session => session && session.instanceId === instanceId)
    return match === undefined ? null : match
  }

  /** Atomic write: a reader never observes a partially written file. */
  write(document) {
    const payload = { ...document, lastUpdated: this.now() }
    const temporary = `${this.filePath}.tmp`
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      fs.writeFileSync(temporary, JSON.stringify(payload, null, 2))
      fs.renameSync(temporary, this.filePath)
      return true
    } catch (error) {
      try { fs.unlinkSync(temporary) } catch { /* best effort cleanup */ }
      console.error('[session-store] write failed:', error.message)
      return false
    }
  }

  /**
   * Creates the file only when it is genuinely absent. A corrupt file is left
   * untouched for an operator to inspect instead of being replaced by an empty
   * collection.
   */
  initialize() {
    if (fs.existsSync(this.filePath)) return false
    return this.write({ sessions: [] })
  }

  /**
   * Appends one record.
   *
   * Identity is the session's own `instanceId`: an existing record with the same
   * id is reported as `duplicate` and nothing is written, so a retry can never
   * create a second reward input.
   *
   * @returns {Promise<{status:'created',session:any}|{status:'duplicate',session:any}|{status:'storage-error'}>}
   */
  async append(record) {
    return this.withLock(() => {
      // Throws on corruption: a corrupt file is never overwritten by an append.
      const document = this.read()
      const duplicate = document.sessions.find(session => session && session.instanceId === record.instanceId)
      if (duplicate) return { status: 'duplicate', session: duplicate }

      const next = { ...document, sessions: [...document.sessions, record] }
      if (!this.write(next)) return { status: 'storage-error' }
      return { status: 'created', session: record }
    })
  }

  /**
   * Read-modify-write under the lock. `operation` receives a copy of the array
   * and returns `{status:'ok', sessions}` or `{status:'not-found'}` /
   * `{status:'invalid', issues}`.
   */
  async mutate(operation) {
    return this.withLock(() => {
      const document = this.read()
      const outcome = operation([...document.sessions])
      if (outcome.status !== 'ok') return outcome

      const next = { ...document, sessions: outcome.sessions }
      if (!this.write(next)) return { status: 'storage-error' }
      return { status: 'ok', sessions: outcome.sessions }
    })
  }
}
