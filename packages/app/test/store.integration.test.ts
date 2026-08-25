import {
  DEFAULT_STORE_DRIVER_KEY_ROOT,
  MemoryObjectStore,
  MemoryStateStore,
  type ObjectStore,
  SecretStoreImpl,
  type StateStore,
} from '@tool-bridge/core'
import { describe, expect, it, vi } from 'vitest'
import {
  cleanupDefaultStore,
  createTbApp,
  defaultStoreRuntime,
  KEY_STORE_CLEANUP_PROGRESS,
  KEY_STORE_TOKEN_SECRET,
  runBootstrap,
  storeTokenSecret,
  type TbAppDeps,
} from '../src/index'
import { deviceCallContextFrom, invokeDevice } from '../src/deviceNodes'
import { TEST_ADMIN_SK, TEST_ENCRYPTION_KEY } from './fixtures'
import { bearer, createTestApp, TEST_REMOTE } from './harness'
import { signStoreRefToken } from '../src/storeRefToken'
import { verifyRefToken } from '../src/refToken'

interface Grant {
  alreadyCompleted?: boolean
  descriptor?: Descriptor
  expiresAt: string
  headers: Record<string, string>
  maxBytes: number
  method: 'PUT'
  objectUri: string
  transport: 'presigned-put' | 'relay'
  uploadId: string
  uploadToken: string
  url: string
}

interface Descriptor {
  contentType: string
  owner: string
  producer?: string
  size: number
  uri: string
}

function admin(extra: RequestInit = {}): RequestInit {
  return bearer(TEST_ADMIN_SK, extra)
}

async function postJson(
  request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  path: string,
  body: unknown,
  init: RequestInit = {},
): Promise<Response> {
  return await request(`https://tb.test/${path}`, {
    method: 'POST',
    ...init,
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

async function createRelay(
  tb: Awaited<ReturnType<typeof createTestApp>>,
  input: Record<string, unknown>,
): Promise<Grant> {
  const response = await postJson(tb.request, 'system/store/create_upload', input, admin())
  expect(response.status).toBe(200)
  const grant = (await response.json()) as Grant
  expect(grant.transport).toBe('relay')
  return grant
}

async function putRelay(
  tb: Awaited<ReturnType<typeof createTestApp>>,
  grant: Grant,
  bytes: Uint8Array,
): Promise<Response> {
  return await tb.request(grant.url, {
    method: 'PUT',
    headers: grant.headers,
    body: new Uint8Array(bytes).buffer,
  })
}

describe('default Store control/data plane', () => {
  it('bootstrap 暴露 Help；普通 create 要 SK/scope，capability secret 只接受 header', async () => {
    const tb = await createTestApp()
    const help = await tb.request('https://tb.test/system/store/~help', admin({
      headers: { accept: 'application/json' },
    }))
    expect(help.status).toBe(200)
    const helpBody = (await help.json()) as { cmds: Array<{ name: string, scope: string }> }
    expect(Object.fromEntries(helpBody.cmds.map(cmd => [cmd.name, cmd.scope]))).toMatchObject({
      create_upload: 'write',
      complete_upload: 'write',
      stat: 'read',
      read: 'read',
      share: 'write',
      delete: 'write',
    })

    const unauthenticated = await postJson(
      tb.request,
      'system/store/create_upload',
      { contentType: 'image/jpeg', size: 1 },
    )
    expect(unauthenticated.status).toBe(401)

    const bodyCapability = await postJson(tb.request, 'system/store/create_upload', {
      contentType: 'image/jpeg',
      callCapability: 'must-not-be-read-from-body',
    }, admin())
    expect(bodyCapability.status).toBe(400)
    expect(await bodyCapability.text()).not.toContain('must-not-be-read-from-body')

    const badCapability = await postJson(tb.request, 'system/store/create_upload', {
      contentType: 'image/jpeg',
    }, { headers: { 'x-tb-store-capability': 'marker-secret' } })
    expect(badCapability.status).toBe(403)
    expect(await badCapability.text()).not.toContain('marker-secret')
  })

  it('relay PUT 在同一请求原子 ready；complete 与 create 重试幂等且不泄漏 token/key', async () => {
    const tb = await createTestApp()
    const input = {
      contentType: 'image/jpeg',
      filename: '../camera/photo.jpg',
      size: 4,
      idempotencyKey: 'capture-01',
    }
    const grant = await createRelay(tb, input)
    expect(grant.url).toBe(`https://tb.test/~store/uploads/${grant.uploadId}`)
    expect(grant.headers['x-tb-store-upload']).toBe(grant.uploadToken)
    expect(grant.objectUri).toMatch(/^store:\/\/default\/[A-Za-z0-9_-]+$/)
    expect(grant.url).not.toContain(grant.uploadToken)

    const missingToken = await tb.request(grant.url, {
      method: 'PUT',
      body: new Uint8Array([1, 2, 3, 4]),
    })
    expect(missingToken.status).toBe(403)

    const wrongPath = await tb.request('https://tb.test/~store/uploads/wrong-upload', {
      method: 'PUT',
      headers: grant.headers,
      body: new Uint8Array([1, 2, 3, 4]),
    })
    expect(wrongPath.status).toBe(403)
    expect(await wrongPath.text()).not.toContain(grant.uploadToken)

    const readyResponse = await putRelay(tb, grant, new Uint8Array([1, 2, 3, 4]))
    expect(readyResponse.status).toBe(200)
    const ready = (await readyResponse.json()) as Descriptor & Record<string, unknown>
    expect(ready).toMatchObject({
      uri: grant.objectUri,
      contentType: 'image/jpeg',
      size: 4,
      owner: 'user:admin',
      producer: 'user:admin',
      status: 'ready',
    })
    expect(ready).not.toHaveProperty('driverKey')
    expect(ready).not.toHaveProperty('uploadToken')
    expect(ready).not.toHaveProperty('url')

    const complete = await postJson(tb.request, 'system/store/complete_upload', {
      uploadId: grant.uploadId,
    }, admin())
    expect(complete.status).toBe(200)
    expect((await complete.json()) as Descriptor).toMatchObject({ uri: grant.objectUri, size: 4 })

    const retry = await createRelay(tb, input)
    expect(retry.uploadId).toBe(grant.uploadId)
    expect(retry.objectUri).toBe(grant.objectUri)
    // Completed sessions return the ready descriptor; clients must not resend bytes.
    expect(retry.alreadyCompleted).toBe(true)
    expect(retry.descriptor).toMatchObject({ uri: grant.objectUri, size: 4 })
    const readAfterRetry = await postJson(tb.request, 'system/store/read', {
      uri: grant.objectUri,
    }, admin())
    const readGrant = (await readAfterRetry.json()) as { $ref: string }
    const bytes = new Uint8Array(await (await tb.request(readGrant.$ref)).arrayBuffer())
    expect([...bytes]).toEqual([1, 2, 3, 4])

    const conflicting = await postJson(tb.request, 'system/store/create_upload', {
      ...input,
      size: 3,
    }, admin())
    expect(conflicting.status).toBe(409)
  })

  it('owner read ref 使用独立 token 域；share 可立即撤销，稳定 URI 本身不授权', async () => {
    const tb = await createTestApp()
    const grant = await createRelay(tb, { contentType: 'text/plain', size: 5 })
    expect((await putRelay(tb, grant, new TextEncoder().encode('hello'))).status).toBe(200)

    const read = await postJson(tb.request, 'system/store/read', { uri: grant.objectUri }, admin())
    expect(read.status).toBe(200)
    const readBody = (await read.json()) as { $ref: string, expiresAt: string }
    expect(readBody.$ref).toContain('/~store/refs/')
    const refToken = decodeURIComponent(readBody.$ref.split('/').pop()!)
    expect(await verifyRefToken(refToken, TEST_ENCRYPTION_KEY)).toBeNull()
    const downloaded = await tb.request(readBody.$ref)
    expect(downloaded.status).toBe(200)
    expect(await downloaded.text()).toBe('hello')
    expect(downloaded.headers.get('cache-control')).toBe('private, no-store')

    const rawUri = await tb.request(grant.objectUri)
    expect(rawUri.status).not.toBe(200)

    const shared = await postJson(tb.request, 'system/store/share', {
      uri: grant.objectUri,
      ttlSec: 60,
    }, admin())
    expect(shared.status).toBe(200)
    const share = (await shared.json()) as { $ref: string, shareId: string }
    expect(share.$ref).toContain('/~store/shares/')
    expect(await (await tb.request(share.$ref)).text()).toBe('hello')

    const revoked = await postJson(tb.request, 'system/store/revoke_share', {
      shareId: share.shareId,
    }, admin())
    expect(revoked.status).toBe(200)
    expect((await tb.request(share.$ref)).status).toBe(404)

    const secret = await storeTokenSecret(tb.state)
    const expiredToken = await signStoreRefToken({ v: 1, objectId: 'expired', exp: 1 }, secret)
    expect((await tb.request(`https://tb.test/~store/refs/${expiredToken}`)).status).toBe(404)
  })

  it('relay effective maxBytes 在 create 与传输中都强制执行', async () => {
    const tb = await createTestApp({ storeMaxObjectBytes: 100, storeRelayMaxBytes: 3 })
    const knownTooLarge = await postJson(tb.request, 'system/store/create_upload', {
      contentType: 'application/octet-stream',
      size: 4,
    }, admin())
    expect(knownTooLarge.status).toBe(429)

    const grant = await createRelay(tb, { contentType: 'application/octet-stream' })
    expect(grant.maxBytes).toBe(3)
    const streamedTooLarge = await putRelay(tb, grant, new Uint8Array([1, 2, 3, 4]))
    expect(streamedTooLarge.status).toBe(429)
    expect(tb.objects === undefined
      ? []
      : (await tb.objects.list(`${DEFAULT_STORE_DRIVER_KEY_ROOT}/`)).items).toHaveLength(0)
  })

  it('direct grant 使用部署级上限，header-only complete 做 HEAD 校验且幂等', async () => {
    const objects = new MemoryObjectStore() as MemoryObjectStore & {
      presignPutExact: NonNullable<ObjectStore['presignPutExact']>
    }
    objects.presignPutExact = async (_key, _ttlSec, opts) => ({
      method: 'PUT',
      url: 'https://objects.example.test/upload?signature=sensitive',
      headers: {
        'content-type': opts.contentType,
        'content-length': String(opts.contentLength),
        'if-none-match': '*',
      },
    })
    const tb = await createTestApp({
      objects,
      storeMaxObjectBytes: 100,
      storeRelayMaxBytes: 3,
    })
    const created = await postJson(tb.request, 'system/store/create_upload', {
      contentType: 'video/mp4',
      size: 4,
    }, admin())
    expect(created.status).toBe(200)
    const grant = (await created.json()) as Grant
    expect(grant.transport).toBe('presigned-put')
    expect(grant.maxBytes).toBe(100)
    expect(grant.headers['content-length']).toBe('4')
    expect(grant.headers['x-tb-store-upload']).toBeUndefined()

    const objectId = grant.objectUri.slice('store://default/'.length)
    await objects.put(
      `${DEFAULT_STORE_DRIVER_KEY_ROOT}/${objectId.slice(0, 2)}/${objectId}`,
      new Uint8Array([1, 2, 3, 4]),
      {
        contentType: 'video/mp4',
        ifNoneMatch: '*',
      },
    )
    const complete = await postJson(tb.request, 'system/store/complete_upload', {
      uploadId: grant.uploadId,
    }, { headers: { 'x-tb-store-upload': grant.uploadToken } })
    expect(complete.status).toBe(200)
    expect((await complete.json()) as Descriptor).toMatchObject({
      uri: grant.objectUri,
      contentType: 'video/mp4',
      size: 4,
    })
    const again = await postJson(tb.request, 'system/store/complete_upload', {
      uploadId: grant.uploadId,
    }, { headers: { 'x-tb-store-upload': grant.uploadToken } })
    expect(again.status).toBe(200)
  })

  it('未声明精确 size 时即使 backend 能签名也只发 relay grant', async () => {
    const objects = new MemoryObjectStore() as MemoryObjectStore & {
      presignPutExact: NonNullable<ObjectStore['presignPutExact']>
    }
    objects.presignPutExact = vi.fn(async () => ({
      method: 'PUT' as const,
      url: 'https://objects.example.test/upload?signature=sensitive',
      headers: {},
    }))
    const tb = await createTestApp({ objects, storeMaxObjectBytes: 100, storeRelayMaxBytes: 3 })
    const created = await postJson(tb.request, 'system/store/create_upload', {
      contentType: 'application/octet-stream',
    }, admin())
    expect(created.status).toBe(200)
    const grant = (await created.json()) as Grant
    expect(grant.transport).toBe('relay')
    expect(grant.maxBytes).toBe(3)
    expect(objects.presignPutExact).not.toHaveBeenCalled()
  })

  it('upload/share capability 到期立即拒绝且错误不回显 token', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))
    try {
      const tb = await createTestApp({ storeUploadTtlSec: 1, storeShareTtlSec: 1 })
      const expiredUpload = await createRelay(tb, { contentType: 'text/plain', size: 1 })
      vi.advanceTimersByTime(1_100)
      const deniedPut = await putRelay(tb, expiredUpload, new Uint8Array([1]))
      expect(deniedPut.status).toBe(403)
      expect(await deniedPut.text()).not.toContain(expiredUpload.uploadToken)

      const fresh = await createRelay(tb, { contentType: 'text/plain', size: 1 })
      expect((await putRelay(tb, fresh, new Uint8Array([2]))).status).toBe(200)
      const shared = await postJson(tb.request, 'system/store/share', {
        uri: fresh.objectUri,
        ttlSec: 1,
      }, admin())
      const share = (await shared.json()) as { $ref: string }
      vi.advanceTimersByTime(1_100)
      expect((await tb.request(share.$ref)).status).toBe(404)
    } finally {
      vi.useRealTimers()
    }
  })

  it('设备 call 内 capability 绑定 caller/device/额度，result 后立即 revoke', async () => {
    const state = new MemoryStateStore()
    await runBootstrap(state, { adminSk: TEST_ADMIN_SK, requireAdminSk: true })
    const objects = new MemoryObjectStore()
    const secrets = new SecretStoreImpl(state, TEST_ENCRYPTION_KEY)
    const appRef: { current?: ReturnType<typeof createTbApp> } = {}
    let capability = ''
    let deniedByMime = 0
    const deps: TbAppDeps = {
      allowInsecureHttp: false,
      objects: () => objects,
      remote: TEST_REMOTE,
      secrets,
      state,
      version: 'test',
      storeCallAllowedContentTypes: ['image/*'],
      storeCallMaxBytes: 4,
      storeCallMaxObjectBytes: 4,
      storeCallMaxObjects: 1,
      device: {
        ws: async () => new Response(null, { status: 501 }),
        invoke: async (_deviceId, request) => {
          capability = request.context?.upload?.token ?? ''
          expect(request.context?.upload).toMatchObject({ maxBytes: 4, maxObjects: 1 })
          const denied = await postJson(
            async (input, init) => await appRef.current!.request(input as never, init),
            'system/store/create_upload',
            { contentType: 'video/mp4', size: 4 },
            { headers: { 'x-tb-store-capability': capability } },
          )
          deniedByMime = denied.status
          const created = await postJson(
            async (input, init) => await appRef.current!.request(input as never, init),
            'system/store/create_upload',
            { contentType: 'image/jpeg', size: 4 },
            { headers: { 'x-tb-store-capability': capability } },
          )
          const grant = (await created.json()) as Grant
          const ready = await appRef.current!.request(grant.url, {
            method: 'PUT',
            headers: grant.headers,
            body: new Uint8Array([1, 2, 3, 4]),
          })
          return { ok: true, value: await ready.json() }
        },
      },
    }
    const app = createTbApp(deps)
    appRef.current = app
    const callContext = deviceCallContextFrom({
      keyId: 'caller-key',
      owner: 'agent:camera-user',
      scopes: [{ pattern: 'device/**', actions: ['call'] }],
      traceId: 'trace-store-call',
    })
    const value = await invokeDevice(deps, 'camera-01', {
      path: 'camera/take_photo',
      arguments: {},
      context: callContext,
    }) as Descriptor
    expect(deniedByMime).toBe(403)
    expect(value).toMatchObject({
      contentType: 'image/jpeg',
      size: 4,
      owner: 'agent:camera-user',
      producer: 'device:camera-01',
    })

    const replay = await postJson(
      async (input, init) => await app.request(input as never, init),
      'system/store/create_upload',
      { contentType: 'image/jpeg', size: 1 },
      { headers: { 'x-tb-store-capability': capability } },
    )
    expect(replay.status).toBe(403)
    expect(await replay.text()).not.toContain(capability)
  })
})

describe('Store token secret and legacy host isolation', () => {
  it('标准宿主从 env-only encryption root 域分离派生且不把 capability 根密钥写入 State', async () => {
    const tb = await createTestApp()
    const runtime = await defaultStoreRuntime(tb.deps)

    expect(runtime.tokenSecret).toMatch(/^[a-f0-9]{64}$/)
    expect(runtime.tokenSecret).not.toBe(TEST_ENCRYPTION_KEY)
    expect(await tb.state.get(KEY_STORE_TOKEN_SECRET)).toBeNull()
  })

  it('concurrent first use converges to one persistent secret without response/log exposure', async () => {
    const state = new MemoryStateStore()
    const values = await Promise.all(Array.from({ length: 12 }, async () => {
      return await storeTokenSecret(state)
    }))
    expect(new Set(values).size).toBe(1)
    expect(await state.get(KEY_STORE_TOKEN_SECRET)).toBe(values[0])
    expect(values[0]).toHaveLength(64)
  })

  it('缺 CAS 的旧 StateStore 仅让 Store fail closed，不拖垮其他 builtin', async () => {
    const backing = new MemoryStateStore()
    const legacy: StateStore = {
      delete: key => backing.delete(key),
      get: key => backing.get(key),
      getMany: keys => backing.getMany(keys),
      list: (prefix, opts) => backing.list(prefix, opts),
      put: (key, value) => backing.put(key, value),
      putIfAbsent: (key, value) => backing.putIfAbsent!(key, value),
    }
    await runBootstrap(legacy, { adminSk: TEST_ADMIN_SK, requireAdminSk: true })
    const deps: TbAppDeps = {
      allowInsecureHttp: false,
      objects: () => new MemoryObjectStore(),
      remote: TEST_REMOTE,
      secrets: new SecretStoreImpl(legacy, TEST_ENCRYPTION_KEY),
      state: legacy,
      version: 'test',
    }
    const app = createTbApp(deps)
    const skHelp = await app.request('https://tb.test/system/sk/~help', admin({
      headers: { accept: 'application/json' },
    }))
    expect(skHelp.status).toBe(200)
    const storeCreate = await app.request('https://tb.test/system/store/create_upload', {
      method: 'POST',
      ...admin(),
      headers: {
        ...admin().headers,
        'accept': 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ contentType: 'image/jpeg' }),
    })
    expect(storeCreate.status).toBe(503)
    expect((await storeCreate.json()) as { code: string }).toMatchObject({ code: 'unavailable' })
  })

  it('cleanup 每 tick 有界并把 cursor 持久化，下一次从后页继续直至删除进度', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))
    try {
      const tb = await createTestApp({ storeUploadTtlSec: 1 })
      for (let i = 0; i < 3; i++) {
        await createRelay(tb, {
          contentType: 'application/octet-stream',
          idempotencyKey: `cleanup-${i}`,
        })
      }
      vi.advanceTimersByTime(1_100)
      const first = await cleanupDefaultStore(tb.deps, { limit: 1, maxPages: 1 })
      expect(first.cursors).toBeDefined()
      expect(first.expiredUploads).toBe(1)
      expect(await tb.state.get(KEY_STORE_CLEANUP_PROGRESS)).not.toBeNull()

      let aggregateExpired = first.expiredUploads
      for (let i = 0; i < 8 && await tb.state.get(KEY_STORE_CLEANUP_PROGRESS) !== null; i++) {
        aggregateExpired += (await cleanupDefaultStore(tb.deps, {
          limit: 1,
          maxPages: 1,
        })).expiredUploads
      }
      expect(aggregateExpired).toBe(3)
      expect(await tb.state.get(KEY_STORE_CLEANUP_PROGRESS)).toBeNull()
      expect(tb.objects === undefined
        ? []
        : (await tb.objects.list(`${DEFAULT_STORE_DRIVER_KEY_ROOT}/`)).items).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('同一 cleanup tick 翻多页时只执行一次 driver maintenance', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))
    try {
      class MaintenanceStore extends MemoryObjectStore {
        cleanupCalls = 0

        async cleanupStaging(): Promise<number> {
          this.cleanupCalls++
          return 0
        }
      }
      const objects = new MaintenanceStore()
      const tb = await createTestApp({ objects, storeUploadTtlSec: 1 })
      for (let i = 0; i < 3; i++) {
        await createRelay(tb, {
          contentType: 'application/octet-stream',
          idempotencyKey: `maintenance-${i}`,
        })
      }
      vi.advanceTimersByTime(1_100)
      await cleanupDefaultStore(tb.deps, { limit: 1, maxPages: 8 })
      expect(objects.cleanupCalls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
