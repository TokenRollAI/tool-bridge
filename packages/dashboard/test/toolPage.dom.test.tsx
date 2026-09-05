import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'

const mocks = vi.hoisted(() => ({
  useHelp: vi.fn(),
  useToolHelp: vi.fn(),
  useSession: vi.fn(),
  invoke: vi.fn(),
  invalidate: vi.fn(),
  persist: vi.fn(),
}))
vi.mock('@/lib/queries', () => ({
  useHelp: mocks.useHelp,
  useToolHelp: mocks.useToolHelp,
  useInvoke: () => ({ mutateAsync: mocks.invoke, isPending: false, error: null }),
  useInvalidate: () => mocks.invalidate,
}))
vi.mock('@/lib/session-context', () => ({ useSession: mocks.useSession }))
vi.mock('@/components/FavoriteToolButton', () => ({ FavoriteToolButton: () => <button>收藏</button> }))

import { CommandWorkspace } from '../src/components/node/CommandWorkspace'

// 预热真实 schema renderer，避免把模块转换耗时作为交互时限。
await import('@/components/SchemaFormRenderer')
import { ToolPage } from '../src/pages/ToolPage'

const command = { name: 'run', path: '/real/dispatch/execute', scope: 'call' as const, h: '运行一次工具', confirm: true }
const help = { data: { node: { kind: 'tool' }, cmds: [command] }, isPending: false, isError: false }

function LocationProbe() {
  const location = useLocation()
  return (
    <output aria-label="当前地址">
      {location.pathname}
      {location.search}
    </output>
  )
}

function mount(from?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/tools/team/service', search: '?tool=run', state: { from } }]}>
      <Routes>
        <Route element={<ToolPage />} path="/tools/*" />
        <Route element={<p>搜索结果</p>} path="/search" />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('独立工具调用页', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('localStorage', { setItem: mocks.persist, getItem: () => null })
    mocks.useHelp.mockReturnValue(help)
    mocks.useToolHelp.mockReturnValue({ isPending: false, isError: false })
    mocks.useSession.mockReturnValue({ active: { id: 'profile-a', baseUrl: '' }, revision: 1 })
    mocks.invoke.mockResolvedValue({})
  })

  it('用实时 help 直接打开表单，保留确认并只调用声明的完整路径', () => {
    mount('/search?q=weather&federation=local')
    expect(mocks.useHelp).toHaveBeenCalledWith('team/service')
    expect(screen.getByRole('heading', { name: '输入参数' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '执行结果' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('arguments JSON'), { target: { value: '{"token":"private-input"}' } })
    fireEvent.click(screen.getByRole('button', { name: '调用', exact: true }))
    expect(mocks.invoke).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认执行', exact: true }))
    expect(mocks.invoke).toHaveBeenCalledWith({ commandPath: 'real/dispatch/execute', historyIdentity: { path: 'team/service', tool: 'run' }, args: { token: 'private-input' }, accept: 'markdown' })
    expect(screen.getByLabelText('当前地址').textContent).toBe('/tools/team/service?tool=run')
    expect(mocks.persist).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: '返回搜索结果' }))
    expect(screen.getByLabelText('当前地址').textContent).toBe('/search?q=weather&federation=local')
  })

  it('缺少或不安全的返回上下文回到工具列表', () => {
    mount('//evil.test')
    expect(screen.getByRole('link', { name: '返回工具列表' }).getAttribute('href')).toBe('/tools')
  })

  it('真实 schema 表单与 JSON 编辑共享当前输入，表单提交仍走同一调用', async () => {
    mocks.useHelp.mockReturnValue({
      ...help,
      data: {
        ...help.data,
        cmds: [{ ...command, confirm: false, inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } }],
      },
    })
    mount()
    fireEvent.change(await screen.findByLabelText(/^message/), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'JSON 编辑' }))
    expect((screen.getByLabelText('arguments JSON') as HTMLTextAreaElement).value).toContain('hello')
    fireEvent.click(screen.getByRole('button', { name: '表单编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '调用', exact: true }))
    expect(mocks.invoke).toHaveBeenCalledWith({ commandPath: 'real/dispatch/execute', historyIdentity: { path: 'team/service', tool: 'run' }, args: { message: 'hello' }, accept: 'markdown' })
  })

  it('已移除和已失权的命令不渲染调用入口', () => {
    mocks.useHelp.mockReturnValue({ ...help, data: { ...help.data, cmds: [] } })
    const view = mount()
    expect(screen.getByText('此命令已不可用')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '调用', exact: true })).toBeNull()
    mocks.useHelp.mockReturnValue({ isPending: false, isError: true, error: new Error('private URL') })
    view.rerender(<MemoryRouter><ToolPage /></MemoryRouter>)
    expect(screen.getByText('暂时无法打开工具')).toBeTruthy()
    expect(screen.queryByText('private URL')).toBeNull()
  })

  it('切换连接销毁旧参数', () => {
    const view = mount()
    fireEvent.change(screen.getByLabelText('arguments JSON'), { target: { value: '{"token":"old-profile-input"}' } })
    mocks.useSession.mockReturnValue({ active: { id: 'profile-b', baseUrl: '' }, revision: 2 })
    view.rerender(
      <MemoryRouter initialEntries={['/tools/team/service?tool=run']}>
        <Routes><Route element={<ToolPage />} path="/tools/*" /></Routes>
      </MemoryRouter>,
    )
    expect((screen.getByLabelText('arguments JSON') as HTMLTextAreaElement).value).toBe('{}')
  })

  it('参数 schema 加载失败时提供重试且不允许盲调用', () => {
    const refetch = vi.fn()
    mocks.useHelp.mockReturnValue({ ...help, data: { ...help.data, node: { kind: 'mcp' } } })
    mocks.useToolHelp.mockReturnValue({ isPending: false, isError: true, refetch })
    mount()
    expect(screen.queryByRole('button', { name: '调用', exact: true })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重新加载参数' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('命令目录打开独立页面，旧 initialTool 深链接仍自动打开弹窗', () => {
    const view = render(
      <MemoryRouter initialEntries={['/nodes/team/service']}>
        <CommandWorkspace cmds={[command]} lazySchema={false} path="team/service" />
        <LocationProbe />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /run/ }))
    expect(screen.getByLabelText('当前地址').textContent).toBe('/tools/team/service?tool=run')
    view.unmount()
    render(<MemoryRouter><CommandWorkspace cmds={[command]} initialTool="run" lazySchema={false} path="team/service" /></MemoryRouter>)
    expect(screen.getByRole('dialog', { name: '调用 run' })).toBeTruthy()
    expect(screen.getByLabelText('arguments JSON')).toBeTruthy()
  })
})
