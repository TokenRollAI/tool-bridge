import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import type { CatalogListItem } from '@/lib/types'

/**
 * 「添加工具」向导的真实渲染证据 + 可见分步挂载回归。用 catalog 里带单值凭证的
 * tavily 走一遍:选来源 → 选集成 → 填 key → 挂载 → 看到成功步骤。
 */

const TAVILY: CatalogListItem = {
  description: 'Tavily search',
  digest: 'd1',
  exportDetails: {
    actions: { auth: { kind: 'single', required: false }, id: 'actions', kind: 'tool' },
  },
  exports: ['actions'],
  id: 'tavily',
  nodeKinds: ['tool'],
}

const calls: Array<{ args: Record<string, unknown>, path: string, tool: string }> = []

vi.mock('@/lib/queries', () => ({
  useInvalidate: () => async () => {},
  useIntegrationCatalog: () => ({ data: [TAVILY] }),
  usePluginList: () => ({
    data: { items: [] },
    fetchNextPage: async () => {},
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
  useSecretList: () => ({ data: { items: [] }, hasNextPage: false }),
  useInvoke: () => ({
    isPending: false,
    mutateAsync: async (input: { args: Record<string, unknown>, path: string, tool: string }) => {
      calls.push(input)
      return { json: {} }
    },
  }),
  useOAuthAuthorize: () => ({ mutateAsync: async () => ({ status: 'authorized' }) }),
}))

vi.mock('sonner', () => ({ toast: { success: () => {}, info: () => {}, error: () => {} } }))

const { AddToolWizard } = await import('@/components/add-tool/AddToolWizard')

afterEach(() => {
  cleanup()
  calls.length = 0
  vi.restoreAllMocks()
})

describe('AddToolWizard 渲染与挂载', () => {
  it('打开后展示来源选择与常用集成预设', async () => {
    render(
      <MemoryRouter>
        <AddToolWizard trigger={<button type="button">开始</button>} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('开始'))
    // 来源卡片
    expect(await screen.findByText('内置集成')).toBeTruthy()
    expect(screen.getByText('MCP Server')).toBeTruthy()
    // tavily 在 catalog 里 → 常用集成预设应出现
    expect(screen.getByText('Tavily 搜索')).toBeTruthy()
  })

  it('选内置集成 → 选 tavily → 挂载,发出 registry write 且显示成功步骤', async () => {
    render(
      <MemoryRouter>
        <AddToolWizard trigger={<button type="button">开始</button>} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('开始'))
    fireEvent.click(await screen.findByText('内置集成'))

    // 配置步骤:搜索并选中 tavily
    const tavilyOption = await screen.findByText('tavily')
    fireEvent.click(tavilyOption)

    // 挂载并预检
    const mountBtn = await screen.findByRole('button', { name: /挂载并预检/ })
    fireEvent.click(mountBtn)

    // 单值凭证留空 = 不建 secret,只发一条 registry write
    await waitFor(() => {
      expect(calls.some(c => c.path === 'system/registry' && c.tool === 'write')).toBe(true)
    })
    // 可见步骤:挂载成功
    expect(await screen.findByText('tavily 挂载成功')).toBeTruthy()
    // 没有写 secret(单值留空)
    expect(calls.some(c => c.path === 'system/secret')).toBe(false)
  })

  it('预设直达:点 Tavily 搜索预设直接进配置步骤', async () => {
    render(
      <MemoryRouter>
        <AddToolWizard trigger={<button type="button">开始</button>} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('开始'))
    fireEvent.click(await screen.findByText('Tavily 搜索'))
    // 直接进入配置步骤:挂载路径预填 tools/tavily
    const pathInput = await screen.findByLabelText('挂载路径 *')
    expect((pathInput as HTMLInputElement).value).toBe('tools/tavily')
  })
})
