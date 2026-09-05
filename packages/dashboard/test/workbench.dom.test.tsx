import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { SessionContext, type SessionState } from '@/lib/session-context'
import { toggleFavorite } from '@/lib/favorites'
import { historyScope } from '@/lib/history'

const mocks = vi.hoisted(() => ({ useHelp: vi.fn(), useHistory: vi.fn(), useRegistryList: vi.fn(), invoke: vi.fn() }))
vi.mock('@/lib/queries', () => ({
  useHelp: mocks.useHelp,
  useHistory: mocks.useHistory,
  useRegistryList: mocks.useRegistryList,
  useToolHelp: () => ({ isPending: false, isError: false }),
  useInvoke: () => ({ mutateAsync: mocks.invoke, isPending: false }),
  useInvalidate: () => vi.fn(),
}))
vi.mock('@/components/add-tool/AddToolWizard', () => ({ AddToolWizard: ({ trigger }: { trigger: ReactNode }) => trigger }))

import { WorkspacePage } from '../src/pages/WorkspacePage'
import { ToolPage } from '../src/pages/ToolPage'

let session: SessionState
let sequence = 0
const tool = { path: 'team/weather', tool: 'forecast' }
function app(state = session) {
  return (
    <SessionContext.Provider value={state}>
      <MemoryRouter>
        <Routes>
          <Route element={<WorkspacePage />} path="/" />
          <Route element={<ToolPage />} path="/tools/*" />
        </Routes>
      </MemoryRouter>
    </SessionContext.Provider>
  )
}

describe('工作台到工具调用', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })
  beforeEach(() => {
    vi.clearAllMocks()
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
    session = { active: { id: `workbench-${sequence++}`, name: '测试连接', baseUrl: 'https://one.test', sk: 'test' }, revision: 1, profiles: [], conn: null, login: vi.fn(), logout: vi.fn(), removeProfile: vi.fn(), switchTo: vi.fn() }
    mocks.useHistory.mockReturnValue([])
    mocks.useRegistryList.mockReturnValue({ data: { items: [] }, isPending: false, isError: false })
    mocks.useHelp.mockReturnValue({ data: { node: { kind: 'tool' }, cmds: [{ name: 'forecast', path: '/actual/weather/forecast', scope: 'read' }] }, isPending: false, isError: false })
  })

  it('收藏链接直接消费实时 help，打开空表单而非自动重放，并能返回工作台', () => {
    toggleFavorite(historyScope(session.active!), tool)
    render(app())
    expect(screen.getByText('收藏 · 本机 / 当前连接档案')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('region', { name: '常用工具' })).getByRole('link', { name: /forecast/ }))
    expect(mocks.useHelp).toHaveBeenCalledWith('team/weather')
    expect((screen.getByLabelText('arguments JSON') as HTMLTextAreaElement).value).toBe('{}')
    expect(mocks.invoke).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: '返回工作台' }))
    expect(screen.getByRole('heading', { name: '工作台' })).toBeTruthy()
  })

  it('最近使用按命令去重，失权后提供明确反馈而不打开旧表单', () => {
    mocks.useHistory.mockReturnValue([{ ...tool, at: '2026-09-01T12:00:00Z', ok: true, ms: 10 }, { ...tool, at: '2026-08-31T12:00:00Z', ok: false, ms: 0 }])
    mocks.useHelp.mockReturnValue({ isPending: false, isError: true })
    render(app())
    const recent = within(screen.getByRole('region', { name: '最近使用' })).getAllByRole('link')
    expect(recent).toHaveLength(1)
    fireEvent.click(recent[0]!)
    expect(screen.getByText('暂时无法打开工具')).toBeTruthy()
    expect(screen.queryByLabelText('arguments JSON')).toBeNull()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('首页收藏随 profile 或同一 profile 的 gateway 变化隔离', () => {
    toggleFavorite(historyScope(session.active!), tool)
    const view = render(app())
    expect(screen.getByRole('link', { name: /forecast/ })).toBeTruthy()
    view.rerender(app({ ...session, active: { ...session.active!, id: 'different-profile' }, revision: 2 }))
    expect(screen.queryByRole('link', { name: /forecast/ })).toBeNull()
    view.rerender(app({ ...session, active: { ...session.active!, baseUrl: 'https://two.test' }, revision: 3 }))
    expect(screen.queryByRole('link', { name: /forecast/ })).toBeNull()
    view.rerender(app(session))
    expect(screen.getByRole('link', { name: /forecast/ })).toBeTruthy()
  })

  it('设备使用 directory 加 online 的真实 wire 形状，离线设备仍可打开', () => {
    mocks.useRegistryList.mockReturnValue({
      data: {
        items: [
          { path: 'devices/laptop', kind: 'directory', description: '我的电脑', online: true },
          { path: 'devices/offline', kind: 'directory', description: '离线电脑', online: false },
          { path: 'team/ordinary', kind: 'directory', description: '普通目录' },
        ],
      },
      isPending: false,
      isError: false,
    })
    render(app())
    const devices = within(screen.getByRole('region', { name: '设备' }))
    expect(devices.getByRole('link', { name: /我的电脑/ }).getAttribute('href')).toBe('/tools?path=devices%2Flaptop')
    expect(devices.getByRole('link', { name: /离线电脑/ }).getAttribute('href')).toBe('/tools?path=devices%2Foffline')
    expect(devices.queryByText('普通目录')).toBeNull()
  })
})
