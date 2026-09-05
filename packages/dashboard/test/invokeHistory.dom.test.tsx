import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { clearHistory, historyScope } from '@/lib/history'
import { useHistory, useInvoke } from '@/lib/queries'
import { toolHref } from '@/lib/toolNavigation'

const profile = vi.hoisted(() => ({ id: 'history-test', baseUrl: 'https://gateway.example.test', sk: 'test-sk' }))
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ active: profile, revision: 1 }),
  useConn: () => ({ baseUrl: profile.baseUrl, sk: profile.sk }),
}))

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  })
})

afterEach(() => {
  cleanup()
  clearHistory(historyScope(profile))
  vi.unstubAllGlobals()
})

function hooks() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook(() => ({ invoke: useInvoke(), history: useHistory() }), { wrapper })
}

describe('最近使用保留声明入口身份', () => {
  it.each([200, 403])('HTTP %i 仍回到 help owner 与命令名，附加身份不进入 wire 或持久化字段', async (status) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(status === 200
      ? { ok: true }
      : {
          error: { code: 'permission_denied', message: 'Denied' },
        }), { status, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    const { result } = hooks()
    await act(async () => {
      await result.current.invoke.mutateAsync({
        commandPath: 'real/dispatch/execute',
        historyIdentity: { path: 'team/service', tool: 'run' },
        args: { token: 'private-argument' },
      }).catch(() => {})
    })
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gateway.example.test/real/dispatch/execute')
    expect(JSON.parse(String(init.body))).toEqual({ token: 'private-argument' })
    const record = result.current.history[0]!
    expect(record).toMatchObject({ path: 'team/service', tool: 'run', ok: status === 200 })
    expect(toolHref(record.path, record.tool)).toBe('/tools/team/service?tool=run')
    expect(Object.keys(record).sort()).toEqual((status === 200
      ? ['at', 'ms', 'ok', 'path', 'tool']
      : ['at', 'code', 'ms', 'ok', 'path', 'tool']).sort())
    const stored = localStorage.getItem(`tb.history.v2.${encodeURIComponent(historyScope(profile))}`)!
    expect(stored).not.toContain('private-argument')
    expect(stored).not.toContain('historyIdentity')
  })

  it('管理调用不传身份时沿用路径拆分，根命令身份也可明确记录', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })))
    const { result } = hooks()
    await act(async () => {
      await result.current.invoke.mutateAsync({ commandPath: 'system/registry/write', args: {} })
      await result.current.invoke.mutateAsync({ commandPath: 'dispatch/root', historyIdentity: { path: '', tool: 'root-command' }, args: {} })
    })
    expect(result.current.history).toMatchObject([
      { path: '', tool: 'root-command' },
      { path: 'system/registry', tool: 'write' },
    ])
  })
})
