import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createScoreState, generateSession } from '../src/features/math-drill/domain'
import {
  createIndexedDbSessionStore,
  SESSION_DATABASE_VERSION,
  UNIFIED_DATABASE_VERSION,
} from '../src/features/math-drill/persistence/indexedDbSessionStore'
import {
  DATABASE_SCHEMA_VERSION,
  DATABASE_STORE_DEFINITIONS,
} from '../src/features/math-drill/persistence/databaseSchema'
import { createUnifiedIndexedDbSessionStore } from '../src/features/math-drill/persistence/completedSessionHistoryStore'
import { createDisposableRewardStore } from '../src/features/math-drill/reward/redemption/rewardPersistence'
import type { RewardConfig } from '../src/features/math-drill/reward/redemption/redemptionTypes'
import type { SavedSessionV1 } from '../src/features/math-drill/persistence/sessionTypes'

const INSTANCE_ID = '550e8400-e29b-41d4-a716-446655440000'
let sequence = 0

function databaseName(): string {
  sequence += 1
  return `math-adventure-stage5b2c-a2-schema-${Date.now()}-${sequence}`
}

function savedSession(instanceId = INSTANCE_ID): SavedSessionV1 {
  const generated = generateSession({ level: 1, mode: 'addition', count: 1, seed: 811, roundSize: 1 })
  if (!generated.ok) throw new Error(generated.error.code)
  return {
    schemaVersion: 1,
    mode: 'regular',
    instanceId,
    sessionId: generated.session.id,
    revision: 1,
    createdAt: 1,
    updatedAt: 2,
    session: generated.session,
    score: createScoreState(generated.session),
    cursor: { questionIndex: 0, phase: 'answering', pendingAdvanceAt: null },
  }
}

function rewardConfig(): RewardConfig {
  return {
    configId: 'active',
    version: 1,
    updatedAt: 1_700_000_000_000,
    rupiahPerStar: 500,
    minStarsPerRedemption: 1,
    maxStarsPerRedemption: 100,
  }
}

function openRaw(
  factory: IDBFactory,
  name: string,
  version: number,
  upgrade?: (db: IDBDatabase, tx: IDBTransaction) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version)
    request.onupgradeneeded = () => upgrade?.(request.result, request.transaction!)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('blocked'))
  })
}

function readAll(db: IDBDatabase, store: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).getAll()
    request.onsuccess = () => resolve(request.result as unknown[])
    request.onerror = () => reject(request.error)
  })
}

function writeRaw(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readwrite').objectStore(store).put(value)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

const ALL_STORES = DATABASE_STORE_DEFINITIONS.map(definition => definition.name)

describe('Stage 7B-A2 P0-1 — one schema authority for the shared database', () => {
  it('1. session store and reward store open the SAME database at the same version (no VersionError) and both work', async () => {
    const factory = new IDBFactory()
    const name = databaseName()

    const session = createUnifiedIndexedDbSessionStore({ databaseName: name, indexedDB: factory })
    const reward = createDisposableRewardStore(name, factory)
    try {
      // Both owners must agree on the version, otherwise the second opener throws VersionError.
      expect(UNIFIED_DATABASE_VERSION).toBe(DATABASE_SCHEMA_VERSION)

      expect(await session.load('regular')).toEqual({ status: 'empty' })
      expect(await reward.listTransactions()).toMatchObject({ status: 'success', invalidCount: 0 })

      // ... and both must be able to WRITE through the same connection/schema.
      const created = await session.create(savedSession())
      expect(created.status).toBe('success')
      expect(await session.load('regular')).toMatchObject({ status: 'valid', value: { instanceId: INSTANCE_ID } })

      expect(await reward.saveConfig(rewardConfig())).toMatchObject({ status: 'success' })
      expect(await reward.loadConfig()).toMatchObject({ status: 'found' })

      const raw = await openRaw(factory, name, DATABASE_SCHEMA_VERSION)
      expect(raw.version).toBe(DATABASE_SCHEMA_VERSION)
      expect([...raw.objectStoreNames].sort()).toEqual([...ALL_STORES].sort())
      expect(await readAll(raw, 'activeSessions')).toHaveLength(1)
      raw.close()
    } finally {
      session.close()
      reward.close()
    }
  })

  it('2. legacy v1 database (activeSessions only) upgrades to the unified schema without losing saved sessions', async () => {
    const factory = new IDBFactory()
    const name = databaseName()

    // Legacy schema exactly as produced by the default (v1) application factory.
    const legacy = await openRaw(factory, name, SESSION_DATABASE_VERSION, db => {
      db.createObjectStore('activeSessions', { keyPath: 'mode' })
    })
    await writeRaw(legacy, 'activeSessions', savedSession())
    legacy.close()

    const session = createUnifiedIndexedDbSessionStore({ databaseName: name, indexedDB: factory })
    try {
      expect(await session.load('regular')).toMatchObject({ status: 'valid', value: { instanceId: INSTANCE_ID } })
    } finally {
      session.close()
    }

    const upgraded = await openRaw(factory, name, DATABASE_SCHEMA_VERSION)
    expect(upgraded.version).toBe(DATABASE_SCHEMA_VERSION)
    expect([...upgraded.objectStoreNames].sort()).toEqual([...ALL_STORES].sort())
    const preserved = await readAll(upgraded, 'activeSessions')
    expect(preserved).toHaveLength(1)
    expect(preserved[0]).toMatchObject({ mode: 'regular', instanceId: INSTANCE_ID })
    upgraded.close()
  })

  it('3. unified v2 database (sessions + history) upgrades additively: history rows survive and reward stores appear', async () => {
    const factory = new IDBFactory()
    const name = databaseName()

    // Schema produced before A2 by `UNIFIED_DATABASE_VERSION = 2`.
    const legacy = await openRaw(factory, name, 2, db => {
      db.createObjectStore('activeSessions', { keyPath: 'mode' })
      const history = db.createObjectStore('completedSessions', { keyPath: 'instanceId' })
      history.createIndex('recordedAt', 'recordedAt', { unique: false })
      history.createIndex('sessionId', 'sessionId', { unique: false })
    })
    await writeRaw(legacy, 'activeSessions', savedSession())
    await writeRaw(legacy, 'completedSessions', { instanceId: 'history-1', recordedAt: 5, sessionId: 'session-1' })
    legacy.close()

    const session = createUnifiedIndexedDbSessionStore({ databaseName: name, indexedDB: factory })
    const reward = createDisposableRewardStore(name, factory)
    try {
      expect(await session.load('regular')).toMatchObject({ status: 'valid', value: { instanceId: INSTANCE_ID } })
      expect(await reward.listTransactions()).toMatchObject({ status: 'success', invalidCount: 0 })
    } finally {
      session.close()
      reward.close()
    }

    const upgraded = await openRaw(factory, name, DATABASE_SCHEMA_VERSION)
    expect([...upgraded.objectStoreNames].sort()).toEqual([...ALL_STORES].sort())
    expect(await readAll(upgraded, 'completedSessions')).toEqual([
      { instanceId: 'history-1', recordedAt: 5, sessionId: 'session-1' },
    ])
    upgraded.close()
  })

  it('4. reopening the application repeatedly does not re-run a destructive migration', async () => {
    const factory = new IDBFactory()
    const name = databaseName()

    for (let round = 0; round < 3; round += 1) {
      const session = createUnifiedIndexedDbSessionStore({ databaseName: name, indexedDB: factory })
      const reward = createDisposableRewardStore(name, factory)
      try {
        const loaded = await session.load('regular')
        if (round === 0) {
          expect(loaded).toEqual({ status: 'empty' })
          expect((await session.create(savedSession())).status).toBe('success')
          expect(await reward.saveConfig(rewardConfig())).toMatchObject({ status: 'success' })
        } else {
          // Data written in round 0 must still be there in every later round.
          expect(loaded).toMatchObject({ status: 'valid', value: { instanceId: INSTANCE_ID } })
          expect(await reward.loadConfig()).toMatchObject({ status: 'found' })
        }
      } finally {
        session.close()
        reward.close()
      }
    }
  })

  it('5. an open connection yields to a version change instead of blocking the upgrade', async () => {
    const factory = new IDBFactory()
    const name = databaseName()

    const session = createUnifiedIndexedDbSessionStore({ databaseName: name, indexedDB: factory })
    expect(await session.load('regular')).toEqual({ status: 'empty' })

    // `onversionchange` in the session store must close itself, otherwise this open blocks forever.
    const higher = await openRaw(factory, name, DATABASE_SCHEMA_VERSION + 1)
    expect(higher.version).toBe(DATABASE_SCHEMA_VERSION + 1)
    higher.close()
    session.close()
  })

  it('6. opening the session store does not disturb reward data and vice versa', async () => {
    const factory = new IDBFactory()
    const name = databaseName()

    const reward = createDisposableRewardStore(name, factory)
    expect(await reward.saveConfig(rewardConfig())).toMatchObject({ status: 'success' })
    reward.close()

    const session = createUnifiedIndexedDbSessionStore({ databaseName: name, indexedDB: factory })
    expect(await session.create(savedSession())).toMatchObject({ status: 'success' })
    session.close()

    const reopened = createDisposableRewardStore(name, factory)
    try {
      expect(await reopened.loadConfig()).toMatchObject({ status: 'found', value: { rupiahPerStar: 500 } })
    } finally {
      reopened.close()
    }

    const legacyFactory = new IDBFactory()
    const legacyName = databaseName()
    const legacyStore = createIndexedDbSessionStore({ databaseName: legacyName, indexedDB: legacyFactory })
    expect(await legacyStore.load('regular')).toEqual({ status: 'empty' })
    const legacyRaw = await openRaw(legacyFactory, legacyName, SESSION_DATABASE_VERSION)
    // The default application factory must stay on v1 (no accidental upgrade).
    expect(legacyRaw.version).toBe(SESSION_DATABASE_VERSION)
    expect([...legacyRaw.objectStoreNames]).toEqual(['activeSessions'])
    legacyRaw.close()
    legacyStore.close()
  })
})
