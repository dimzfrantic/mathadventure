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

import { DATABASE_SCHEMA_VERSION, upgradeDatabaseSchema } from '../../persistence/databaseSchema'

/**
 * @deprecated Stage 7B-A2 (P0-1): the version is owned by
 * `persistence/databaseSchema.ts` so that the session store and the reward
 * store cannot drift apart again. Kept as an alias for existing imports.
 */
export const STAGE7B_DATABASE_VERSION = DATABASE_SCHEMA_VERSION

/**
 * Safely upgrades an existing IndexedDB database to the canonical schema
 * version by creating the required stores/indexes if they do not exist.
 *
 * Delegates to `upgradeDatabaseSchema()` — the single schema authority — so the
 * reward store and the session/history store always produce the exact same
 * schema for the shared `math-adventure` database.
 *
 * Adheres strictly to the database safety contract:
 * - Does NOT modify activeSessions or completedSessions that already exist.
 * - Is idempotent (checks objectStoreNames before creating).
 */
export function upgradeDatabaseToVersion3(db: IDBDatabase, tx?: IDBTransaction | null): void {
  upgradeDatabaseSchema(db, tx)
}
