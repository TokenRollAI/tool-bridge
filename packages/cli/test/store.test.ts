import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetFetch, setFetch } from '../src/http'
import { runCli } from './cliHarness'

const gw = ['--base-url', 'https://gw.example', '--sk', 'tbk_owner']
const READY = {
  uri: 'store://default/obj_01k4photo',
  contentType: 'image/jpeg',
  filename: 'capture.jpg',
  size: 4,
  createdAt: '2099-08-24T11:59:00.000Z',
  readyAt: '2099-08-24T12:00:00.000Z',
  owner: { kind: 'user', id: 'alice' },
  driverKey: 'store/v1/private',
  uploadToken: 'must-not-escape',
  url: 'https://private.example/?signature=must-not-escape',
}

const RELAY_GRANT = {
  uploadId: 'upload-01',
  objectUri: READY.uri,
  transport: 'relay' as const,
  method: 'PUT' as const,
  url: 'https://gw.example/~store/uploads/upload-01',
  headers: { 'content-type': 'image/jpeg' },
  expiresAt: '2099-08-24T12:10:00.000Z',
  maxBytes: 1024,
  uploadToken: 'session-secret',
}

let dir: string

beforeEach(() => {
  process.exitCode = 0
  dir = mkdtempSync(join(tmpdir(), 'tb-store-cli-'))
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
  process.exitCode = 0
  resetFetch()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

async function readRequestBody(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

describe('tb store upload', () => {
  it('relay 流式读取文件，PUT capability 只放 header，输出裁剪敏感字段', async () => {
    const file = join(dir, 'capture.jpg')
    writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0x00]))
    const calls: Array<{ init?: RequestInit, input: RequestInfo | URL }> = []
    let uploaded = Buffer.alloc(0)
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      if (calls.length === 1) return new Response(JSON.stringify(RELAY_GRANT), { status: 200 })
      uploaded = await readRequestBody(init?.body)
      return new Response(JSON.stringify(READY), { status: 200 })
    })
    setFetch(fetcher as typeof fetch)

    await runCli(['store', 'upload', file, '--json', ...gw])

    expect(uploaded).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0x00]))
    expect(String(calls[0]?.input)).toBe('https://gw.example/system/store/create_upload')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      contentType: 'image/jpeg', filename: 'capture.jpg', size: 4,
    })
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer tbk_owner')
    expect(String(calls[1]?.input)).toBe(RELAY_GRANT.url)
    expect(new Headers(calls[1]?.init?.headers).get('x-tb-store-upload')).toBe('session-secret')
    const stdout = vi.mocked(process.stdout.write).mock.calls.map(call => String(call[0])).join('')
    expect(stdout).toContain(READY.uri)
    expect(stdout).not.toContain('must-not-escape')
    expect(stdout).not.toContain('driverKey')
    expect(calls).toHaveLength(2)
  })

  it('direct PUT 后 complete 只用 session header，不携带 SK', async () => {
    const file = join(dir, 'capture.jpg')
    writeFileSync(file, Buffer.from([1, 2, 3, 4]))
    const grant = {
      ...RELAY_GRANT,
      transport: 'presigned-put' as const,
      url: 'https://objects.example/upload?signature=secret',
    }
    const calls: Array<{ init?: RequestInit, input: RequestInfo | URL }> = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      if (calls.length === 1) return new Response(JSON.stringify(grant), { status: 200 })
      if (calls.length === 2) {
        await readRequestBody(init?.body)
        return new Response(null, { status: 200 })
      }
      return new Response(JSON.stringify(READY), { status: 200 })
    })
    setFetch(fetcher as typeof fetch)

    await runCli(['store', 'upload', file, '--json', ...gw])

    expect(String(calls[2]?.input)).toBe('https://gw.example/system/store/complete_upload')
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ uploadId: grant.uploadId })
    const headers = new Headers(calls[2]?.init?.headers)
    expect(headers.get('x-tb-store-upload')).toBe(grant.uploadToken)
    expect(headers.get('authorization')).toBeNull()
  })

  it('幂等 create 已完成时直接返回 descriptor，绝不再次 PUT', async () => {
    const file = join(dir, 'capture.jpg')
    writeFileSync(file, Buffer.from([1, 2, 3, 4]))
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      alreadyCompleted: true,
      descriptor: READY,
    }), { status: 200 }))
    setFetch(fetcher as typeof fetch)

    await runCli([
      'store', 'upload', file, '--idempotency-key', 'call-01', '--json', ...gw,
    ])

    expect(fetcher).toHaveBeenCalledOnce()
    const init = fetcher.mock.calls[0]?.[1]
    expect(JSON.parse(String(init?.body))).toMatchObject({ idempotencyKey: 'call-01' })
    const stdout = vi.mocked(process.stdout.write).mock.calls.map(call => String(call[0])).join('')
    expect(stdout).toContain(READY.uri)
    expect(stdout).not.toContain('must-not-escape')
  })
})

describe('tb store management', () => {
  it('list/stat 使用普通 owner SK 且 JSON 不泄漏 driver/token/url', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
      String(input).endsWith('/list') ? { items: [READY] } : READY,
    ), { status: 200 }))
    setFetch(fetcher as typeof fetch)

    await runCli(['store', 'list', '--json', ...gw])
    await runCli(['store', 'stat', READY.uri, '--json', ...gw])

    for (const call of fetcher.mock.calls) {
      expect(new Headers(call[1]?.headers).get('authorization')).toBe('Bearer tbk_owner')
    }
    const stdout = vi.mocked(process.stdout.write).mock.calls.map(call => String(call[0])).join('')
    expect(stdout).toContain(READY.uri)
    expect(stdout).not.toContain('driverKey')
    expect(stdout).not.toContain('must-not-escape')
  })

  it('share 在成功 stdout 返回用户明确请求的 bearer，错误面仍不经此路径输出', async () => {
    const secretRef = 'https://gw.example/~store/shares/secret-token'
    setFetch(vi.fn(async () => new Response(JSON.stringify({
      shareId: 'share-01', uri: READY.uri, expiresAt: '2099-08-24T12:10:00.000Z', $ref: secretRef,
    }), { status: 200 })) as typeof fetch)

    await runCli(['store', 'share', READY.uri, '--ttl', '60', '--json', ...gw])

    const stdout = vi.mocked(process.stdout.write).mock.calls.map(call => String(call[0])).join('')
    expect(stdout).toContain('share-01')
    expect(stdout).toContain(secretRef)
    expect(stdout).toContain('$ref')
  })

  it('get 先用 SK 换取 $ref，再无 SK/cookie 流式下载到新文件', async () => {
    const out = join(dir, 'download.jpg')
    const ref = 'https://gw.example/~store/refs/read-secret'
    const calls: Array<{ init?: RequestInit, input: RequestInfo | URL }> = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return calls.length === 1
        ? new Response(JSON.stringify({
            $ref: ref,
            contentType: 'image/jpeg',
            size: 4,
            expiresAt: '2099-08-24T12:10:00.000Z',
          }), { status: 200 })
        : new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
    })
    setFetch(fetcher as typeof fetch)

    await runCli(['store', 'get', READY.uri, '--out', out, '--json', ...gw])

    expect(readFileSync(out)).toEqual(Buffer.from([1, 2, 3, 4]))
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer tbk_owner')
    expect(String(calls[1]?.input)).toBe(ref)
    expect(new Headers(calls[1]?.init?.headers).get('authorization')).toBeNull()
    expect(calls[1]?.init?.credentials).toBe('omit')
  })

  it('get --out 已存在时拒绝覆盖，并保留原文件', async () => {
    const out = join(dir, 'existing.bin')
    writeFileSync(out, Buffer.from('original'))
    setFetch(vi.fn(async () => new Response(JSON.stringify({
      $ref: 'https://gw.example/~store/refs/read-secret',
      contentType: 'application/octet-stream',
      size: 4,
      expiresAt: '2099-08-24T12:10:00.000Z',
    }), { status: 200 })) as typeof fetch)

    await runCli(['store', 'get', READY.uri, '--out', out, '--json', ...gw])

    expect(process.exitCode).toBe(1)
    expect(readFileSync(out, 'utf8')).toBe('original')
  })
})
