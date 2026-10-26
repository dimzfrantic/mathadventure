/**
 * Stage 7B — IndexedDB Version 4 Migration & Store Definitions
 *
 * Implements version 4 schema migration on top of existing version 2/3.
 * Adds reward stores safely:
 * 1. `rewardTransactions` (keyPath: 'transactionId')
 *    - Index: `status` (non-unique)
 *    - Index: `requestedAt` (non-unique)
 * 2. `rewardConfig` (keyPath: 'configId')
 * 3. `rewardCorrections` (keyPath: 'correctionId')
 *
 * Preserves existing stores (`activeSessions`, `completedSessions`) and indexes
 * without modification. `completedSessions` is created (additively, if missing)
 * so that atomic balance checks inside reward transactions are always possible
 * on fresh disposable databases; it is NEVER re-created or overwritten when the
 * store already exists (data-safe for live v2/v3 databases).
 */

export const STAGE7B_DATABASE_VERSION = 4

/**
 * Safely upgrades an existing v2/v3 IndexedDB database to v4 by creating
 * the required redemption/session stores if they do not already exist.
 *
 * Adheres strictly to the database safety contract:
 * - Does NOT modify activeSessions or completedSessions that already exist.
 * - Is idempotent (checks objectStoreNames before creating).
 */
export function upgradeDatabaseToVersion3(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains('rewardTransactions')) {
    const txStore = db.createObjectStore('rewardTransactions', {
      keyPath: 'transactionId',
    })
    txStore.createIndex('status', 'status', { unique: false })
    txStore.createIndex('requestedAt', 'requestedAt', { unique: false })
  }

  if (!db.objectStoreNames.contains('rewardConfig')) {
    db.createObjectStore('rewardConfig', { keyPath: 'configId' })
  }

  if (!db.objectStoreNames.contains('completedSessions')) {
    db.createObjectStore('completedSessions', { keyPath: 'instanceId' })
  }

  if (!db.objectStoreNames.contains('rewardCorrections')) {
    db.createObjectStore('rewardCorrections', { keyPath: 'correctionId' })
  }
}
