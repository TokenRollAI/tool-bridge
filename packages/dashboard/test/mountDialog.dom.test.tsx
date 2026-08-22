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

const calls: Array<{ args: Record<string, unknown>, path: string, tool: string }> = []

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
    mutateAsync: async (input: { args: Record<string, unknown>, path: string, tool: string }) => {
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
  await waitFor(() => expect(screen.getByLabelText('path *')).toBeDefined())

  fireEvent.click(screen.getAllByRole('combobox')[0]!)
  await waitFor(() => expect(screen.getByText('tool — plugin 工具源')).toBeDefined())
  fireEvent.click(screen.getByText('tool — plugin 工具源'))

  await waitFor(() => expect(screen.getByText('选择 plugin…')).toBeDefined())
  fireEvent.click(screen.getAllByRole('combobox')[1]!)
  await waitFor(() => expect(screen.getByText('amap')).toBeDefined())
  fireEvent.click(screen.getByText('amap'))
}

describe('高级挂载的内置凭证体验', () => {
  it('只显示 API key，提交时自动先保管凭证再挂载', async () => {
    await pickBuiltinTool()
    await waitFor(() => expect(screen.getByLabelText(/API key/)).toBeDefined())

    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).not.toContain('authRef')
    fireEvent.change(screen.getByLabelText('path *'), { target: { value: 'tools/amap' } })
    fireEvent.change(screen.getByLabelText('描述 *'), { target: { value: 'AMap' } })
    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: 'amap-key' } })
    fireEvent.click(screen.getByRole('button', { name: '挂载 tools/amap' }))

    await waitFor(() => expect(calls.length).toBe(2))
    expect(calls.map(call => `${call.path}:${call.tool}`)).toEqual([
      'system/secret:set',
      'system/registry:write',
    ])
    expect(calls[0]?.args).toEqual({ name: 'integration-tools%2Famap', value: 'amap-key' })
    expect(calls[1]?.args).toMatchObject({
      config: { provider: 'amap', authRef: 'integration-tools%2Famap' },
      path: 'tools/amap',
    })
  }, 15_000)
})
