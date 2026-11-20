import type { SessionControllerOptions } from './sessionController'
import { createLiveUnifiedIndexedDbSessionStore, createUnifiedIndexedDbSessionStore } from './completedSessionHistoryStore'
import { withBackendSessionRecording } from './backendSessionRecorder'
import { liveSessionUploadQueue } from './sessionUploadRetry'

export type MathHistoryActivation =
  | { readonly mode: 'disposable'; readonly databaseName: string; readonly indexedDB?: IDBFactory | null }
  | { readonly mode: 'live' }

/** Default OFF: only explicit composition opts in. Unknown flags fail closed. */
export function selectMathDrillPersistence(activation?: MathHistoryActivation): (() => SessionControllerOptions) | undefined {
  if (activation?.mode === 'disposable') {
    return () => ({ store: createUnifiedIndexedDbSessionStore({ databaseName: activation.databaseName, indexedDB: activation.indexedDB }), completionMode: 'atomic' })
  }
  if (activation?.mode === 'live') {
    // Stage 7B-A2 blocker remediation: the LIVE composition is the only one that
    // talks to the backend. The session is still committed to IndexedDB exactly
    // as before; `withBackendSessionRecording` adds the outbound
    // `POST /api/sessions` that makes the backend the source of the reward
    // balance. Disposable/test compositions stay fully offline.
    //
    // Stage 7B-A2 limited remediation (finding B): the decorator is given the
    // page-wide queue from `sessionUploadRetry` so that the boot-time retry
    // (`startStartupSessionUploadRetry`), the `online` listener and every Math
    // Drill mount share ONE single-flight queue. Without this the startup retry
    // and the screen-level flush could run in parallel.
    return () => ({
      store: withBackendSessionRecording(createLiveUnifiedIndexedDbSessionStore(), { queue: liveSessionUploadQueue() }),
      completionMode: 'atomic',
    })
  }
  return undefined
}
