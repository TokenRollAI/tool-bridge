import {
  MemoryObjectStore,
  type ObjectPresignPutOptions,
  type ObjectStore,
} from '@tool-bridge/core'
import { describe, expect, it, vi } from 'vitest'
import type { TbAppDeps } from '../src/deps'
import {
  type ContextConfig,
  contextDirectUploadAvailable,
} from '../src/contextNodes'
import { createTestApp, TEST_REMOTE, TEST_VERSION } from './harness'
import { TEST_ADMIN_SK } from './fixtures'

const adminHeaders = {
  'authorization': `Bearer ${TEST_ADMIN_SK}`,
  'content-type': 'application/json',
  'accept': 'application/json',
}

async function mountR2(
  request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  path: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const response = await request(`https://tb.test/${path}/~register`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      path,
      kind: 'context',
      description: 'camera uploads',
      config: { kind: 'context', provider: 'r2', ...extra },
    }),
  })
  expect(response.status).toBe(200)
}

describe('context create_upload', () => {
  it('只暴露真实能力，并按挂载前缀签发 PUT grant', async () => {
    const store = new MemoryObjectStore() as ObjectStore
    const presignPut = vi.fn(async (
      key: string,
      ttlSec: number,
      opts: ObjectPresignPutOptions,
    ) => ({
      method: 'PUT' as const,
      url: `https://r2-upload.test/${encodeURIComponent(key)}?ttl=${ttlSec}&secret=redacted`,
      headers: {
        'content-type': opts.contentType,
        ...(opts.ifNoneMatch === undefined ? {} : { 'if-none-match': opts.ifNoneMatch }),
      },
    }))
    store.presignPut = presignPut
    const tb = await createTestApp({ objects: store, refTtlSec: 60 })
    await mountR2(tb.request, 'camera/photos')

    const help = await tb.request('https://tb.test/camera/photos/~help', {
      headers: adminHeaders,
    })
    expect(help.status).toBe(200)
    const commands = ((await help.json()) as { cmds: Array<{ name: string, path: string }> }).cmds
    expect(commands).toContainEqual(expect.objectContaining({
      name: 'create_upload',
      path: '/camera/photos/create_upload',
    }))

    const describe = await tb.request('https://tb.test/camera/photos/~describe', {
      headers: adminHeaders,
    })
    expect(await describe.json()).toEqual({
      kind: 'context',
      capabilities: ['search', 'delete', 'direct-upload'],
    })

    const response = await tb.request('https://tb.test/camera/photos/create_upload', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ path: '2026/shot.jpg', contentType: 'image/jpeg' }),
    })
    expect(response.status).toBe(200)
    const grant = (await response.json()) as Record<string, unknown>
    expect(grant).toMatchObject({
      uri: 'node://camera/photos/2026/shot.jpg',
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg', 'if-none-match': '*' },
    })
    expect(grant.url).toContain('secret=redacted')
    expect(presignPut).toHaveBeenCalledWith('ctx/camera/photos/2026/shot.jpg', 60, {
      contentType: 'image/jpeg',
      ifNoneMatch: '*',
    })
    expect(await store.head('ctx/camera/photos/2026/shot.jpg')).toBeNull()
  })

  it('只有显式 overwrite 才签发可覆盖 PUT', async () => {
    const store = new MemoryObjectStore() as ObjectStore
    const presignPut = vi.fn(async () => ({
      method: 'PUT' as const,
      url: 'https://r2-upload.test/replace',
      headers: { 'content-type': 'image/jpeg' },
    }))
    store.presignPut = presignPut
    const tb = await createTestApp({ objects: store })
    await mountR2(tb.request, 'camera/replace')

    const response = await tb.request('https://tb.test/camera/replace/create_upload', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        path: 'shot.jpg',
        contentType: 'image/jpeg',
        overwrite: true,
      }),
    })
    expect(response.status).toBe(200)
    expect(presignPut).toHaveBeenCalledWith('ctx/camera/replace/shot.jpg', 900, {
      contentType: 'image/jpeg',
    })
  })

  it('上传 TTL 与下载 TTL 解耦，允许显式缩放且缺省不超过 900 秒', async () => {
    const store = new MemoryObjectStore() as ObjectStore
    const presignPut = vi.fn(async () => ({
      method: 'PUT' as const,
      url: 'https://r2-upload.test/ttl',
      headers: {},
    }))
    store.presignPut = presignPut
    const tb = await createTestApp({
      objects: store,
      refTtlSec: 86_400,
      uploadGrantTtlSec: 120,
    })
    await mountR2(tb.request, 'camera/ttl')

    const response = await tb.request('https://tb.test/camera/ttl/create_upload', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ path: 'shot.jpg', contentType: 'image/jpeg' }),
    })
    expect(response.status).toBe(200)
    expect(presignPut).toHaveBeenCalledWith(
      'ctx/camera/ttl/shot.jpg',
      120,
      expect.any(Object),
    )

    const defaultStore = new MemoryObjectStore() as ObjectStore
    const defaultPresignPut = vi.fn(async () => ({
      method: 'PUT' as const,
      url: 'https://r2-upload.test/default-ttl',
      headers: {},
    }))
    defaultStore.presignPut = defaultPresignPut
    const defaultTb = await createTestApp({ objects: defaultStore, refTtlSec: 86_400 })
    await mountR2(defaultTb.request, 'camera/default-ttl')
    const defaultResponse = await defaultTb.request(
      'https://tb.test/camera/default-ttl/create_upload',
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ path: 'shot.jpg', contentType: 'image/jpeg' }),
      },
    )
    expect(defaultResponse.status).toBe(200)
    expect(defaultPresignPut).toHaveBeenCalledWith(
      'ctx/camera/default-ttl/shot.jpg',
      900,
      expect.any(Object),
    )
  })

  it('无 PUT signer 时不宣告能力，显式调用返回 unavailable', async () => {
    const tb = await createTestApp({ objects: new MemoryObjectStore() })
    await mountR2(tb.request, 'camera/no-signer')

    const help = await tb.request('https://tb.test/camera/no-signer/~help', {
      headers: adminHeaders,
    })
    const names = ((await help.json()) as { cmds: Array<{ name: string }> }).cmds.map(c => c.name)
    expect(names).not.toContain('create_upload')

    const response = await tb.request('https://tb.test/camera/no-signer/create_upload', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ path: 'shot.jpg', contentType: 'image/jpeg' }),
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'unavailable' })
  })

  it('对象工厂异常只隐藏可选能力，不拖垮 help/describe', async () => {
    const objectsFactory = vi.fn(async (): Promise<ObjectStore> => {
      throw new Error('secret decrypt failed')
    })
    const tb = await createTestApp({ objectsFactory })
    await mountR2(tb.request, 'camera/broken-signer')

    const help = await tb.request('https://tb.test/camera/broken-signer/~help', {
      headers: adminHeaders,
    })
    expect(help.status).toBe(200)
    const names = ((await help.json()) as { cmds: Array<{ name: string }> }).cmds.map(c => c.name)
    expect(names).not.toContain('create_upload')

    const describe = await tb.request('https://tb.test/camera/broken-signer/~describe', {
      headers: adminHeaders,
    })
    expect(describe.status).toBe(200)
    expect(await describe.json()).toEqual({
      kind: 'context',
      capabilities: ['search', 'delete'],
    })
    expect(objectsFactory).toHaveBeenCalledTimes(2)
  })

  it('S3 能力发现不解析节点 authRef', async () => {
    const tb = await createTestApp()
    const resolve = vi.spyOn(tb.secrets, 'resolve')
    const deps: TbAppDeps = {
      allowInsecureHttp: false,
      remote: TEST_REMOTE,
      secrets: tb.secrets,
      state: tb.state,
      version: TEST_VERSION,
    }
    const cfg: ContextConfig = {
      kind: 'context',
      provider: 's3',
      authRef: 'revoked-secret',
      providerConfig: {
        endpoint: 'https://s3.example.com',
        bucket: 'photos',
      },
    }

    await expect(contextDirectUploadAvailable(cfg, deps)).resolves.toBe(true)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('readOnly 隐藏并拒绝 create_upload', async () => {
    const store = new MemoryObjectStore() as ObjectStore
    store.presignPut = async () => ({ method: 'PUT', url: 'https://upload.test', headers: {} })
    const tb = await createTestApp({ objects: store })
    await mountR2(tb.request, 'camera/read-only', { readOnly: true })

    const help = await tb.request('https://tb.test/camera/read-only/~help', {
      headers: adminHeaders,
    })
    const names = ((await help.json()) as { cmds: Array<{ name: string }> }).cmds.map(c => c.name)
    expect(names).not.toContain('create_upload')
    const response = await tb.request('https://tb.test/camera/read-only/create_upload', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ path: 'shot.jpg', contentType: 'image/jpeg' }),
    })
    expect(response.status).toBe(403)
  })
})
