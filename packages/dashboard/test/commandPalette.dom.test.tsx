import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useState } from 'react'
import { SessionContext, type SessionState } from '@/lib/session-context'

const mocks = vi.hoisted(() => ({ useToolSearch: vi.fn(), useTree: vi.fn(), useHelp: vi.fn(), add: vi.fn(), invoke: vi.fn(), openChange: vi.fn() }))
vi.mock('@/lib/queries', () => ({
  useToolSearch: mocks.useToolSearch,
  useTree: mocks.useTree,
  useHelp: mocks.useHelp,
  useToolHelp: () => ({ isPending: false, isError: false }),
  useInvalidate: () => vi.fn(),
  useInvoke: () => ({ mutateAsync: mocks.invoke, isPending: false }),
}))
vi.mock('@/lib/useDebounced', () => ({ useDebounced: (value: string) => value }))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }) }))

import { CommandPalette } from '../src/components/CommandPalette'
import { ToolPage } from '../src/pages/ToolPage'

let session: SessionState
let sequence = 0
function Harness() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <CommandPalette
        onAddTool={mocks.add}
        onOpenChange={(next) => {
          mocks.openChange(next)
          setOpen(next)
        }}
        open={open}
      />
      <Routes>
        <Route element={<ToolPage />} path="/tools/*" />
        <Route element={<p>工具库</p>} path="/tools" />
      </Routes>
    </>
  )
}
function mount() {
  return render(<SessionContext.Provider value={session}><MemoryRouter initialEntries={['/tools']}><Harness /></MemoryRouter></SessionContext.Provider>)
}
const results = [
  { path: 'remote/weather', tool: { name: 'z_remote', description: 'Remote response', effect: 'read' }, source: { path: 'regional' } },
  { path: 'local/weather', tool: { name: 'a_local', description: 'Local response', effect: 'read' } },
]

describe('全局工具搜索面板', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    session = { active: { id: `palette-${sequence++}`, name: '测试', baseUrl: '', sk: 'test' }, revision: 1, profiles: [], conn: null, login: vi.fn(), logout: vi.fn(), removeProfile: vi.fn(), switchTo: vi.fn() }
    mocks.useTree.mockReturnValue({ data: { path: '', kind: 'directory', children: [] } })
    mocks.useToolSearch.mockReturnValue({ data: { pages: [{ items: results }] }, isError: false, isFetching: false })
    mocks.useHelp.mockReturnValue({ data: { node: { kind: 'tool' }, cmds: [{ name: 'z_remote', path: 'authoritative/execute', scope: 'read' }] }, isPending: false, isError: false })
  })

  it('保留服务端结果和排名，命令选择直接打开实时表单并保留查询返回上下文', () => {
    mount()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '天气' } })
    expect(mocks.useToolSearch).toHaveBeenLastCalledWith('天气')
    const tools = screen.getAllByRole('option').filter(option => /z_remote|a_local/.test(option.textContent ?? ''))
    expect(tools.map(option => option.textContent)).toEqual([expect.stringContaining('z_remote'), expect.stringContaining('a_local')])
    fireEvent.click(tools[0]!)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.useHelp).toHaveBeenCalledWith('remote/weather')
    expect(screen.getByLabelText('arguments JSON')).toBeTruthy()
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: '返回搜索结果' }).getAttribute('href')).toBe('/search?q=%E5%A4%A9%E6%B0%94')
  })

  it('添加动作关闭面板并触发统一向导入口', () => {
    mount()
    fireEvent.click(screen.getByRole('option', { name: '添加工具' }))
    expect(mocks.add).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('远端结果到达后 Enter 直接打开服务端第一条命令，不停留在查看全部结果', async () => {
    mocks.useToolSearch.mockReturnValue({ isError: false, isFetching: true })
    const view = mount()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '天气' } })
    await waitFor(() => expect(screen.getByRole('option', { name: '查看全部搜索结果与范围筛选' }).getAttribute('aria-selected')).toBe('true'))
    mocks.useToolSearch.mockReturnValue({ data: { pages: [{ items: results }] }, isError: false, isFetching: false })
    view.rerender(<SessionContext.Provider value={session}><MemoryRouter initialEntries={['/tools']}><Harness /></MemoryRouter></SessionContext.Provider>)
    await waitFor(() => expect(screen.getByRole('option', { name: /z_remote/ }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByRole('option', { name: /a_local/ }).getAttribute('aria-selected')).toBe('false')
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(mocks.useHelp).toHaveBeenCalledWith('remote/weather')
    expect(screen.getByRole('heading', { name: 'z_remote' })).toBeTruthy()
    expect(screen.getByLabelText('arguments JSON')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Escape 请求关闭面板且不执行动作', () => {
    mount()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    expect(mocks.openChange).toHaveBeenCalledWith(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('搜索部分失败仍显示可见命令，节点加载失败不阻断工具搜索', () => {
    mocks.useToolSearch.mockReturnValue({ data: { pages: [{ items: results, partial: true }] }, isError: false, isFetching: false })
    mocks.useTree.mockReturnValue({ isError: true })
    mount()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '天气' } })
    expect(screen.getByText('部分来源未完成，结果可能不完整。')).toBeTruthy()
    expect(screen.getByText('连接与设备未能加载，工具搜索仍可使用。')).toBeTruthy()
    expect(screen.getByRole('option', { name: /z_remote/ })).toBeTruthy()
  })

  it('命令搜索失败不回显内部错误，保留工具浏览入口', () => {
    mocks.useToolSearch.mockReturnValue({ isError: true, isFetching: false, error: new Error('https://secret-internal.test') })
    mount()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '天气' } })
    expect(screen.getByText('命令搜索暂不可用，可重试或浏览工具。')).toBeTruthy()
    expect(screen.queryByText(/secret-internal/)).toBeNull()
    expect(screen.getByRole('option', { name: '查看全部搜索结果与范围筛选' })).toBeTruthy()
  })
})
