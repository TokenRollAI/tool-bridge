import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgEntries, parseCallArgs } from '../src/commands/call'
import { resetFetch, setFetch } from '../src/http'
import { resolveTarget } from '../src/args'
import { runCli } from './cliHarness'

/**
 * `--args-file -` 走 stdin 唯一底层实现(process.stdin 异步迭代,见 src/stdin.ts),
 * 测试用临时替换 process.stdin 的方式注入内容(plugin.test.ts 同款)。
 */
function withStdin(content: string): () => void {
  const original = process.stdin
  Object.defineProperty(process, 'stdin', {
    value: Readable.from([Buffer.from(content, 'utf8')]),
    configurable: true,
  })
  return () => {
    Object.defineProperty(process, 'stdin', { value: original, configurable: true })
  }
}

/**
 * 本轮 Agent 体验修复的回归面:
 * - `tb call` 第二 positional 直接当 arguments JSON(误写 `--json '{...}'` 也自然工作);
 * - `--arg k=v` 扁平标量与 `--args-file -`(stdin)两条便利入口,及与整块 JSON 的四源互斥;
 * - 失败现场的 ~feedback 提示(有条目列 top、无条目不加提示、拉取失败静默);
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

  it('parseCallArgs 三源互斥;positional 优先级与 --args 等价', async () => {
    await expect(parseCallArgs('{}', undefined, '{}')).rejects.toThrow(/mutually exclusive/)
    await expect(parseCallArgs(undefined, '/tmp/x.json', '{}')).rejects.toThrow(/mutually exclusive/)
    expect(await parseCallArgs(undefined, undefined, '{"a":1}')).toEqual({ a: 1 })
  })
})

describe('tb call — --arg k=v 扁平参数', () => {
  it('多个 --arg 合并为 arguments;标量按保守规则定型', async () => {
    const fn = sequenceFetch([{ body: { ok: true } }])
    await runCli([
      'call',
      'docs/ctx7/resolve',
      '--arg',
      'name=react',
      '--arg',
      'limit=5',
      '--json',
      ...GLOBALS,
    ])
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ name: 'react', limit: 5 })
    expect(process.exitCode).toBe(0)
  })

  it('`--arg=k=v` 形式同样收集', async () => {
    const fn = sequenceFetch([{ body: { ok: true } }])
    await runCli(['call', 'docs/ctx7/resolve', '--arg=name=react', '--json', ...GLOBALS])
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ name: 'react' })
  })

  it('保守标量解析:true/false/null/整数/小数定型,其余保持 string', () => {
    expect(
      parseArgEntries([
        'yes=true',
        'no=false',
        'nothing=null',
        'count=5',
        'ratio=-1.5',
        'text=react',
        'version=1.2.3',
        'plus=+5',
        'exp=1e3',
        'hex=0x10',
        'padded= 42',
        'empty=',
      ]),
    ).toEqual({
      yes: true,
      no: false,
      nothing: null,
      count: 5,
      ratio: -1.5,
      text: 'react',
      // 多段点号、正号前缀、指数与十六进制都不是"纯整数/小数",保持 string。
      version: '1.2.3',
      plus: '+5',
      exp: '1e3',
      hex: '0x10',
      // value 不 trim:带空白就不再是纯数字字面量。
      padded: ' 42',
      empty: '',
    })
  })

  it('value 可含 `=`(只按第一个 `=` 切分)', () => {
    expect(parseArgEntries(['q=a=b=c', 'token=YWJj=='])).toEqual({ q: 'a=b=c', token: 'YWJj==' })
  })

  it('重复 key 后者覆盖前者', () => {
    expect(parseArgEntries(['n=1', 'n=2', 'n=last'])).toEqual({ n: 'last' })
  })

  it('缺 `=` 或空 key → CliError', () => {
    expect(() => parseArgEntries(['bare'])).toThrow(/expected "key=value"/)
    expect(() => parseArgEntries(['=v'])).toThrow(/empty key/)
    expect(() => parseArgEntries(['   =v'])).toThrow(/empty key/)
  })

  it('--arg 与 positional / --args / --args-file 互斥', async () => {
    await expect(parseCallArgs(undefined, undefined, '{"a":1}', ['b=2'])).rejects.toThrow(
      /mutually exclusive/,
    )
    await expect(parseCallArgs('{"a":1}', undefined, undefined, ['b=2'])).rejects.toThrow(
      /mutually exclusive/,
    )
    await expect(parseCallArgs(undefined, '/tmp/x.json', undefined, ['b=2'])).rejects.toThrow(
      /mutually exclusive/,
    )
  })

  it('命令行 --arg 与 --args 同时给 → exit 1 且提示互斥', async () => {
    sequenceFetch([{ body: { ok: true } }])
    await runCli([
      'call',
      'docs/ctx7/resolve',
      '--args',
      '{"a":1}',
      '--arg',
      'b=2',
      '--json',
      ...GLOBALS,
    ])
    expect(process.exitCode).toBe(1)
    expect(written(process.stdout)).toContain('mutually exclusive')
  })

  it('无 --arg 时不影响缺省 {}', async () => {
    expect(await parseCallArgs(undefined, undefined, undefined, [])).toEqual({})
  })
})

describe('tb call — --args-file', () => {
  let tmp: string
  const wasTTY = process.stdin.isTTY

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tb-call-args-'))
    // 管道场景:isTTY 为假才允许 `--args-file -`。
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
    Object.defineProperty(process.stdin, 'isTTY', { value: wasTTY, configurable: true })
  })

  it('`-` → 从 stdin 读整块 JSON', async () => {
    const restore = withStdin('{"libraryName":"react"}\n')
    try {
      const fn = sequenceFetch([{ body: { ok: true } }])
      await runCli(['call', 'docs/ctx7/resolve', '--args-file', '-', '--json', ...GLOBALS])
      const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
      expect(JSON.parse(init.body as string)).toEqual({ libraryName: 'react' })
      expect(process.exitCode).toBe(0)
    } finally {
      restore()
    }
  })

  it('stdin 为空 → 沿用"空 → {}"语义', async () => {
    const restore = withStdin('\n  \n')
    try {
      expect(await parseCallArgs(undefined, '-')).toEqual({})
    } finally {
      restore()
    }
  })

  it('stdin 非法 JSON → arguments must be valid JSON', async () => {
    const restore = withStdin('not-json')
    try {
      await expect(parseCallArgs(undefined, '-')).rejects.toThrow(/arguments must be valid JSON/)
    } finally {
      restore()
    }
  })

  it('stdin 是 TTY(没接管道)→ 直接拒绝而不是挂住', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    await expect(parseCallArgs(undefined, '-')).rejects.toThrow(/pipe the arguments JSON via stdin/)
  })

  it('普通文件路径不受 `-` 分支影响', async () => {
    const file = join(tmp, 'args.json')
    writeFileSync(file, '{"a":1}')
    expect(await parseCallArgs(undefined, file)).toEqual({ a: 1 })
    await expect(parseCallArgs(undefined, join(tmp, 'missing.json'))).rejects.toThrow(
      /cannot read --args-file/,
    )
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
      { body: { items: [{
        id: 'fb_a1',
        title: 'index does not cover JSON content',
        score: 4,
        at: '2026-08-25T00:00:00.000Z',
        by: 'agent:test',
        up: 4,
        down: 0,
      }] } },
    ])
    await runCli(['call', 'logs/sls/query', ...GLOBALS])
    expect(process.exitCode).toBe(1)
    // 第二请求打到该 path 的 ~feedback
    expect(String(fn.mock.calls[1]?.[0])).toBe('https://gw/logs/sls/query/~feedback')
    const stderr = written(process.stderr)
    expect(stderr).toContain('retryable: yes')
    expect(stderr).not.toContain('try again')
    expect(stderr).toContain('known pitfalls from other agents')
    expect(stderr).toContain('fb_a1 (+4) "index does not cover JSON content"')
    expect(stderr).toContain('tb feedback get logs/sls/query')
  })

  it('--json 模式:错误输出带 retryable 与结构化 feedback', async () => {
    sequenceFetch([
      upstreamDown,
      { body: { items: [{
        id: 'fb_a1',
        title: 'known pitfall',
        score: 2,
        at: '2026-08-25T00:00:00.000Z',
        by: 'agent:test',
        up: 2,
        down: 0,
      }] } },
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

  it('无 feedback 条目 → 只保留实际错误，不追加无助于理解结果的提交提示', async () => {
    sequenceFetch([upstreamDown, { body: { items: [] } }])
    await runCli(['call', 'logs/sls/query', ...GLOBALS])
    expect(process.exitCode).toBe(1)
    expect(written(process.stderr)).toContain('upstream unavailable: timed out')
    expect(written(process.stderr)).not.toContain('hint:')
    expect(written(process.stderr)).not.toContain('tb feedback submit')
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
  it.each([false, true])('lost response after call stays unknown and never retries (json=%s)', async (asJson) => {
    const fetcher = sequenceFetch([new Error('connection lost after dispatch'), { body: { items: [] } }])
    await runCli(['call', 'tools/mail/send', ...(asJson ? ['--json'] : []), ...GLOBALS])
    const output = written(asJson ? process.stdout : process.stderr)
    expect(output).toContain('outcome is unknown')
    expect(output).not.toContain('try again')
    expect(output).not.toContain('connection lost after dispatch')
    if (asJson) {
      const result = JSON.parse(output)
      expect(result).toMatchObject({ ok: false, code: 'unavailable', kind: 'network', outcome: 'unknown' })
      expect(result).not.toHaveProperty('retryable')
      expect(written(process.stderr)).toBe('')
    } else expect(written(process.stdout)).toBe('')
    expect(fetcher.mock.calls.filter(call => String(call[0]) === 'https://gw/tools/mail/send')).toHaveLength(1)
    expect(process.exitCode).toBe(1)
  })

  it('秒 → 毫秒;支持小数', () => {
    expect(resolveTarget({ baseUrl: 'https://gw', timeout: '30' }).timeoutMs).toBe(30_000)
    expect(resolveTarget({ baseUrl: 'https://gw', timeout: '2.5' }).timeoutMs).toBe(2500)
  })

  it('缺省 → timeoutMs undefined(http 层落默认 120s)', () => {
    expect(resolveTarget({ baseUrl: 'https://gw' }).timeoutMs).toBeUndefined()
  })

  it('非法值(非数字/0/负数/超过一天)→ CliError', () => {
    for (const bad of ['abc', '0', '-5', '86401']) {
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
