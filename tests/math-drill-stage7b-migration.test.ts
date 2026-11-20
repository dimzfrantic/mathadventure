import { describe, expect, it } from 'vitest'
import { upgradeDatabaseToVersion3 } from '../src/features/math-drill/reward'

describe('Stage 7B — Phase 3: IndexedDB Version 3 Migration Simulation', () => {
  it('1. upgrades a mock IDBDatabase successfully, creating stores and indexes idempotently', () => {
    const createdStores = new Map<string, { keyPath: string; indexes: Map<string, string> }>()

    const mockDb = {
      objectStoreNames: {
        contains: (name: string) => createdStores.has(name),
      },
      createObjectStore: (name: string, options: { keyPath: string }) => {
        const indexes = new Map<string, string>()
        const storeObj = {
          keyPath: options.keyPath,
          // Real IDBObjectStore exposes indexNames; the upgrade path checks it
          // for idempotency, so the mock must model it faithfully.
          indexNames: {
            contains: (indexName: string) => indexes.has(indexName),
          },
          createIndex: (indexName: string, keyPath: string) => {
            indexes.set(indexName, keyPath)
          },
        }
        createdStores.set(name, { keyPath: options.keyPath, indexes })
        return storeObj
      },
    } as unknown as IDBDatabase

    // Run migration
    upgradeDatabaseToVersion3(mockDb)

    // Verify stores created
    expect(createdStores.has('rewardTransactions')).toBe(true)
    expect(createdStores.has('rewardConfig')).toBe(true)

    const txStore = createdStores.get('rewardTransactions')!
    expect(txStore.keyPath).toBe('transactionId')
    expect(txStore.indexes.has('status')).toBe(true)
    expect(txStore.indexes.has('requestedAt')).toBe(true)

    const configStore = createdStores.get('rewardConfig')!
    expect(configStore.keyPath).toBe('configId')

    // Run migration again (idempotency check: should not throw or duplicate)
    expect(() => upgradeDatabaseToVersion3(mockDb)).not.toThrow()
  })
})
