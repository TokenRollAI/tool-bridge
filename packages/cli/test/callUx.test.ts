import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseCallArgs } from '../src/commands/call'
import { resetFetch, setFetch } from '../src/http'
import { resolveTarget } from '../src/args'
import { runCli } from './cliHarness'

/**
 * 本轮 Agent 体验修复的回归面:
 * - `tb call` 第二 positional 直接当 arguments JSON(误写 `--json '{...}'` 也自然工作);
 * - 失败现场的 ~feedback 提示(有条目列 top、无条目引导 submit、拉取失败静默);
 * - retryable 呈现与 `--timeout` 解析。
 */

/** 按调用序应答的 fetch mock(Error 项 → 抛出)。 */
function sequenceFetch(
  responses: Array<{ body: unknown, status?: number } | Error>,
): ReturnType<typeof vi.fn> {
  let i = 0
  const fn = vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)]
    i += 1
    if (r instanceof Error) throw r
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  setFetch(fn as unknown as typeof fetch)
  return fn
}

function written(stream: NodeJS.WriteStream): string {
  return (stream.write as unknown as ReturnType<typeof vi.fn>).mock.calls
    .map(c => String(c[0]))
    .join('')
}

const GLOBALS = ['--base-url', 'https://gw', '--sk', 'tbk_x']

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

describe('tb call — positional JSON arguments', () => {
  it('第二 positional 即 arguments 本体:tb call <tool> \'{...}\'', async () => {
    const fn = sequenceFetch([{ body: { ok: true } }])
    await runCli(['call', 'docs/ctx7/resolve', '{"libraryName":"react"}', '--json', ...GLOBALS])
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gw/docs/ctx7/resolve')
    expect(JSON.parse(init.body as string)).toEqual({ libraryName: 'react' })
    expect(process.exitCode).toBe(0)
  })

  it('误写形态 `--json \'{...}\'` 自然工作(--json 是输出开关,JSON 滑为 positional args)', async () => {
    const fn = sequenceFetch([{ body: { ok: true } }])
    await runCli(['call', 'docs/ctx7/resolve', '--json', '{"libraryName":"react"}', ...GLOBALS])
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ libraryName: 'react' })
    expect(process.exitCode).toBe(0)
  })

  it('positional 与 --args 同时给 → 互斥报错', async () => {
    sequenceFetch([{ body: { ok: true } }])
    await runCli([
      'call',
      'docs/ctx7/resolve',
      '{"a":1}',
      '--args',
      '{"b":2}',
      '--json',
      ...GLOBALS,
    ])
    expect(process.exitCode).toBe(1)
    expect(written(process.stdout)).toContain('mutually exclusive')
  })

  it('parseCallArgs 三源互斥;positional 优先级与 --args 等价', () => {
    expect(() => parseCallArgs('{}', undefined, '{}')).toThrow(/mutually exclusive/)
    expect(() => parseCallArgs(undefined, '/tmp/x.json', '{}')).toThrow(/mutually exclusive/)
    expect(parseCallArgs(undefined, undefined, '{"a":1}')).toEqual({ a: 1 })
  })
})

describe('tb call — 失败现场的 ~feedback 提示', () => {
  const upstreamDown = {
    body: { code: 'unavailable', message: 'upstream unavailable: timed out', retryable: true },
    status: 503,
  }

  it('上游错误且该 path 有 feedback → stderr 列 top 条目与下钻命令', async () => {
    const fn = sequenceFetch([
      upstreamDown,
      { body: { items: [{ id: 'fb_a1', title: 'index does not cover JSON content', score: 4 }] } },
    ])
    await runCli(['call', 'logs/sls/query', ...GLOBALS])
    expect(process.exitCode).toBe(1)
    // 第二请求打到该 path 的 ~feedback
    expect(String(fn.mock.calls[1]?.[0])).toBe('https://gw/logs/sls/query/~feedback')
    const stderr = written(process.stderr)
    expect(stderr).toContain('(retryable — try again)')
    expect(stderr).toContain('known pitfalls from other agents')
    expect(stderr).toContain('fb_a1 (+4) "index does not cover JSON content"')
    expect(stderr).toContain('tb feedback get logs/sls/query')
  })

  it('--json 模式:错误输出带 retryable 与结构化 feedback', async () => {
    sequenceFetch([
      upstreamDown,
      { body: { items: [{ id: 'fb_a1', title: 'known pitfall', score: 2 }] } },
    ])
    await runCli(['call', 'logs/sls/query', '--json', ...GLOBALS])
    expect(process.exitCode).toBe(1)
    const out = JSON.parse(written(process.stdout))
    expect(out).toMatchObject({
      ok: false,
      code: 'unavailable',
      retryable: true,
      feedback: [{ id: 'fb_a1', title: 'known pitfall', score: 2 }],
    })
  })

  it('无 feedback 条目 → 引导 submit(把踩坑经验留给下一个 agent)', async () => {
    sequenceFetch([upstreamDown, { body: { items: [] } }])
    await runCli(['call', 'logs/sls/query', ...GLOBALS])
    expect(process.exitCode).toBe(1)
    expect(written(process.stderr)).toContain('tb feedback submit logs/sls/query')
  })

  it('feedback 拉取失败 → 静默,主错误照常呈现', async () => {
    sequenceFetch([upstreamDown, new Error('boom')])
    await runCli(['call', 'logs/sls/query', ...GLOBALS])
    expect(process.exitCode).toBe(1)
    const stderr = written(process.stderr)
    expect(stderr).toContain('upstream unavailable: timed out')
    expect(stderr).not.toContain('boom')
  })

  it('permission_denied 不触发 feedback 查询(只有一次请求)', async () => {
    const fn = sequenceFetch([
      { body: { code: 'permission_denied', message: 'nope', retryable: false }, status: 403 },
    ])
    await runCli(['call', 'logs/sls/query', ...GLOBALS])
    expect(process.exitCode).toBe(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('--timeout 解析(resolveTarget)', () => {
  it('秒 → 毫秒;支持小数', () => {
    expect(resolveTarget({ baseUrl: 'https://gw', timeout: '30' }).timeoutMs).toBe(30_000)
    expect(resolveTarget({ baseUrl: 'https://gw', timeout: '2.5' }).timeoutMs).toBe(2500)
  })

  it('缺省 → timeoutMs undefined(http 层落默认 120s)', () => {
    expect(resolveTarget({ baseUrl: 'https://gw' }).timeoutMs).toBeUndefined()
  })

  it('非法值(非数字/0/负数)→ CliError', () => {
    for (const bad of ['abc', '0', '-5']) {
      expect(() => resolveTarget({ baseUrl: 'https://gw', timeout: bad })).toThrow(
        /invalid --timeout/,
      )
    }
  })

  it('命令行非法 --timeout → exit 1 且提示', async () => {
    sequenceFetch([{ body: { ok: true } }])
    await runCli(['call', 'docs/ctx7/resolve', '--timeout', 'abc', ...GLOBALS])
    expect(process.exitCode).toBe(1)
    expect(written(process.stderr)).toContain('invalid --timeout')
  })
})
