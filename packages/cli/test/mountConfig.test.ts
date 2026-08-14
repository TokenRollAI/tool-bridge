import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFetch, setFetch } from '../src/http'
import { runCli } from './cliHarness'

/**
 * `--config k=v`:`kind:'tool'` 与 plugin context 挂载的 providerConfig 输入口。
 *
 * 此前两个操作面都没有这个入口,于是 memos / grafana / metabase / langsmith 这些"必须配
 * baseUrl 或 instanceUrl"的 provider 只能手写节点 JSON 直打 `system/registry` —— 那是
 * 管理旁路(三入口对等纪律里算缺陷)。
 */

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

/** 取 `~register` body(NodeInput)的 config 部分。 */
function sentConfig(fn: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fn.mock.calls[0] as [string, RequestInit]
  const payload = JSON.parse(init.body as string) as { config: Record<string, unknown> }
  return payload.config
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

const base = ['--json', '--base-url', 'https://gw', '--sk', 'tbk_x']

describe('tb tool mount --config', () => {
  it('多个 --config 合成 providerConfig', async () => {
    const fn = captureFetch({ path: 'notes/memos', kind: 'tool' })
    await runCli([
      'tool',
      'mount',
      'notes/memos',
      '--kind',
      'tool',
      '--provider',
      'memos',
      '--auth-ref',
      'memos-key',
      '--config',
      'baseUrl=https://memos.example.com',
      '--config',
      'workspace=team',
      ...base,
    ])
    expect(sentConfig(fn)).toEqual({
      kind: 'tool',
      provider: 'memos',
      authRef: 'memos-key',
      providerConfig: { baseUrl: 'https://memos.example.com', workspace: 'team' },
    })
  })

  it('不给 --config 时不塞空的 providerConfig', async () => {
    const fn = captureFetch({ path: 'x', kind: 'tool' })
    await runCli(['tool', 'mount', 'x', '--kind', 'tool', '--provider', 'tavily', ...base])
    expect(sentConfig(fn)).toEqual({ kind: 'tool', provider: 'tavily' })
  })

  /** 值原样按字符串收:猜类型会把 `0755` 变成数字 755。 */
  it('值不做类型推断,且首个 = 之后的内容原样保留', async () => {
    const fn = captureFetch({ path: 'x', kind: 'tool' })
    await runCli([
      'tool',
      'mount',
      'x',
      '--kind',
      'tool',
      '--provider',
      'p',
      '--config',
      'region=0755',
      '--config',
      'url=https://h/p?a=1&b=2',
      ...base,
    ])
    expect(sentConfig(fn).providerConfig).toEqual({
      region: '0755',
      url: 'https://h/p?a=1&b=2',
    })
  })

  it('形状非法 → 本地拒(不发请求)', async () => {
    const fn = captureFetch({})
    await runCli(['tool', 'mount', 'x', '--kind', 'tool', '--provider', 'p', '--config', 'nope', ...base])
    expect(process.exitCode).not.toBe(0)
    expect(fn).not.toHaveBeenCalled()
  })

  it('空 key 或空 value → 本地拒', async () => {
    for (const spec of ['=v', 'k=']) {
      const fn = captureFetch({})
      await runCli(['tool', 'mount', 'x', '--kind', 'tool', '--provider', 'p', '--config', spec, ...base])
      expect(process.exitCode, spec).not.toBe(0)
      expect(fn, spec).not.toHaveBeenCalled()
      process.exitCode = 0
    }
  })

  it('--kind mcp / http 用 --config → 本地拒(条件 flag 纪律)', async () => {
    for (const argv of [
      ['tool', 'mount', 'x', '--kind', 'mcp', '--url', 'https://u/mcp', '--config', 'a=b'],
      [
        'tool',
        'mount',
        'x',
        '--kind',
        'http',
        '--endpoint',
        'https://u',
        '--tools-file',
        'f.json',
        '--config',
        'a=b',
      ],
    ]) {
      const fn = captureFetch({})
      await runCli([...argv, ...base])
      expect(process.exitCode, argv[4]).not.toBe(0)
      expect(fn, argv[4]).not.toHaveBeenCalled()
      process.exitCode = 0
    }
  })
})

describe('tb ctx mount --config', () => {
  it('plugin provider 收 providerConfig', async () => {
    const fn = captureFetch({ path: 'ctx/notion', kind: 'context' })
    await runCli([
      'ctx',
      'mount',
      'ctx/notion',
      '--provider',
      'notion',
      '--auth-ref',
      'notion-key',
      '--config',
      'baseUrl=https://api.notion.com',
      ...base,
    ])
    expect(sentConfig(fn)).toMatchObject({
      kind: 'context',
      provider: 'notion',
      providerConfig: { baseUrl: 'https://api.notion.com' },
    })
  })

  it('r2 / s3 用 --config → 本地拒(它们的配置有专用 flag)', async () => {
    for (const argv of [
      ['ctx', 'mount', 'x', '--provider', 'r2', '--config', 'a=b'],
      [
        'ctx',
        'mount',
        'x',
        '--provider',
        's3',
        '--endpoint',
        'https://s3',
        '--bucket',
        'b',
        '--auth-ref',
        'r',
        '--config',
        'a=b',
      ],
    ]) {
      const fn = captureFetch({})
      await runCli([...argv, ...base])
      expect(process.exitCode, argv[4]).not.toBe(0)
      expect(fn, argv[4]).not.toHaveBeenCalled()
      process.exitCode = 0
    }
  })
})
