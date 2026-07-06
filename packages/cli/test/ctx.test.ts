import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ctxCatCommand,
  ctxLsCommand,
  ctxMountCommand,
  ctxPatchCommand,
  ctxPutCommand,
  ctxSearchCommand,
  ctxUnmountCommand,
  guessContentType,
  parseMeta,
} from '../src/commands/ctx'
import { resetFetch, setFetch } from '../src/http'

function invoke(
  // biome-ignore lint/suspicious/noExplicitAny: citty run context 仅用到 args,测试直接注入。
  cmd: { run?: (ctx: any) => unknown },
  args: Record<string, unknown>,
): Promise<unknown> {
  return Promise.resolve(cmd.run?.({ args, cmd, rawArgs: [] }))
}

/** 捕获请求并按 body 应答;返回 mock 以断言 URL/body。 */
function captureFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )
  setFetch(fn as unknown as typeof fetch)
  return fn
}

function stdoutText(): string {
  const stdout = process.stdout.write as unknown as ReturnType<typeof vi.fn>
  return stdout.mock.calls.map((c) => String(c[0])).join('')
}

const gw = { 'base-url': 'https://gw', sk: 'tbk_x' }

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
    await invoke(ctxLsCommand, { ...gw, json: true, ns: 'ctx/notes' })
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/ctx/notes')
    expect((init.method ?? '').toUpperCase()).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      tool: 'List',
      arguments: { path: '' },
    })
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
    await invoke(ctxLsCommand, {
      ...gw,
      json: true,
      ns: 'ctx/notes',
      prefix: 'guides/',
      limit: '10',
      cursor: 'c1',
    })
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      tool: 'List',
      arguments: { path: 'guides/', opts: { limit: 10, cursor: 'c1' } },
    })
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
    await invoke(ctxLsCommand, { ...gw, json: false, ns: 'ctx/notes' })
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
    await invoke(ctxCatCommand, { ...gw, json: false, ns: 'ctx/notes', entry: 'a.md' })
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/ctx/notes')
    expect(JSON.parse(init.body as string)).toEqual({
      tool: 'Get',
      arguments: { path: 'a.md' },
    })
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
    await invoke(ctxCatCommand, { ...gw, json: false, ns: 'ctx/notes', entry: 'big.bin' })
    expect(stdoutText()).toBe('https://r2.example/presigned?sig=abc\n')
    const stderr = process.stderr.write as unknown as ReturnType<typeof vi.fn>
    const err = stderr.mock.calls.map((c) => String(c[0])).join('')
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
    await invoke(ctxCatCommand, { ...gw, json: true, ns: 'ctx/notes', entry: 'big.bin' })
    expect(JSON.parse(stdoutText())).toEqual(entry)
  })
})

describe('tb ctx put', () => {
  it('--content + --meta + --if-version → Write{path,entry},缺省 contentType text/plain', async () => {
    const fn = captureFetch({ uri: 'node://ctx/notes/a', version: 'v2' })
    await invoke(ctxPutCommand, {
      ...gw,
      json: true,
      ns: 'ctx/notes',
      entry: 'a',
      content: 'hi',
      meta: ['author=djj', 'topic=phase=3'],
      'if-version': 'v1',
    })
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/ctx/notes')
    expect(JSON.parse(init.body as string)).toEqual({
      tool: 'Write',
      arguments: {
        path: 'a',
        entry: {
          contentType: 'text/plain',
          content: 'hi',
          // "=" 只按第一个分割:value 内可以再含 "="。
          metadata: { author: 'djj', topic: 'phase=3' },
          ifVersion: 'v1',
        },
      },
    })
    expect(process.exitCode).toBe(0)
  })

  it('--file *.md → contentType 猜 text/markdown,内容取自文件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tb-ctx-'))
    const file = join(dir, 'note.md')
    writeFileSync(file, '# title\n')
    const fn = captureFetch({ uri: 'node://ctx/notes/note.md', version: 'v1' })
    await invoke(ctxPutCommand, { ...gw, json: true, ns: 'ctx/notes', entry: 'note.md', file })
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      tool: 'Write',
      arguments: {
        path: 'note.md',
        entry: { contentType: 'text/markdown', content: '# title\n' },
      },
    })
  })

  it('--content-type 显式覆盖推断', async () => {
    const fn = captureFetch({ uri: 'node://ctx/notes/a', version: 'v1' })
    await invoke(ctxPutCommand, {
      ...gw,
      json: true,
      ns: 'ctx/notes',
      entry: 'a',
      content: '{}',
      'content-type': 'application/json',
    })
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.arguments.entry.contentType).toBe('application/json')
  })

  it('--meta 缺 "=" → 退出码 1,不发请求', async () => {
    const fn = captureFetch({})
    await invoke(ctxPutCommand, {
      ...gw,
      json: true,
      ns: 'ctx/notes',
      entry: 'a',
      content: 'hi',
      meta: ['noequals'],
    })
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
})

describe('tb ctx patch', () => {
  it('--content → Update{path,patch:{content}}', async () => {
    const fn = captureFetch({ uri: 'node://ctx/notes/a', version: 'v3' })
    await invoke(ctxPatchCommand, {
      ...gw,
      json: true,
      ns: 'ctx/notes',
      entry: 'a',
      content: 'new body',
      'if-version': 'v2',
    })
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/ctx/notes')
    expect(JSON.parse(init.body as string)).toEqual({
      tool: 'Update',
      arguments: { path: 'a', patch: { content: 'new body', ifVersion: 'v2' } },
    })
  })

  it('仅 --meta → patch 只带 metadata', async () => {
    const fn = captureFetch({ uri: 'node://ctx/notes/a', version: 'v3' })
    await invoke(ctxPatchCommand, {
      ...gw,
      json: true,
      ns: 'ctx/notes',
      entry: 'a',
      meta: 'reviewed=yes',
    })
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      tool: 'Update',
      arguments: { path: 'a', patch: { metadata: { reviewed: 'yes' } } },
    })
  })

  it('content 与 meta 都缺 → 本地退出码 1,不发请求', async () => {
    const fn = captureFetch({})
    await invoke(ctxPatchCommand, { ...gw, json: true, ns: 'ctx/notes', entry: 'a' })
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
})

describe('tb ctx search', () => {
  it('--mode/--limit → Search{query,opts}', async () => {
    const fn = captureFetch({ items: [] })
    await invoke(ctxSearchCommand, {
      ...gw,
      json: true,
      ns: 'ctx/notes',
      query: 'phase',
      mode: 'keyword',
      limit: '5',
    })
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/ctx/notes')
    expect(JSON.parse(init.body as string)).toEqual({
      tool: 'Search',
      arguments: { query: 'phase', opts: { mode: 'keyword', limit: 5 } },
    })
    expect(process.exitCode).toBe(0)
  })

  it('缺省不带 opts;非法 --mode → 退出码 1', async () => {
    const fn = captureFetch({ items: [] })
    await invoke(ctxSearchCommand, { ...gw, json: true, ns: 'ctx/notes', query: 'phase' })
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      tool: 'Search',
      arguments: { query: 'phase' },
    })

    fn.mockClear()
    await invoke(ctxSearchCommand, {
      ...gw,
      json: true,
      ns: 'ctx/notes',
      query: 'phase',
      mode: 'fuzzy',
    })
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
})

describe('tb ctx mount', () => {
  it('r2 → ~register,config {kind:context,provider:r2,providerConfig:{prefix},readOnly,ttl}', async () => {
    const fn = captureFetch({ path: 'ctx/notes', kind: 'context' })
    await invoke(ctxMountCommand, {
      ...gw,
      json: true,
      path: 'ctx/notes',
      provider: 'r2',
      description: 'team notes',
      prefix: 'notes/',
      'read-only': true,
      ttl: '3600',
    })
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
    await invoke(ctxMountCommand, { ...gw, json: true, path: 'ctx/notes', provider: 'r2' })
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string).config).toEqual({ kind: 'context', provider: 'r2' })
  })

  it('s3 → providerConfig {endpoint,bucket,region,prefix} + authRef', async () => {
    const fn = captureFetch({ path: 'ctx/ext', kind: 'context' })
    await invoke(ctxMountCommand, {
      ...gw,
      json: true,
      path: 'ctx/ext',
      provider: 's3',
      endpoint: 'https://s3.example',
      bucket: 'docs',
      region: 'auto',
      prefix: 'team/',
      'auth-ref': 's3-main',
    })
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
    await invoke(ctxMountCommand, {
      ...gw,
      json: true,
      path: 'ctx/ext',
      provider: 's3',
      bucket: 'docs',
      'auth-ref': 's3-main',
    })
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)

    process.exitCode = 0
    await invoke(ctxMountCommand, {
      ...gw,
      json: true,
      path: 'ctx/ext',
      provider: 's3',
      endpoint: 'https://s3.example',
      bucket: 'docs',
    })
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('非法 --provider → 退出码 1,不发请求', async () => {
    const fn = captureFetch({})
    await invoke(ctxMountCommand, { ...gw, json: true, path: 'ctx/x', provider: 'gcs' })
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
})

describe('tb ctx unmount', () => {
  it('先 get 确认 kind=context 再 delete(管理面 system/registry)', async () => {
    const fn = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      if (body.tool === 'get') {
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
    await invoke(ctxUnmountCommand, { ...gw, json: true, path: 'ctx/notes' })
    expect(fn).toHaveBeenCalledTimes(2)
    expect(String(fn.mock.calls[0]?.[0])).toBe('https://gw/system/registry')
    expect(JSON.parse((fn.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      tool: 'get',
      arguments: { path: 'ctx/notes' },
    })
    expect(JSON.parse((fn.mock.calls[1]?.[1] as RequestInit).body as string)).toEqual({
      tool: 'delete',
      arguments: { path: 'ctx/notes' },
    })
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
    await invoke(ctxUnmountCommand, { ...gw, json: false, path: 'docs/ctx7' })
    expect(fn).toHaveBeenCalledTimes(1) // 只有前置 get,没有 delete
    expect(process.exitCode).toBe(1)
    const stderr = process.stderr.write as unknown as ReturnType<typeof vi.fn>
    const printed = stderr.mock.calls.map((c) => String(c[0])).join('')
    expect(printed).toMatch(/kind 'mcp'/)
  })
})
