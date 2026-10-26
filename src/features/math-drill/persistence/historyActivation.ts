import type { SessionControllerOptions } from './sessionController'
import { createLiveUnifiedIndexedDbSessionStore, createUnifiedIndexedDbSessionStore } from './completedSessionHistoryStore'

export type MathHistoryActivation =
  | { readonly mode: 'disposable'; readonly databaseName: string; readonly indexedDB?: IDBFactory | null }
  | { readonly mode: 'live' }

/** Default OFF: only explicit composition opts in. Unknown flags fail closed. */
export function selectMathDrillPersistence(activation?: MathHistoryActivation): (() => SessionControllerOptions) | undefined {
  if (activation?.mode === 'disposable') {
    return () => ({ store: createUnifiedIndexedDbSessionStore({ databaseName: activation.databaseName, indexedDB: activation.indexedDB }), completionMode: 'atomic' })
  }
  if (activation?.mode === 'live') {
    return () => ({ store: createLiveUnifiedIndexedDbSessionStore(), completionMode: 'atomic' })
  }
  return undefined
}
