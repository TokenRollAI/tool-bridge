import type { CallUploadCapability, ShareGrant, StoreObject, UploadSession } from './types'
import { assertUploadBinding, type BeginStoreUpload, reserveUploadQuota, type StoreIdempotencyBinding, type StoreRecords, type StoreRepository } from './repository'
import { TBError } from '../errors'

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Volatile, explicit test/embedded-development repository. Never a persistent-host fallback. */
export class MemoryStoreRecords<T extends { revision: number }> implements StoreRecords<T> {
  readonly values = new Map<string, T>()
  async get(id: string): Promise<T | null> { return copy(this.values.get(id) ?? null) }
  async compare(id: string, revision: number | null, next: T | null): Promise<boolean> {
    const current = this.values.get(id)
    if (revision === null ? current !== undefined || next === null : current?.revision !== revision) return false
    if (next === null) this.values.delete(id)
    else this.values.set(id, copy(next))
    return true
  }

  async list(opts: { cursor?: string, limit: number }): Promise<{ cursor?: string, items: Array<{ key: string, value: T }> }> {
    const entries = [...this.values].filter(([key]) => opts.cursor === undefined || key > opts.cursor).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    const items = entries.slice(0, opts.limit).map(([key, value]) => ({ key, value: copy(value) }))
    const last = items.at(-1)
    return { items, ...(entries.length > opts.limit && last !== undefined ? { cursor: last.key } : {}) }
  }
}

export class MemoryStoreRepository implements StoreRepository {
  readonly objects = new MemoryStoreRecords<StoreObject>()
  readonly uploads = new MemoryStoreRecords<UploadSession>()
  readonly shares = new MemoryStoreRecords<ShareGrant>()
  readonly callCapabilities = new MemoryStoreRecords<CallUploadCapability>()
  readonly idempotencyBindings = new MemoryStoreRecords<StoreIdempotencyBinding>()

  async beginUpload(candidate: BeginStoreUpload): Promise<{ object: StoreObject, session: UploadSession }> {
    const input = copy(candidate)
    if (input.binding !== undefined) {
      const previous = this.idempotencyBindings.values.get(input.binding.id)
      if (previous !== undefined) {
        assertUploadBinding(previous, input.binding.record, input.now)
        const object = this.objects.values.get(previous.objectId)
        const session = this.uploads.values.get(previous.uploadId)
        if (object === undefined || session === undefined) throw new TBError('internal', 'upload identity records missing')
        return copy({ object, session })
      }
    }
    if (this.objects.values.has(input.object.id) || this.uploads.values.has(input.session.id)) throw new TBError('conflict', 'upload identity collision')
    let capability: CallUploadCapability | undefined
    if (input.capability !== undefined) {
      const current = this.callCapabilities.values.get(input.capability.id)
      if (current === undefined) throw new TBError('permission_denied', 'call upload capability 不存在')
      capability = reserveUploadQuota(input, current)
    }
    // No await in this mutation section: tests observe the same atomic boundary as PG.
    if (capability !== undefined) this.callCapabilities.values.set(capability.id, copy(capability))
    this.objects.values.set(input.object.id, copy(input.object))
    this.uploads.values.set(input.session.id, copy(input.session))
    if (input.binding !== undefined) this.idempotencyBindings.values.set(input.binding.id, copy(input.binding.record))
    return copy({ object: input.object, session: input.session })
  }

  async finishUpload(object: StoreObject, session: UploadSession): Promise<StoreObject | null> {
    const current = this.objects.values.get(object.id)
    if (current?.status === 'ready') return copy(current)
    if (current?.revision !== object.revision - 1 || current.status !== 'pending'
      || this.uploads.values.get(session.id)?.status !== 'created'
      || this.uploads.values.get(session.id)?.revision !== session.revision - 1) return null
    this.objects.values.set(object.id, copy(object))
    this.uploads.values.set(session.id, copy(session))
    return copy(object)
  }

  async terminateUpload(object: StoreObject, session: UploadSession): Promise<boolean> {
    if (this.objects.values.get(object.id)?.revision !== object.revision - 1
      || this.uploads.values.get(session.id)?.revision !== session.revision - 1) return false
    this.objects.values.set(object.id, copy(object))
    this.uploads.values.set(session.id, copy(session))
    return true
  }

  async listReadyObjects(owner: string, opts: { cursor?: string, limit: number }): Promise<{ cursor?: string, items: StoreObject[] }> {
    const rows = [...this.objects.values.values()].filter(row => row.owner === owner && row.status === 'ready'
      && (opts.cursor === undefined || row.id > opts.cursor)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    const items = rows.slice(0, opts.limit).map(copy)
    const last = items.at(-1)
    return { items, ...(rows.length > opts.limit && last !== undefined ? { cursor: last.id } : {}) }
  }
}
