/**
 * Stage 7B-A2 (P0-1) — Single schema authority for the `math-adventure` database.
 *
 * Before A2 two independent owners opened the SAME database name at DIFFERENT
 * versions:
 *   - the session/history store opened `math-adventure` at version 2
 *     (`UNIFIED_DATABASE_VERSION = SESSION_DATABASE_VERSION + 1`)
 *   - the reward store opened `math-adventure` at version 4
 *     (`STAGE7B_DATABASE_VERSION`)
 *
 * Whichever opened second hit `VersionError`, so the two stores could never be
 * live at the same time (masked only because the reward UI was never wired).
 *
 * This module is now the ONLY place that decides the schema version and the
 * complete set of object stores / indexes. Every opener of the shared database
 * must:
 *   1. open at `DATABASE_SCHEMA_VERSION`,
 *   2. run `upgradeDatabaseSchema()` inside `onupgradeneeded`,
 *   3. close its connection on `versionchange`.
 *
 * The upgrade is strictly additive and idempotent: existing stores and their
 * data are never dropped, re-created or rewritten. That is what makes the
 * migration from the versions actually used by this repository (v1 legacy,
 * v2 unified session schema, v4 reward schema) safe.
 */

/** The one and only schema version of the shared `math-adventure` database. */
export const DATABASE_SCHEMA_VERSION = 4

export const ACTIVE_SESSIONS_STORE = 'activeSessions'
export const COMPLETED_SESSIONS_STORE = 'completedSessions'
export const REWARD_TRANSACTIONS_STORE = 'rewardTransactions'
export const REWARD_CONFIG_STORE = 'rewardConfig'
export const REWARD_CORRECTIONS_STORE = 'rewardCorrections'

export interface IndexDefinition {
  readonly name: string
  readonly keyPath: string
}

export interface StoreDefinition {
  readonly name: string
  readonly keyPath: string
  readonly indexes: readonly IndexDefinition[]
}

/**
 * Canonical, ordered store catalogue. Order matters only for readability:
 * session stores first (legacy), reward stores second (additive).
 */
export const DATABASE_STORE_DEFINITIONS: readonly StoreDefinition[] = [
  { name: ACTIVE_SESSIONS_STORE, keyPath: 'mode', indexes: [] },
  {
    name: COMPLETED_SESSIONS_STORE,
    keyPath: 'instanceId',
    indexes: [
      { name: 'recordedAt', keyPath: 'recordedAt' },
      { name: 'sessionId', keyPath: 'sessionId' },
    ],
  },
  {
    name: REWARD_TRANSACTIONS_STORE,
    keyPath: 'transactionId',
    indexes: [
      { name: 'status', keyPath: 'status' },
      { name: 'requestedAt', keyPath: 'requestedAt' },
    ],
  },
  { name: REWARD_CONFIG_STORE, keyPath: 'configId', indexes: [] },
  { name: REWARD_CORRECTIONS_STORE, keyPath: 'correctionId', indexes: [] },
]

/**
 * Additive, idempotent schema upgrade. Must be called from `onupgradeneeded`.
 *
 * `tx` is the version-change transaction. It is optional so that pure schema
 * simulations (unit tests) can call this with a bare mock database object; when
 * it is supplied, the key paths of pre-existing stores/indexes are verified and
 * an incompatible schema aborts the upgrade instead of silently diverging.
 */
export function upgradeDatabaseSchema(db: IDBDatabase, tx?: IDBTransaction | null): void {
  for (const definition of DATABASE_STORE_DEFINITIONS) {
    let store: IDBObjectStore

    if (!db.objectStoreNames.contains(definition.name)) {
      store = db.createObjectStore(definition.name, { keyPath: definition.keyPath })
    } else if (tx) {
      store = tx.objectStore(definition.name)
      if (store.keyPath !== definition.keyPath) {
        throw new Error(`incompatible-key-path:${definition.name}`)
      }
    } else {
      // Existing store, no transaction handle available (schema simulation).
      continue
    }

    for (const index of definition.indexes) {
      if (!store.indexNames.contains(index.name)) {
        store.createIndex(index.name, index.keyPath, { unique: false })
        continue
      }
      const existing = store.index(index.name)
      if (existing.keyPath !== index.keyPath || existing.unique) {
        throw new Error(`incompatible-index:${definition.name}.${index.name}`)
      }
    }
  }
}

/**
 * Verifies that an opened connection satisfies the canonical schema for the
 * given subset of stores. Returns an issue code or `null` when compatible.
 * Used by both openers so that a schema mismatch fails closed (never a
 * half-working database).
 */
export function findDatabaseSchemaIssue(
  db: IDBDatabase,
  requiredStores: readonly string[] = DATABASE_STORE_DEFINITIONS.map(definition => definition.name),
): string | null {
  for (const name of requiredStores) {
    const definition = DATABASE_STORE_DEFINITIONS.find(candidate => candidate.name === name)
    if (!definition) return `unknown-store:${name}`
    if (!db.objectStoreNames.contains(name)) return `missing-store:${name}`

    const store = db.transaction(name, 'readonly').objectStore(name)
    if (store.keyPath !== definition.keyPath) return `incompatible-key-path:${name}`

    for (const index of definition.indexes) {
      if (!store.indexNames.contains(index.name)) return `missing-index:${name}.${index.name}`
      const existing = store.index(index.name)
      if (existing.keyPath !== index.keyPath || existing.unique) return `incompatible-index:${name}.${index.name}`
    }
  }
  return null
}
