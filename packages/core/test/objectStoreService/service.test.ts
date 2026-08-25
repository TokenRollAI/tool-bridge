import { beforeEach, describe, expect, it } from 'vitest'
import {
  KEY_STORE_CALL_CAPABILITY,
  KEY_STORE_IDEMPOTENCY,
  KEY_STORE_OBJECT,
  KEY_STORE_SHARE,
  KEY_STORE_UPLOAD,
  StoreService,
} from '../../src/objectStoreService/service'
import {
  DEFAULT_STORE_DRIVER_KEY_ROOT,
  type StoreObject,
} from '../../src/objectStoreService/types'
import { MemoryStateStore, type StateStore } from '../../src/store'
import { MemoryObjectStore } from '../../src/context/objectStore'
import { isTBError, TBError } from '../../src/errors'

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

  it('持久化记录只容忍未知新字段，已知时间/配额/状态字段损坏一律 fail closed', async () => {
    const corrupt = async (key: string, patch: Record<string, unknown>): Promise<void> => {
      const current = await state.get(key) as Record<string, unknown> | null
      expect(current).not.toBeNull()
      await state.put(key, { ...current, futureField: 'rolling-deploy-compatible', ...patch })
    }
    const expectCorrupt = async (operation: Promise<unknown>): Promise<void> => {
      await expect(operation).rejects.toMatchObject({
        code: 'internal',
        retryable: false,
      })
    }

    const upload = await service.beginUpload(
      { contentType: 'text/plain', size: 1 },
      { owner: OWNER },
    )
    await corrupt(`${KEY_STORE_UPLOAD}${upload.uploadId}`, { expiresAt: undefined })
    await expectCorrupt(service.verifyUploadToken(upload.uploadToken))

    const call = await service.issueCallUploadCapability({
      allowedContentTypes: ['*/*'],
      callId: 'corrupt-call',
      expiresAt: '2026-08-25T01:00:00.000Z',
      maxBytes: 10,
      maxObjectBytes: 5,
      maxObjects: 2,
      owner: OWNER,
      producer: DEVICE,
    })
    await corrupt(`${KEY_STORE_CALL_CAPABILITY}${call.capability.id}`, {
      reservations: [{ maxBytes: 5, objectId: 'reserved-object' }],
      reservedBytes: 0,
    })
    await expectCorrupt(service.verifyCallUploadCapability(call.token))

    const sharedUpload = await service.beginUpload(
      { contentType: 'text/plain', size: 1 },
      { owner: OWNER },
    )
    const ready = await service.commitRelayUpload({
      uploadToken: sharedUpload.uploadToken,
      body: 'x',
    })
    const share = await service.share(ready.uri, OWNER)
    await corrupt(`${KEY_STORE_SHARE}${share.shareId}`, { expiresAt: 'not-a-timestamp' })
    await expectCorrupt(service.verifyShareToken(share.token))

    const idempotentInput = {
      contentType: 'text/plain',
      idempotencyKey: 'corrupt-binding',
      size: 1,
    }
    await service.beginUpload(idempotentInput, { owner: OWNER })
    const binding = (await state.list(KEY_STORE_IDEMPOTENCY)).items
      .find(item => (item.value as { fingerprint?: unknown }).fingerprint !== undefined)
    expect(binding).toBeDefined()
    await corrupt(binding!.key, { expiresAt: null })
    await expectCorrupt(service.beginUpload(idempotentInput, { owner: OWNER }))

    await corrupt(`${KEY_STORE_OBJECT}${ready.uri.split('/').at(-1)!}`, { updatedAt: undefined })
    await expectCorrupt(service.stat(ready.uri, { owner: OWNER }))
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

  it('begin 的 session CAS 已落地但响应丢失时，幂等 replay 恢复同一外部身份', async () => {
    class LostSessionAckState extends MemoryStateStore {
      loseAck = true

      override async compareAndSwap(
        key: string,
        expectedRevision: number | null,
        value: unknown | null,
      ): Promise<boolean> {
        const written = await super.compareAndSwap(key, expectedRevision, value)
        if (this.loseAck && written && key.startsWith(KEY_STORE_UPLOAD)) {
          this.loseAck = false
          throw new Error('session CAS acknowledgement lost')
        }
        return written
      }
    }
    const replayState = new LostSessionAckState()
    const replayService = new StoreService(replayState, objects, {
      tokenSecret: TOKEN_SECRET,
      now: () => now,
      maxObjectBytes: 1024,
      uploadTtlSec: 60,
    })
    const input = {
      contentType: 'image/jpeg',
      size: 3,
      idempotencyKey: 'lost-session-ack',
    }
    await expect(replayService.beginUpload(input, { owner: OWNER }))
      .rejects.toThrow('session CAS acknowledgement lost')
    const pending = (await replayState.list(KEY_STORE_OBJECT)).items[0]?.value as StoreObject

    const replay = await replayService.beginUpload(input, { owner: OWNER })
    expect(replay).toMatchObject({
      uploadId: pending.uploadId,
      objectUri: `store://default/${pending.id}`,
      alreadyCompleted: false,
    })
    await expect(replayService.commitRelayUpload({
      uploadToken: replay.uploadToken,
      body: 'abc',
    })).resolves.toMatchObject({ uri: replay.objectUri, status: 'ready' })
  })

  it('upload/call/share token 保持独立 domain，grant 分别返回 uploadId 与 Store URI', async () => {
    const upload = await service.beginUpload({ contentType: 'text/plain', size: 1 }, { owner: OWNER })
    expect(upload.uploadId).toMatch(/^[A-Za-z0-9_-]{22,64}$/)
    expect(upload.objectUri).toMatch(/^store:\/\/default\/[A-Za-z0-9_-]{22,64}$/)
    expect(upload.uploadToken).toMatch(new RegExp(`^tbu_${upload.uploadId}\\.`))
    const ready = await service.commitRelayUpload({ uploadToken: upload.uploadToken, body: 'x' })
    const share = await service.share(ready.uri, OWNER)
    const call = await service.issueCallUploadCapability({
      owner: OWNER,
      producer: DEVICE,
      callId: 'domain-call',
      expiresAt: '2026-08-25T00:05:00.000Z',
      maxObjects: 1,
      maxBytes: 1,
      maxObjectBytes: 1,
      allowedContentTypes: ['text/plain'],
    })
    expect(share.token).toMatch(/^tbs_/)
    expect(call.token).toMatch(/^tbc_/)
    await expect(service.verifyUploadToken(call.token)).rejects.toSatisfy(codeIs('permission_denied'))
    await expect(service.verifyCallUploadCapability(share.token))
      .rejects.toSatisfy(codeIs('permission_denied'))
    await expect(service.verifyShareToken(upload.uploadToken))
      .rejects.toSatisfy(codeIs('permission_denied'))
  })

  it('owner 与 call 幂等域隔离，call replay 精确绑定 callId 与 producer', async () => {
    const input = {
      contentType: 'image/jpeg',
      size: 3,
      idempotencyKey: 'same-across-domains',
    }
    const ordinary = await service.beginUpload(input, { owner: OWNER })
    await expect(service.beginUpload(input, { owner: OWNER, producer: DEVICE }))
      .rejects.toSatisfy(codeIs('conflict'))
    const callA = await service.issueCallUploadCapability({
      owner: OWNER,
      producer: DEVICE,
      callId: 'call-a',
      expiresAt: '2026-08-25T00:05:00.000Z',
      maxObjects: 2,
      maxBytes: 10,
      maxObjectBytes: 10,
      allowedContentTypes: ['image/*'],
    })
    const callB = await service.issueCallUploadCapability({
      owner: OWNER,
      producer: DEVICE,
      callId: 'call-b',
      expiresAt: '2026-08-25T00:05:00.000Z',
      maxObjects: 2,
      maxBytes: 10,
      maxObjectBytes: 10,
      allowedContentTypes: ['image/*'],
    })
    const otherProducer = await service.issueCallUploadCapability({
      owner: OWNER,
      producer: 'device:camera-02',
      callId: 'call-a',
      expiresAt: '2026-08-25T00:05:00.000Z',
      maxObjects: 2,
      maxBytes: 10,
      maxObjectBytes: 10,
      allowedContentTypes: ['image/*'],
    })

    const fromCallA = await service.beginCallUpload(input, callA.token)
    const replayCallA = await service.beginCallUpload(input, callA.token)
    const fromCallB = await service.beginCallUpload(input, callB.token)
    const fromOtherProducer = await service.beginCallUpload(input, otherProducer.token)

    expect(replayCallA.uploadId).toBe(fromCallA.uploadId)
    expect(new Set([
      ordinary.uploadId,
      fromCallA.uploadId,
      fromCallB.uploadId,
      fromOtherProducer.uploadId,
    ]).size).toBe(4)
    expect((await state.list(KEY_STORE_IDEMPOTENCY)).items).toHaveLength(4)
  })

  it('OwnerRef、producer 与 callId 不施加 Store 私有 255 字符上限', async () => {
    const longOwner = `agent:${'o'.repeat(512)}`
    const longProducer = `device:${'p'.repeat(512)}`
    const longCallId = `call-${'c'.repeat(512)}`
    await expect(service.beginUpload(
      { contentType: 'text/plain' },
      { owner: longOwner, producer: longProducer },
    )).resolves.toMatchObject({ transport: 'relay' })
    await expect(service.issueCallUploadCapability({
      owner: longOwner,
      producer: longProducer,
      callId: longCallId,
      expiresAt: '2026-08-25T00:05:00.000Z',
      maxObjects: 1,
      maxBytes: 1,
      maxObjectBytes: 1,
      allowedContentTypes: ['text/plain'],
    })).resolves.toMatchObject({
      capability: { owner: longOwner, producer: longProducer, callId: longCallId },
    })
    await expect(service.beginUpload(
      { contentType: 'text/plain' },
      { owner: 'agent:bad\nowner' },
    )).rejects.toSatisfy(codeIs('invalid_argument'))
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
    await expect(service.abortUploadWithToken(expired.uploadId, expired.uploadToken))
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

  it('并发 call begin 的 relay contender 不继承 direct reservation 上限', async () => {
    class ReservationRaceState extends MemoryStateStore {
      readonly reservationWritten: Promise<void>
      private pause = true
      private releaseReservation!: () => void
      private signalReservation!: () => void

      constructor() {
        super()
        this.reservationWritten = new Promise(resolve => this.signalReservation = resolve)
      }

      resumeDirect(): void {
        this.releaseReservation()
      }

      override async compareAndSwap(
        key: string,
        expectedRevision: number | null,
        value: unknown | null,
      ): Promise<boolean> {
        const reservations = (value as { reservations?: unknown[] } | null)?.reservations
        if (
          this.pause
          && key.startsWith(KEY_STORE_CALL_CAPABILITY)
          && expectedRevision !== null
          && reservations?.length === 1
        ) {
          this.pause = false
          const written = await super.compareAndSwap(key, expectedRevision, value)
          this.signalReservation()
          await new Promise<void>(resolve => this.releaseReservation = resolve)
          return written
        }
        return await super.compareAndSwap(key, expectedRevision, value)
      }
    }
    class SplitSignerStore extends MemoryObjectStore {
      calls = 0

      async presignPutExact(key: string, _ttlSec: number, opts: { contentLength: number }) {
        this.calls++
        if (this.calls > 1) throw new Error('signer temporarily unavailable')
        return {
          method: 'PUT' as const,
          url: `https://objects.invalid/${key}`,
          headers: { 'Content-Length': String(opts.contentLength), 'If-None-Match': '*' },
        }
      }
    }
    const raceState = new ReservationRaceState()
    const raceObjects = new SplitSignerStore(() => now)
    const raceService = new StoreService(raceState, raceObjects, {
      tokenSecret: TOKEN_SECRET,
      now: () => now,
      maxObjectBytes: 100,
      relayMaxBytes: 5,
    })
    const issued = await raceService.issueCallUploadCapability({
      owner: OWNER,
      producer: DEVICE,
      callId: 'reservation-race',
      expiresAt: '2026-08-25T00:05:00.000Z',
      maxObjects: 2,
      maxBytes: 100,
      maxObjectBytes: 100,
      allowedContentTypes: ['video/*'],
    })
    const input = { contentType: 'video/mp4', size: 6, idempotencyKey: 'same-race' }
    const directPending = raceService.beginCallUpload(input, issued.token)
    await raceState.reservationWritten
    await expect(raceService.beginCallUpload(input, issued.token))
      .rejects.toSatisfy(codeIs('rate_limited'))
    raceState.resumeDirect()

    await expect(directPending).resolves.toMatchObject({
      transport: 'presigned-put',
      maxBytes: 6,
    })
    expect(raceObjects.calls).toBe(2)
    expect((await raceState.list(KEY_STORE_UPLOAD)).items).toHaveLength(1)
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
        driverKey: `${DEFAULT_STORE_DRIVER_KEY_ROOT}/${id.slice(0, 2)}/${id}`,
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

  it.each(['ready', 'abandoned'] as const)(
    'complete×abort 的 object CAS winner=%s 决定唯一终态',
    async (winner) => {
      class CompleteAbortRaceState extends MemoryStateStore {
        private readonly winnerDone: Promise<void>
        private releaseWinner!: () => void

        constructor() {
          super()
          this.winnerDone = new Promise(resolve => this.releaseWinner = resolve)
        }

        override async compareAndSwap(
          key: string,
          expectedRevision: number | null,
          value: unknown | null,
        ): Promise<boolean> {
          const status = (value as { status?: unknown } | null)?.status
          if (
            key.startsWith(KEY_STORE_OBJECT)
            && expectedRevision === 1
            && (status === 'ready' || status === 'abandoned')
          ) {
            if (status === winner) {
              const won = await super.compareAndSwap(key, expectedRevision, value)
              this.releaseWinner()
              return won
            }
            await this.winnerDone
          }
          return await super.compareAndSwap(key, expectedRevision, value)
        }
      }
      const raceState = new CompleteAbortRaceState()
      const raceObjects = new MemoryObjectStore(() => now)
      const raceService = new StoreService(raceState, raceObjects, {
        tokenSecret: TOKEN_SECRET,
        now: () => now,
        maxObjectBytes: 1024,
        uploadTtlSec: 60,
      })
      const start = await raceService.beginUpload({
        contentType: 'text/plain', size: 2,
      }, { owner: OWNER })
      const [complete, abort] = await Promise.allSettled([
        raceService.commitRelayUpload({ uploadToken: start.uploadToken, body: 'ok' }),
        raceService.abortUploadWithToken(start.uploadId, start.uploadToken),
      ])
      const object = (await raceState.list(KEY_STORE_OBJECT)).items[0]?.value as StoreObject

      if (winner === 'ready') {
        expect(complete.status).toBe('fulfilled')
        expect(abort.status).toBe('rejected')
        expect(object.status).toBe('ready')
        expect(await raceObjects.head(object.driverKey)).not.toBeNull()
      } else {
        expect(complete.status).toBe('rejected')
        expect(abort.status).toBe('fulfilled')
        expect(object.status).toBe('abandoned')
        expect(await raceObjects.head(object.driverKey)).toBeNull()
      }
    },
  )

  it('delete×read/share：已线性化的读取快照可返回，之后访问与新 share 均不可用', async () => {
    class DeleteBeforeShareState extends MemoryStateStore {
      beforeShareCreate?: () => Promise<void>

      override async compareAndSwap(
        key: string,
        expectedRevision: number | null,
        value: unknown | null,
      ): Promise<boolean> {
        if (key.startsWith(KEY_STORE_SHARE) && expectedRevision === null) {
          const hook = this.beforeShareCreate
          this.beforeShareCreate = undefined
          await hook?.()
        }
        return await super.compareAndSwap(key, expectedRevision, value)
      }
    }
    const raceState = new DeleteBeforeShareState()
    const raceObjects = new MemoryObjectStore(() => now)
    const raceService = new StoreService(raceState, raceObjects, {
      tokenSecret: TOKEN_SECRET,
      now: () => now,
      uploadTtlSec: 60,
      shareTtlSec: 30,
    })
    const start = await raceService.beginUpload({ contentType: 'text/plain', size: 1 }, { owner: OWNER })
    const ready = await raceService.commitRelayUpload({ uploadToken: start.uploadToken, body: 'x' })
    const readSnapshot = await raceService.authorizeRead(ready.uri, { owner: OWNER })
    raceState.beforeShareCreate = async () => {
      await raceService.delete(ready.uri, { owner: OWNER })
    }

    const share = await raceService.share(ready.uri, OWNER)
    expect(readSnapshot).toMatchObject({ status: 'ready', id: ready.uri.split('/').at(-1) })
    await expect(raceService.authorizeRead(ready.uri, { owner: OWNER }))
      .rejects.toSatisfy(codeIs('not_found'))
    await expect(raceService.authorizeSharedRead(ready.uri, share.token))
      .rejects.toSatisfy(codeIs('not_found'))
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

  it('cleanup 在安全窗口后删除终态 metadata，且字节删除成功后不再重复 DELETE', async () => {
    class CountingStore extends MemoryObjectStore {
      deleteCalls = 0

      override async delete(key: string): Promise<void> {
        this.deleteCalls++
        await super.delete(key)
      }
    }
    const cleanupState = new MemoryStateStore()
    const cleanupObjects = new CountingStore(() => now)
    const cleanupService = new StoreService(cleanupState, cleanupObjects, {
      tokenSecret: TOKEN_SECRET,
      now: () => now,
      uploadTtlSec: 60,
      shareTtlSec: 30,
    })
    const pending = await cleanupService.beginUpload({
      contentType: 'text/plain',
      idempotencyKey: 'cleanup-convergence',
    }, { owner: OWNER })
    const pendingObject = (await cleanupState.list(KEY_STORE_OBJECT)).items[0]?.value as StoreObject
    await cleanupObjects.put(pendingObject.driverKey, 'late-bytes', { ifNoneMatch: '*' })

    const readyStart = await cleanupService.beginUpload({
      contentType: 'text/plain',
      size: 1,
    }, { owner: OWNER })
    const ready = await cleanupService.commitRelayUpload({
      uploadToken: readyStart.uploadToken,
      body: 'x',
    })
    await cleanupService.share(ready.uri, OWNER, 20)
    await cleanupService.delete(ready.uri, { owner: OWNER })
    const issued = await cleanupService.issueCallUploadCapability({
      owner: OWNER,
      producer: DEVICE,
      callId: 'cleanup-convergence-call',
      expiresAt: '2026-08-25T00:00:30.000Z',
      maxObjects: 1,
      maxBytes: 1,
      maxObjectBytes: 1,
      allowedContentTypes: ['text/plain'],
    })

    now = '2026-08-25T00:02:00.000Z'
    await cleanupService.cleanup()
    expect(cleanupObjects.deleteCalls).toBe(2)
    await cleanupService.cleanup()
    expect(cleanupObjects.deleteCalls).toBe(2)
    await expect(cleanupService.verifyUploadToken(pending.uploadToken))
      .rejects.toSatisfy(codeIs('permission_denied'))
    await expect(cleanupService.verifyCallUploadCapability(issued.token))
      .rejects.toSatisfy(codeIs('permission_denied'))

    now = '2026-08-25T00:03:01.000Z'
    await cleanupService.cleanup()
    expect(cleanupObjects.deleteCalls).toBe(2)
    expect((await cleanupState.list(KEY_STORE_UPLOAD)).items).toHaveLength(0)
    expect((await cleanupState.list(KEY_STORE_OBJECT)).items).toHaveLength(0)
    expect((await cleanupState.list(KEY_STORE_CALL_CAPABILITY)).items).toHaveLength(0)
    expect((await cleanupState.list(KEY_STORE_SHARE)).items).toHaveLength(0)
    expect((await cleanupState.list(KEY_STORE_IDEMPOTENCY)).items).toHaveLength(0)
  })

  it('complete 在 object ready 与 session completed 之间遇 cleanup，最终仍收敛 completed', async () => {
    class CompleteCleanupRaceState extends MemoryStateStore {
      readonly completePaused: Promise<void>
      private pause = true
      private releaseComplete!: () => void
      private signalPaused!: () => void

      constructor() {
        super()
        this.completePaused = new Promise(resolve => this.signalPaused = resolve)
      }

      resumeComplete(): void {
        this.releaseComplete()
      }

      override async compareAndSwap(
        key: string,
        expectedRevision: number | null,
        value: unknown | null,
      ): Promise<boolean> {
        const status = (value as { status?: unknown } | null)?.status
        if (
          this.pause
          && key.startsWith(KEY_STORE_UPLOAD)
          && expectedRevision !== null
          && status === 'completed'
        ) {
          this.pause = false
          this.signalPaused()
          await new Promise<void>(resolve => this.releaseComplete = resolve)
        }
        return await super.compareAndSwap(key, expectedRevision, value)
      }
    }

    const raceState = new CompleteCleanupRaceState()
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
    const completing = raceService.commitRelayUpload({
      uploadToken: start.uploadToken,
      body: 'data',
    })
    await raceState.completePaused
    now = '2026-08-25T00:02:00.000Z'
    const cleaned = await raceService.cleanup()
    raceState.resumeComplete()
    const ready = await completing

    expect(cleaned.expiredUploads).toBe(0)
    expect(cleaned.deletedBytes).toBe(0)
    expect(ready).toMatchObject({ status: 'ready', size: 4 })
    expect(await raceObjects.head(object.driverKey)).not.toBeNull()
    const session = (await raceState.list(KEY_STORE_UPLOAD)).items[0]?.value as { status: string }
    expect(session.status).toBe('completed')
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

  it('cleanup 可仅首页调用 staging hook，保留无 metadata driver 对象并释放幂等 key', async () => {
    class CleanupAwareStore extends MemoryObjectStore {
      cleanupArgs?: { olderThan: string, prefix: string }
      listCalls = 0

      async cleanupStaging(prefix: string, olderThan: string): Promise<number> {
        this.cleanupArgs = { prefix, olderThan }
        return 2
      }

      override async list(prefix: string) {
        this.listCalls++
        return super.list(prefix)
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
    const orphanKey = `${DEFAULT_STORE_DRIVER_KEY_ROOT}/ZZ/${orphanId}`
    await cleanupObjects.put(orphanKey, 'orphan')

    now = '2026-08-25T00:02:00.000Z'
    const cleaned = await cleanupService.cleanup()
    expect(cleaned).toMatchObject({
      deletedStaging: 2,
      expiredIdempotencyBindings: 1,
    })
    expect(cleanupObjects.cleanupArgs).toEqual({
      prefix: `${DEFAULT_STORE_DRIVER_KEY_ROOT}/`,
      olderThan: '2026-08-25T00:01:00.000Z',
    })
    expect(await cleanupObjects.head(orphanKey)).not.toBeNull()
    expect(cleanupObjects.listCalls).toBe(0)

    cleanupObjects.cleanupArgs = undefined
    const continuation = await cleanupService.cleanup({ runDriverMaintenance: false })
    expect(continuation.deletedStaging).toBe(0)
    expect(cleanupObjects.cleanupArgs).toBeUndefined()

    const retried = await cleanupService.beginUpload({
      contentType: 'text/plain',
      idempotencyKey: 'reusable-after-expiry',
    }, { owner: OWNER })
    expect(retried.uploadId).not.toBe(first.uploadId)
  })

  it('metadata object 扫描会 CAS 放弃过期 pending，再删除边界处晚到的直传字节', async () => {
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
        objects: '',
      },
    })
    expect(cleaned.deletedBytes).toBe(1)
    expect(await objects.head(stored.driverKey)).toBeNull()
    await expect(service.verifyUploadToken(start.uploadToken))
      .rejects.toSatisfy(codeIs('permission_denied'))
    const abandoned = (await state.get(`${KEY_STORE_OBJECT}${stored.id}`)) as StoreObject
    expect(abandoned.status).toBe('abandoned')
  })
})

describe('StoreService direct upload', () => {
  it('未知 size 或只有旧 presignPut 的 backend 一律退回 relay', async () => {
    class LegacyPresigningStore extends MemoryObjectStore {
      legacyCalls = 0

      async presignPut(key: string) {
        this.legacyCalls++
        return {
          method: 'PUT' as const,
          url: `https://objects.invalid/${key}`,
          headers: { 'If-None-Match': '*' },
        }
      }
    }
    const objects = new LegacyPresigningStore()
    const service = new StoreService(new MemoryStateStore(), objects, {
      tokenSecret: TOKEN_SECRET,
      maxObjectBytes: 100,
      relayMaxBytes: 5,
    })
    await expect(service.beginUpload(
      { contentType: 'video/mp4', size: 4 },
      { owner: OWNER },
    )).resolves.toMatchObject({ transport: 'relay', maxBytes: 5 })
    await expect(service.beginUpload(
      { contentType: 'video/mp4' },
      { owner: OWNER },
    )).resolves.toMatchObject({ transport: 'relay', maxBytes: 5 })
    expect(objects.legacyCalls).toBe(0)
  })

  it('幂等 replay 的 direct signer 不可用时返回 unavailable，不伪装成 relay grant', async () => {
    class FlakySignerStore extends MemoryObjectStore {
      available = true

      async presignPutExact(key: string, _ttlSec: number, opts: { contentLength: number }) {
        if (!this.available) {
          throw new TBError('unavailable', 'signer temporarily unavailable', { retryable: true })
        }
        return {
          method: 'PUT' as const,
          url: `https://objects.invalid/${key}`,
          headers: { 'Content-Length': String(opts.contentLength), 'If-None-Match': '*' },
        }
      }
    }
    const objects = new FlakySignerStore()
    const service = new StoreService(new MemoryStateStore(), objects, {
      tokenSecret: TOKEN_SECRET,
      maxObjectBytes: 100,
      relayMaxBytes: 5,
    })
    const input = {
      contentType: 'video/mp4',
      size: 6,
      idempotencyKey: 'direct-signer-replay',
    }
    await expect(service.beginUpload(input, { owner: OWNER })).resolves.toMatchObject({
      transport: 'presigned-put',
    })
    objects.available = false
    await expect(service.beginUpload(input, { owner: OWNER }))
      .rejects.toSatisfy(codeIs('unavailable'))
  })

  it('presigned PUT 必须 complete/HEAD，且并发 complete 幂等返回同 descriptor', async () => {
    const state = new MemoryStateStore()
    class PresigningStore extends MemoryObjectStore {
      exactLengths: number[] = []

      async presignPutExact(key: string, _ttlSec: number, opts: { contentLength: number }) {
        this.exactLengths.push(opts.contentLength)
        return {
          method: 'PUT' as const,
          url: `https://objects.invalid/${key}`,
          headers: {
            'Content-Length': String(opts.contentLength),
            'If-None-Match': '*',
          },
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
      idempotencyKey: 'direct-replay',
      checksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
    }, { owner: OWNER })
    expect(start.transport).toBe('presigned-put')
    expect(start.maxBytes).toBe(100)
    expect(objects.exactLengths).toEqual([4])
    const replay = await service.beginUpload({
      contentType: 'video/mp4',
      size: 4,
      idempotencyKey: 'direct-replay',
      checksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
    }, { owner: OWNER })
    expect(replay.transport).toBe('presigned-put')
    expect(replay.uploadId).toBe(start.uploadId)
    expect(objects.exactLengths).toEqual([4, 4])
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

  it('direct 字节已落地但 ready metadata CAS 暂态失败时原地重试，不删除可恢复字节', async () => {
    class FalseOnceReadyState extends MemoryStateStore {
      failed = false

      override async compareAndSwap(
        key: string,
        expectedRevision: number | null,
        value: unknown | null,
      ): Promise<boolean> {
        if (
          !this.failed
          && key.startsWith(KEY_STORE_OBJECT)
          && expectedRevision !== null
          && (value as { status?: unknown } | null)?.status === 'ready'
        ) {
          this.failed = true
          return false
        }
        return await super.compareAndSwap(key, expectedRevision, value)
      }
    }
    class DirectStore extends MemoryObjectStore {
      async presignPutExact(key: string, _ttlSec: number, opts: { contentLength: number }) {
        return {
          method: 'PUT' as const,
          url: `https://objects.invalid/${key}`,
          headers: { 'Content-Length': String(opts.contentLength), 'If-None-Match': '*' },
        }
      }
    }
    const state = new FalseOnceReadyState()
    const objects = new DirectStore(() => '2026-08-25T00:00:00.000Z')
    const service = new StoreService(state, objects, {
      tokenSecret: TOKEN_SECRET,
      now: () => '2026-08-25T00:00:00.000Z',
      maxObjectBytes: 100,
    })
    const start = await service.beginUpload({
      contentType: 'video/mp4', size: 4,
    }, { owner: OWNER })
    const object = (await state.list(KEY_STORE_OBJECT)).items[0]?.value as StoreObject
    await objects.put(object.driverKey, 'data', { contentType: 'video/mp4', ifNoneMatch: '*' })

    await expect(service.completeUploadWithToken(start.uploadId, start.uploadToken))
      .resolves.toMatchObject({ uri: start.objectUri, size: 4, status: 'ready' })
    expect(state.failed).toBe(true)
    expect(await objects.head(object.driverKey)).not.toBeNull()
  })
})
