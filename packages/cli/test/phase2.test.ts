import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseCallArgs } from '../src/commands/call'
import { resetFetch, setFetch } from '../src/http'
import { buildVirtualize, parseToolsFile } from '../src/registry'
import { runCli } from './cliHarness'

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

const savedBaseUrl = process.env.TB_BASE_URL

beforeEach(() => {
  process.exitCode = 0
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
  process.exitCode = 0
  process.env.TB_BASE_URL = savedBaseUrl
  resetFetch()
  vi.restoreAllMocks()
})

describe('tb tool mount --kind mcp', () => {
  it('走 ~register,构造 mcp NodeInput 形状(含 authRef 与 virtualize)', async () => {
    const fn = captureFetch({ path: 'docs/ctx7', kind: 'mcp' })
    await runCli([
      'tool',
      'mount',
      'docs/ctx7',
      '--json',
      '--base-url',
      'https://gw',
      '--sk',
      'tbk_x',
      '--kind',
      'mcp',
      '--url',
      'https://mcp.example/sse',
      '--auth-ref',
      's-mcp',
      '--description',
      'Context7',
      '--prefix',
      'ctx__',
      '--rename',
      'resolve=r',
      '--rename',
      'get-docs=g',
      '--hide',
      'debug',
      '--describe',
      'resolve=Resolve libraries',
    ])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/docs/ctx7/~register')
    const payload = JSON.parse(init.body as string)
    // ~register body = NodeInput 本体(非 {tool,arguments} 信封),且 body.path == URL path。
    expect(payload.path).toBe('docs/ctx7')
    expect(payload.kind).toBe('mcp')
    expect(payload.description).toBe('Context7')
    expect(payload.config).toEqual({
      kind: 'mcp',
      url: 'https://mcp.example/sse',
      authRef: 's-mcp',
    })
    expect(payload.virtualize).toEqual({
      prefix: 'ctx__',
      rename: { resolve: 'r', 'get-docs': 'g' },
      hide: ['debug'],
      describe: { resolve: 'Resolve libraries' },
    })
    expect(process.exitCode).toBe(0)
  })

  it('缺 --url → 退出码 1,不发请求', async () => {
    const fn = captureFetch({})
    await runCli([
      'tool',
      'mount',
      'docs/ctx7',
      '--json',
      '--base-url',
      'https://gw',
      '--sk',
      'tbk_x',
      '--kind',
      'mcp',
    ])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
})

describe('tb tool mount --kind http', () => {
  it('从 --tools-file 读 HttpToolDef[] 放进 config.tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tb-tools-'))
    const file = join(dir, 'tools.json')
    writeFileSync(
      file,
      JSON.stringify([
        { name: 'echo', description: 'echo it', method: 'post', pathTemplate: '/echo' },
      ]),
    )
    const fn = captureFetch({ path: 'svc/echo', kind: 'http' })
    await runCli([
      'tool',
      'mount',
      'svc/echo',
      '--json',
      '--base-url',
      'https://gw',
      '--sk',
      'tbk_x',
      '--kind',
      'http',
      '--endpoint',
      'https://echo.example',
      '--tools-file',
      file,
      '--auth-ref',
      's-http',
      '--auth-header',
      'X-Api-Key',
      '--auth-scheme',
      '',
    ])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.config.kind).toBe('http')
    expect(payload.config.endpoint).toBe('https://echo.example')
    expect(payload.config.authRef).toBe('s-http')
    expect(payload.config.authHeader).toBe('X-Api-Key')
    expect(payload.config.authScheme).toBe('')
    expect(payload.config.tools).toEqual([
      { name: 'echo', description: 'echo it', method: 'POST', pathTemplate: '/echo' },
    ])
    expect(process.exitCode).toBe(0)
  })
})

describe('parseToolsFile', () => {
  it('缺必填字段 → CliError', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tb-tools-'))
    const file = join(dir, 'bad.json')
    writeFileSync(file, JSON.stringify([{ name: 'x', description: 'y', method: 'GET' }]))
    expect(() => parseToolsFile(file)).toThrow(/pathTemplate/)
  })

  it('非法 method → CliError', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tb-tools-'))
    const file = join(dir, 'bad2.json')
    writeFileSync(
      file,
      JSON.stringify([{ name: 'x', description: 'y', method: 'PATCH', pathTemplate: '/x' }]),
    )
    expect(() => parseToolsFile(file)).toThrow(/invalid method/)
  })

  it('非数组 → CliError', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tb-tools-'))
    const file = join(dir, 'obj.json')
    writeFileSync(file, JSON.stringify({ name: 'x' }))
    expect(() => parseToolsFile(file)).toThrow(/JSON array/)
  })
})

describe('buildVirtualize', () => {
  it('重复 --rename "from=to" → Record;无字段 → undefined', () => {
    expect(buildVirtualize({})).toBeUndefined()
    expect(buildVirtualize({ rename: ['a=b', 'c=d'], hide: 'x', describe: ['a=A tool'] })).toEqual({
      rename: { a: 'b', c: 'd' },
      hide: ['x'],
      describe: { a: 'A tool' },
    })
  })

  it('--rename 缺 "=" → CliError', () => {
    expect(() => buildVirtualize({ rename: ['noeq'] })).toThrow(/from=to/)
  })
})

describe('tb server add', () => {
  it('构造 kind:remote NodeInput,--base-url 指远端,网关取自 env', async () => {
    process.env.TB_BASE_URL = 'https://gw'
    const fn = captureFetch({ path: 'fed/peer', kind: 'remote' })
    await runCli([
      'server',
      'add',
      'fed/peer',
      '--json',
      '--sk',
      'tbk_x',
      '--base-url',
      'https://peer.example',
      '--sk-ref',
      's-out',
      '--description',
      'peer',
    ])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/fed/peer/~register')
    const payload = JSON.parse(init.body as string)
    expect(payload.kind).toBe('remote')
    expect(payload.config).toEqual({
      kind: 'remote',
      baseUrl: 'https://peer.example',
      skRef: 's-out',
    })
    expect(process.exitCode).toBe(0)
  })
})

describe('tb server ls / rm', () => {
  it('server ls --json 走 system/registry list 并过滤 remote 节点', async () => {
    const fn = captureFetch({
      items: [
        {
          path: 'fed/peer',
          kind: 'remote',
          description: 'peer',
          config: { kind: 'remote', baseUrl: 'https://peer.example' },
        },
        { path: 'ext/http', kind: 'http', description: 'not remote' },
      ],
    })
    await runCli(['server', 'ls', '--json', '--base-url', 'https://gw', '--sk', 'tbk_x'])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/system/registry')
    expect(JSON.parse(init.body as string)).toEqual({ tool: 'list', arguments: {} })
    const stdout = process.stdout.write as unknown as ReturnType<typeof vi.fn>
    const printed = stdout.mock.calls.map((c) => String(c[0])).join('')
    expect(JSON.parse(printed)).toEqual([
      {
        path: 'fed/peer',
        kind: 'remote',
        description: 'peer',
        config: { kind: 'remote', baseUrl: 'https://peer.example' },
      },
    ])
  })

  it('server rm 先确认 kind=remote 再 delete', async () => {
    const fn = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      if (body.tool === 'get') {
        return new Response(JSON.stringify({ path: 'fed/peer', kind: 'remote' }), {
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
    await runCli([
      'server',
      'rm',
      'fed/peer',
      '--json',
      '--base-url',
      'https://gw',
      '--sk',
      'tbk_x',
    ])
    expect(fn).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse((fn.mock.calls[0]?.[1] as RequestInit).body as string)
    const secondBody = JSON.parse((fn.mock.calls[1]?.[1] as RequestInit).body as string)
    expect(firstBody).toEqual({ tool: 'get', arguments: { path: 'fed/peer' } })
    expect(secondBody).toEqual({ tool: 'delete', arguments: { path: 'fed/peer' } })
  })
})

describe('tb call', () => {
  it('--tool 给出 → 信封 body {tool, arguments}(--json)', async () => {
    const fn = captureFetch({ ok: true })
    await runCli([
      'call',
      'docs/ctx7',
      '--json',
      '--base-url',
      'https://gw',
      '--sk',
      'tbk_x',
      '--tool',
      'resolve',
      '--args',
      '{"libraryName":"react"}',
    ])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/docs/ctx7')
    expect(JSON.parse(init.body as string)).toEqual({
      tool: 'resolve',
      arguments: { libraryName: 'react' },
    })
    expect(process.exitCode).toBe(0)
  })

  it('--tool 省略 → path 即直连工具路径,body 为 arguments 本体(--json)', async () => {
    const fn = captureFetch({ ok: true })
    await runCli([
      'call',
      'docs/ctx7/resolve',
      '--json',
      '--base-url',
      'https://gw',
      '--sk',
      'tbk_x',
      '--args',
      '{"libraryName":"react"}',
    ])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/docs/ctx7/resolve')
    expect(JSON.parse(init.body as string)).toEqual({ libraryName: 'react' })
    expect(process.exitCode).toBe(0)
  })

  it('--tool 省略且无 --args → 直连空对象 body', async () => {
    const fn = captureFetch({ ok: true })
    await runCli([
      'call',
      'docs/ctx7/resolve',
      '--json',
      '--base-url',
      'https://gw',
      '--sk',
      'tbk_x',
    ])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/docs/ctx7/resolve')
    expect(JSON.parse(init.body as string)).toEqual({})
    expect(process.exitCode).toBe(0)
  })

  it('非法 --args JSON → 退出码 1', async () => {
    captureFetch({})
    await runCli([
      'call',
      'docs/ctx7',
      '--json',
      '--base-url',
      'https://gw',
      '--sk',
      'tbk_x',
      '--tool',
      'resolve',
      '--args',
      'not-json',
    ])
    expect(process.exitCode).toBe(1)
  })
})

describe('parseCallArgs', () => {
  it('缺省 {}', () => {
    expect(parseCallArgs(undefined, undefined)).toEqual({})
  })
  it('--args 与 --args-file 互斥', () => {
    expect(() => parseCallArgs('{}', '/tmp/x.json')).toThrow(/mutually exclusive/)
  })
  it('非对象 JSON → CliError', () => {
    expect(() => parseCallArgs('[1,2]', undefined)).toThrow(/JSON object/)
  })
})

describe('tb tool rm — 404 提示', () => {
  it('system/registry delete 404 → 提示需管理面可见性', async () => {
    setFetch(
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ code: 'not_found', message: 'no such node', retryable: false }),
            { status: 404, headers: { 'content-type': 'application/json' } },
          ),
      ) as unknown as typeof fetch,
    )
    await runCli(['tool', 'rm', 'docs/ctx7', '--base-url', 'https://gw', '--sk', 'tbk_x'])
    expect(process.exitCode).toBe(1)
    const stderr = process.stderr.write as unknown as ReturnType<typeof vi.fn>
    const printed = stderr.mock.calls.map((c) => String(c[0])).join('')
    expect(printed).toMatch(/system\/registry/)
  })
})
