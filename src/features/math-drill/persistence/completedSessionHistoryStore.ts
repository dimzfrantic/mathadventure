import { compareCompletionContent, validateCompletedSession } from './completedSessionCodec'
import type { CompletedSessionRecord } from './completedSessionTypes'
import { validateSavedSession } from './sessionCodec'
import { projectCompletedSession } from './completedSessionProjection'
import type { SavedSession } from './sessionTypes'
import { SESSION_DATABASE_NAME, UNIFIED_DATABASE_VERSION, UNIFIED_DISPOSABLE_DATABASE_PREFIX, SESSION_OBJECT_STORE, HISTORY_OBJECT_STORE, NativeIndexedDbSessionStore, createLiveVersion2SessionStore } from './indexedDbSessionStore'
import type { IndexedDbSessionStore, SessionExpectation } from './indexedDbSessionStore'

export const HISTORY_DATABASE_VERSION = UNIFIED_DATABASE_VERSION
export { HISTORY_OBJECT_STORE }
export type HistoryStoreError = 'unavailable' | 'unsafe-database-name' | 'open-failed' | 'blocked' | 'unsupported-database-version' | 'incompatible-database' | 'transaction-failed' | 'quota-exceeded' | 'unexpected'
export type HistoryRecordResult =
  | { readonly status: 'found'; readonly value: CompletedSessionRecord }
  | { readonly status: 'not-found' }
  | { readonly status: 'corrupt-existing' }
  | { readonly status: 'unsupported-version'; readonly version: number }
  | { readonly status: 'storage-error'; readonly code: HistoryStoreError }
export type HistoryStoreResult =
  | { readonly status: 'inserted'; readonly value: CompletedSessionRecord }
  | { readonly status: 'already-exists-equivalent'; readonly value: CompletedSessionRecord }
  | { readonly status: 'conflict' }
  | { readonly status: 'invalid-record' }
  | { readonly status: 'corrupt-existing' }
  | { readonly status: 'unsupported-version'; readonly version: number }
  | { readonly status: 'storage-error'; readonly code: HistoryStoreError }
export type HistoryListResult =
  | { readonly status: 'success'; readonly records: readonly CompletedSessionRecord[]; readonly nextCursor?: { readonly recordedAt: number; readonly instanceId: string }; readonly invalidCount: number }
  | { readonly status: 'storage-error'; readonly code: HistoryStoreError }
export type AtomicCompletionResult = { readonly status: 'inserted' | 'already-exists-equivalent'; readonly value: CompletedSessionRecord; readonly snapshot: SavedSession } | Exclude<HistoryStoreResult, { readonly status: 'inserted' | 'already-exists-equivalent' }> | { readonly status: 'active-session-conflict' | 'invalid-snapshot' | 'invalid-history' } | { readonly status: 'unsupported-snapshot-version'; readonly versionKind: string; readonly version: number }
export type CompletionVerificationResult = { readonly status: 'committed' | 'not-committed' | 'conflict' | 'invalid-snapshot' | 'invalid-history' } | { readonly status: 'unsupported-snapshot-version'; readonly versionKind: string; readonly version: number } | Extract<HistoryStoreResult, { status: 'corrupt-existing' | 'unsupported-version' | 'storage-error' }>
export interface CompletedSessionHistoryStore {
  open(): Promise<{ readonly status: 'opened' } | { readonly status: 'storage-error'; readonly code: HistoryStoreError }>
  insert(value: unknown): Promise<HistoryStoreResult>
  get(instanceId: string): Promise<HistoryRecordResult>
  list(options?: { readonly limit?: number; readonly cursor?: { readonly recordedAt: number; readonly instanceId: string } }): Promise<HistoryListResult>
  commitResult(snapshot: unknown, expected: SessionExpectation, history: unknown): Promise<AtomicCompletionResult>
  verifyCommitted(snapshot: unknown, history: unknown): Promise<CompletionVerificationResult>
  close(): void
}
export interface CompletedSessionHistoryStoreOptions {
  readonly databaseName: string
  readonly indexedDB?: IDBFactory | null
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function validExpected(value: unknown): value is SessionExpectation {
  return isRecord(value) && typeof value.instanceId === 'string' && typeof value.sessionId === 'string' && Number.isSafeInteger(value.revision) && (value.revision as number) > 0
}
function validateExisting(value: unknown): HistoryRecordResult {
  const checked = validateCompletedSession(value)
  if (checked.status === 'valid') return { status: 'found', value: checked.value }
  if (checked.status === 'unsupported-version') return { status: 'unsupported-version', version: checked.version }
  return { status: 'corrupt-existing' }
}
function projectForRecord(snapshot: unknown, record: CompletedSessionRecord) {
  return record.historySchemaVersion === 1
    ? projectCompletedSession(snapshot, { completedAt: record.completedAt, recordedAt: record.recordedAt, provenance: record.provenance })
    : projectCompletedSession(snapshot, { recordedAt: record.recordedAt })
}
function isTerminalPhase(phase: string): boolean { return phase === 'result' || phase === 'timeout' }

function storageError<T extends { readonly status: string }>(code: HistoryStoreError): T { return { status: 'storage-error', code } as unknown as T }
function existingStoreFailure(value: HistoryRecordResult): Extract<HistoryStoreResult, { status: 'corrupt-existing' | 'unsupported-version' }> {
  if (value.status === 'unsupported-version') return value
  return { status: 'corrupt-existing' }
}

/** Unified adapter: disposable by default; exact live name requires a dedicated owner. */
function createHistoryStore(options: CompletedSessionHistoryStoreOptions, connectionProvider?: () => Promise<IDBDatabase>, exactLiveOwner = false): CompletedSessionHistoryStore {
  const databaseName = options.databaseName
  const disposable = !!databaseName && databaseName.startsWith(UNIFIED_DISPOSABLE_DATABASE_PREFIX)
  const authorizedLive = exactLiveOwner && !!connectionProvider && databaseName === SESSION_DATABASE_NAME
  const unsafeName = !disposable && !authorizedLive
  const owner = connectionProvider ? null : new NativeIndexedDbSessionStore(options, UNIFIED_DATABASE_VERSION)
  let closed = false
  function openDatabase(): Promise<IDBDatabase> {
    if (unsafeName) return Promise.reject(new Error('unsafe-database-name'))
    if (closed) return Promise.reject(new Error('unavailable'))
    if (connectionProvider) return connectionProvider()
    if (!owner) return Promise.reject(new Error('unavailable'))
    return owner.openDatabaseForHistory()
  }
  function codeFor(error: unknown): HistoryStoreError {
    const message = error instanceof Error ? error.message : ''
    if (message === 'unsafe-database-name') return 'unsafe-database-name'
    if (message === 'unavailable') return 'unavailable'
    if (message === 'blocked') return 'blocked'
    if (message === 'unsupported-database-version') return 'unsupported-database-version'
    if (message === 'incompatible-database') return 'incompatible-database'
    if (message === 'quota-exceeded') return 'quota-exceeded'
    return 'open-failed'
  }
  function transact<T>(stores: readonly string[], mode: IDBTransactionMode, work: (tx: IDBTransaction, finish: (value: T) => void) => void): Promise<T | { readonly status: 'storage-error'; readonly code: HistoryStoreError }> {
    return openDatabase().then(db => new Promise(resolve => {
      let decision: T | undefined, settled = false
      const end = (value: T | { readonly status: 'storage-error'; readonly code: HistoryStoreError }) => { if (!settled) { settled = true; resolve(value) } }
      try {
        const tx = db.transaction([...stores], mode)
        tx.oncomplete = () => end(decision === undefined ? storageError('transaction-failed') : decision)
        tx.onerror = () => undefined
        tx.onabort = () => end(storageError(tx.error?.name === 'QuotaExceededError' ? 'quota-exceeded' : 'transaction-failed'))
        work(tx, value => { decision = value })
      } catch { end(storageError('transaction-failed')) }
    }), error => storageError(codeFor(error)))
  }
  function classifyCandidate(value: unknown): { readonly status: 'valid'; readonly value: CompletedSessionRecord } | { readonly status: 'invalid-record' } | { readonly status: 'unsupported-version'; readonly version: number } {
    const checked = validateCompletedSession(value)
    if (checked.status === 'valid') return checked
    if (checked.status === 'unsupported-version') return checked
    return { status: 'invalid-record' }
  }
  function insert(value: unknown): Promise<HistoryStoreResult> {
    const candidateCheck = classifyCandidate(value)
    if (candidateCheck.status !== 'valid') return Promise.resolve(candidateCheck)
    const candidate = candidateCheck.value
    return transact([HISTORY_OBJECT_STORE], 'readwrite', (tx, finish) => {
      const store = tx.objectStore(HISTORY_OBJECT_STORE), request = store.get(candidate.instanceId)
      request.onerror = () => { try { tx.abort() } catch { /* abort event resolves */ } }
      request.onsuccess = () => {
        if (request.result !== undefined) {
          const existing = validateExisting(request.result)
          finish(existing.status === 'found' ? compareCompletionContent(existing.value, candidate) === 'equivalent' ? { status: 'already-exists-equivalent', value: existing.value } : { status: 'conflict' } : existingStoreFailure(existing))
          return
        }
        const add = store.add(candidate)
        add.onerror = () => { try { tx.abort() } catch { /* abort event resolves */ } }
        add.onsuccess = () => finish({ status: 'inserted', value: candidate })
      }
    })
  }
  function get(instanceId: string): Promise<HistoryRecordResult> {
    return transact([HISTORY_OBJECT_STORE], 'readonly', (tx, finish) => {
      const request = tx.objectStore(HISTORY_OBJECT_STORE).get(instanceId)
      request.onerror = () => { try { tx.abort() } catch { /* abort event resolves */ } }
      request.onsuccess = () => {
        if (request.result === undefined) { finish({ status: 'not-found' }); return }
        const checked = validateExisting(request.result)
        if (checked.status === 'found') finish(checked)
        else finish(checked.status === 'unsupported-version' ? checked : checked.status === 'corrupt-existing' ? checked : storageError('transaction-failed'))
      }
    })
  }
  function list(options: { readonly limit?: number; readonly cursor?: { readonly recordedAt: number; readonly instanceId: string } } = {}): Promise<HistoryListResult> {
    const limit = options.limit ?? 100
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) return Promise.resolve(storageError('unexpected'))
    return transact([HISTORY_OBJECT_STORE], 'readonly', (tx, finish) => {
      const request = tx.objectStore(HISTORY_OBJECT_STORE).getAll()
      request.onerror = () => { try { tx.abort() } catch { /* abort event resolves */ } }
      request.onsuccess = () => {
        const records: CompletedSessionRecord[] = []; let invalidCount = 0
        for (const raw of request.result as unknown[]) { const checked = validateExisting(raw); if (checked.status === 'found') records.push(checked.value); else invalidCount += 1 }
        records.sort((a, b) => a.recordedAt - b.recordedAt || a.instanceId.localeCompare(b.instanceId))
        const after = options.cursor ? records.filter(item => item.recordedAt > options.cursor!.recordedAt || (item.recordedAt === options.cursor!.recordedAt && item.instanceId > options.cursor!.instanceId)) : records
        const page = after.slice(0, limit), last = page.at(-1)
        finish({ status: 'success', records: page, ...(after.length > limit && last ? { nextCursor: { recordedAt: last.recordedAt, instanceId: last.instanceId } } : {}), invalidCount })
      }
    })
  }
  function commitResult(snapshot: unknown, expected: SessionExpectation, history: unknown): Promise<AtomicCompletionResult> {
    const session = validateSavedSession(snapshot)
    if (session.status === 'unsupported-version') return Promise.resolve({ status: 'unsupported-snapshot-version', versionKind: session.versionKind, version: session.version })
    if (session.status !== 'valid' || !isTerminalPhase(session.value.cursor.phase)) return Promise.resolve({ status: 'invalid-snapshot' })
    const recordCheck = classifyCandidate(history)
    if (recordCheck.status === 'invalid-record') return Promise.resolve({ status: 'invalid-history' })
    if (recordCheck.status === 'unsupported-version') return Promise.resolve(recordCheck)
    const record = recordCheck.value
    const projected = projectForRecord(session.value, record)
    if (projected.status !== 'valid') return Promise.resolve({ status: 'invalid-snapshot' })
    if (compareCompletionContent(projected.value, record) !== 'equivalent') return Promise.resolve({ status: 'invalid-history' })
    if (!validExpected(expected) || session.value.instanceId !== expected.instanceId || session.value.sessionId !== expected.sessionId || session.value.revision !== expected.revision || record.instanceId !== expected.instanceId || record.sessionId !== expected.sessionId || record.mode !== session.value.mode) return Promise.resolve({ status: 'active-session-conflict' })
    return transact([SESSION_OBJECT_STORE, HISTORY_OBJECT_STORE], 'readwrite', (tx, finish) => {
      const activeStore = tx.objectStore(SESSION_OBJECT_STORE), historyStore = tx.objectStore(HISTORY_OBJECT_STORE)
      const activeRequest = activeStore.get(session.value.mode)
      activeRequest.onerror = () => { try { tx.abort() } catch { /* abort event resolves */ } }
      activeRequest.onsuccess = () => {
        const current = validateSavedSession(activeRequest.result)
        if (current.status === 'unsupported-version') { finish({ status: 'unsupported-snapshot-version', versionKind: current.versionKind, version: current.version }); return }
        if (current.status === 'corrupt') { finish({ status: 'invalid-snapshot' }); return }
        if (current.value.instanceId !== expected.instanceId || current.value.sessionId !== expected.sessionId) { finish({ status: 'active-session-conflict' }); return }
        const existingRequest = historyStore.get(record.instanceId)
        existingRequest.onerror = () => { try { tx.abort() } catch { /* abort event resolves */ } }
        existingRequest.onsuccess = () => {
          if (existingRequest.result !== undefined) {
            const existing = validateExisting(existingRequest.result)
            if (existing.status === 'found') {
              const currentProjection = isTerminalPhase(current.value.cursor.phase)
                ? projectForRecord(current.value, existing.value)
                : null
              const alreadyCommitted = currentProjection?.status === 'valid'
                && compareCompletionContent(existing.value, record) === 'equivalent'
                && compareCompletionContent(currentProjection.value, existing.value) === 'equivalent'
              finish(alreadyCommitted ? { status: 'already-exists-equivalent', value: existing.value, snapshot: current.value } : { status: 'conflict' })
            } else finish(existingStoreFailure(existing))
            return
          }
          if (isTerminalPhase(current.value.cursor.phase) || current.value.revision !== expected.revision) { finish({ status: 'active-session-conflict' }); return }
          if (expected.revision >= Number.MAX_SAFE_INTEGER) { finish(storageError('unexpected')); return }
          const finalSnapshot: SavedSession = { ...session.value, revision: expected.revision + 1, updatedAt: Math.max(session.value.updatedAt, Date.now()) }
          activeStore.put(finalSnapshot); historyStore.add(record); finish({ status: 'inserted', value: record, snapshot: finalSnapshot })
        }
      }
    })
  }
  function verifyCommitted(snapshot: unknown, history: unknown): Promise<CompletionVerificationResult> {
    const intended = validateSavedSession(snapshot)
    if (intended.status === 'unsupported-version') return Promise.resolve({ status: 'unsupported-snapshot-version', versionKind: intended.versionKind, version: intended.version })
    if (intended.status !== 'valid' || !isTerminalPhase(intended.value.cursor.phase)) return Promise.resolve({ status: 'invalid-snapshot' })
    const candidateCheck = classifyCandidate(history)
    if (candidateCheck.status === 'invalid-record') return Promise.resolve({ status: 'invalid-history' })
    if (candidateCheck.status === 'unsupported-version') return Promise.resolve(candidateCheck)
    const candidate = candidateCheck.value
    if (candidate.instanceId !== intended.value.instanceId || candidate.sessionId !== intended.value.sessionId || candidate.mode !== intended.value.mode) return Promise.resolve({ status: 'invalid-history' })
    const intendedProjection = projectForRecord(intended.value, candidate)
    if (intendedProjection.status !== 'valid' || compareCompletionContent(intendedProjection.value, candidate) !== 'equivalent') return Promise.resolve({ status: 'invalid-history' })
    return transact([SESSION_OBJECT_STORE, HISTORY_OBJECT_STORE], 'readonly', (tx, finish) => {
      const activeRequest = tx.objectStore(SESSION_OBJECT_STORE).get(intended.value.mode)
      const historyRequest = tx.objectStore(HISTORY_OBJECT_STORE).get(candidate.instanceId)
      let activeDone = false, historyDone = false
      let activeValue: unknown, historyValue: unknown
      const evaluate = () => {
        if (!activeDone || !historyDone) return
        if (historyValue === undefined) {
          const active = validateSavedSession(activeValue)
          if (activeValue === undefined) { finish({ status: 'not-committed' }); return }
          if (active.status === 'unsupported-version') { finish({ status: 'unsupported-snapshot-version', versionKind: active.versionKind, version: active.version }); return }
          if (active.status === 'corrupt') { finish({ status: 'invalid-snapshot' }); return }
          finish(active.value.instanceId === candidate.instanceId && active.value.sessionId === candidate.sessionId && active.value.cursor.phase !== 'result' && active.value.cursor.phase !== 'timeout' ? { status: 'not-committed' } : { status: 'conflict' })
          return
        }
        const stored = validateExisting(historyValue)
        if (stored.status !== 'found') { finish(existingStoreFailure(stored)); return }
        const active = validateSavedSession(activeValue)
        if (active.status === 'unsupported-version') { finish({ status: 'unsupported-snapshot-version', versionKind: active.versionKind, version: active.version }); return }
        if (active.status === 'corrupt') { finish({ status: 'invalid-snapshot' }); return }
        if (!isTerminalPhase(active.value.cursor.phase) || active.value.instanceId !== intended.value.instanceId || active.value.sessionId !== intended.value.sessionId || active.value.instanceId !== candidate.instanceId || active.value.sessionId !== candidate.sessionId || active.value.mode !== candidate.mode) { finish({ status: 'conflict' }); return }
        const projected = projectForRecord(active.value, stored.value)
        finish(projected.status === 'valid'
          && active.value.instanceId === candidate.instanceId
          && compareCompletionContent(projected.value, stored.value) === 'equivalent'
          && compareCompletionContent(stored.value, candidate) === 'equivalent'
          ? { status: 'committed' } : { status: 'conflict' })
      }
      activeRequest.onerror = historyRequest.onerror = () => { try { tx.abort() } catch { /* abort event resolves */ } }
      activeRequest.onsuccess = () => { activeValue = activeRequest.result; activeDone = true; evaluate() }
      historyRequest.onsuccess = () => { historyValue = historyRequest.result; historyDone = true; evaluate() }
    })
  }
  return {
    open: async () => { try { await openDatabase(); return { status: 'opened' } } catch (error) { return storageError(codeFor(error)) } },
    insert, get, list, commitResult, verifyCommitted,
    close() { closed = true; owner?.close() },
  }
}

export function createCompletedSessionHistoryStore(options: CompletedSessionHistoryStoreOptions): CompletedSessionHistoryStore {
  return createHistoryStore(options)
}

export interface UnifiedIndexedDbSessionStore extends IndexedDbSessionStore, CompletedSessionHistoryStore {}

export function createUnifiedIndexedDbSessionStore(options: { readonly databaseName: string; readonly indexedDB?: IDBFactory | null }): UnifiedIndexedDbSessionStore {
  const active = new NativeIndexedDbSessionStore(options, UNIFIED_DATABASE_VERSION)
  const history = createHistoryStore(options, () => active.openDatabaseForHistory())
  return combineActiveAndHistory(active, history)
}

/** Dormant until an explicit live composition selects it; no arbitrary name or factory override. */
export function createLiveUnifiedIndexedDbSessionStore(): UnifiedIndexedDbSessionStore {
  const active = createLiveVersion2SessionStore()
  const history = createHistoryStore({ databaseName: SESSION_DATABASE_NAME }, () => active.openDatabaseForHistory(), true)
  return combineActiveAndHistory(active, history)
}

function combineActiveAndHistory(active: NativeIndexedDbSessionStore, history: CompletedSessionHistoryStore): UnifiedIndexedDbSessionStore {
  return {
    load: mode => active.load(mode),
    create: snapshot => active.create(snapshot),
    save: (snapshot, expected) => active.save(snapshot, expected),
    replace: (snapshot, expected) => active.replace(snapshot, expected),
    open: () => history.open(),
    insert: value => history.insert(value),
    get: instanceId => history.get(instanceId),
    list: options => history.list(options),
    commitResult: (snapshot, expected, record) => history.commitResult(snapshot, expected, record),
    verifyCommitted: (snapshot, record) => history.verifyCommitted(snapshot, record),
    close() { history.close(); active.close() },
  }
}

