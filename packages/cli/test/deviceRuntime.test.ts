import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReconnectingWebSocket from 'partysocket/ws'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDeviceConnection } from '../src/deviceRuntime'
import { CliError } from '../src/http'
import { runCli } from './cliHarness'

// 复现 partysocket 关键行为:close() 会同步派发 close 事件——bug(拒绝被吞、
// 退出码 0)正是 onRejected 里 close 触发的 resolveClosed 抢先于 rejectClosed。
vi.mock('partysocket/ws', () => {
  type Listener = (ev: unknown) => void
  class FakeReconnectingWebSocket {
    static OPEN = 1
    static instances: FakeReconnectingWebSocket[] = []
    readyState = 1
    sent: string[] = []
    private listeners = new Map<string, Listener[]>()
    constructor(_url: string, _protocols?: unknown, _opts?: unknown) {
      FakeReconnectingWebSocket.instances.push(this)
    }

    addEventListener(type: string, fn: Listener): void {
      const arr = this.listeners.get(type) ?? []
      arr.push(fn)
      this.listeners.set(type, arr)
    }

    send(data: string): void {
      this.sent.push(String(data))
    }

    close(_code?: number, _reason?: string): void {
      this.dispatch('close', {})
    }

    reconnect(): void {}
    dispatch(type: string, ev: unknown): void {
      for (const fn of this.listeners.get(type) ?? []) fn(ev)
    }
  }
  return { default: FakeReconnectingWebSocket }
})

interface FakeSocket {
  dispatch(type: string, ev: unknown): void
  sent: string[]
}

const FakeWs = ReconnectingWebSocket as unknown as { instances: FakeSocket[] }

const REJECT_FRAME = JSON.stringify({
  type: 'error',
  error: { code: 'permission_denied', message: 'registerPaths 越界', retryable: false },
})

let tmpConfig: string | undefined
const oldXdg = process.env.XDG_CONFIG_HOME

beforeEach(() => {
  process.exitCode = 0
  FakeWs.instances.length = 0
  tmpConfig = mkdtempSync(join(tmpdir(), 'tb-cli-devrt-'))
  process.env.XDG_CONFIG_HOME = tmpConfig
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
  process.exitCode = 0
  vi.restoreAllMocks()
  if (tmpConfig) rmSync(tmpConfig, { recursive: true, force: true })
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = oldXdg
})

describe('网关拒绝帧(error + close 1008)', () => {
  it('closed 以 CliError 拒绝(close 事件同步到达也不得吞掉拒绝)', async () => {
    const handle = startDeviceConnection({
      baseUrl: 'https://gw.example',
      sk: 'tbk_x',
      deviceId: 'd-rej',
      expose: { shell: { allow: [] } },
    })
    const socket = FakeWs.instances[0]
    expect(socket).toBeDefined()
    socket?.dispatch('open', {})
    expect(socket?.sent.some(f => f.includes('"type":"hello"'))).toBe(true)
    socket?.dispatch('message', { data: REJECT_FRAME })
    await expect(handle.closed).rejects.toMatchObject({
      name: 'CliError',
      code: 'permission_denied',
      message: 'registerPaths 越界',
    })
    await expect(handle.closed).rejects.toBeInstanceOf(CliError)
  })

  it('tb connect 被拒 → stderr 输出错误信息、退出码非 0', async () => {
    // connect 是长驻命令:runCli 的 promise 在连接关闭后才 resolve,先派发帧再 await。
    const running = runCli([
      'connect',
      '--base-url',
      'https://gw.example',
      '--sk',
      'tbk_x',
      '--device-id',
      'd-rej-cmd',
    ])
    await vi.waitFor(() => expect(FakeWs.instances.length).toBe(1))
    const socket = FakeWs.instances[0]
    socket?.dispatch('open', {})
    socket?.dispatch('message', { data: REJECT_FRAME })
    await running
    expect(process.exitCode).toBe(1)
    const stderr = (process.stderr.write as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map(c => String(c[0]))
      .join('')
    expect(stderr).toContain('registerPaths 越界')
  })
})
