import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HelpCmd } from '../src/lib/types'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), persist: vi.fn() }))
vi.mock('@/lib/api', () => ({ invoke: mocks.invoke }))
vi.mock('@/lib/session-context', () => {
  const conn = { baseUrl: '', sk: 'private-key' }
  return { useConn: () => conn, useSession: () => ({ active: { id: 'a', baseUrl: '' }, revision: 1 }) }
})
import { DeviceSessionPanel } from '../src/components/node/DeviceSessionPanel'
import { sessionCommands } from '../src/lib/deviceSession'

const path = '/device/build/sessions/build'
const cmds: HelpCmd[] = ['start', 'list', 'observe', 'stop'].map(name => ({
  name, path: `${path}/${name}`, method: 'POST', scope: 'call', effect: name === 'start' ? 'destructive' : 'read',
  ...(name === 'start' ? { confirm: true, inputSchema: { type: 'object', properties: { expectedRuntimeId: { type: 'string' } }, required: ['expectedRuntimeId'] } } : {}),
}))
const summary = { sessionId: 'runtime:session', runtimeId: 'runtime', requestId: 'original', state: 'running', startedAt: '2026-09-15T00:00:00.000Z' }
const page = { runtimeId: 'runtime', now: summary.startedAt, items: [summary] }
const result = (value: unknown) => ({ json: value })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', { setItem: mocks.persist, getItem: () => null })
  mocks.invoke.mockImplementation(async (_conn, command: string, _args, _accept, opts) => {
    if (command.endsWith('/list')) return result(page)
    if (command.endsWith('/start')) return result(summary)
    if (command.endsWith('/stop')) return result({ ...summary, state: 'stopping' })
    return await new Promise((_resolve, reject) => opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('process session controls', () => {
  it('requires the public schema marker and full quartet', () => {
    expect(sessionCommands(cmds)).not.toBeNull()
    expect(sessionCommands(cmds.slice(0, 3))).toBeNull()
    expect(sessionCommands(cmds.map(cmd => ({ ...cmd, inputSchema: {} })))).toBeNull()
    expect(sessionCommands(cmds.map(cmd => ({ ...cmd, inputSchema: { properties: { expectedRuntimeId: {} } } })))).toBeNull()
  })

  it('starts only after declared confirmation with device time and generated identity', async () => {
    render(<DeviceSessionPanel cmds={cmds} />)
    await screen.findByRole('button', { name: /runtime:session/ })
    fireEvent.change(screen.getByLabelText('命令输入（JSON）'), { target: { value: '{"message":"private-input"}' } })
    fireEvent.click(screen.getByRole('button', { name: '启动会话' }))
    expect(mocks.invoke.mock.calls.filter(call => String(call[1]).endsWith('/start'))).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(expect.anything(), `${path}/start`, {
      input: { message: 'private-input' }, requestId: expect.any(String), expectedRuntimeId: 'runtime', startBefore: '2026-09-15T00:01:00.000Z',
    }, 'json', expect.anything()))
    expect(mocks.persist).not.toHaveBeenCalled()
  })

  it('pause/unmount abort observation only; stop remains explicit and reports stopping', async () => {
    const view = render(<DeviceSessionPanel cmds={cmds} />)
    fireEvent.click(await screen.findByRole('button', { name: /runtime:session/ }))
    await waitFor(() => expect(mocks.invoke.mock.calls.some(call => String(call[1]).endsWith('/observe'))).toBe(true))
    const firstSignal = mocks.invoke.mock.calls.find(call => String(call[1]).endsWith('/observe'))?.[4].signal as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: '暂停日志' }))
    expect(firstSignal.aborted).toBe(true)
    expect(mocks.invoke.mock.calls.some(call => String(call[1]).endsWith('/stop'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '停止进程' }))
    await screen.findByText('正在停止，尚未确认退出')
    fireEvent.click(screen.getByRole('button', { name: '继续读取日志' }))
    const calls = mocks.invoke.mock.calls.filter(call => String(call[1]).endsWith('/observe'))
    const lastSignal = calls.at(-1)?.[4].signal as AbortSignal
    view.unmount()
    expect(lastSignal.aborted).toBe(true)
    expect(mocks.invoke.mock.calls.filter(call => String(call[1]).endsWith('/stop'))).toHaveLength(1)
  })

  it('keeps its cursor after a read failure, reports gaps and renders logs as text', async () => {
    let observations = 0
    mocks.invoke.mockImplementation(async (_conn, command: string) => {
      if (command.endsWith('/list')) return result(page)
      observations++
      if (observations === 2) throw new Error('offline')
      return result({ ...summary, state: observations > 2 ? 'exited' : 'running', exitCode: 7, chunks: observations === 1 ? [{ seq: 4, stream: 'stdout', text: '<script>untrusted</script>' }] : [], nextCursor: 4, gap: true, droppedBytes: 100 })
    })
    render(<DeviceSessionPanel cmds={cmds} />)
    fireEvent.click(await screen.findByRole('button', { name: /runtime:session/ }))
    await screen.findByText(/读取中断/)
    expect(screen.getByLabelText('会话日志').textContent).toContain('<script>untrusted</script>')
    expect(screen.getByLabelText('会话日志').querySelector('script')).toBeNull()
    expect(screen.getByText(/设备日志已发生截断/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '继续读取日志' }))
    await screen.findByText(/已退出 · 退出码 7/)
    const reads = mocks.invoke.mock.calls.filter(call => String(call[1]).endsWith('/observe'))
    expect(reads.map(call => call[2].cursor)).toEqual([0, 4, 4])
  })

  it('retains the request id on unknown start and prevents another start until explicitly reconciled', async () => {
    mocks.invoke.mockImplementation(async (_conn, command: string) => {
      if (command.endsWith('/list')) return result(page)
      throw new Error('lost response')
    })
    render(<DeviceSessionPanel cmds={cmds} />)
    await screen.findByRole('button', { name: /runtime:session/ })
    fireEvent.click(screen.getByRole('button', { name: '启动会话' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    await screen.findByText(/未取得启动结果/)
    const start = mocks.invoke.mock.calls.find(call => String(call[1]).endsWith('/start'))!
    expect(screen.getByText(new RegExp(start[2].requestId))).toBeTruthy()
    expect((screen.getByRole('button', { name: '启动会话' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '查找原请求' }))
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(expect.anything(), `${path}/list`, { limit: 20, requestId: start[2].requestId }, 'json', expect.anything()))
    expect(mocks.invoke.mock.calls.filter(call => String(call[1]).endsWith('/start'))).toHaveLength(1)
  })
})
