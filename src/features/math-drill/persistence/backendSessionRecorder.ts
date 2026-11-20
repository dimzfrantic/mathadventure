/**
 * Stage 7B-A2 blocker remediation — backend recording of completed sessions.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The live composition wrote completed sessions to IndexedDB and nothing else:
 * `main.tsx` → `historyActivation.ts` → `sessionController.ts` → local store.
 * No code path ever called `POST /api/sessions`, so the authoritative backend
 * never learned about a session a child actually finished, and the parent's
 * backend-computed balance stayed at 0 forever.
 *
 * THE SHAPE OF THE FIX
 * --------------------
 * A decorator around the SAME store the app already uses. The local commit is
 * untouched and still authoritative for history; after it succeeds, the exact
 * committed record is offered to the backend, which is the only source of the
 * reward balance.
 *
 * Invariants (each one maps to a requirement of this stage):
 *
 *  1. The decorated store returns the inner result UNCHANGED. The upload can
 *     never turn a successful local commit into a failure.
 *  2. Only a record that was actually committed NOW is queued. Existing
 *     IndexedDB history is never scanned, listed or replayed — the owner's
 *     decision is that legacy sessions are not migrated and not counted.
 *  3. The upload is fire-and-forget with respect to the caller: no `await` in
 *     the commit path, and every failure is contained (a rejection here must
 *     never surface as an unhandled rejection in the app).
 *  4. Identity is the session's own `instanceId`. A retry therefore re-sends the
 *     same identity, and the server answers 409 instead of creating a second
 *     reward input — a repeated session can never double-credit.
 *  5. A failed upload NEVER deletes or mutates the local record. The local
 *     history stays complete; only the delivery attempt is retried.
 *  6. The queue is a DELIVERY queue, not a ledger. It stores instance ids and
 *     attempt metadata only — never stars, never a balance — so it cannot
 *     compete with the backend as a source of truth. The payload is re-read
 *     from IndexedDB at send time, so the queue cannot inject a fabricated
 *     record either.
 */

import type { CompletedSessionRecord } from './completedSessionTypes'
import type { UnifiedIndexedDbSessionStore } from './completedSessionHistoryStore'
import { recordCompletedSession } from '../api/sessionApi'
import type { RecordSessionOutcome } from '../api/sessionApi'

/** Storage subset this module needs; `null` means "memory only". */
export interface PendingUploadStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Where a queued id's payload is read from at send time. */
export type PendingRecordLookup =
  | { readonly status: 'found'; readonly value: CompletedSessionRecord }
  | { readonly status: 'missing' }
  | { readonly status: 'error' }

export interface PendingUpload {
  readonly instanceId: string
  readonly attempts: number
  readonly lastReason: string | null
  /** The backend refused the payload itself; retrying the same record cannot help. */
  readonly permanent: boolean
}

export interface SessionFlushSummary {
  readonly attempted: number
  readonly recorded: number
  readonly duplicates: number
  readonly rejected: number
  readonly pending: number
}

export interface SessionUploadQueue {
  /** Records that this session still needs to reach the backend. */
  enqueue(instanceId: string): void
  /** Attempts delivery of everything pending. Never throws. */
  flush(): Promise<SessionFlushSummary>
  /** Delivery backlog (ids + metadata only). Never a balance. */
  pending(): readonly PendingUpload[]
}

export interface SessionUploadQueueOptions {
  readonly post?: (record: CompletedSessionRecord) => Promise<RecordSessionOutcome>
  readonly load: (instanceId: string) => Promise<PendingRecordLookup>
  readonly storage?: PendingUploadStorage | null
  /** Attempts before a retryable failure stops being retried on this device. */
  readonly maxAttempts?: number
}

export const PENDING_UPLOAD_STORAGE_KEY = 'math-adventure:pending-session-uploads:v1'
const DEFAULT_MAX_ATTEMPTS = 5

function defaultStorage(): PendingUploadStorage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const probe = `${PENDING_UPLOAD_STORAGE_KEY}:probe`
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return window.localStorage
  } catch {
    // Private mode / quota / disabled storage: fall back to memory. A missing
    // queue must never break session completion.
    return null
  }
}

function isPendingUpload(value: unknown): value is PendingUpload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.instanceId === 'string'
    && Number.isSafeInteger(candidate.attempts)
    && typeof candidate.permanent === 'boolean'
}

export function createSessionUploadQueue(options: SessionUploadQueueOptions): SessionUploadQueue {
  const post = options.post ?? recordCompletedSession
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const storage = options.storage === undefined ? defaultStorage() : options.storage

  // Memory mirror is always authoritative for this page load; storage is only a
  // durability layer for reloads.
  let entries: PendingUpload[] = []
  let loaded = false
  let inFlight: Promise<SessionFlushSummary> | null = null

  function readStored(): PendingUpload[] {
    if (!storage) return []
    try {
      const raw = storage.getItem(PENDING_UPLOAD_STORAGE_KEY)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      // Rebuild from validated fields only: never trust stored shapes.
      return parsed.filter(isPendingUpload).map(entry => ({
        instanceId: entry.instanceId,
        attempts: entry.attempts,
        lastReason: typeof entry.lastReason === 'string' ? entry.lastReason : null,
        permanent: entry.permanent,
      }))
    } catch {
      return []
    }
  }

  function persist(): void {
    if (!storage) return
    try {
      storage.setItem(PENDING_UPLOAD_STORAGE_KEY, JSON.stringify(entries))
    } catch {
      // Quota/unavailable: keep working from memory for this page load.
    }
  }

  function ensureLoaded(): void {
    if (loaded) return
    loaded = true
    entries = readStored()
  }

  function remove(instanceId: string): void {
    entries = entries.filter(entry => entry.instanceId !== instanceId)
  }

  function enqueue(instanceId: string): void {
    ensureLoaded()
    if (entries.some(entry => entry.instanceId === instanceId)) return
    entries = [...entries, { instanceId, attempts: 0, lastReason: null, permanent: false }]
    persist()
  }

  async function runFlush(): Promise<SessionFlushSummary> {
    ensureLoaded()
    let attempted = 0
    let recorded = 0
    let duplicates = 0
    let rejected = 0

    // Snapshot: enqueues during the loop are picked up by the next flush.
    for (const entry of [...entries]) {
      if (entry.permanent) continue
      if (entry.attempts >= maxAttempts) continue

      const lookup = await options.load(entry.instanceId).catch((): PendingRecordLookup => ({ status: 'error' }))
      if (lookup.status === 'missing') {
        // The local record no longer exists, so there is nothing to send. This
        // is not a deletion: the decorator never removes local history.
        remove(entry.instanceId)
        persist()
        continue
      }
      if (lookup.status === 'error') {
        // Local storage is unavailable right now; keep the backlog untouched.
        break
      }

      attempted += 1
      const outcome = await post(lookup.value).catch((): RecordSessionOutcome => ({
        status: 'unavailable', httpStatus: 0, reason: 'client-error',
      }))

      if (outcome.status === 'recorded' || outcome.status === 'duplicate') {
        if (outcome.status === 'recorded') recorded += 1
        else duplicates += 1
        remove(entry.instanceId)
        persist()
        continue
      }

      if (outcome.status === 'rejected') {
        rejected += 1
        entries = entries.map(item => item.instanceId === entry.instanceId
          ? { ...item, attempts: item.attempts + 1, lastReason: outcome.reason, permanent: true }
          : item)
        persist()
        console.error(`[session-recorder] backend rejected session ${entry.instanceId}: ${outcome.reason}`)
        continue
      }

      // Unavailable: keep the id, count the attempt, stop hammering.
      entries = entries.map(item => item.instanceId === entry.instanceId
        ? { ...item, attempts: item.attempts + 1, lastReason: outcome.reason }
        : item)
      persist()
      break
    }

    return { attempted, recorded, duplicates, rejected, pending: entries.filter(entry => !entry.permanent).length }
  }

  return {
    enqueue,
    pending() {
      ensureLoaded()
      return [...entries]
    },
    flush() {
      // Single flight: overlapping triggers (startup + online + a new session)
      // must not post the same record twice.
      if (!inFlight) {
        inFlight = runFlush().finally(() => { inFlight = null })
      }
      return inFlight
    },
  }
}

export interface BackendSessionRecordingOptions {
  readonly post?: (record: CompletedSessionRecord) => Promise<RecordSessionOutcome>
  readonly storage?: PendingUploadStorage | null
  readonly queue?: SessionUploadQueue
  /** Flush leftovers from a previous page load on startup (default true). */
  readonly flushOnStart?: boolean
}

/**
 * Only a record that BECAME part of history in this call is offered to the
 * backend. `already-exists-equivalent` is deliberately excluded: the record was
 * stored by an earlier call, whose delivery attempt is already tracked (or
 * already completed) by the queue. Re-offering it would fire a second request
 * for the same session on every duplicate commit.
 */
function committedRecord(result: unknown): CompletedSessionRecord | null {
  if (typeof result !== 'object' || result === null) return null
  const candidate = result as { status?: unknown; value?: unknown }
  if (candidate.status !== 'inserted') return null
  const value = candidate.value as CompletedSessionRecord | undefined
  return value && typeof value.instanceId === 'string' ? value : null
}

/**
 * Wraps a session store so that every successful completion is also offered to
 * the authoritative backend. The wrapped store is behaviourally identical to
 * the inner one for its callers.
 */
export function withBackendSessionRecording(
  store: UnifiedIndexedDbSessionStore,
  options: BackendSessionRecordingOptions = {},
): UnifiedIndexedDbSessionStore {
  const queue = options.queue ?? createSessionUploadQueue({
    post: options.post,
    storage: options.storage,
    load: async (instanceId): Promise<PendingRecordLookup> => {
      try {
        const result = await store.get(instanceId)
        if (result.status === 'found') return { status: 'found', value: result.value }
        if (result.status === 'not-found') return { status: 'missing' }
        return { status: 'error' }
      } catch {
        return { status: 'error' }
      }
    },
  })

  const offer = (record: CompletedSessionRecord): void => {
    queue.enqueue(record.instanceId)
    // Deliberately not awaited: the local commit is already durable and the
    // completion flow must not block on the network. Errors are contained here.
    void queue.flush().catch(() => undefined)
  }

  const onOnline = (): void => { void queue.flush().catch(() => undefined) }
  const canListen = typeof window !== 'undefined' && typeof window.addEventListener === 'function'
  if (canListen) window.addEventListener('online', onOnline)

  if (options.flushOnStart !== false && queue.pending().length > 0) {
    // Deliver a backlog left by a previous page load / offline period.
    void queue.flush().catch(() => undefined)
  }

  return {
    ...store,
    insert: async (value) => {
      const result = await store.insert(value)
      const record = committedRecord(result)
      if (record) offer(record)
      return result
    },
    commitResult: async (snapshot, expected, history) => {
      const result = await store.commitResult(snapshot, expected, history)
      const record = committedRecord(result)
      if (record) offer(record)
      return result
    },
    close() {
      if (canListen) window.removeEventListener('online', onOnline)
      store.close()
    },
  }
}
