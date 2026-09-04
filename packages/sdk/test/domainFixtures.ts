import { MemoryMailboxRepository, MemoryStoreRepository, type ObjectStore } from '@tool-bridge/core'

export function testPersistence(objects: ObjectStore) {
  return {
    objects,
    storeRepository: new MemoryStoreRepository(),
    mailboxRepository: new MemoryMailboxRepository(),
    storeBackends: {
      defaultBackend: async () => ({ id: 'test-backend', objects }),
      resolveBackend: async () => objects,
    },
  }
}
