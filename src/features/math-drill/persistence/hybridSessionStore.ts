/**
 * Hybrid Session Store
 * 
 * Combines backend API with local IndexedDB for shared session persistence.
 * Tries backend first (for shared data), falls back to IndexedDB (for local data).
 * This ensures the app works offline while supporting data sharing when backend is available.
 */

import type { 
  CompletedSessionHistoryStore, 
  AtomicCompletionResult, 
  CompletionVerificationResult,
  HistoryStoreResult,
  HistoryRecordResult,
} from './completedSessionHistoryStore'
import type { CompletedSessionRecord } from './completedSessionTypes'
import { isBackendAvailable, getSessions, toCompletedSessionRecord, fromCompletedSessionRecord } from '../api/sessionApi'

export interface HybridStoreOptions {
  /** Local IndexedDB store to use as fallback */
  localStore: CompletedSessionHistoryStore
  /** Whether to attempt backend sync (default: true in dev, can be disabled) */
  enableBackendSync?: boolean
}

/**
 * Creates a hybrid store that tries backend first, falls back to local IndexedDB
 */
export function createHybridSessionStore(options: HybridStoreOptions): CompletedSessionHistoryStore {
  const { localStore, enableBackendSync = true } = options
  let backendAvailable: boolean | null = null
  
  async function checkBackend(): Promise<boolean> {
    if (!enableBackendSync) return false
    if (backendAvailable !== null) return backendAvailable
    
    try {
      backendAvailable = await isBackendAvailable()
    } catch {
      backendAvailable = false
    }
    return backendAvailable
  }
  
  return {
    async open() {
      // Always open local store
      await localStore.open()
      // Check backend availability in background
      checkBackend()
      return { status: 'opened' }
    },
    
    async insert(value: unknown): Promise<HistoryStoreResult> {
      return localStore.insert(value)
    },
    
    async get(instanceId: string): Promise<HistoryRecordResult> {
      // Try backend first
      if (await checkBackend()) {
        try {
          const response = await getSessions({ limit: 100 })
          const found = response.sessions.find(s => s.instanceId === instanceId)
          if (found) {
            return { status: 'found', value: toCompletedSessionRecord(found) }
          }
        } catch {
          // Fall through
        }
      }
      
      return localStore.get(instanceId)
    },
    
    async list(options) {
      // Try backend first if available
      if (await checkBackend()) {
        try {
          const response = await getSessions({
            limit: options?.limit ?? 50,
            offset: 0,
          })
          
          const records: CompletedSessionRecord[] = response.sessions.map(toCompletedSessionRecord)
          
          return {
            status: 'success',
            records,
            invalidCount: 0,
            ...(response.total > response.limit ? { nextCursor: { recordedAt: records[records.length - 1]?.recordedAt ?? 0, instanceId: records[records.length - 1]?.instanceId ?? '' } } : {}),
          }
        } catch (error) {
          console.warn('Backend list failed, falling back to local:', error)
          // Fall through to local store
        }
      }
      
      // Fall back to local IndexedDB
      return localStore.list(options)
    },
    
    async commitResult(snapshot, expected, history): Promise<AtomicCompletionResult> {
      // Use local store as primary (offline-first approach)
      // Then try to sync to backend for cross-device sharing
      const result = await localStore.commitResult(snapshot, expected, history)
      
      // If local commit succeeded, try to sync to backend
      if (result.status === 'inserted' || result.status === 'already-exists-equivalent') {
        const backendOk = await checkBackend()
        if (backendOk) {
          try {
            const apiSession = fromCompletedSessionRecord(result.value)
            const { createSession } = await import('../api/sessionApi')
            await createSession(apiSession)
            console.log('Session synced to backend')
          } catch (error) {
            // Log but don't fail - local save succeeded
            console.warn('Background sync to backend failed:', error)
          }
        } else {
          console.log('Session saved locally (backend unavailable)')
        }
      }
      
      return result
    },
    
    async verifyCommitted(snapshot, history): Promise<CompletionVerificationResult> {
      return localStore.verifyCommitted(snapshot, history)
    },
    
    close() {
      localStore.close()
    },
  }
}