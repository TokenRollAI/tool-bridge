import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFetch, setFetch } from '../src/http'
import { runCli } from './cliHarness'

const gateway = ['--base-url', 'https://events.test', '--sk', 'tbk_test_reader', '--json']
const event = {
  type: 'done', schemaVersion: 1, source: 'user:alice', recordedAt: '2026-01-01T00:00:00.000Z',
  data: { value: 1 }, cursor: 'c2', id: '54357651-7ee1-4654-a171-2ff7cc75da9c',
}
const page = { events: [event], nextCursor: 'c3', timedOut: false }
const result = (value: unknown) => Response.json(value)
const output = () => vi.mocked(process.stdout.write).mock.calls.map(call => String(call[0])).join('')

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

describe('event CLI', () => {
  it('wait pins its server-provided cursor across requests and takes one matching event', async () => {
    const inputs = []
    const fetcher = vi.fn().mockResolvedValueOnce(result({ events: [], timedOut: true, nextCursor: 'pinned' }))
      .mockResolvedValueOnce(result(page))
    setFetch(fetcher)
    await runCli([...gateway, 'wait', 'project/builds', '--type', 'done', '--timeout', '65s'])
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).toBe('https://events.test/project/builds/read')
      inputs.push(JSON.parse(String(init.body)))
    }
    expect(inputs).toEqual([{ type: 'done', limit: 1, waitMs: 30_000 }, { type: 'done', limit: 1, waitMs: 30_000, after: 'pinned' }])
    expect(JSON.parse(output())).toEqual(page)
  })

  it('returns a resumable timeout and a distinct exit status', async () => {
    setFetch(async () => result({ events: [], nextCursor: 'tail', timedOut: false }))
    await runCli(['wait', 'project/builds', '--timeout', '0s', ...gateway])
    expect(process.exitCode).toBe(2)
    expect(JSON.parse(output())).toEqual({ events: [], nextCursor: 'tail', timedOut: true })
  })

  it('streams only event lines and stops with the recovery cursor on a gap', async () => {
    const gap = { events: [], nextCursor: 'floor', timedOut: false, gap: { reason: 'retention', earliestCursor: 'floor' } }
    const fetcher = vi.fn().mockResolvedValueOnce(result(page)).mockResolvedValueOnce(result(gap))
    setFetch(fetcher)
    await runCli([...gateway, 'sub', 'project/builds', '--after', 'saved'])
    expect(JSON.parse(fetcher.mock.calls[1]![1].body).after).toBe('c3')
    expect(output().trim().split('\n').map(line => JSON.parse(line))).toEqual([event])
    expect(vi.mocked(process.stderr.write).mock.calls[0]?.[0]).toContain('earliestCursor')
    expect(process.exitCode).toBe(3)
  })

  it('keeps an HTTP failure off the subscription output, including in JSON mode', async () => {
    setFetch(async () => Response.json({ code: 'permission_denied', message: 'denied', retryable: false }, { status: 403 }))
    await runCli([...gateway, 'sub', 'private'])
    expect(process.exitCode).toBe(1)
    expect(output()).toBe('')
    expect(vi.mocked(process.stderr.write).mock.calls.map(c => c[0]).join('')).toContain('permission_denied')
  })
})
