import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import type { CatalogListItem } from '@/lib/types'

const AMAP: CatalogListItem = {
  description: 'AMap',
  digest: 'd1',
  exportDetails: {
    actions: {
      auth: { kind: 'single', required: true },
      id: 'actions',
      kind: 'tool',
    },
  },
  exports: ['actions'],
  id: 'amap',
  nodeKinds: ['tool'],
}

const calls: Array<{ args: Record<string, unknown>, commandPath: string }> = []

vi.stubGlobal('ResizeObserver', class {
  disconnect() {}
  observe() {}
  unobserve() {}
})

vi.mock('@/lib/queries', () => ({
  useInvalidate: () => () => {},
  useIntegrationCatalog: () => ({ data: [AMAP] }),
  usePluginList: () => ({
    data: { items: [] },
    fetchNextPage: async () => {},
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
  useSecretList: () => ({ data: { items: [{ name: 'shared-key' }] }, hasNextPage: false }),
  useInvoke: () => ({
    isPending: false,
    mutateAsync: async (input: { args: Record<string, unknown>, commandPath: string }) => {
      calls.push(input)
      return { json: {} }
    },
  }),
  useOAuthAuthorize: () => ({ mutate: () => {} }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}))

vi.mock('sonner', () => ({ toast: { success: () => {}, info: () => {}, error: () => {} } }))

const { MountDialog } = await import('@/pages/system/forms/MountDialog')

afterEach(() => {
  cleanup()
  calls.length = 0
  vi.restoreAllMocks()
})

async function pickBuiltinTool(): Promise<void> {
  render(
    <MemoryRouter>
      <MountDialog existingPaths={[]} />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: /挂载节点/ }))
  await waitFor(() => expect(screen.getByLabelText(/^path.*\*$/)).toBeDefined())

  fireEvent.click(screen.getByRole('button', { name: 'mcp — MCP server' }))
  await waitFor(() => expect(screen.getByText('tool — plugin 工具源')).toBeDefined())
  fireEvent.click(screen.getByText('tool — plugin 工具源'))

  await waitFor(() => expect(screen.getByText('选择 plugin…')).toBeDefined())
  fireEvent.click(screen.getAllByRole('combobox')[0]!)
  await waitFor(() => expect(screen.getByText('amap')).toBeDefined())
  fireEvent.click(screen.getByText('amap'))
}

describe('高级挂载的内置凭证体验', () => {
  it('只显示 API key，提交时自动先保管凭证再挂载', async () => {
    await pickBuiltinTool()
    await waitFor(() => expect(screen.getByLabelText(/API key/)).toBeDefined())

    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).not.toContain('authRef')
    fireEvent.change(screen.getByLabelText(/^path.*\*$/), { target: { value: 'tools/amap' } })
    fireEvent.change(screen.getByLabelText(/^描述.*\*$/), { target: { value: 'AMap' } })
    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: 'amap-key' } })
    fireEvent.click(screen.getByRole('button', { name: '挂载 tools/amap' }))

    await waitFor(() => expect(calls.length).toBe(2))
    expect(calls.map(call => call.commandPath)).toEqual([
      'system/secret/set',
      'system/registry/write',
    ])
    expect(calls[0]?.args).toEqual({ name: 'integration-tools%2Famap', value: 'amap-key' })
    expect(calls[1]?.args).toMatchObject({
      config: { provider: 'amap', authRef: 'integration-tools%2Famap' },
      path: 'tools/amap',
    })
  }, 15_000)

  it('schema 驱动的 MCP 字段保留条件认证与最终 wire 形状', async () => {
    render(
      <MemoryRouter>
        <MountDialog existingPaths={[]} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /挂载节点/ }))
    fireEvent.change(await screen.findByLabelText(/^path.*\*$/), {
      target: { value: 'providers/mcp' },
    })
    fireEvent.change(screen.getByLabelText(/^描述.*\*$/), { target: { value: 'MCP' } })
    fireEvent.change(screen.getByLabelText(/^url.*\*$/), {
      target: { value: 'https://mcp.example.com/mcp' },
    })

    fireEvent.click(screen.getByRole('button', { name: '无（公开上游）' }))
    fireEvent.click(await screen.findByText('authRef — 静态凭证'))
    fireEvent.change(await screen.findByLabelText(/^authRef.*\*$/), {
      target: { value: 'mcp-token' },
    })
    fireEvent.change(screen.getByLabelText('静态 headers（每行 Name=value）'), {
      target: { value: 'X-Tenant=alpha' },
    })
    fireEvent.click(screen.getByRole('button', { name: '挂载 providers/mcp' }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({
      commandPath: 'system/registry/write',
      args: {
        path: 'providers/mcp',
        config: {
          kind: 'mcp',
          url: 'https://mcp.example.com/mcp',
          authRef: 'mcp-token',
          headers: { 'X-Tenant': 'alpha' },
        },
      },
    })
  }, 15_000)
})
