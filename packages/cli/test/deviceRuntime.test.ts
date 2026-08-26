import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReconnectingWebSocket from 'partysocket/ws'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDeviceConnection } from '../src/deviceRuntime'
import { CliError } from '../src/http'
import { runCli } from './cliHarness'

const nodeWsHarness = vi.hoisted(() => ({
  instances: [] as Array<{
    headers?: Record<string, string>
    protocols?: string | string[]
    url: string
  }>,
}))

vi.mock('ws', () => {
  class FakeNodeWebSocket {
    constructor(
      url: string,
      protocolsOrOptions?: string | string[] | { headers?: Record<string, string> },
      options?: { headers?: Record<string, string> },
    ) {
      const protocols
        = typeof protocolsOrOptions === 'string' || Array.isArray(protocolsOrOptions)
          ? protocolsOrOptions
          : undefined
      const socketOptions = protocols === undefined ? protocolsOrOptions : options
      nodeWsHarness.instances.push({
        url,
        ...(protocols === undefined ? {} : { protocols }),
        ...(socketOptions?.headers === undefined
          ? {}
          : { headers: { ...socketOptions.headers } }),
      })
    }
  }
  return { default: FakeNodeWebSocket }
})

// 复现 supervisor 依赖的 PartySocket 边界：每次 connect/reconnect 都重新
// 解析 URL + protocols，再调用注入的 Node WebSocket factory。close() 刻意同步
// 派发，锁住“网关拒绝不得被 close resolve 抢先吞掉”的历史回归。
vi.mock('partysocket/ws', () => {
  type Listener = (ev: unknown) => void
  class FakeReconnectingWebSocket {
    static OPEN = 1
    static instances: FakeReconnectingWebSocket[] = []
    readyState = 1
    reconnects: unknown[][] = []
    sent: string[] = []
    private listeners = new Map<string, Listener[]>()
    constructor(
      private readonly urlProvider: string | (() => string | Promise<string>),
      private readonly protocolsProvider:
        | string
        | string[]
        | null
        | (() => string | string[] | null | Promise<string | string[] | null>),
      private readonly options: { WebSocket: new (url: string, protocols?: string | string[]) => WebSocket },
    ) {
      FakeReconnectingWebSocket.instances.push(this)
      void this.connect()
    }

    addEventListener(type: string, fn: Listener): void {
      const arr = this.listeners.get(type) ?? []
      arr.push(fn)
      this.listeners.set(type, arr)
    }

    private async connect(): Promise<void> {
      const url = typeof this.urlProvider === 'function'
        ? await this.urlProvider()
        : this.urlProvider
      const protocols = typeof this.protocolsProvider === 'function'
        ? await this.protocolsProvider()
        : this.protocolsProvider
      this.readyState = 1
      new this.options.WebSocket(url, protocols ?? undefined)
    }

    send(data: string): void {
      this.sent.push(String(data))
    }

    close(): void {
      this.readyState = 3
      this.dispatch('close', {})
    }

    reconnect(...args: unknown[]): void {
      this.reconnects.push(args)
      void this.connect()
    }

    dispatch(type: string, ev: unknown): void {
      if (type === 'open') this.readyState = 1
      if (type === 'close') this.readyState = 3
      for (const fn of this.listeners.get(type) ?? []) fn(ev)
    }
  }
  return { default: FakeReconnectingWebSocket }
})

interface FakeSocket {
  dispatch(type: string, ev: unknown): void
  reconnects: unknown[][]
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
  nodeWsHarness.instances.length = 0
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
    await vi.waitFor(() => expect(FakeWs.instances).toHaveLength(1))
    const socket = FakeWs.instances[0]
    expect(socket).toBeDefined()
    socket?.dispatch('open', {})
    expect(socket?.sent.some(f => f.includes('"type":"hello"'))).toBe(true)
    socket?.dispatch('message', { data: REJECT_FRAME })
    await expect(handle.ready).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(handle.closed).rejects.toMatchObject({
      name: 'CliError',
      code: 'permission_denied',
      message: 'registerPaths 越界',
    })
    await expect(handle.closed).rejects.toBeInstanceOf(CliError)
    handle.restart()
    await Promise.resolve()
    expect(nodeWsHarness.instances).toHaveLength(1)
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

describe('SDK device supervisor 的 Node adapter', () => {
  it('原样发送 legacy expose，保留 shell device kind 与 fs readOnly 服务端语义', async () => {
    const root = tmpConfig
    if (root === undefined) throw new Error('missing temp root')
    const onReady = vi.fn()
    const states: string[] = []
    const options = {
      baseUrl: 'https://gw.example/base',
      sk: 'tbk_first',
      deviceId: 'd-wire',
      mountPath: 'device/custom',
      expose: {
        shell: { allow: ['echo'], description: 'CI shell' },
        fs: { roots: [root], readOnly: true },
      },
      onReady,
      onStateChange: (state: string) => states.push(state),
    }
    const handle = startDeviceConnection(options)
    await vi.waitFor(() => expect(nodeWsHarness.instances).toHaveLength(1))
    expect(nodeWsHarness.instances[0]).toEqual({
      url: 'wss://gw.example/system/device/ws?deviceId=d-wire',
      headers: { authorization: 'Bearer tbk_first' },
    })

    const socket = FakeWs.instances[0]
    socket?.dispatch('open', {})
    expect(socket?.sent.map(frame => JSON.parse(frame))).toEqual([{
      type: 'hello',
      deviceId: 'd-wire',
      mountPath: 'device/custom',
      expose: {
        shell: { allow: ['echo'], description: 'CI shell' },
        fs: { roots: [root], readOnly: true },
      },
    }])
    socket?.dispatch('message', {
      data: JSON.stringify({ type: 'ready', mountPath: 'device/custom' }),
    })
    await expect(handle.ready).resolves.toBe('device/custom')
    expect(handle.state).toBe('ready')
    expect(onReady).toHaveBeenCalledWith('device/custom')

    options.sk = 'tbk_restart'
    handle.restart()
    await vi.waitFor(() => expect(nodeWsHarness.instances).toHaveLength(2))
    expect(nodeWsHarness.instances[1]?.headers).toEqual({ authorization: 'Bearer tbk_restart' })
    expect(handle.state).toBe('reconnecting')

    handle.suspend()
    expect(handle.state).toBe('suspended')
    options.sk = 'tbk_resume'
    handle.resume()
    await vi.waitFor(() => expect(nodeWsHarness.instances).toHaveLength(3))
    expect(nodeWsHarness.instances[2]?.headers).toEqual({ authorization: 'Bearer tbk_resume' })
    expect(states).toContain('suspended')

    handle.close()
    await expect(handle.closed).resolves.toBeUndefined()
    expect(handle.state).toBe('closed')
  })

  it('readOnly fs 在设备侧仍 fail-closed 拒绝写入', async () => {
    const root = tmpConfig
    if (root === undefined) throw new Error('missing temp root')
    const handle = startDeviceConnection({
      baseUrl: 'https://gw.example',
      sk: 'tbk_x',
      deviceId: 'd-readonly',
      expose: { fs: { roots: [root], readOnly: true } },
    })
    await vi.waitFor(() => expect(FakeWs.instances).toHaveLength(1))
    const socket = FakeWs.instances[0]
    socket?.dispatch('open', {})
    socket?.dispatch('message', {
      data: JSON.stringify({ type: 'ready', mountPath: 'device/d-readonly' }),
    })
    await handle.ready
    socket?.sent.splice(0)
    socket?.dispatch('message', {
      data: JSON.stringify({
        type: 'call',
        id: 'write-1',
        path: 'fs/write',
        arguments: {
          path: 'note.txt',
          entry: { content: 'blocked', contentType: 'text/plain' },
        },
      }),
    })
    await vi.waitFor(() => expect(socket?.sent).toHaveLength(1))
    expect(JSON.parse(socket?.sent[0] ?? '')).toEqual({
      type: 'result',
      id: 'write-1',
      ok: false,
      error: {
        code: 'permission_denied',
        message: 'readOnly 挂载拒绝 write',
        retryable: false,
      },
    })
    handle.close()
    await handle.closed
  })

  it('structured command 直传 argv 执行并返回机器可读终态', async () => {
    const profile = {
      version: 1 as const,
      path: 'ops/system',
      description: 'safe operations',
      commands: [{
        name: 'echo-value',
        description: 'echo one argv value',
        executable: process.execPath,
        effect: 'read' as const,
        argv: [
          '-e',
          'process.stdout.write(process.argv[1])',
          { input: 'value', required: true },
        ],
      }],
    }
    const handle = startDeviceConnection({
      baseUrl: 'https://gw.example',
      sk: 'tbk_x',
      deviceId: 'd-structured',
      commandProfiles: [profile],
      expose: {
        nodes: [{
          path: profile.path,
          kind: 'tool',
          description: profile.description,
          cmds: [{ name: 'echo-value', effect: 'read' }],
        }],
      },
    })
    await vi.waitFor(() => expect(FakeWs.instances).toHaveLength(1))
    const socket = FakeWs.instances[0]
    socket?.dispatch('open', {})
    socket?.dispatch('message', {
      data: JSON.stringify({ type: 'ready', mountPath: 'device/d-structured' }),
    })
    await handle.ready
    socket?.sent.splice(0)
    socket?.dispatch('message', {
      data: JSON.stringify({
        type: 'call',
        id: 'structured-1',
        path: 'ops/system/echo-value',
        arguments: { value: 'hello; exit 7' },
      }),
    })
    await vi.waitFor(() => expect(socket?.sent).toHaveLength(1))
    const result = JSON.parse(socket?.sent[0] ?? '') as Record<string, unknown>
    expect(result).toMatchObject({
      type: 'result',
      id: 'structured-1',
      ok: true,
      value: {
        stdout: 'hello; exit 7',
        stderr: '',
        exitCode: 0,
        outcome: 'exited',
        stdoutTruncated: false,
        stderrTruncated: false,
      },
    })
    expect(result.value).toMatchObject({
      startedAt: expect.any(String),
      completedAt: expect.any(String),
    })
    handle.close()
    await handle.closed
  })

  it('心跳 timer unref；一轮无入站帧后由 SDK supervisor 主动重连', async () => {
    const unref = vi.fn()
    let tick: (() => void) | undefined
    const timer = { unref }
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation((callback) => {
      tick = callback as () => void
      return timer as unknown as ReturnType<typeof setInterval>
    })
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {})
    const handle = startDeviceConnection({
      baseUrl: 'https://gw.example',
      sk: 'tbk_x',
      deviceId: 'd-heartbeat',
      expose: { shell: { allow: [] } },
    })
    await vi.waitFor(() => expect(FakeWs.instances).toHaveLength(1))
    const socket = FakeWs.instances[0]
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000)
    expect(unref).toHaveBeenCalledOnce()
    socket?.dispatch('open', {})
    socket?.sent.splice(0)

    tick?.()
    expect(socket?.sent).toEqual(['{"type":"ping"}'])
    tick?.()
    await vi.waitFor(() => expect(nodeWsHarness.instances).toHaveLength(2))
    expect(socket?.reconnects).toContainEqual([1012, 'heartbeat timeout'])

    handle.close()
    await handle.closed
    expect(clearIntervalSpy).toHaveBeenCalledWith(timer)
  })
})
