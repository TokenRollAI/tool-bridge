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

const authorize = vi.hoisted(() => vi.fn(async (): Promise<{ authorizationUrl?: string, status: string }> => ({ status: 'authorized' })))

const calls: Array<{ args: Record<string, unknown>, commandPath: string }> = []

vi.stubGlobal('ResizeObserver', class {
  disconnect() {}
  observe() {}
  unobserve() {}
})

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
    mutateAsync: async (input: { args: Record<string, unknown>, commandPath: string }) => {
      calls.push(input)
      return { json: {} }
    },
  }),
  useOAuthAuthorize: () => ({ mutateAsync: authorize }),
}))

vi.mock('sonner', () => ({ toast: { success: () => {}, info: () => {}, error: () => {} } }))

await import('@/components/SchemaFormRenderer')
const { AddToolWizard } = await import('@/components/add-tool/AddToolWizard')

afterEach(() => {
  cleanup()
  calls.length = 0
  authorize.mockClear()
  vi.restoreAllMocks()
})

describe('AddToolWizard 渲染与挂载', () => {
  it('受控入口无默认按钮，关闭请求由调用方接收，重新打开回到来源', async () => {
    const onOpenChange = vi.fn()
    const view = (open: boolean) => (
      <MemoryRouter><AddToolWizard onOpenChange={onOpenChange} open={open} trigger={null} /></MemoryRouter>
    )
    const { rerender } = render(view(true))
    expect(screen.queryByRole('button', { name: '添加工具' })).toBeNull()
    fireEvent.click(await screen.findByText('Tavily 搜索'))
    expect(await screen.findByLabelText('挂载路径 *')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    rerender(view(false))
    rerender(view(true))
    expect(await screen.findByText('选择来源')).toBeTruthy()
  })

  it('自定义 MCP 添加后进入统一完成页，查看工具关闭向导', async () => {
    render(<MemoryRouter><AddToolWizard /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '添加工具' }))
    fireEvent.click(await screen.findByText('MCP Server'))
    fireEvent.change(await screen.findByLabelText(/^path.*\*$/), { target: { value: 'tools/mcp' } })
    fireEvent.change(screen.getByLabelText(/^描述.*\*$/), { target: { value: 'MCP tools' } })
    fireEvent.change(screen.getByLabelText(/^url.*\*$/), { target: { value: 'https://mcp.example.test' } })
    fireEvent.click(screen.getByRole('button', { name: '挂载 tools/mcp' }))
    expect(await screen.findByText('工具已添加')).toBeTruthy()
    const tools = screen.getByRole('link', { name: '查看可用工具' })
    expect(tools.getAttribute('href')).toBe('/nodes/tools/mcp?tab=invoke')
    fireEvent.click(tools)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it.each(['pending', 'failed'] as const)('自定义 MCP 的 %s 授权保留已添加状态，不重写或回滚', async (outcome) => {
    if (outcome === 'failed') authorize.mockRejectedValueOnce(new Error('OAuth unavailable'))
    else authorize.mockResolvedValueOnce({ status: 'pending', authorizationUrl: 'https://auth.example.test/consent' })
    render(<MemoryRouter><AddToolWizard /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '添加工具' }))
    fireEvent.click(await screen.findByText('MCP Server'))
    fireEvent.change(await screen.findByLabelText(/^path.*\*$/), { target: { value: 'tools/oauth' } })
    fireEvent.change(screen.getByLabelText(/^描述.*\*$/), { target: { value: 'OAuth tools' } })
    fireEvent.change(screen.getByLabelText(/^url.*\*$/), { target: { value: 'https://mcp.example.test' } })
    fireEvent.click(screen.getByRole('button', { name: '无（公开上游）' }))
    fireEvent.click(await screen.findByText('oauth — 网关托管 OAuth'))
    fireEvent.click(screen.getByRole('button', { name: '挂载 tools/oauth' }))
    expect(await screen.findByText(outcome === 'failed' ? '已添加，授权未完成' : '已添加，等待授权')).toBeTruthy()
    expect(calls.map(call => call.commandPath)).toEqual(['system/registry/write'])
    expect(authorize).toHaveBeenCalledWith('tools/oauth')
    expect(screen.getByRole('link', { name: '查看可用工具' }).getAttribute('href')).toBe('/nodes/tools/oauth?tab=invoke')
    if (outcome === 'pending') expect(screen.getByRole('link', { name: '打开授权页完成授权' })).toBeTruthy()
  })

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
      expect(calls.some(c => c.commandPath === 'system/registry/write')).toBe(true)
    })
    // 可见步骤:挂载成功
    expect(await screen.findByText('工具已添加')).toBeTruthy()
    expect(screen.getByRole('link', { name: '查看可用工具' }).getAttribute('href')).toBe('/nodes/tools/tavily?tab=invoke')
    // 没有写 secret(单值留空)
    expect(calls.some(c => c.commandPath.startsWith('system/secret/'))).toBe(false)
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
