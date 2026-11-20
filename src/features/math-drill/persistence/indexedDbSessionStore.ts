import { validateSavedSession } from './sessionCodec'
import {
  ACTIVE_SESSIONS_STORE,
  COMPLETED_SESSIONS_STORE,
  DATABASE_SCHEMA_VERSION,
  upgradeDatabaseSchema,
} from './databaseSchema'
import type { SavedChallengeSessionV1, SavedRegularSessionV1, SavedChallengeSessionV2, SavedRegularSessionV2, SavedSession, SavedSessionMode, SavedSessionValidation } from './sessionTypes'

export const SESSION_DATABASE_NAME = 'math-adventure'
/** Legacy single-store schema version (`activeSessions` only). Unchanged. */
export const SESSION_DATABASE_VERSION = 1
/**
 * Stage 7B-A2 (P0-1): the unified/live schema version is owned by
 * `databaseSchema.ts`, so the session/history store and the reward store open
 * the shared `math-adventure` database at the SAME version. Previously this was
 * `SESSION_DATABASE_VERSION + 1` (2) while the reward store opened at 4, which
 * made the second opener fail with `VersionError`.
 */
export const UNIFIED_DATABASE_VERSION = DATABASE_SCHEMA_VERSION
export const SESSION_OBJECT_STORE = ACTIVE_SESSIONS_STORE
export const HISTORY_OBJECT_STORE = COMPLETED_SESSIONS_STORE
export const UNIFIED_DISPOSABLE_DATABASE_PREFIX = 'math-adventure-stage5b2c-'
// This authority is deliberately not exported; ordinary v2 constructors stay disposable-only.
const LIVE_V2_AUTHORITY = Symbol('live-v2-explicit-composition')

export type SavedSessionDraft =
  | Omit<SavedRegularSessionV1, 'revision' | 'createdAt' | 'updatedAt'>
  | Omit<SavedChallengeSessionV1, 'revision' | 'createdAt' | 'updatedAt'>
  | Omit<SavedRegularSessionV2, 'revision' | 'createdAt' | 'updatedAt'>
  | Omit<SavedChallengeSessionV2, 'revision' | 'createdAt' | 'updatedAt'>

export interface SessionExpectation {
  readonly instanceId: string
  readonly sessionId: string
  readonly revision: number
}

export type SessionStoreErrorCode =
  | 'unavailable'
  | 'unsafe-database-name'
  | 'open-failed'
  | 'blocked'
  | 'unsupported-database-version'
  | 'quota-exceeded'
  | 'incompatible-database'
  | 'transaction-failed'
  | 'revision-exhausted'
  | 'unexpected'

export type SessionConflictReason =
  | 'slot-exists'
  | 'slot-missing'
  | 'identity-mismatch'
  | 'revision-mismatch'
  | 'replacement-instance-required'
  | 'stored-identity-unavailable'

export type SessionLoadResult =
  | { readonly status: 'empty' }
  | { readonly status: 'valid'; readonly value: SavedSession }
  | { readonly status: 'corrupt'; readonly issues: readonly string[]; readonly observed?: SessionExpectation }
  | { readonly status: 'unsupported-version'; readonly versionKind: string; readonly version: number; readonly observed?: SessionExpectation }
  | { readonly status: 'storage-error'; readonly code: SessionStoreErrorCode }

export type SessionWriteResult =
  | { readonly status: 'success'; readonly value: SavedSession }
  | { readonly status: 'conflict'; readonly reason: SessionConflictReason }
  | { readonly status: 'corrupt'; readonly issues: readonly string[] }
  | { readonly status: 'unsupported-version'; readonly versionKind: string; readonly version: number }
  | { readonly status: 'storage-error'; readonly code: SessionStoreErrorCode }

export interface IndexedDbSessionStore {
  load(mode: SavedSessionMode): Promise<SessionLoadResult>
  create(snapshot: SavedSessionDraft): Promise<SessionWriteResult>
  save(snapshot: SavedSession, expected: SessionExpectation): Promise<SessionWriteResult>
  replace(snapshot: SavedSessionDraft, expected: SessionExpectation): Promise<SessionWriteResult>
  close(): void
}

export interface IndexedDbSessionStoreOptions {
  readonly indexedDB?: IDBFactory | null
  readonly databaseName?: string
}

type Failure = Extract<SavedSessionValidation, { readonly status: 'corrupt' | 'unsupported-version' }>
type Decision<T> = { done: false } | { done: true; value: T }
type UnknownRecord = Record<string, unknown>

class StoreFault extends Error {
  readonly code: SessionStoreErrorCode

  constructor(code: SessionStoreErrorCode) {
    super(code)
    this.code = code
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validExpected(value: unknown): value is SessionExpectation {
  return isRecord(value) && typeof value.instanceId === 'string' && value.instanceId.length > 0
    && typeof value.sessionId === 'string' && value.sessionId.length > 0
    && Number.isSafeInteger(value.revision) && (value.revision as number) > 0
}

function writeFailure(value: Failure): SessionWriteResult {
  return value.status === 'corrupt'
    ? { status: 'corrupt', issues: value.issues }
    : { status: 'unsupported-version', versionKind: value.versionKind, version: value.version }
}

function validateDraft(snapshot: SavedSessionDraft, revision: number, now: number, createdAt = now): SavedSessionValidation {
  if (!isRecord(snapshot)) return { status: 'corrupt', issues: ['RECORD_NOT_OBJECT'] }
  return validateSavedSession({ ...snapshot, revision, createdAt, updatedAt: now })
}

function classify(mode: SavedSessionMode, raw: unknown): SessionLoadResult {
  if (raw === undefined) return { status: 'empty' }
  if (!isRecord(raw)) return { status: 'corrupt', issues: ['RECORD_NOT_OBJECT'] }
  if (raw.mode !== mode) return { status: 'corrupt', issues: ['MODE_KEY_MISMATCH'] }
  const result = validateSavedSession(raw)
  if (result.status === 'valid') return { status: 'valid', value: result.value }
  const observed = typeof raw.instanceId === 'string' && typeof raw.sessionId === 'string' && Number.isSafeInteger(raw.revision)
    ? { instanceId: raw.instanceId, sessionId: raw.sessionId, revision: raw.revision as number }
    : undefined
  if (result.status === 'corrupt') return { status: 'corrupt', issues: result.issues, ...(observed ? { observed } : {}) }
  return { status: 'unsupported-version', versionKind: result.versionKind, version: result.version, ...(observed ? { observed } : {}) }
}

function storageError<T>(code: SessionStoreErrorCode): T {
  return { status: 'storage-error', code } as T
}

export class NativeIndexedDbSessionStore implements IndexedDbSessionStore {
  private readonly factory: IDBFactory | null
  private readonly databaseName: string
  private readonly databaseVersion: number
  private readonly liveAuthorization: symbol | undefined
  private database: IDBDatabase | null = null
  private opening: Promise<IDBDatabase> | null = null
  private closed = false

  constructor(options: IndexedDbSessionStoreOptions = {}, databaseVersion = SESSION_DATABASE_VERSION, liveAuthorization?: symbol) {
    const browserIndexedDB = (globalThis as typeof globalThis & { indexedDB?: IDBFactory }).indexedDB
    this.factory = options.indexedDB === undefined ? browserIndexedDB ?? null : options.indexedDB
    this.databaseName = options.databaseName ?? SESSION_DATABASE_NAME
    this.databaseVersion = databaseVersion
    this.liveAuthorization = liveAuthorization
  }

  async load(mode: SavedSessionMode): Promise<SessionLoadResult> {
    return this.transact(mode, 'readonly', (raw, _store, decide) => decide(classify(mode, raw)))
  }

  async create(snapshot: SavedSessionDraft): Promise<SessionWriteResult> {
    const checked = validateDraft(snapshot, 1, Date.now())
    if (checked.status !== 'valid') return writeFailure(checked)
    return this.transact(checked.value.mode, 'readwrite', (raw, store, decide, failed) => {
      if (raw !== undefined) {
        const existing = classify(checked.value.mode, raw)
        if (existing.status === 'valid') decide({ status: 'conflict', reason: 'slot-exists' })
        else if (existing.status === 'corrupt' || existing.status === 'unsupported-version') decide(existing)
        else decide({ status: 'conflict', reason: 'slot-exists' })
        return
      }
      this.put(store, checked.value, { status: 'success', value: checked.value }, decide, failed)
    })
  }

  async save(snapshot: SavedSession, expected: SessionExpectation): Promise<SessionWriteResult> {
    const checked = validateSavedSession(snapshot)
    if (checked.status !== 'valid') return writeFailure(checked)
    if (!validExpected(expected) || snapshot.instanceId !== expected.instanceId || snapshot.sessionId !== expected.sessionId) return { status: 'conflict', reason: 'identity-mismatch' }
    if (snapshot.revision !== expected.revision) return { status: 'conflict', reason: 'revision-mismatch' }
    return this.transact(snapshot.mode, 'readwrite', (raw, store, decide, failed) => {
      if (raw === undefined) { decide({ status: 'conflict', reason: 'slot-missing' }); return }
      const current = classify(snapshot.mode, raw)
      if (current.status === 'corrupt' || current.status === 'unsupported-version') { decide(current); return }
      if (current.status !== 'valid') { decide({ status: 'conflict', reason: 'slot-missing' }); return }
      if (current.value.instanceId !== expected.instanceId || current.value.sessionId !== expected.sessionId) { decide({ status: 'conflict', reason: 'identity-mismatch' }); return }
      if (current.value.revision !== expected.revision) { decide({ status: 'conflict', reason: 'revision-mismatch' }); return }
      if (current.value.revision >= Number.MAX_SAFE_INTEGER) { decide(storageError('revision-exhausted')); return }
      const next = validateSavedSession({ ...snapshot, revision: current.value.revision + 1, createdAt: current.value.createdAt, updatedAt: Math.max(Date.now(), current.value.updatedAt) })
      if (next.status !== 'valid') { decide(writeFailure(next)); return }
      this.put(store, next.value, { status: 'success', value: next.value }, decide, failed)
    })
  }

  async replace(snapshot: SavedSessionDraft, expected: SessionExpectation): Promise<SessionWriteResult> {
    if (!validExpected(expected)) return { status: 'conflict', reason: 'identity-mismatch' }
    const checked = validateDraft(snapshot, 1, Date.now())
    if (checked.status !== 'valid') return writeFailure(checked)
    if (checked.value.instanceId === expected.instanceId) return { status: 'conflict', reason: 'replacement-instance-required' }
    return this.transact(checked.value.mode, 'readwrite', (raw, store, decide, failed) => {
      if (raw === undefined) { decide({ status: 'conflict', reason: 'slot-missing' }); return }
      const current = classify(checked.value.mode, raw)
      if (current.status === 'corrupt' || current.status === 'unsupported-version') { decide(current); return }
      if (current.status !== 'valid') { decide({ status: 'conflict', reason: 'slot-missing' }); return }
      if (current.value.instanceId !== expected.instanceId || current.value.sessionId !== expected.sessionId) {
        decide({ status: 'conflict', reason: 'identity-mismatch' }); return
      }
      if (current.value.revision !== expected.revision) {
        decide({ status: 'conflict', reason: 'revision-mismatch' }); return
      }
      if (expected.revision >= Number.MAX_SAFE_INTEGER) { decide(storageError('revision-exhausted')); return }
      const now = Date.now()
      const next = validateDraft(snapshot, expected.revision + 1, now, now)
      if (next.status !== 'valid') { decide(writeFailure(next)); return }
      this.put(store, next.value, { status: 'success', value: next.value }, decide, failed)
    })
  }

  close(): void {
    this.closed = true
    this.database?.close()
    this.database = null
    this.opening = null
  }

  private put<T>(store: IDBObjectStore, value: SavedSession, success: T, decide: (value: T) => void, failed: () => void): void {
    const request = store.put(value)
    request.onerror = failed
    decide(success)
  }

  private async transact<T>(mode: SavedSessionMode, txMode: IDBTransactionMode, onRecord: (raw: unknown, store: IDBObjectStore, decide: (value: T) => void, failed: () => void) => void): Promise<T | { status: 'storage-error'; code: SessionStoreErrorCode }> {
    let db: IDBDatabase
    try { db = await this.openDatabase() }
    catch (error) { return storageError(error instanceof StoreFault ? error.code : 'open-failed') }
    return new Promise(resolve => {
      let settled = false
      let result: Decision<T> = { done: false }
      let failedCode: SessionStoreErrorCode | null = null
      const finish = (value: T | { status: 'storage-error'; code: SessionStoreErrorCode }) => { if (!settled) { settled = true; resolve(value) } }
      const decide = (value: T) => { result = { done: true, value } }
      const failed = (event?: Event) => {
        const error = (event?.target as { error?: DOMException | null } | null)?.error
        failedCode ??= error?.name === 'QuotaExceededError' ? 'quota-exceeded' : 'transaction-failed'
      }
      try {
        const tx = db.transaction(SESSION_OBJECT_STORE, txMode)
        const store = tx.objectStore(SESSION_OBJECT_STORE)
        const request = store.get(mode)
        request.onerror = failed
        tx.onerror = failed
        tx.onabort = () => finish(storageError(failedCode ?? (tx.error?.name === 'QuotaExceededError' ? 'quota-exceeded' : 'transaction-failed')))
        tx.oncomplete = () => finish(failedCode ? storageError(failedCode) : result.done ? result.value : storageError('unexpected'))
        request.onsuccess = () => {
          try { onRecord(request.result, store, decide, failed) }
          catch { failedCode = 'transaction-failed'; try { tx.abort() } catch { finish(storageError(failedCode)) } }
        }
      } catch { finish(storageError('transaction-failed')) }
    })
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databaseVersion !== SESSION_DATABASE_VERSION && this.databaseVersion !== UNIFIED_DATABASE_VERSION) {
      return Promise.reject(new StoreFault('unsupported-database-version'))
    }
    const disposable = this.databaseName.startsWith(UNIFIED_DISPOSABLE_DATABASE_PREFIX)
    const authorizedLive = this.databaseName === SESSION_DATABASE_NAME && this.liveAuthorization === LIVE_V2_AUTHORITY
    if (this.databaseVersion === UNIFIED_DATABASE_VERSION && !disposable && !authorizedLive) {
      return Promise.reject(new StoreFault('unsafe-database-name'))
    }
    if (this.closed || !this.factory) return Promise.reject(new StoreFault('unavailable'))
    if (this.database) return Promise.resolve(this.database)
    if (this.opening) return this.opening
    this.opening = new Promise((resolve, reject) => {
      let settled = false
      let openError: SessionStoreErrorCode = 'open-failed'
      const fail = (code: SessionStoreErrorCode) => { if (!settled) { settled = true; this.opening = null; reject(new StoreFault(code)) } }
      let request: IDBOpenDBRequest
      try { request = this.factory!.open(this.databaseName, this.databaseVersion) }
      catch { fail('open-failed'); return }
      request.onupgradeneeded = () => {
        try {
          const db = request.result
          const tx = request.transaction
          if (this.databaseVersion === UNIFIED_DATABASE_VERSION) {
            // Stage 7B-A2 (P0-1): one shared, additive upgrade path creates
            // activeSessions, completedSessions (+ indexes) AND the reward
            // stores, so both owners always see the identical schema.
            upgradeDatabaseSchema(db, tx)
            return
          }
          let active: IDBObjectStore
          if (!db.objectStoreNames.contains(SESSION_OBJECT_STORE)) active = db.createObjectStore(SESSION_OBJECT_STORE, { keyPath: 'mode' })
          else {
            active = tx!.objectStore(SESSION_OBJECT_STORE)
            if (active.keyPath !== 'mode') throw new Error('active-key-path')
          }
        } catch {
          openError = 'incompatible-database'
          try { request.transaction?.abort() } catch { /* open request reports failure */ }
        }
      }
      request.onerror = () => fail(openError !== 'open-failed' ? openError : request.error?.name === 'VersionError' ? 'unsupported-database-version' : 'open-failed')
      request.onblocked = () => fail('blocked')
      request.onsuccess = () => {
        const db = request.result
        if (settled || this.closed) { db.close(); return }
        try {
          if (db.version !== this.databaseVersion || !db.objectStoreNames.contains(SESSION_OBJECT_STORE)
            || db.transaction(SESSION_OBJECT_STORE, 'readonly').objectStore(SESSION_OBJECT_STORE).keyPath !== 'mode') {
            db.close(); fail('incompatible-database'); return
          }
          if (this.databaseVersion === UNIFIED_DATABASE_VERSION) {
            if (!db.objectStoreNames.contains(HISTORY_OBJECT_STORE)) { db.close(); fail('incompatible-database'); return }
            const history = db.transaction(HISTORY_OBJECT_STORE, 'readonly').objectStore(HISTORY_OBJECT_STORE)
            if (history.keyPath !== 'instanceId' || !history.indexNames.contains('recordedAt') || !history.indexNames.contains('sessionId')
              || history.index('recordedAt').keyPath !== 'recordedAt' || history.index('recordedAt').unique
              || history.index('sessionId').keyPath !== 'sessionId' || history.index('sessionId').unique) {
              db.close(); fail('incompatible-database'); return
            }
          }
          db.onversionchange = () => { db.close(); this.database = null; this.opening = null }
          this.database = db; settled = true; resolve(db)
        } catch { db.close(); fail('incompatible-database') }
      }
    })
    return this.opening
  }

  openDatabaseForHistory(): Promise<IDBDatabase> {
    return this.openDatabase()
  }
}

export function createIndexedDbSessionStore(options: IndexedDbSessionStoreOptions = {}): IndexedDbSessionStore {
  return new NativeIndexedDbSessionStore(options)
}

/** Only an explicit live composition can use this exact-name, v2-only owner. */
export function createLiveVersion2SessionStore(): NativeIndexedDbSessionStore {
  return new NativeIndexedDbSessionStore({ databaseName: SESSION_DATABASE_NAME }, UNIFIED_DATABASE_VERSION, LIVE_V2_AUTHORITY)
}

export type SessionValidation = SavedSessionValidation
