import type { DeviceOperationRecord, DeviceOperationState } from './mailbox'
import { TBError } from '../errors'

export interface MailboxQuery {
  /** Select only queued/expired-lease candidates for this device credential. */
  claimableBy?: string
  cursor?: string
  deviceId?: string
  limit: number
  now?: string
  states?: DeviceOperationState[]
}

export interface MailboxRepository {
  claimNext(record: DeviceOperationRecord, expectedRevision: number, now: string): Promise<boolean>
  compare(operationId: string, revision: number, next: DeviceOperationRecord | null): Promise<boolean>
  complete(record: DeviceOperationRecord, expectedRevision: number, now: string): Promise<boolean>
  enqueue(record: DeviceOperationRecord, maxPendingPerDevice: number, now: string): Promise<DeviceOperationRecord>
  get(operationId: string): Promise<DeviceOperationRecord | null>
  list(query: MailboxQuery): Promise<{ cursor?: string, items: Array<{ key: string, value: DeviceOperationRecord }> }>
  renew(record: DeviceOperationRecord, expectedRevision: number, now: string): Promise<boolean>
}

export function assertMailboxIdentity(previous: DeviceOperationRecord, requested: DeviceOperationRecord): void {
  if (requested.idempotencyFingerprint === undefined || previous.idempotencyFingerprint !== requested.idempotencyFingerprint
    || previous.deviceId !== requested.deviceId || previous.callerOwner !== requested.callerOwner
    || previous.targetPath !== requested.targetPath) {
    throw new TBError('conflict', 'idempotency key is bound to another operation')
  }
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Explicit volatile test/embedded-development authority, never a host persistence fallback. */
export class MemoryMailboxRepository implements MailboxRepository {
  readonly records = new Map<string, DeviceOperationRecord>()
  async get(id: string): Promise<DeviceOperationRecord | null> { return copy(this.records.get(id) ?? null) }
  async list(query: MailboxQuery): Promise<{ cursor?: string, items: Array<{ key: string, value: DeviceOperationRecord }> }> {
    const rows = [...this.records.values()].filter(row => (query.deviceId === undefined || row.deviceId === query.deviceId)
      && (query.cursor === undefined || row.operationId > query.cursor)
      && (query.states === undefined || query.states.includes(row.state))
      && (query.claimableBy === undefined || (row.deviceKeyId === query.claimableBy && row.expiresAt > (query.now ?? '')
        && (row.state === 'queued' || (row.state === 'claimed' && (row.leaseUntil ?? '') <= (query.now ?? ''))))))
      .sort((a, b) => a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0)
    const items = rows.slice(0, query.limit).map(row => ({ key: row.operationId, value: copy(row) }))
    const last = items.at(-1)
    return { items, ...(rows.length > query.limit && last !== undefined ? { cursor: last.key } : {}) }
  }

  async compare(id: string, revision: number, next: DeviceOperationRecord | null): Promise<boolean> {
    if (this.records.get(id)?.revision !== revision || (next !== null && next.revision !== revision + 1)) return false
    if (next === null) this.records.delete(id)
    else this.records.set(id, copy(next))
    return true
  }

  async enqueue(record: DeviceOperationRecord, maxPending: number, now: string): Promise<DeviceOperationRecord> {
    const existing = this.records.get(record.operationId)
    if (existing !== undefined) {
      assertMailboxIdentity(existing, record)
      return copy(existing)
    }
    const pending = [...this.records.values()].filter(row => row.deviceId === record.deviceId
      && (row.state === 'queued' || row.state === 'claimed') && row.expiresAt > now).length
    if (pending >= maxPending) throw new TBError('rate_limited', 'device mailbox pending limit reached', { retryable: true })
    this.records.set(record.operationId, copy(record))
    return copy(record)
  }

  async claimNext(record: DeviceOperationRecord, expectedRevision: number, now: string): Promise<boolean> {
    const current = this.records.get(record.operationId)
    if (current === undefined || current.deviceKeyId !== record.deviceKeyId || current.expiresAt <= now
      || (current.state !== 'queued' && !(current.state === 'claimed' && (current.leaseUntil ?? '') <= now))) return false
    return this.compare(record.operationId, expectedRevision, record)
  }

  async renew(record: DeviceOperationRecord, expectedRevision: number, now: string): Promise<boolean> {
    const current = this.records.get(record.operationId)
    if (current?.state !== 'claimed' || current.deviceKeyId !== record.deviceKeyId
      || current.leaseId !== record.leaseId || current.expiresAt <= now || (current.leaseUntil ?? '') <= now) return false
    return this.compare(record.operationId, expectedRevision, record)
  }

  async complete(record: DeviceOperationRecord, expectedRevision: number, now: string): Promise<boolean> {
    return this.renew(record, expectedRevision, now)
  }
}
