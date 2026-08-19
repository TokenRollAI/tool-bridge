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
  it('POST /~search 并把 mode/limit/cursor 放入 opts', async () => {
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
      '--json',
      ...gateway,
    ])
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gw/~search')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'calendar',
      opts: { mode: 'keyword', limit: 25, cursor: 'c1' },
    })
    expect(JSON.parse(written(process.stdout))).toEqual({ items: [], cursor: 'next' })
  })

  it('人类输出分开节点与工具名，并给出下一页 cursor', async () => {
    jsonFetch({
      items: [{
        path: 'work/calendar',
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
    expect(output).toContain('Create a calendar event')
    expect(output).toContain('next cursor: c2')
  })

  it('--schemas 在表格后逐工具附 inputSchema(省掉再跑 tb help 的往返)', async () => {
    const fn = jsonFetch({
      items: [
        {
          path: 'work/calendar',
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
        { path: 'work/calendar', tool: { name: 'list_events' } },
      ],
    })
    await runCli(['search', 'calendar', '--schemas', ...gateway])
    // 渲染开关而已:schema 已在同一个 ~search 响应里,不额外请求。
    expect(fn).toHaveBeenCalledTimes(1)
    const output = written(process.stdout)
    expect(output).toContain('work/calendar/create_event')
    expect(output).toContain('"required": [')
    expect(output).toContain('"title"')
    expect(output).toContain('work/calendar/list_events')
    expect(output).toContain('(no input schema)')
  })

  it('不带 --schemas 时人类模式只有表格,不打 schema', async () => {
    jsonFetch({
      items: [{
        path: 'work/calendar',
        tool: { name: 'create_event', inputSchema: { type: 'object' } },
      }],
    })
    await runCli(['search', 'calendar', ...gateway])
    const output = written(process.stdout)
    expect(output).not.toContain('"type": "object"')
    expect(output).not.toContain('(no input schema)')
  })

  it('--json 不受 --schemas 影响:整页 spec 原样输出', async () => {
    const page = {
      items: [{ path: 'work/calendar', tool: { name: 'create_event', inputSchema: { type: 'object' } } }],
    }
    jsonFetch(page)
    await runCli(['search', 'calendar', '--schemas', '--json', ...gateway])
    expect(JSON.parse(written(process.stdout))).toEqual(page)
  })

  it('无结果时 --schemas 不追加任何段', async () => {
    jsonFetch({ items: [] })
    await runCli(['search', 'calendar', '--schemas', ...gateway])
    expect(written(process.stdout)).toBe('(no visible tools found)\n')
  })

  it('非法 mode 与越界 limit 在请求前拒绝', async () => {
    const fn = jsonFetch({ items: [] })
    await runCli(['search', 'q', '--mode', 'regex', ...gateway])
    expect(process.exitCode).toBe(1)
    expect(fn).not.toHaveBeenCalled()

    process.exitCode = 0
    await runCli(['search', 'q', '--limit', '201', ...gateway])
    expect(process.exitCode).toBe(1)
    expect(fn).not.toHaveBeenCalled()
  })
})
