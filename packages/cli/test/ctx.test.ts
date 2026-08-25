import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { guessContentType, guessUploadContentType, parseMeta } from '../src/commands/ctx'
import { mockJsonResponse, runCli } from './cliHarness'
import { resetFetch, setFetch } from '../src/http'

/** 捕获请求并按 body 应答;返回 mock 以断言 URL/body。 */
function captureFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string, init?: RequestInit) =>
    mockJsonResponse(url, init, body, status))
  setFetch(fn as unknown as typeof fetch)
  return fn
}

function stdoutText(): string {
  const stdout = process.stdout.write as unknown as ReturnType<typeof vi.fn>
  return stdout.mock.calls.map(c => String(c[0])).join('')
}

const gw = ['--base-url', 'https://gw', '--sk', 'tbk_x']

beforeEach(() => {
  process.exitCode = 0
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
  process.exitCode = 0
  resetFetch()
  vi.restoreAllMocks()
})

describe('tb ctx ls', () => {
  it('无 prefix → List{path:""},不带 opts', async () => {
    const fn = captureFetch({ items: [] })
    await runCli(['ctx', 'ls', 'ctx/notes', ...gw, '--json'])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/ctx/notes/list')
    expect((init.method ?? '').toUpperCase()).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ path: '' })
    expect(process.exitCode).toBe(0)
  })

  it('prefix + --limit/--cursor → opts 整体传不平铺;--json 输出可解析', async () => {
    const page = {
      items: [
        {
          uri: 'node://ctx/notes/guides/',
          contentType: 'inode/directory',
          version: '-',
          updatedAt: '2026-07-07T00:00:00Z',
          metadata: {},
        },
      ],
      cursor: 'c2',
    }
    const fn = captureFetch(page)
    await runCli([
      'ctx',
      'ls',
      'ctx/notes',
      'guides/',
      '--limit',
      '10',
      '--cursor',
      'c1',
      ...gw,
      '--json',
    ])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ path: 'guides/', opts: { limit: 10, cursor: 'c1' } })
    expect(JSON.parse(stdoutText())).toEqual(page)
  })

  it('人类模式按行列出 uri + size + updatedAt', async () => {
    captureFetch({
      items: [
        {
          uri: 'node://ctx/notes/a.md',
          contentType: 'text/markdown',
          size: 12,
          version: 'v1',
          updatedAt: '2026-07-07T00:00:00Z',
          metadata: {},
        },
      ],
    })
    await runCli(['ctx', 'ls', 'ctx/notes', ...gw])
    const printed = stdoutText()
    expect(printed).toContain('node://ctx/notes/a.md')
    expect(printed).toContain('12')
    expect(printed).toContain('2026-07-07T00:00:00Z')
    expect(process.exitCode).toBe(0)
  })
})

describe('tb ctx cat', () => {
  it('content 为字符串 → 直接打印', async () => {
    const fn = captureFetch({
      uri: 'node://ctx/notes/a.md',
      contentType: 'text/markdown',
      version: 'v1',
      updatedAt: '2026-07-07T00:00:00Z',
      metadata: {},
      content: 'hello world\n',
    })
    await runCli(['ctx', 'cat', 'ctx/notes', 'a.md', ...gw])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/ctx/notes/get')
    expect(JSON.parse(init.body as string)).toEqual({ path: 'a.md' })
    expect(stdoutText()).toBe('hello world\n')
    expect(process.exitCode).toBe(0)
  })

  it('content 为 { $ref } → stdout 打印 URL,stderr 提示', async () => {
    captureFetch({
      uri: 'node://ctx/notes/big.bin',
      contentType: 'application/octet-stream',
      size: 2_000_000,
      version: 'v9',
      updatedAt: '2026-07-07T00:00:00Z',
      metadata: {},
      content: { $ref: 'https://r2.example/presigned?sig=abc' },
    })
    await runCli(['ctx', 'cat', 'ctx/notes', 'big.bin', ...gw])
    expect(stdoutText()).toBe('https://r2.example/presigned?sig=abc\n')
    const stderr = process.stderr.write as unknown as ReturnType<typeof vi.fn>
    const err = stderr.mock.calls.map(c => String(c[0])).join('')
    expect(err).toMatch(/large object, download via URL/)
    expect(process.exitCode).toBe(0)
  })

  it('--json 原样输出整个 entry(含 $ref content)', async () => {
    const entry = {
      uri: 'node://ctx/notes/big.bin',
      contentType: 'application/octet-stream',
      version: 'v9',
      updatedAt: '2026-07-07T00:00:00Z',
      metadata: {},
      content: { $ref: 'https://r2.example/presigned?sig=abc' },
    }
    captureFetch(entry)
    await runCli(['ctx', 'cat', 'ctx/notes', 'big.bin', ...gw, '--json'])
    expect(JSON.parse(stdoutText())).toEqual(entry)
  })
})

describe('tb ctx put', () => {
  it('--content + --meta + --if-version → Write{path,entry},缺省 contentType text/plain', async () => {
    const fn = captureFetch({ uri: 'node://ctx/notes/a', version: 'v2' })
    await runCli([
      'ctx',
      'put',
      'ctx/notes',
      'a',
      '--content',
      'hi',
      '--meta',
      'author=djj',
      '--meta',
      'topic=phase=3',
      '--if-version',
      'v1',
      ...gw,
      '--json',
    ])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/ctx/notes/write')
    expect(JSON.parse(init.body as string)).toEqual({
      path: 'a',
      entry: {
        contentType: 'text/plain',
        content: 'hi',
        // "=" 只按第一个分割:value 内可以再含 "="。
        metadata: { author: 'djj', topic: 'phase=3' },
        ifVersion: 'v1',
      },
    })
    expect(process.exitCode).toBe(0)
  })

  it('--file *.md → contentType 猜 text/markdown,内容取自文件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tb-ctx-'))
    const file = join(dir, 'note.md')
    writeFileSync(file, '# title\n')
    const fn = captureFetch({ uri: 'node://ctx/notes/note.md', version: 'v1' })
    await runCli(['ctx', 'put', 'ctx/notes', 'note.md', '--file', file, ...gw, '--json'])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      path: 'note.md',
      entry: { contentType: 'text/markdown', content: '# title\n' },
    })
  })

  it('--content-type 显式覆盖推断', async () => {
    const fn = captureFetch({ uri: 'node://ctx/notes/a', version: 'v1' })
    await runCli([
      'ctx',
      'put',
      'ctx/notes',
      'a',
      '--content',
      '{}',
      '--content-type',
      'application/json',
      ...gw,
      '--json',
    ])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.entry.contentType).toBe('application/json')
  })

  it('--meta 缺 "=" → 退出码 1,不发请求', async () => {
    // --content 始终提供,避免 put 落到 stdin 分支(parseMeta 先于内容解析抛错)。
    const fn = captureFetch({})
    await runCli([
      'ctx',
      'put',
      'ctx/notes',
      'a',
      '--content',
      'hi',
      '--meta',
      'noequals',
      ...gw,
      '--json',
    ])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
})

describe('parseMeta / guessContentType', () => {
  it('重复 k=v → Record;无项 → undefined;缺 "=" → CliError', () => {
    expect(parseMeta(undefined)).toBeUndefined()
    expect(parseMeta(['a=1', 'b=2'])).toEqual({ a: '1', b: '2' })
    expect(() => parseMeta(['bad'])).toThrow(/key=value/)
  })

  it('扩展名映射:.md/.json/.txt/其他/无文件', () => {
    expect(guessContentType('a.md')).toBe('text/markdown')
    expect(guessContentType('a.json')).toBe('application/json')
    expect(guessContentType('a.txt')).toBe('text/plain')
    expect(guessContentType('a.bin')).toBe('text/plain')
    expect(guessContentType(undefined)).toBe('text/plain')
  })

  it('直传媒体类型识别常见图片，未知扩展名回退 octet-stream', () => {
    expect(guessUploadContentType('shot.JPG')).toBe('image/jpeg')
    expect(guessUploadContentType('shot.png')).toBe('image/png')
    expect(guessUploadContentType('shot.webp')).toBe('image/webp')
    expect(guessUploadContentType('raw.bin')).toBe('application/octet-stream')
  })
})

describe('tb ctx upload', () => {
  it.each([undefined, 'store://default/AAAAAAAAAAAAAAAAAAAAAA', 'node://'])(
    '畸形 Context grant uri=%j 时不发送私有文件',
    async (uri) => {
      const dir = mkdtempSync(join(tmpdir(), 'tb-ctx-upload-invalid-'))
      const file = join(dir, 'private.bin')
      writeFileSync(file, new Uint8Array([1, 2, 3]))
      const fn = vi.fn(async () => new Response(JSON.stringify({
        ...(uri === undefined ? {} : { uri }),
        method: 'PUT',
        url: 'https://objects.example/private?signature=secret',
        headers: { 'content-type': 'application/octet-stream' },
        expiresAt: '2099-08-24T12:00:00.000Z',
      }), { status: 200 }))
      setFetch(fn as unknown as typeof fetch)

      await runCli(['ctx', 'upload', 'ctx/photos', 'private.bin', '--file', file, ...gw, '--json'])
      expect(fn).toHaveBeenCalledOnce()
      expect(stdoutText()).toContain('invalid upload grant')
      expect(process.exitCode).toBe(1)
    },
  )

  it('先申请 grant，再把文件原始字节直传；输出不泄露签名 URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tb-ctx-upload-'))
    const file = join(dir, 'shot.jpg')
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00])
    writeFileSync(file, bytes)
    const grant = {
      uri: 'node://ctx/photos/camera/shot.jpg',
      method: 'PUT',
      url: 'https://objects.example/shot.jpg?signature=must-not-print',
      headers: { 'content-type': 'image/jpeg', 'if-none-match': '*' },
      expiresAt: '2099-08-24T12:00:00.000Z',
    }
    const fn = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(grant), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: 'v-photo' } }))
    setFetch(fn as unknown as typeof fetch)

    await runCli([
      'ctx',
      'upload',
      'ctx/photos',
      'camera/shot.jpg',
      '--file',
      file,
      ...gw,
      '--json',
    ])

    expect(fn).toHaveBeenCalledTimes(2)
    const [grantUrl, grantInit] = fn.mock.calls[0] as [string, RequestInit]
    expect(grantUrl).toBe('https://gw/ctx/photos/create_upload')
    expect(JSON.parse(String(grantInit.body))).toEqual({
      path: 'camera/shot.jpg',
      contentType: 'image/jpeg',
    })
    expect(new Headers(grantInit.headers).get('authorization')).toBe('Bearer tbk_x')

    const [uploadUrl, uploadInit] = fn.mock.calls[1] as [URL, RequestInit]
    expect(uploadUrl.toString()).toBe(grant.url)
    expect(uploadInit.method).toBe('PUT')
    expect(uploadInit.redirect).toBe('error')
    expect(uploadInit.credentials).toBe('omit')
    expect(new Headers(uploadInit.headers).get('authorization')).toBeNull()
    expect(new Headers(uploadInit.headers).get('content-type')).toBe('image/jpeg')
    expect(new Headers(uploadInit.headers).get('if-none-match')).toBe('*')
    expect(new Uint8Array(uploadInit.body as ArrayBufferLike)).toEqual(bytes)
    expect(JSON.parse(stdoutText())).toEqual({ uri: grant.uri, etag: 'v-photo' })
    expect(stdoutText()).not.toContain('must-not-print')
    expect(process.exitCode).toBe(0)
  })

  it('对象存储失败仅报告状态，不回显响应体或预签名 URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tb-ctx-upload-error-'))
    const file = join(dir, 'shot.jpg')
    writeFileSync(file, new Uint8Array([1]))
    const secretUrl = 'https://objects.example/shot.jpg?signature=secret'
    const fn = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        uri: 'node://ctx/photos/shot.jpg',
        method: 'PUT',
        url: secretUrl,
        headers: { 'content-type': 'image/jpeg' },
        expiresAt: '2099-08-24T12:00:00.000Z',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('SignatureDoesNotMatch secret body', { status: 403 }))
    setFetch(fn as unknown as typeof fetch)

    await runCli(['ctx', 'upload', 'ctx/photos', 'shot.jpg', '--file', file, ...gw, '--json'])
    const output = stdoutText()
    expect(output).toContain('object upload returned HTTP 403')
    expect(output).not.toContain('SignatureDoesNotMatch')
    expect(output).not.toContain(secretUrl)
    expect(process.exitCode).toBe(1)
  })

  it('对象存储网络异常不回显 fetch 错误中可能携带的预签名 URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tb-ctx-upload-network-'))
    const file = join(dir, 'shot.jpg')
    writeFileSync(file, new Uint8Array([1]))
    const secretUrl = 'https://objects.example/shot.jpg?signature=network-secret'
    const fn = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        uri: 'node://ctx/photos/shot.jpg',
        method: 'PUT',
        url: secretUrl,
        headers: { 'content-type': 'image/jpeg' },
        expiresAt: '2099-08-24T12:00:00.000Z',
      }), { status: 200 }))
      .mockRejectedValueOnce(new Error(`fetch failed for ${secretUrl}`))
    setFetch(fn as unknown as typeof fetch)

    await runCli(['ctx', 'upload', 'ctx/photos', 'shot.jpg', '--file', file, ...gw, '--json'])
    expect(stdoutText()).toContain('object upload request failed')
    expect(stdoutText()).not.toContain('network-secret')
    expect(process.exitCode).toBe(1)
  })

  it('--force 显式申请覆盖 grant；默认命中 412 时给 conflict 提示', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tb-ctx-upload-force-'))
    const file = join(dir, 'shot.jpg')
    writeFileSync(file, new Uint8Array([1]))
    const grant = {
      uri: 'node://ctx/photos/shot.jpg',
      method: 'PUT',
      url: 'https://objects.example/shot.jpg?signature=secret',
      headers: { 'content-type': 'image/jpeg' },
      expiresAt: '2099-08-24T12:00:00.000Z',
    }
    const forceFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(grant), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    setFetch(forceFetch as unknown as typeof fetch)

    await runCli([
      'ctx', 'upload', 'ctx/photos', 'shot.jpg', '--file', file, '--force', ...gw, '--json',
    ])
    expect(JSON.parse(String(forceFetch.mock.calls[0]?.[1]?.body))).toEqual({
      path: 'shot.jpg',
      contentType: 'image/jpeg',
      overwrite: true,
    })
    expect(process.exitCode).toBe(0)

    process.exitCode = 0
    const stdout = process.stdout.write as unknown as ReturnType<typeof vi.fn>
    stdout.mockClear()
    const conflictFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(grant), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
    setFetch(conflictFetch as unknown as typeof fetch)
    await runCli(['ctx', 'upload', 'ctx/photos', 'shot.jpg', '--file', file, ...gw, '--json'])
    expect(stdoutText()).toContain('re-run with --force')
    expect(stdoutText()).toContain('conflict')
    expect(process.exitCode).toBe(1)
  })
})

describe('tb ctx patch', () => {
  it('--content → Update{path,patch:{content}}', async () => {
    const fn = captureFetch({ uri: 'node://ctx/notes/a', version: 'v3' })
    await runCli([
      'ctx',
      'patch',
      'ctx/notes',
      'a',
      '--content',
      'new body',
      '--if-version',
      'v2',
      ...gw,
      '--json',
    ])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/ctx/notes/update')
    expect(JSON.parse(init.body as string)).toEqual({ path: 'a', patch: { content: 'new body', ifVersion: 'v2' } })
  })

  it('仅 --meta → patch 只带 metadata', async () => {
    const fn = captureFetch({ uri: 'node://ctx/notes/a', version: 'v3' })
    await runCli(['ctx', 'patch', 'ctx/notes', 'a', '--meta', 'reviewed=yes', ...gw, '--json'])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ path: 'a', patch: { metadata: { reviewed: 'yes' } } })
  })

  it('content 与 meta 都缺 → 本地退出码 1,不发请求', async () => {
    const fn = captureFetch({})
    await runCli(['ctx', 'patch', 'ctx/notes', 'a', ...gw, '--json'])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
})

describe('tb ctx search', () => {
  it('--mode/--limit → Search{query,opts}', async () => {
    const fn = captureFetch({ items: [] })
    await runCli([
      'ctx',
      'search',
      'ctx/notes',
      'phase',
      '--mode',
      'keyword',
      '--limit',
      '5',
      ...gw,
      '--json',
    ])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/ctx/notes/search')
    expect(JSON.parse(init.body as string)).toEqual({ query: 'phase', opts: { mode: 'keyword', limit: 5 } })
    expect(process.exitCode).toBe(0)
  })

  it('缺省不带 opts;非法 --mode → 退出码 1', async () => {
    const fn = captureFetch({ items: [] })
    await runCli(['ctx', 'search', 'ctx/notes', 'phase', ...gw, '--json'])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ query: 'phase' })

    fn.mockClear()
    await runCli(['ctx', 'search', 'ctx/notes', 'phase', '--mode', 'fuzzy', ...gw, '--json'])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
})

describe('tb ctx mount', () => {
  it('r2 → ~register,config {kind:context,provider:r2,providerConfig:{prefix},readOnly,ttl}', async () => {
    const fn = captureFetch({ path: 'ctx/notes', kind: 'context' })
    await runCli([
      'ctx',
      'mount',
      'ctx/notes',
      '--provider',
      'r2',
      '--description',
      'team notes',
      '--prefix',
      'notes/',
      '--read-only',
      '--ttl',
      '3600',
      ...gw,
      '--json',
    ])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/ctx/notes/~register')
    const payload = JSON.parse(init.body as string)
    // ~register body = NodeInput 本体(非 {tool,arguments} 信封),body.path == URL path。
    expect(payload).toEqual({
      path: 'ctx/notes',
      kind: 'context',
      description: 'team notes',
      config: {
        kind: 'context',
        provider: 'r2',
        providerConfig: { prefix: 'notes/' },
        readOnly: true,
        ttl: 3600,
      },
    })
    expect(process.exitCode).toBe(0)
  })

  it('r2 无 --prefix → 不带 providerConfig', async () => {
    const fn = captureFetch({ path: 'ctx/notes', kind: 'context' })
    await runCli(['ctx', 'mount', 'ctx/notes', '--provider', 'r2', ...gw, '--json'])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string).config).toEqual({ kind: 'context', provider: 'r2' })
  })

  it('s3 → providerConfig {endpoint,bucket,region,prefix} + authRef', async () => {
    const fn = captureFetch({ path: 'ctx/ext', kind: 'context' })
    await runCli([
      'ctx',
      'mount',
      'ctx/ext',
      '--provider',
      's3',
      '--endpoint',
      'https://s3.example',
      '--bucket',
      'docs',
      '--region',
      'auto',
      '--prefix',
      'team/',
      '--auth-ref',
      's3-main',
      ...gw,
      '--json',
    ])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string).config).toEqual({
      kind: 'context',
      provider: 's3',
      providerConfig: {
        endpoint: 'https://s3.example',
        bucket: 'docs',
        region: 'auto',
        prefix: 'team/',
      },
      authRef: 's3-main',
    })
  })

  it('s3 缺 --endpoint / --bucket / --auth-ref → 退出码 1,不发请求', async () => {
    const fn = captureFetch({})
    await runCli([
      'ctx',
      'mount',
      'ctx/ext',
      '--provider',
      's3',
      '--bucket',
      'docs',
      '--auth-ref',
      's3-main',
      ...gw,
      '--json',
    ])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)

    process.exitCode = 0
    await runCli([
      'ctx',
      'mount',
      'ctx/ext',
      '--provider',
      's3',
      '--endpoint',
      'https://s3.example',
      '--bucket',
      'docs',
      ...gw,
      '--json',
    ])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('自定义 provider id → 按 context-provider plugin 挂载', async () => {
    const fn = captureFetch({ path: 'ctx/x', kind: 'context' })
    await runCli([
      'ctx',
      'mount',
      'ctx/x',
      '--provider',
      'notion-context',
      '--auth-ref',
      'notion-token',
      ...gw,
      '--json',
    ])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      path: 'ctx/x',
      kind: 'context',
      description: 'context at ctx/x',
      config: { kind: 'context', provider: 'notion-context', authRef: 'notion-token' },
    })
  })
})

describe('tb ctx unmount', () => {
  it('先 get 确认 kind=context 再 delete(管理面 system/registry)', async () => {
    const fn = vi.fn(async (url: string) => {
      if (String(url).endsWith('/get')) {
        return new Response(JSON.stringify({ path: 'ctx/notes', kind: 'context' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    setFetch(fn as unknown as typeof fetch)
    await runCli(['ctx', 'unmount', 'ctx/notes', ...gw, '--json'])
    expect(fn).toHaveBeenCalledTimes(2)
    expect(String(fn.mock.calls[0]?.[0])).toBe('https://gw/system/registry/get')
    expect(String(fn.mock.calls[1]?.[0])).toBe('https://gw/system/registry/delete')
    expect(JSON.parse((fn.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({ path: 'ctx/notes' })
    expect(JSON.parse((fn.mock.calls[1]?.[1] as RequestInit).body as string)).toEqual({ path: 'ctx/notes' })
    expect(process.exitCode).toBe(0)
  })

  it('kind 非 context → 报错不删', async () => {
    const fn = vi.fn(
      async () =>
        new Response(JSON.stringify({ path: 'docs/ctx7', kind: 'mcp' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    setFetch(fn as unknown as typeof fetch)
    await runCli(['ctx', 'unmount', 'docs/ctx7', ...gw])
    expect(fn).toHaveBeenCalledTimes(1) // 只有前置 get,没有 delete
    expect(process.exitCode).toBe(1)
    const stderr = process.stderr.write as unknown as ReturnType<typeof vi.fn>
    const printed = stderr.mock.calls.map(c => String(c[0])).join('')
    expect(printed).toMatch(/kind 'mcp'/)
  })
})
