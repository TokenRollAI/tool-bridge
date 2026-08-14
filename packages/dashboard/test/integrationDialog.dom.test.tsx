import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogListItem } from '@/lib/types'

/**
 * `IntegrationDialog` 的**组件级**行为。
 *
 * 纯逻辑测试(integrationPlan.test.ts)覆盖了"表单态 → 该发什么调用";这一份补它测不到的
 * 两件事:
 *
 * 1. **表单是按 descriptor 生成的** —— 选了 jira 就出现它声明的那两个输入框,且
 *    `secret: false` 的那个不遮蔽。这是 catalog 驱动的全部意义,而它只在渲染后可见。
 * 2. **调用顺序是"先凭证后挂载"** —— 挂载时平台会用凭证跑 `credentialProbe`,顺序反了
 *    探针必失败。那是时序性质,纯函数断言不出来。
 */

const TAVILY: CatalogListItem = {
  id: 'tavily',
  digest: 'd1',
  exports: ['actions'],
  nodeKinds: ['tool'],
  needsOAuth: false,
  description: 'Tavily search',
}

const JIRA: CatalogListItem = {
  id: 'jira',
  digest: 'd2',
  exports: ['actions'],
  nodeKinds: ['tool'],
  needsOAuth: false,
  description: 'Jira',
  credentialFields: [
    { key: 'baseUrl', label: 'Instance URL', required: true, secret: false },
    { key: 'personalAccessToken', label: 'PAT', required: true, secret: true },
  ],
}

const SENTRY: CatalogListItem = {
  id: 'sentry',
  digest: 'd3',
  exports: ['actions'],
  nodeKinds: ['tool'],
  needsOAuth: true,
  description: 'Sentry',
}

/** 记录 invoke 调用顺序(测试的核心观测点)。 */
const calls: Array<{ args: Record<string, unknown>, path: string, tool: string }> = []
const oauthCalls: string[] = []

vi.mock('@/lib/queries', () => ({
  useIntegrationCatalog: () => ({
    data: [JIRA, SENTRY, TAVILY],
    isPending: false,
    isError: false,
    error: null,
    isLoading: false,
  }),
  useSecretList: () => ({ data: { items: [{ name: 'shared-key' }] } }),
  useInvoke: () => ({
    isPending: false,
    mutate: (
      input: { args: Record<string, unknown>, path: string, tool: string },
      opts?: { onSuccess?: (r: unknown) => void },
    ) => {
      calls.push(input)
      opts?.onSuccess?.({ json: {} })
    },
  }),
  useOAuthAuthorize: () => ({
    mutate: (path: string, opts?: { onSuccess?: (r: unknown) => void }) => {
      oauthCalls.push(path)
      opts?.onSuccess?.({ status: 'authorized' })
    },
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}))

vi.mock('sonner', () => ({ toast: { success: () => {}, info: () => {}, error: () => {} } }))

const { IntegrationDialog } = await import('@/pages/system/forms/IntegrationDialog')

afterEach(() => {
  // **必须显式 cleanup**:RTL 的自动清理只在 vitest globals 开启时挂上,而本仓不开
  // globals(测试逐个 import)。不清理则上一个用例的 DOM 留在 document 里,下一个用例
  // 的 `queryByLabelText` 会命中前一个对话框 —— 第一版就这么假红/假绿过。
  cleanup()
  calls.length = 0
  oauthCalls.length = 0
  vi.restoreAllMocks()
})

/** 打开对话框并选中一个集成。 */
async function openAndPick(providerId: string): Promise<void> {
  render(<IntegrationDialog />)
  fireEvent.click(screen.getByRole('button', { name: /添加集成/ }))
  await waitFor(() => expect(screen.getByLabelText('挂载路径 *')).toBeDefined())
  fireEvent.click(screen.getByRole('button', { name: new RegExp(providerId) }))
}

describe('按 descriptor 生成表单', () => {
  it('多字段集成:声明的每个字段都有输入框,secret:false 的不遮蔽', async () => {
    await openAndPick('jira')
    await waitFor(() => expect(screen.getByLabelText(/baseUrl/)).toBeDefined())

    const baseUrl = screen.getByLabelText(/baseUrl/) as HTMLInputElement
    const pat = screen.getByLabelText(/personalAccessToken/) as HTMLInputElement
    // `secret` 只管遮蔽:baseUrl 明文可见,PAT 遮蔽 —— 但两者都进同一个加密 secret。
    expect(baseUrl.type).toBe('text')
    expect(pat.type).toBe('password')
  })

  it('单值集成:只有一个 API key 框,且提示派生出的 secret 名', async () => {
    await openAndPick('tavily')
    await waitFor(() => expect(screen.getByLabelText('API key')).toBeDefined())
    expect(screen.queryByLabelText(/baseUrl/)).toBeNull()

    fireEvent.change(screen.getByLabelText('挂载路径 *'), { target: { value: 'tools/tavily' } })
    // 用户不必知道 authRef 这个词,但该看得见凭证会存到哪。
    await waitFor(() => expect(screen.getByText(/integration-tools-tavily/)).toBeDefined())
  })

  it('OAuth 集成:要 clientId/clientSecret,不要 API key', async () => {
    await openAndPick('sentry')
    await waitFor(() => expect(screen.getByLabelText(/clientId/)).toBeDefined())
    expect(screen.getByLabelText(/clientSecret/)).toBeDefined()
    expect(screen.queryByLabelText('API key')).toBeNull()
  })
})

describe('提交顺序', () => {
  it('**先写凭证再挂载**(顺序反了挂载探针必失败)', async () => {
    await openAndPick('tavily')
    fireEvent.change(screen.getByLabelText('挂载路径 *'), { target: { value: 'tools/tavily' } })
    await waitFor(() => expect(screen.getByLabelText('API key')).toBeDefined())
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'tvly-k' } })

    fireEvent.click(screen.getByRole('button', { name: /添加 tavily/ }))

    await waitFor(() => expect(calls.length).toBe(2))
    expect(calls[0]).toMatchObject({ path: 'system/secret', tool: 'set' })
    expect(calls[1]).toMatchObject({ path: 'system/registry', tool: 'write' })
    // 挂载配置里的 authRef 与刚写的 secret 名对得上(不靠用户手打)。
    expect((calls[0]!.args as { name: string }).name).toBe('integration-tools-tavily')
    expect(
      ((calls[1]!.args as { config: { authRef: string } }).config).authRef,
    ).toBe('integration-tools-tavily')
  })

  it('复用已有凭证时不写 secret,只挂载', async () => {
    await openAndPick('tavily')
    fireEvent.change(screen.getByLabelText('挂载路径 *'), { target: { value: 'tools/t2' } })
    // 切到"复用已有凭证"并选中下拉里的那个 —— 下拉本身就是"不手打引用名"的兑现。
    const modeTrigger = screen.getAllByRole('combobox')[0]!
    fireEvent.click(modeTrigger)
    await waitFor(() => expect(screen.getByText('复用已有凭证')).toBeDefined())
    fireEvent.click(screen.getByText('复用已有凭证'))

    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1))
    const secretTrigger = screen.getAllByRole('combobox')[1]!
    fireEvent.click(secretTrigger)
    await waitFor(() => expect(screen.getByText('shared-key')).toBeDefined())
    fireEvent.click(screen.getByText('shared-key'))

    fireEvent.click(screen.getByRole('button', { name: /添加 tavily/ }))
    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0]).toMatchObject({ path: 'system/registry', tool: 'write' })
    expect(
      ((calls[0]!.args as { config: { authRef: string } }).config).authRef,
    ).toBe('shared-key')
  })

  it('OAuth 集成挂载后自动发起授权', async () => {
    await openAndPick('sentry')
    fireEvent.change(screen.getByLabelText('挂载路径 *'), { target: { value: 'tools/sentry' } })
    await waitFor(() => expect(screen.getByLabelText(/clientId/)).toBeDefined())
    fireEvent.change(screen.getByLabelText(/clientId/), { target: { value: 'cid' } })
    fireEvent.change(screen.getByLabelText(/clientSecret/), { target: { value: 'cs' } })

    fireEvent.click(screen.getByRole('button', { name: /添加 sentry/ }))
    await waitFor(() => expect(oauthCalls).toEqual(['tools/sentry']))
  })

  it('校验失败时不发任何请求,并就地显示原因', async () => {
    await openAndPick('jira')
    fireEvent.change(screen.getByLabelText('挂载路径 *'), { target: { value: 'tools/jira' } })
    await waitFor(() => expect(screen.getByLabelText(/baseUrl/)).toBeDefined())
    // 只填一个字段 → 缺 personalAccessToken。
    fireEvent.change(screen.getByLabelText(/baseUrl/), { target: { value: 'https://x' } })

    fireEvent.click(screen.getByRole('button', { name: /添加 jira/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined())
    expect(screen.getByRole('alert').textContent).toContain('personalAccessToken')
    expect(calls).toEqual([])
  })
})
