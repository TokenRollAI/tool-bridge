import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFetch, setFetch } from '../src/http'
import { runCli } from './cliHarness'

function written(stream: NodeJS.WriteStream): string {
  return (stream.write as unknown as ReturnType<typeof vi.fn>).mock.calls
    .map(call => String(call[0]))
    .join('')
}

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

describe('tb search', () => {
  it('POST /~search 并转发 compact discovery 选项', async () => {
    const fn = jsonFetch({ items: [], cursor: 'next' })
    await runCli([
      'search',
      '  calendar  ',
      '--mode',
      'keyword',
      '--limit',
      '25',
      '--cursor',
      'c1',
      '--federation',
      'recursive',
      '--matching',
      'best',
      '--min-coverage',
      '0.75',
      '--path-prefix',
      'home/home-assistant',
      '--effect',
      'read',
      '--effect=unknown',
      '--json',
      ...gateway,
    ])
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gw/~search')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'calendar',
      opts: {
        cursor: 'c1',
        detail: 'compact',
        effects: ['read', 'unknown'],
        federation: 'recursive',
        limit: 25,
        matching: 'best',
        minCoverage: 0.75,
        mode: 'keyword',
        pathPrefix: 'home/home-assistant',
      },
    })
    expect(JSON.parse(written(process.stdout))).toEqual({ items: [], cursor: 'next' })
  })

  it('人类输出分开节点与工具名，并展示命中覆盖证据', async () => {
    jsonFetch({
      items: [{
        path: 'work/calendar',
        relevance: {
          coverage: 0.75,
          matchedTermCount: 3,
          rankingVersion: 'keyword-v2',
          totalTermCount: 4,
        },
        source: { path: 'remotes/work' },
        tool: {
          name: 'calendar/create_event',
          description: 'Create a calendar event',
          effect: 'write',
          confirm: true,
        },
      }],
      cursor: 'c2',
    })
    await runCli(['search', 'calendar', ...gateway])
    const output = written(process.stdout)
    expect(output).toContain('work/calendar')
    expect(output).toContain('calendar/create_event')
    expect(output).not.toContain('work/calendar/calendar/create_event')
    expect(output).toContain('COVERAGE')
    expect(output).toContain('SOURCE')
    expect(output).toContain('remotes/work')
    expect(output).toContain('3/4')
    expect(output).toContain('write')
    expect(output).toContain('Create a calendar event')
    expect(output).toContain('next cursor: c2')
  })

  it('partial 状态写 stderr，JSON stdout 保持完整 federation evidence', async () => {
    const page = {
      items: [{
        path: 'remotes/work/calendar',
        relevance: {
          coverage: 1,
          matchedTermCount: 1,
          rankingVersion: 'keyword-v2',
          totalTermCount: 1,
        },
        source: { path: 'remotes/work' },
        tool: { name: 'list_events' },
      }],
      partial: true,
      sources: [
        { path: '', status: 'ok' },
        { path: 'remotes/work', status: 'timed_out' },
      ],
    }
    jsonFetch(page)

    await runCli(['search', 'calendar', '--json', ...gateway])

    expect(JSON.parse(written(process.stdout))).toEqual(page)
    expect(written(process.stderr)).toContain('warning: partial search results')
    expect(written(process.stderr)).toContain('remotes/work=timed_out')
    expect(written(process.stderr)).not.toContain('https://')
  })

  it('--schemas 在表格后逐工具附 inputSchema(省掉再跑 tb help 的往返)', async () => {
    const fn = jsonFetch({
      items: [
        {
          path: 'work/calendar',
          relevance: {
            coverage: 1,
            matchedTermCount: 1,
            rankingVersion: 'keyword-v2',
            totalTermCount: 1,
          },
          tool: {
            name: 'create_event',
            description: 'Create a calendar event',
            inputSchema: {
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
            },
          },
        },
        {
          path: 'work/calendar',
          relevance: {
            coverage: 1,
            matchedTermCount: 1,
            rankingVersion: 'keyword-v2',
            totalTermCount: 1,
          },
          tool: { name: 'list_events' },
        },
      ],
    })
    await runCli(['search', 'calendar', '--schemas', ...gateway])
    // full detail 仍在同一个 ~search 往返里返回 schema。
    expect(fn).toHaveBeenCalledTimes(1)
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'calendar',
      opts: { detail: 'full' },
    })
    const output = written(process.stdout)
    expect(output).toContain('work/calendar/create_event')
    expect(output).toContain('"required": [')
    expect(output).toContain('"title"')
    expect(output).toContain('work/calendar/list_events')
    expect(output).toContain('(no input schema)')
  })

  it('不带 --schemas 时人类模式只有表格,不打 schema', async () => {
    const fn = jsonFetch({
      items: [{
        path: 'work/calendar',
        relevance: {
          coverage: 1,
          matchedTermCount: 1,
          rankingVersion: 'keyword-v2',
          totalTermCount: 1,
        },
        tool: { name: 'create_event', inputSchema: { type: 'object' } },
      }],
    })
    await runCli(['search', 'calendar', ...gateway])
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'calendar',
      opts: { detail: 'compact' },
    })
    const output = written(process.stdout)
    expect(output).not.toContain('"type": "object"')
    expect(output).not.toContain('(no input schema)')
  })

  it('--schemas --json 请求 full 并把整页 spec 原样输出', async () => {
    const page = {
      items: [{
        path: 'work/calendar',
        relevance: {
          coverage: 1,
          matchedTermCount: 1,
          rankingVersion: 'keyword-v2' as const,
          totalTermCount: 1,
        },
        tool: { name: 'create_event', inputSchema: { type: 'object' } },
      }],
    }
    const fn = jsonFetch(page)
    await runCli(['search', 'calendar', '--schemas', '--json', ...gateway])
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'calendar',
      opts: { detail: 'full' },
    })
    expect(JSON.parse(written(process.stdout))).toEqual(page)
  })

  it('无结果时 --schemas 不追加任何段', async () => {
    jsonFetch({ items: [] })
    await runCli(['search', 'calendar', '--schemas', ...gateway])
    expect(written(process.stdout)).toBe('(no visible tools found)\n')
  })

  it('非法枚举、覆盖率、路径与 limit 都在请求前拒绝', async () => {
    const fn = jsonFetch({ items: [] })
    const invalidArgs = [
      ['--mode', 'regex'],
      ['--federation', 'direct'],
      ['--matching', 'any'],
      ['--effect', 'mutate'],
      ['--min-coverage', '0'],
      ['--min-coverage', '1.01'],
      ['--min-coverage', 'NaN'],
      ['--path-prefix', '   '],
      ['--limit', '201'],
      ['--matching', 'all', '--min-coverage', '0.75'],
    ]
    for (const args of invalidArgs) {
      process.exitCode = 0
      await runCli(['search', 'q', ...args, ...gateway])
      expect(process.exitCode).toBe(1)
    }
    expect(fn).not.toHaveBeenCalled()
  })
})
