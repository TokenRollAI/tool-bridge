import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import { DevicesPage } from '@/pages/system/DevicesPage'

const state = vi.hoisted(() => ({
  devices: [{ path: 'device/laptop', deviceId: 'raw:laptop', kind: 'directory', online: false }],
  fetchNextPage: vi.fn(),
  refetch: vi.fn(async () => ({ isError: false })),
}))
vi.mock('@/lib/queries', () => ({
  useRegistryList: () => ({
    data: { items: state.devices }, hasNextPage: true, isFetchingNextPage: false,
    isPending: false, isError: false, isRefetching: false,
    fetchNextPage: state.fetchNextPage, refetch: state.refetch,
  }),
}))
vi.mock('@/lib/session-context', () => ({ useSession: () => ({ active: { baseUrl: 'https://gateway.example.test' } }) }))
vi.mock('@/components/device/DeviceMailboxPanel', () => ({
  DeviceMailboxPanel: ({ targets }: { targets: unknown[] }) => <div data-testid="mailbox">{JSON.stringify(targets)}</div>,
}))
function Location() {
  return <output data-testid="location">{useLocation().search}</output>
}
function page(url = '/manage/devices') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <DevicesPage />
      <Location />
    </MemoryRouter>,
  )
}
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('设备工作台', () => {
  it('首屏保留离线设备、工具入口与分页，按真实 deviceId 传递邮箱目标', () => {
    page()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('link', { name: '打开 device/laptop' }).getAttribute('href')).toBe('/nodes/device/laptop?tab=invoke')
    expect(screen.getByTestId('mailbox').textContent).toContain('raw:laptop')
    fireEvent.click(screen.getByRole('button', { name: /加载下一页/ }))
    expect(state.fetchNextPage).toHaveBeenCalledOnce()
  })
  it('深链接打开连接流程，关闭保留其他查询参数，连接命令不包含 SK', async () => {
    page('/manage/devices?connect=1&view=all')
    expect(screen.getByRole('dialog', { name: '连接设备' })).toBeTruthy()
    expect(screen.getByText('tb connect https://gateway.example.test')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('location').textContent).toBe('?view=all')
    fireEvent.click(screen.getByRole('button', { name: '连接设备' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
  it('空态提供可操作的首次接入引导', () => {
    const devices = state.devices
    state.devices = []
    page()
    state.devices = devices
    fireEvent.click(screen.getByRole('button', { name: '连接第一台设备' }))
    expect(screen.getByRole('dialog', { name: '连接设备' })).toBeTruthy()
  })
})
