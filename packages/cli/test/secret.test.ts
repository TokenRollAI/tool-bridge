import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { resetFetch, setFetch } from '../src/http'
import { runCli } from './cliHarness'

/**
 * `tb secret set` 的输入语义(统一后的公共实现:src/stdin.ts 与 args.parseFieldSpecs):
 * - stdin 凭证只去一个尾随换行(兼容 \r\n),不整体 trim;
 * - --field 重复 key 报错、允许空值、值不 trim。
 * integration add 走同一实现,语义在 integration.test.ts 里从它那侧再锁一遍。
 */

interface Call { body: { name?: string, value?: string }, url: string }

function captureFetch(): Call[] {
  const calls: Call[] = []
  setFetch((async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body === undefined ? {} : JSON.parse(String(init.body)) })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch)
  return calls
}

/** 临时把 process.stdin 换成给定内容的可读流(plugin.test.ts 同款)。 */
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

const base = ['--json', '--base-url', 'https://gw', '--sk', 'tbk_x']

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

describe('tb secret set — stdin 凭证语义', () => {
  it.each([
    // [stdin 输入, 落库 value]:只剥一个尾随换行,首尾空格与更早的换行保留。
    [' p@ss \n', ' p@ss '],
    ['p@ss\r\n', 'p@ss'],
    ['p@ss\n\n', 'p@ss\n'],
  ])('stdin %j → value %j', async (input, expected) => {
    const restore = withStdin(input)
    try {
      const calls = captureFetch()
      await runCli(['secret', 'set', '--name', 's1', ...base])
      expect(process.exitCode).toBe(0)
      expect(calls[0]?.url).toBe('https://gw/system/secret/set')
      expect(calls[0]?.body.value).toBe(expected)
    } finally {
      restore()
    }
  })
})

describe('tb secret set — --field 解析', () => {
  it('重复 key → 本地拒,不发请求', async () => {
    const calls = captureFetch()
    await runCli(['secret', 'set', '--name', 's1', '--field', 'a=1', '--field', 'a=2', ...base])
    expect(process.exitCode).not.toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('允许空值且值不 trim', async () => {
    const calls = captureFetch()
    await runCli(['secret', 'set', '--name', 's1', '--field', 'a=', '--field', 'b= x ', ...base])
    expect(process.exitCode).toBe(0)
    expect(JSON.parse(calls[0]?.body.value ?? '')).toEqual({ a: '', b: ' x ' })
  })
})
