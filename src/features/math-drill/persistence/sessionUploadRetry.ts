/**
 * Stage 7B-A2 limited remediation — finding B: retry the pending session upload
 * queue when the app boots.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The upload queue created by `withBackendSessionRecording` was only flushed
 * when (a) a Math Drill screen mounted, (b) an `online` event fired *after* that
 * mount, or (c) the child finished another session. A session that failed to
 * reach the backend therefore stayed pending until the child happened to open
 * Math Drill again — the parent dashboard, opened first, showed a balance that
 * was missing the session even though the backend was reachable again.
 *
 * THE SHAPE OF THE FIX
 * --------------------
 * One queue per page load, created here, shared by every caller:
 *
 *   - `startStartupSessionUploadRetry()` (called from `main.tsx`) flushes a
 *     backlog once, as soon as the app is ready, and registers a single
 *     `online` listener so a reconnect is also retried even when the child
 *     never opens Math Drill.
 *   - `selectMathDrillPersistence({ mode: 'live' })` reuses the SAME queue, so
 *     the startup flush and the in-app triggers cannot run in parallel or
 *     duplicate a delivery.
 *
 * Invariants preserved from the existing implementation:
 *
 *  1. Single flight is owned by the queue itself (`flush()` returns the
 *     in-flight promise). Sharing one instance extends that guarantee to the
 *     startup trigger instead of adding a second, competing flusher.
 *  2. The queue stores instance ids only; the payload is re-read from IndexedDB
 *     at send time. Nothing about the storage format changed.
 *  3. `maxAttempts` (5), the "stop on unavailable" rule and the permanent
 *     rejection rule are untouched. There is no timer, no backoff loop and no
 *     unbounded retry: a boot flush happens at most once per page load, plus
 *     once per `online` event.
 *  4. An empty backlog returns immediately WITHOUT opening IndexedDB, so the
 *     startup hook costs nothing on a normal launch.
 *  5. If IndexedDB is not ready the lookup reports `error`, the queue keeps the
 *     backlog untouched (no deletion), and the next trigger — the `online`
 *     listener, the Math Drill mount flush, or the next completed session —
 *     tries again.
 *  6. Nothing here touches the parent PIN, the reward contract or the API.
 */

import {
  createSessionUploadQueue,
} from './backendSessionRecorder'
import type {
  PendingRecordLookup,
  SessionFlushSummary,
  SessionUploadQueue,
} from './backendSessionRecorder'
import { createLiveUnifiedIndexedDbSessionStore } from './completedSessionHistoryStore'
import type { UnifiedIndexedDbSessionStore } from './completedSessionHistoryStore'

const EMPTY_SUMMARY: SessionFlushSummary = {
  attempted: 0,
  recorded: 0,
  duplicates: 0,
  rejected: 0,
  pending: 0,
}

let liveStore: UnifiedIndexedDbSessionStore | null = null
let liveQueue: SessionUploadQueue | null = null

/**
 * The single delivery queue for this page load. The store is created lazily so
 * a boot with nothing pending never opens IndexedDB.
 */
export function liveSessionUploadQueue(): SessionUploadQueue {
  if (liveQueue) return liveQueue
  if (!liveStore) liveStore = createLiveUnifiedIndexedDbSessionStore()
  const store = liveStore
  liveQueue = createSessionUploadQueue({
    load: async (instanceId): Promise<PendingRecordLookup> => {
      try {
        const result = await store.get(instanceId)
        if (result.status === 'found') return { status: 'found', value: result.value }
        if (result.status === 'not-found') return { status: 'missing' }
        return { status: 'error' }
      } catch {
        // IndexedDB unavailable (private mode, still opening, blocked): the
        // queue keeps the backlog and retries on the next trigger.
        return { status: 'error' }
      }
    },
  })
  return liveQueue
}

/** Number of ids waiting for delivery. Reads storage only — never IndexedDB. */
export function pendingSessionUploadCount(): number {
  try {
    return liveSessionUploadQueue().pending().length
  } catch {
    return 0
  }
}

/**
 * Attempt delivery of everything pending, once. Never throws; never deletes a
 * backlog because the backend is unavailable.
 */
export async function retryPendingSessionUploads(): Promise<SessionFlushSummary> {
  const queue = liveSessionUploadQueue()
  if (queue.pending().length === 0) return EMPTY_SUMMARY
  try {
    return await queue.flush()
  } catch {
    return { ...EMPTY_SUMMARY, pending: queue.pending().length }
  }
}

let startupRetryStarted = false

/**
 * Called once from the app entry point. Idempotent: repeated calls (hot reload,
 * StrictMode, tests) register nothing extra and never start a second flusher.
 */
export function startStartupSessionUploadRetry(): void {
  if (startupRetryStarted) return
  startupRetryStarted = true

  const run = (): void => {
    void retryPendingSessionUploads().catch(() => undefined)
  }

  run()
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    // A reconnect is the other moment a backlog becomes deliverable without the
    // child opening Math Drill. Same queue, same single flight.
    window.addEventListener('online', run)
  }
}
