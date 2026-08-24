import { beforeEach, describe, expect, it } from 'vitest'
import type { StoreObject, UploadSession } from '../../src/objectStoreService/types'
import {
  KEY_STORE_CALL_CAPABILITY,
  KEY_STORE_OBJECT,
  StoreService,
} from '../../src/objectStoreService/service'
import { MemoryStateStore, type StateStore } from '../../src/store'
import { MemoryObjectStore } from '../../src/context/objectStore'
import { isTBError } from '../../src/errors'

const TOKEN_SECRET = 'test-store-token-secret-at-least-16'
const OWNER = 'agent:caller'
const OTHER = 'agent:other'
const DEVICE = 'device:camera-01'

function codeIs(code: string) {
  return (error: unknown) => isTBError(error) && error.code === code
}

describe('StoreService', () => {
  let now: string
  let state: MemoryStateStore
  let objects: MemoryObjectStore
  let service: StoreService

  beforeEach(() => {
    now = '2026-08-25T00:00:00.000Z'
    state = new MemoryStateStore()
    objects = new MemoryObjectStore(() => now)
    service = new StoreService(state, objects, {
      tokenSecret: TOKEN_SECRET,
      now: () => now,
      maxObjectBytes: 1024,
      uploadTtlSec: 60,
      shareTtlSec: 30,
    })
  })

  it('缺少跨副本 CAS 的 StateStore fail closed', () => {
    const noCas: StateStore = {
      get: key => state.get(key),
      getMany: keys => state.getMany(keys),
      put: (key, value) => state.put(key, value),
      putIfAbsent: (key, value) => state.putIfAbsent(key, value),
      delete: key => state.delete(key),
      list: (prefix, opts) => state.list(prefix, opts),
    }
    expect(() => new StoreService(noCas, objects, { tokenSecret: TOKEN_SECRET }))
      .toThrowError(/compareAndSwap/)
  })

  it('upload/share capability TTL 有七天硬上限', async () => {
    expect(() => new StoreService(state, objects, {
      tokenSecret: TOKEN_SECRET,
      uploadTtlSec: 604_801,
    })).toThrowError(/uploadTtlSec/)

    const start = await service.beginUpload({ contentType: 'text/plain' }, { owner: OWNER })
    const ready = await service.commitRelayUpload({ uploadToken: start.uploadToken, body: 'x' })
    await expect(service.share(ready.uri, OWNER, 604_801))
      .rejects.toSatisfy(codeIs('invalid_argument'))
  })

  it('ordinary relay: owner 用稳定 OwnerRef、token 只存 hash、PUT 即 ready、complete 幂等', async () => {
    const start = await service.beginUpload({
      contentType: 'image/jpeg',
      filename: '../camera.jpg',
      size: 5,
      idempotencyKey: 'photo-1',
    }, { owner: OWNER, producer: DEVICE })
    expect(start.transport).toBe('relay')
    expect(start.objectUri).toMatch(/^store:\/\/default\//)

    const raw = (await state.list('store:')).items
    const dump = JSON.stringify(raw)
    expect(dump).not.toContain(start.uploadToken)
    const storedObject = raw.find(item => item.key.startsWith(KEY_STORE_OBJECT))?.value as StoreObject
    expect(storedObject.owner).toBe(OWNER)
    expect(storedObject.producer).toBe(DEVICE)
    expect(storedObject.driverKey).not.toContain('../camera.jpg')

    const ready = await service.commitRelayUpload({
      uploadToken: start.uploadToken,
      body: 'hello',
    })
    expect(ready).toMatchObject({
      uri: start.objectUri,
      owner: OWNER,
      producer: DEVICE,
      size: 5,
      contentType: 'image/jpeg',
      status: 'ready',
    })
    expect(await service.completeUploadWithToken(start.uploadId, start.uploadToken)).toEqual(ready)
    expect(await service.completeUpload(start.uploadId, OWNER)).toEqual(ready)
  })

  it('idempotency 同声明返回同 session，矛盾声明 conflict', async () => {
    const first = await service.beginUpload({
      contentType: 'image/jpeg',
      size: 3,
      idempotencyKey: 'same',
    }, { owner: OWNER })
    const replay = await service.beginUpload({
      contentType: 'image/jpeg',
      size: 3,
      idempotencyKey: 'same',
    }, { owner: OWNER })
    expect(replay.uploadId).toBe(first.uploadId)
    expect(replay.objectUri).toBe(first.objectUri)
    expect(replay.uploadToken).toBe(first.uploadToken)
    await expect(service.beginUpload({
      contentType: 'video/mp4',
      size: 3,
      idempotencyKey: 'same',
    }, { owner: OWNER })).rejects.toSatisfy(codeIs('conflict'))
  })

  it('超限 create 不占住 idempotency key，修正声明后可立即重试', async () => {
    const limited = new StoreService(state, objects, {
      tokenSecret: TOKEN_SECRET,
      now: () => now,
      maxObjectBytes: 100,
      relayMaxBytes: 5,
    })
    await expect(limited.beginUpload({
      contentType: 'video/mp4',
      size: 6,
      idempotencyKey: 'oversized',
    }, { owner: OWNER })).rejects.toSatisfy(codeIs('rate_limited'))

    await expect(limited.beginUpload({
      contentType: 'video/mp4',
      size: 4,
      idempotencyKey: 'oversized',
    }, { owner: OWNER })).resolves.toMatchObject({ maxBytes: 5, transport: 'relay' })
  })

  it('upload token 篡改、过期与 size 虚报均拒绝；失败对象不再可读', async () => {
    const tampered = await service.beginUpload({ contentType: 'image/jpeg' }, { owner: OWNER })
    await expect(service.commitRelayUpload({
      uploadToken: `${tampered.uploadToken.slice(0, -1)}x`,
      body: 'x',
    })).rejects.toSatisfy(codeIs('permission_denied'))

    const expired = await service.beginUpload({ contentType: 'image/jpeg' }, { owner: OWNER })
    now = '2026-08-25T00:02:00.000Z'
    await expect(service.commitRelayUpload({ uploadToken: expired.uploadToken, body: 'x' }))
      .rejects.toSatisfy(codeIs('permission_denied'))

    now = '2026-08-25T00:00:00.000Z'
    const wrongSize = await service.beginUpload({
      contentType: 'image/jpeg',
      size: 2,
    }, { owner: OWNER })
    await expect(service.commitRelayUpload({ uploadToken: wrongSize.uploadToken, body: 'xxx' }))
      .rejects.toSatisfy(codeIs('conflict'))
    await expect(service.stat(wrongSize.objectUri, { owner: OWNER }))
      .rejects.toSatisfy(codeIs('not_found'))
  })

  it('relayMaxBytes 独立收紧 relay，不把部署平台上限误当作 direct 上限', async () => {
    const limited = new StoreService(new MemoryStateStore(), new MemoryObjectStore(), {
      tokenSecret: TOKEN_SECRET,
      now: () => now,
      maxObjectBytes: 100,
      relayMaxBytes: 5,
    })
    await expect(limited.beginUpload({
      contentType: 'video/mp4',
      size: 6,
    }, { owner: OWNER })).rejects.toSatisfy(codeIs('rate_limited'))
    const accepted = await limited.beginUpload({
      contentType: 'video/mp4',
      size: 5,
    }, { owner: OWNER })
    expect(accepted).toMatchObject({ transport: 'relay', maxBytes: 5 })
  })

  it('无 Content-Length 的 relay 流逐 chunk 限额，越界立即 cancel 且不留最终对象', async () => {
    const limitedState = new MemoryStateStore()
    const limitedObjects = new MemoryObjectStore(() => now)
    const limited = new StoreService(limitedState, limitedObjects, {
      tokenSecret: TOKEN_SECRET,
      now: () => now,
      maxObjectBytes: 5,
      relayMaxBytes: 5,
    })
    const start = await limited.beginUpload({ contentType: 'video/mp4' }, { owner: OWNER })
    let step = 0
    let cancelled = false
    const body = {
      getReader() {
        return {
          async read() {
            step++
            if (step === 1) return { done: false, value: new Uint8Array(4) }
            if (step === 2) return { done: false, value: new Uint8Array(4) }
            return { done: true }
          },
          async cancel() {
            cancelled = true
          },
          releaseLock() {},
        }
      },
    }
    await expect(limited.commitRelayUpload({ uploadToken: start.uploadToken, body }))
      .rejects.toSatisfy(codeIs('rate_limited'))
    expect(cancelled).toBe(true)
    const stored = (await limitedState.list(KEY_STORE_OBJECT)).items[0]?.value as StoreObject
    expect(stored.status).toBe('failed')
    expect(await limitedObjects.head(stored.driverKey)).toBeNull()
  })

  it('call capability 绑定 owner/producer/call/MIME/数量/字节，幂等重放不重复消费', async () => {
    const issued = await service.issueCallUploadCapability({
      owner: OWNER,
      producer: DEVICE,
      callId: 'call-123',
      expiresAt: '2026-08-25T00:05:00.000Z',
      maxObjects: 2,
      maxBytes: 10,
      maxObjectBytes: 6,
      allowedContentTypes: ['image/*'],
    })
    expect(JSON.stringify((await state.list(KEY_STORE_CALL_CAPABILITY)).items))
      .not.toContain(issued.token)

    const one = await service.beginCallUpload({
      contentType: 'image/jpeg',
      size: 4,
      idempotencyKey: 'one',
    }, issued.token)
    const replay = await service.beginCallUpload({
      contentType: 'image/jpeg',
      size: 4,
      idempotencyKey: 'one',
    }, issued.token)
    expect(replay.uploadId).toBe(one.uploadId)
    const afterReplay = await service.verifyCallUploadCapability(issued.token)
    expect(afterReplay.reservations).toHaveLength(1)
    expect(afterReplay.reservedBytes).toBe(4)

    await service.beginCallUpload({ contentType: 'image/png', size: 6 }, issued.token)
    const exhausted = await service.verifyCallUploadCapability(issued.token)
    expect(exhausted.status).toBe('exhausted')
    expect(exhausted.reservedBytes).toBe(10)
    await expect(service.beginCallUpload({ contentType: 'image/webp', size: 1 }, issued.token))
      .rejects.toSatisfy(codeIs('rate_limited'))

    const object = (await state.list(KEY_STORE_OBJECT)).items
      .map(item => item.value as StoreObject)
      .find(item => item.originCallId === 'call-123')
    expect(object).toMatchObject({ owner: OWNER, producer: DEVICE, originCallId: 'call-123' })
  })

  it('call capability 拒绝 MIME、篡改与过期 token', async () => {
    const issued = await service.issueCallUploadCapability({
      owner: OWNER,
      producer: DEVICE,
      callId: 'call-x',
      expiresAt: '2026-08-25T00:01:00.000Z',
      maxObjects: 2,
      maxBytes: 20,
      maxObjectBytes: 10,
      allowedContentTypes: ['image/*'],
    })
    await expect(service.beginCallUpload({ contentType: 'video/mp4', size: 1 }, issued.token))
      .rejects.toSatisfy(codeIs('permission_denied'))
    await expect(service.verifyCallUploadCapability(`${issued.token.slice(0, -1)}x`))
      .rejects.toSatisfy(codeIs('permission_denied'))
    now = '2026-08-25T00:02:00.000Z'
    await expect(service.verifyCallUploadCapability(issued.token))
      .rejects.toSatisfy(codeIs('permission_denied'))
  })

  it('call capability revoke 幂等，撤销后不能再消费', async () => {
    const issued = await service.issueCallUploadCapability({
      owner: OWNER,
      producer: DEVICE,
      callId: 'call-revoke',
      expiresAt: '2026-08-25T00:05:00.000Z',
      maxObjects: 1,
      maxBytes: 10,
      maxObjectBytes: 10,
      allowedContentTypes: ['image/*'],
    })
    await service.revokeCallUploadCapability(issued.token)
    await service.revokeCallUploadCapability(issued.token)
    await expect(service.beginCallUpload({ contentType: 'image/jpeg', size: 1 }, issued.token))
      .rejects.toSatisfy(codeIs('permission_denied'))
  })

  it('owner 隔离、list、delete 与 share/revoke 全链路', async () => {
    const first = await service.beginUpload({ contentType: 'text/plain', size: 3 }, { owner: OWNER })
    const ready = await service.commitRelayUpload({ uploadToken: first.uploadToken, body: 'one' })
    expect((await service.list(OWNER)).items).toEqual([ready])
    expect((await service.list(OTHER)).items).toEqual([])
    await expect(service.stat(ready.uri, { owner: OTHER })).rejects.toSatisfy(codeIs('not_found'))

    const share = await service.share(ready.uri, OWNER, 20)
    expect(JSON.stringify((await state.list('store:share:')).items)).not.toContain(share.token)
    expect(await service.authorizeSharedRead(ready.uri, share.token)).toMatchObject({
      id: ready.uri.slice('store://default/'.length),
      owner: OWNER,
      status: 'ready',
    })

    const second = await service.beginUpload({ contentType: 'text/plain', size: 3 }, { owner: OWNER })
    const otherReady = await service.commitRelayUpload({ uploadToken: second.uploadToken, body: 'two' })
    await expect(service.authorizeSharedRead(otherReady.uri, share.token))
      .rejects.toSatisfy(codeIs('permission_denied'))

    await service.revokeShare(share.shareId, OWNER)
    await expect(service.authorizeSharedRead(ready.uri, share.token))
      .rejects.toSatisfy(codeIs('permission_denied'))
    await service.delete(ready.uri, { owner: OWNER })
    await expect(service.stat(ready.uri, { owner: OWNER })).rejects.toSatisfy(codeIs('not_found'))
    expect(await service.delete(ready.uri, { owner: OWNER })).toEqual({ ok: true })
  })

  it('list 的 owner 过滤分页不跳过同一底层页中尚未扫描的对象', async () => {
    const ids = [
      'AAAAAAAAAAAAAAAAAAAAAA',
      'BBBBBBBBBBBBBBBBBBBBBB',
      'CCCCCCCCCCCCCCCCCCCCCC',
    ]
    for (const [index, id] of ids.entries()) {
      const owner = index === 1 ? OTHER : OWNER
      const record: StoreObject = {
        id,
        store: 'default',
        driverKey: `store/v1/${id.slice(0, 2)}/${id}`,
        uploadId: `upload-${id}`,
        status: 'ready',
        owner,
        producer: owner,
        contentType: 'text/plain',
        size: 1,
        etag: `v${index}`,
        createdAt: now,
        updatedAt: now,
        readyAt: now,
        revision: 1,
      }
      await state.put(`${KEY_STORE_OBJECT}${id}`, record)
    }
    const first = await service.list(OWNER, { limit: 1 })
    expect(first.items.map(item => item.uri)).toEqual([`store://default/${ids[0]}`])
    expect(first.cursor).toBeDefined()
    const second = await service.list(OWNER, { limit: 1, cursor: first.cursor })
    expect(second.items.map(item => item.uri)).toEqual([`store://default/${ids[2]}`])
  })

  it('abort 与 ready 竞争有确定结果：abandoned 不可提交，ready 不可 abort', async () => {
    const aborted = await service.beginUpload({ contentType: 'text/plain' }, { owner: OWNER })
    expect(await service.abortUploadWithToken(aborted.uploadId, aborted.uploadToken))
      .toEqual({ ok: true })
    await expect(service.commitRelayUpload({ uploadToken: aborted.uploadToken, body: 'late' }))
      .rejects.toSatisfy(codeIs('permission_denied'))

    const completed = await service.beginUpload({
      contentType: 'text/plain',
      size: 2,
    }, { owner: OWNER })
    await service.commitRelayUpload({ uploadToken: completed.uploadToken, body: 'ok' })
    await expect(service.abortUploadWithToken(completed.uploadId, completed.uploadToken))
      .rejects.toSatisfy(codeIs('conflict'))
  })

  it('cleanup 幂等回收过期 upload/call/share 及 pending bytes', async () => {
    const pending = await service.beginUpload({ contentType: 'text/plain' }, { owner: OWNER })
    const issued = await service.issueCallUploadCapability({
      owner: OWNER,
      producer: DEVICE,
      callId: 'cleanup-call',
      expiresAt: '2026-08-25T00:00:30.000Z',
      maxObjects: 1,
      maxBytes: 10,
      maxObjectBytes: 10,
      allowedContentTypes: ['text/plain'],
    })
    const readyStart = await service.beginUpload({
      contentType: 'text/plain',
      size: 1,
    }, { owner: OWNER })
    const ready = await service.commitRelayUpload({ uploadToken: readyStart.uploadToken, body: 'x' })
    const share = await service.share(ready.uri, OWNER, 20)
    expect(await service.verifyCallUploadCapability(issued.token)).toBeDefined()
    expect(await service.verifyShareToken(share.token)).toBeDefined()

    now = '2026-08-25T00:02:00.000Z'
    const first = await service.cleanup()
    expect(first).toMatchObject({
      expiredUploads: 1,
      expiredCallCapabilities: 1,
      expiredShares: 1,
    })
    await expect(service.verifyUploadToken(pending.uploadToken))
      .rejects.toSatisfy(codeIs('permission_denied'))
    await expect(service.verifyCallUploadCapability(issued.token))
      .rejects.toSatisfy(codeIs('permission_denied'))
    await expect(service.verifyShareToken(share.token))
      .rejects.toSatisfy(codeIs('permission_denied'))
    expect(await service.cleanup()).toMatchObject({
      expiredUploads: 0,
      expiredCallCapabilities: 0,
      expiredShares: 0,
    })
  })

  it('cleanup 的过期 CAS 输给并发 complete 时绝不删除 ready 字节', async () => {
    class CompleteWinsState extends MemoryStateStore {
      win = true

      override async compareAndSwap(
        key: string,
        expectedRevision: number | null,
        value: unknown | null,
      ): Promise<boolean> {
        const next = value as { status?: unknown } | null
        if (
          this.win
          && key.startsWith('store:upload:')
          && expectedRevision !== null
          && next?.status === 'expired'
        ) {
          this.win = false
          const session = await this.get(key) as UploadSession
          const objectKey = `${KEY_STORE_OBJECT}${session.objectId}`
          const object = await this.get(objectKey) as StoreObject
          const readyAt = '2026-08-25T00:02:00.000Z'
          await super.compareAndSwap(objectKey, object.revision, {
            ...object,
            status: 'ready',
            size: 4,
            etag: 'winner',
            readyAt,
            updatedAt: readyAt,
            revision: object.revision + 1,
          })
          await super.compareAndSwap(key, session.revision, {
            ...session,
            status: 'completed',
            completedAt: readyAt,
            revision: session.revision + 1,
          })
          return false
        }
        return await super.compareAndSwap(key, expectedRevision, value)
      }
    }

    const raceState = new CompleteWinsState()
    const raceObjects = new MemoryObjectStore(() => now)
    const raceService = new StoreService(raceState, raceObjects, {
      tokenSecret: TOKEN_SECRET,
      now: () => now,
      uploadTtlSec: 60,
    })
    const start = await raceService.beginUpload({
      contentType: 'video/mp4',
      size: 4,
    }, { owner: OWNER })
    const object = (await raceState.list(KEY_STORE_OBJECT)).items[0]?.value as StoreObject
    await raceObjects.put(object.driverKey, 'data', { ifNoneMatch: '*' })

    now = '2026-08-25T00:02:00.000Z'
    const cleaned = await raceService.cleanup()
    expect(cleaned.expiredUploads).toBe(0)
    expect(cleaned.deletedBytes).toBe(0)
    expect(await raceObjects.head(object.driverKey)).not.toBeNull()
    await expect(raceService.stat(start.objectUri, { owner: OWNER })).resolves.toMatchObject({
      status: 'ready',
      size: 4,
    })
  })

  it('cleanup 返回各前缀 cursor，小页循环不会让后续过期记录饿死', async () => {
    for (let i = 0; i < 3; i++) {
      await service.beginUpload({ contentType: 'text/plain' }, { owner: OWNER })
    }
    now = '2026-08-25T00:02:00.000Z'
    let cursors: Awaited<ReturnType<StoreService['cleanup']>>['cursors']
    let expiredUploads = 0
    do {
      const step = await service.cleanup({ limit: 1, ...(cursors !== undefined ? { cursors } : {}) })
      expiredUploads += step.expiredUploads
      cursors = step.cursors
    } while (cursors !== undefined)
    expect(expiredUploads).toBe(3)
  })

  it('cleanup 调用 staging hook、删除 driver orphan，并释放过期 idempotency key', async () => {
    class CleanupAwareStore extends MemoryObjectStore {
      cleanupArgs?: { olderThan: string, prefix: string }

      async cleanupStaging(prefix: string, olderThan: string): Promise<number> {
        this.cleanupArgs = { prefix, olderThan }
        return 2
      }
    }
    const cleanupState = new MemoryStateStore()
    const cleanupObjects = new CleanupAwareStore(() => now)
    const cleanupService = new StoreService(cleanupState, cleanupObjects, {
      tokenSecret: TOKEN_SECRET,
      now: () => now,
      uploadTtlSec: 60,
    })
    const first = await cleanupService.beginUpload({
      contentType: 'text/plain',
      idempotencyKey: 'reusable-after-expiry',
    }, { owner: OWNER })
    const orphanId = 'ZZZZZZZZZZZZZZZZZZZZZZ'
    const orphanKey = `store/v1/ZZ/${orphanId}`
    await cleanupObjects.put(orphanKey, 'orphan')

    now = '2026-08-25T00:02:00.000Z'
    const cleaned = await cleanupService.cleanup()
    expect(cleaned).toMatchObject({
      deletedStaging: 2,
      deletedOrphans: 1,
      expiredIdempotencyBindings: 1,
    })
    expect(cleanupObjects.cleanupArgs).toEqual({
      prefix: 'store/v1/',
      olderThan: '2026-08-25T00:01:00.000Z',
    })
    expect(await cleanupObjects.head(orphanKey)).toBeNull()

    const retried = await cleanupService.beginUpload({
      contentType: 'text/plain',
      idempotencyKey: 'reusable-after-expiry',
    }, { owner: OWNER })
    expect(retried.uploadId).not.toBe(first.uploadId)
  })

  it('driver 反向扫描会 CAS 放弃过期 pending，再删除边界处晚到的直传字节', async () => {
    const start = await service.beginUpload({ contentType: 'video/mp4' }, { owner: OWNER })
    const stored = (await state.list(KEY_STORE_OBJECT)).items[0]?.value as StoreObject
    await objects.put(stored.driverKey, 'late-direct-bytes', { ifNoneMatch: '*' })
    now = '2026-08-25T00:02:00.000Z'
    const cleaned = await service.cleanup({
      cursors: {
        uploads: null,
        shares: null,
        callCapabilities: null,
        idempotencyBindings: null,
        objects: null,
        driverObjects: '',
      },
    })
    expect(cleaned.deletedOrphans).toBe(1)
    expect(await objects.head(stored.driverKey)).toBeNull()
    await expect(service.verifyUploadToken(start.uploadToken))
      .rejects.toSatisfy(codeIs('permission_denied'))
    const abandoned = (await state.get(`${KEY_STORE_OBJECT}${stored.id}`)) as StoreObject
    expect(abandoned.status).toBe('abandoned')
  })
})

describe('StoreService direct upload', () => {
  it('presigned PUT 必须 complete/HEAD，且并发 complete 幂等返回同 descriptor', async () => {
    const state = new MemoryStateStore()
    class PresigningStore extends MemoryObjectStore {
      async presignPut(key: string) {
        return {
          method: 'PUT' as const,
          url: `https://objects.invalid/${key}`,
          headers: { 'If-None-Match': '*' },
        }
      }
    }
    const objects = new PresigningStore(() => '2026-08-25T00:00:00.000Z')
    const service = new StoreService(state, objects, {
      tokenSecret: TOKEN_SECRET,
      now: () => '2026-08-25T00:00:00.000Z',
      maxObjectBytes: 100,
      relayMaxBytes: 5,
    })
    const start = await service.beginUpload({
      contentType: 'video/mp4',
      size: 4,
      checksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
    }, { owner: OWNER })
    expect(start.transport).toBe('presigned-put')
    expect(start.maxBytes).toBe(100)
    await expect(service.stat(start.objectUri, { owner: OWNER })).rejects.toSatisfy(codeIs('not_found'))
    const stored = (await state.list(KEY_STORE_OBJECT)).items[0]?.value as StoreObject
    await objects.put(stored.driverKey, 'data', { contentType: 'video/mp4', ifNoneMatch: '*' })
    const [left, right] = await Promise.all([
      service.completeUploadWithToken(start.uploadId, start.uploadToken),
      service.completeUploadWithToken(start.uploadId, start.uploadToken),
    ])
    expect(left).toEqual(right)
    expect(left).toMatchObject({ uri: start.objectUri, size: 4, status: 'ready' })
    // backend 未返回可验证 checksum metadata 时，声明值绝不能冒充已验证值。
    expect(left.checksum).toBeUndefined()
  })
})
