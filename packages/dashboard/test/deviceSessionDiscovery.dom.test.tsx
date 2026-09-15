import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { HelpCmd } from '../src/lib/types'
import { SessionContext, type SessionState } from '../src/lib/session-context'
import { CommandWorkspace } from '../src/components/node/CommandWorkspace'
import { ToolPage } from '../src/pages/ToolPage'

const path = 'device/build/sessions/build'
// Matches real node-level help: no inputSchema or outputSchema in the index.
const cmds: HelpCmd[] = ['start', 'list', 'observe', 'stop'].map(name => ({ name, path: `/${path}/${name}`, method: 'POST', scope: 'call' }))
const index = { htbp: '0.1', node: { path, kind: 'tool', description: 'process sessions' }, cmds }
const detail = { ...index, cmds: [{ ...cmds[0], inputSchema: { type: 'object', properties: { expectedRuntimeId: { type: 'string' }, input: { type: 'object' } }, required: ['expectedRuntimeId'] } }] }
const state: SessionState = {
  active: { id: 'test', baseUrl: 'https://fixture.invalid', name: 'test', sk: 'test' },
  conn: { baseUrl: 'https://fixture.invalid', sk: 'test' },
  revision: 1, profiles: [], login: () => {}, logout: () => {}, removeProfile: () => {}, switchTo: () => {},
}

function mount(surface: 'page' | 'workspace', commands = cmds) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <SessionContext value={state}>
        <MemoryRouter initialEntries={[`/tools/${path}?tool=start`]}>
          {surface === 'page'
            ? <Routes><Route element={<ToolPage />} path="/tools/*" /></Routes>
            : <CommandWorkspace cmds={commands} lazySchema={false} path={path} />}
        </MemoryRouter>
      </SessionContext>
    </QueryClientProvider>,
  )
  return { view, client }
}

function fetcher(startHelp: unknown = detail, status = 200) {
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname === `/${path}/start/~help`) return Response.json(startHelp, { status })
    if (url.pathname === `/${path}/~help`) return Response.json(index)
    if (url.pathname === `/${path}/list`) return Response.json({ runtimeId: 'runtime', now: '2026-09-15T00:00:00.000Z', items: [] })
    throw new Error(`unexpected request: ${url.pathname}`)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('progressive process-session discovery through real SDK help parser', () => {
  it.each(['page', 'workspace'] as const)('%s hydrates only start detail from the schema-free command index', async (surface) => {
    const fn = fetcher()
    mount(surface)
    await screen.findByRole('region', { name: '设备进程会话' })
    await screen.findByText(/本页没有可见会话/)
    const helpUrls = fn.mock.calls.map(call => String(call[0])).filter(url => url.includes('~help'))
    expect(helpUrls).toContain(`https://fixture.invalid/${path}/start/~help`)
    expect(helpUrls.every(url => !url.includes('?') && !/\/(list|observe|stop)\/~help/.test(url))).toBe(true)
    expect(screen.queryByRole('button', { name: '调用', exact: true })).toBeNull()
  })

  it.each(['page', 'workspace'] as const)('%s does not identify a controller when detail loading fails', async (surface) => {
    fetcher({ code: 'unavailable', message: 'offline', retryable: false }, 503)
    const { client } = mount(surface)
    await waitFor(() => expect(client.getQueryState(['tb', 'test', 'https://fixture.invalid', 1, 'help', `${path}/start`])?.status).toBe('error'))
    expect(screen.queryByRole('region', { name: '设备进程会话' })).toBeNull()
  })

  it('similarly named commands without a required marker remain ordinary tools', async () => {
    fetcher({ ...detail, cmds: [{ ...detail.cmds[0], inputSchema: { type: 'object', properties: { expectedRuntimeId: { type: 'string' } } } }] })
    const { client } = mount('workspace')
    await waitFor(() => expect(client.getQueryState(['tb', 'test', 'https://fixture.invalid', 1, 'help', `${path}/start`])?.status).toBe('success'))
    expect(screen.getByRole('region', { name: '命令工作区' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: '设备进程会话' })).toBeNull()
  })

  it('ordinary command lists do not request start schema', () => {
    const fn = fetcher()
    mount('workspace', cmds.filter(cmd => cmd.name !== 'stop'))
    expect(fn).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: '设备进程会话' })).toBeNull()
  })
})
