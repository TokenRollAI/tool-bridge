import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFetch, setFetch } from '../src/http'
import { runCli } from './cliHarness'

function jsonFetch(body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
  setFetch(fn as unknown as typeof fetch)
  return fn
}

const gateway = ['--base-url', 'https://gw', '--sk', 'tbk_admin']

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

describe('tb help --schemas', () => {
  it('默认不带 schemas 查询参数', async () => {
    const fn = jsonFetch({ htbp: '0.1', node: { path: 'docs', kind: 'mcp', description: '' }, cmds: [] })
    await runCli(['help', 'docs', '--json', ...gateway])
    const [url] = fn.mock.calls[0] as unknown as [string]
    expect(url).toBe('https://gw/docs/~help')
  })

  it('--schemas 追加 ?schemas=1(内联全量 schema,省掉逐工具下钻)', async () => {
    const fn = jsonFetch({ htbp: '0.1', node: { path: 'docs', kind: 'mcp', description: '' }, cmds: [] })
    await runCli(['help', 'docs', '--schemas', '--json', ...gateway])
    const [url] = fn.mock.calls[0] as unknown as [string]
    expect(url).toBe('https://gw/docs/~help?schemas=1')
  })

  it('--schemas 对 DSL 表现同样生效', async () => {
    const fn = vi.fn(async () => new Response('htbp 0.1\nnode docs mcp ""', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }))
    setFetch(fn as unknown as typeof fetch)
    await runCli(['help', 'docs', '--dsl', '--schemas', ...gateway])
    const [url] = fn.mock.calls[0] as unknown as [string]
    expect(url).toBe('https://gw/docs/~help?schemas=1')
  })
})
