export const KEY_STORE_OBJECT = 'store:object:'
export const KEY_STORE_UPLOAD = 'store:upload:'
export const KEY_STORE_CALL_CAPABILITY = 'store:call-capability:'
export const KEY_STORE_SHARE = 'store:share:'
export const KEY_STORE_IDEMPOTENCY = 'store:idempotency:'

import type { StoreBackendResolver, StoreRepository } from '../../src/objectStoreService/repository'
import type { ObjectStore } from '../../src/context/objectStore'
import { MemoryStoreRecords, MemoryStoreRepository } from '../../src/objectStoreService/memoryRepository'

/** Named fixtures preserve readable corruption/fault-injection tests after the KV backend retired. */
export class StoreTestRepository extends MemoryStoreRepository {
  private readonly collections = [
    ['store:object:', this.objects], ['store:upload:', this.uploads],
    ['store:share:', this.shares], ['store:call-capability:', this.callCapabilities],
    ['store:idempotency:', this.idempotencyBindings],
  ] as const

  constructor() {
    super()
    for (const [prefix, records] of this.collections) {
      records.compare = (id: string, revision: number | null, next: { revision: number } | null) => this.compareAndSwap(prefix + id, revision, next)
    }
  }

  private collection(key: string): { id: string, records: MemoryStoreRecords<{ revision: number }> } {
    const found = this.collections.find(([prefix]) => key.startsWith(prefix))
    if (found === undefined) throw new Error(`unknown test entity ${key}`)
    return { records: found[1] as MemoryStoreRecords<{ revision: number }>, id: key.slice(found[0].length) }
  }

  async get(key: string): Promise<unknown | null> {
    const { records, id } = this.collection(key)
    return records.get(id)
  }

  async put(key: string, value: unknown): Promise<void> {
    const { records, id } = this.collection(key)
    records.values.set(id, value as { revision: number })
  }

  async compareAndSwap(key: string, revision: number | null, value: unknown | null): Promise<boolean> {
    const { records, id } = this.collection(key)
    return MemoryStoreRecords.prototype.compare.call(records, id, revision, value as { revision: number } | null)
  }

  async list(prefix: string): Promise<{ items: Array<{ key: string, value: unknown }> }> {
    const items: Array<{ key: string, value: unknown }> = []
    for (const [entityPrefix, records] of this.collections) {
      for (const [id, value] of records.values) {
        const key = entityPrefix + id
        if (key.startsWith(prefix)) items.push({ key, value })
      }
    }
    return { items: items.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) }
  }
}

export function backend(objects: ObjectStore): StoreBackendResolver {
  return { defaultBackend: async () => ({ id: 'test', objects }), resolveBackend: async () => objects }
}

export type TestStoreRepository = StoreRepository
