import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFetch, setFetch } from '../src/http'
import { runCli } from './cliHarness'

const path = 'device/build/sessions/build'
const gateway = ['--base-url', 'https://gw', '--sk', 'tbk_admin']
const summary = {
  sessionId: 'runtime:session', runtimeId: 'runtime', requestId: 'original-request',
  state: 'running', startedAt: '2026-09-15T00:00:00.000Z',
}
const list = { runtimeId: 'runtime', now: summary.startedAt, items: [summary] }
const help = { htbp: '0.1', node: { path, kind: 'tool', description: '' }, cmds: ['start', 'list', 'observe', 'stop'].map(name => ({ name, path: `${path}/${name}`, scope: 'call', effect: 'write', method: 'POST' })) }
const output = () => vi.mocked(process.stdout.write).mock.calls.map(call => String(call[0])).join('')

function transport(handler: (url: string, body: Record<string, unknown>, signal?: AbortSignal | null) => unknown | Promise<unknown>) {
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify(await handler(String(url), JSON.parse(String(init?.body ?? '{}')), init?.signal)), { headers: { 'content-type': 'application/json' } }))
  setFetch(fetcher as typeof fetch)
  return fetcher
}

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

describe('device process session CLI', () => {
  it('start uses device time and generation and sends the bound input once', async () => {
    const fetcher = transport((url, body) => {
      if (url.endsWith('/~help')) return help
      if (url.endsWith('/list')) return list
      return { ...summary, requestId: body.requestId }
    })
    await runCli(['device', 'session', 'start', path, '--arg', 'message=hello', '--run-timeout', '90000', '--json', ...gateway])
    expect(process.exitCode).toBe(0)
    const [, init] = fetcher.mock.calls[2]!
    expect(JSON.parse(String(init?.body))).toEqual({ input: { message: 'hello' }, requestId: expect.any(String), expectedRuntimeId: 'runtime', startBefore: '2026-09-15T00:01:00.000Z', timeoutMs: 90_000 })
    expect(JSON.parse(output()).sessionId).toBe(summary.sessionId)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('lost start response retains its original request id and never retries', async () => {
    let requestId = ''
    const fetcher = transport((url, body) => {
      if (url.endsWith('/~help')) return help
      if (url.endsWith('/list')) return list
      requestId = String(body.requestId)
      throw new TypeError('network disconnected')
    })
    await runCli(['device', 'session', 'start', path, '--json', ...gateway])
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(JSON.parse(output())).toMatchObject({ ok: false, outcome: 'unknown', hint: expect.stringContaining(`--request-id ${requestId}`) })
    expect(process.exitCode).toBe(1)
  })

  it('follow advances independent cursors and drains terminal buffered output as JSON lines', async () => {
    const cursors: unknown[] = []
    transport((_url, body) => {
      cursors.push(body.cursor)
      return { ...summary, state: 'exited', exitCode: 3, chunks: body.cursor === 0 ? [{ seq: 1, stream: 'stderr', text: 'failure' }] : [], nextCursor: 1, gap: body.cursor === 0, droppedBytes: 12 }
    })
    await runCli(['device', 'session', 'observe', path, summary.sessionId, '--follow', '--json', ...gateway])
    expect(cursors).toEqual([0, 1])
    expect(output().trim().split('\n').map(line => JSON.parse(line))).toEqual([
      expect.objectContaining({ state: 'exited', exitCode: 3, gap: true }),
      expect.objectContaining({ nextCursor: 1, chunks: [] }),
    ])
  })

  it('Ctrl-C aborts only the current observer and removes its signal listener', async () => {
    const before = process.listenerCount('SIGINT')
    const fetcher = transport(async (_url, _body, signal) => await new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      queueMicrotask(() => process.emit('SIGINT'))
    }))
    await runCli(['device', 'session', 'observe', path, summary.sessionId, '--follow', ...gateway])
    expect(fetcher).toHaveBeenCalledOnce()
    expect(String(fetcher.mock.calls[0]?.[0])).toMatch(/\/observe$/)
    expect(process.listenerCount('SIGINT')).toBe(before)
    expect(process.exitCode).toBe(0)
  })

  it('renders VT-free logs and accurately reports a pending stop', async () => {
    transport(url => url.endsWith('/~help') ? help : { ...summary, state: 'stopping' })
    await runCli(['device', 'session', 'stop', path, summary.sessionId, ...gateway])
    expect(output()).toContain('exit not yet confirmed')
    vi.mocked(process.stdout.write).mockClear()
    transport(() => ({ ...summary, chunks: [{ seq: 1, stream: 'stdout', text: '\u001b[31mhello\u001b[0m' }], nextCursor: 1, gap: false, droppedBytes: 0 }))
    await runCli(['device', 'session', 'observe', path, summary.sessionId, ...gateway])
    expect(output()).toContain('hello')
    expect(output()).not.toContain('\u001b')
  })

  it.each([
    ['list', path, '--state', 'unknown'],
    ['observe', path, summary.sessionId, '--cursor', '-1'],
    ['observe', path, summary.sessionId, '--wait', '20001'],
    ['observe', path, summary.sessionId, '--follow', '--wait', '0'],
    ['observe', path, summary.sessionId, '--limit-bytes', '262145'],
    ['observe', path, summary.sessionId, '--limit-bytes', '1'],
    ['observe', path, summary.sessionId, '--limit-bytes', '2'],
    ['observe', path, summary.sessionId, '--limit-bytes', '3'],
    ['start', path, '--args', '[]'],
    ['start', path, '--run-timeout', '0'],
    ['stop', path, summary.sessionId, 'extra'],
    ['list', path, '--unknown'],
  ])('rejects invalid arguments before requests: %j', async (...args) => {
    const fetcher = transport(() => list)
    await runCli(['device', 'session', ...args, ...gateway])
    expect(process.exitCode).toBe(1)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('forwards filters and does not describe an empty cursor page as no sessions globally', async () => {
    const fetcher = transport(() => ({ ...list, items: [], cursor: 'next-page' }))
    await runCli(['device', 'session', 'list', path, '--request-id', 'recover', '--state', 'running', '--limit', '2', ...gateway])
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ requestId: 'recover', state: 'running', limit: 2 })
    expect(output()).toContain('next cursor: next-page')
    expect(output()).toContain('does not prove a command never ran')
  })

  it('rejects malformed successful responses instead of inventing session state', async () => {
    transport(() => ({ sessionId: 'incomplete' }))
    await runCli(['device', 'session', 'observe', path, summary.sessionId, '--json', ...gateway])
    expect(JSON.parse(output())).toMatchObject({ ok: false, kind: 'protocol', outcome: 'unknown' })
  })
})
