import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFetch, setFetch } from '../src/http'
import { runCli } from './cliHarness'

function stdout(): string {
  return vi.mocked(process.stdout.write).mock.calls.map(call => String(call[0])).join('')
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

describe('status result meaning', () => {
  it.each([
    { body: { healthy: true, version: 'test' }, status: 200, healthy: true, exit: 0 },
    { body: { healthy: false }, status: 200, healthy: false, exit: 1 },
    { body: { healthy: false }, status: 503, healthy: false, exit: 1 },
    { body: { healthy: true }, status: 503, healthy: false, exit: 1 },
    { body: {}, status: 200, healthy: null, exit: 1 },
    { body: { healthy: 'true' }, status: 200, healthy: null, exit: 1 },
    { body: 'not JSON', status: 200, healthy: null, exit: 1 },
  ])('HTTP $status / $body reports health independently from HTTP success', async ({ body, status, healthy, exit }) => {
    const fetcher = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
    setFetch(fetcher as typeof fetch)
    await runCli(['status', '--base-url', 'https://gw', '--json'])
    expect(JSON.parse(stdout())).toMatchObject({
      ok: exit === 0,
      httpOk: status >= 200 && status < 300,
      status,
      healthy,
      body,
    })
    expect(process.exitCode).toBe(exit)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(vi.mocked(process.stderr.write)).not.toHaveBeenCalled()
  })

  it('human output distinguishes unknown health from unhealthy', async () => {
    setFetch(vi.fn(async () => new Response('{}')) as typeof fetch)
    await runCli(['status', '--base-url', 'https://gw'])
    expect(stdout()).toContain('http:     200')
    expect(stdout()).toContain('health:   unknown')
    expect(stdout()).not.toContain('unhealthy')
    expect(process.exitCode).toBe(1)
  })
})
