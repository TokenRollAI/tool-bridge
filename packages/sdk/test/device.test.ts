import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectDevice,
  createReactNativeWebSocketFactory,
  decodeDeviceFrame,
  type DeviceFrame,
  type DeviceWebSocketFactory,
  type DeviceWebSocketFactoryInput,
  encodeDeviceFrame,
  type ReactNativeWebSocketConstructor,
} from '../src/device'

class FakeRawWebSocket extends EventTarget {
  static readonly CLOSED = 3
  static readonly CLOSING = 2
  static readonly CONNECTING = 0
  static readonly OPEN = 1

  binaryType = 'blob'
  readonly bufferedAmount = 0
  readonly extensions = ''
  readonly protocol = ''
  readyState = FakeRawWebSocket.CONNECTING
  readonly sent: string[] = []

  constructor(readonly url: string) {
    super()
  }

  close(): void {
    if (this.readyState === FakeRawWebSocket.CLOSED) return
    this.readyState = FakeRawWebSocket.CLOSED
    this.dispatchEvent(new Event('close'))
  }

  open(): void {
    this.readyState = FakeRawWebSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  receive(frame: DeviceFrame): void {
    this.dispatchEvent(new MessageEvent('message', { data: encodeDeviceFrame(frame) }))
  }

  send(data: string): void {
    this.sent.push(data)
  }
}

interface FactoryHarness {
  factory: DeviceWebSocketFactory
  inputs: DeviceWebSocketFactoryInput[]
  sockets: FakeRawWebSocket[]
}

function factoryHarness(): FactoryHarness {
  const inputs: DeviceWebSocketFactoryInput[] = []
  const sockets: FakeRawWebSocket[] = []
  return {
    inputs,
    sockets,
    factory: {
      open(input) {
        inputs.push(input)
        const socket = new FakeRawWebSocket(input.url)
        sockets.push(socket)
        return socket as unknown as WebSocket
      },
    },
  }
}

async function connectAttempt(harness: FactoryHarness, expectedCount: number): Promise<FakeRawWebSocket> {
  await vi.advanceTimersByTimeAsync(0)
  await vi.waitFor(() => expect(harness.sockets).toHaveLength(expectedCount))
  const socket = harness.sockets.at(-1)
  if (socket === undefined) throw new Error('missing fake socket')
  return socket
}

function helloFrames(socket: FakeRawWebSocket): DeviceFrame[] {
  return socket.sent.map(text => decodeDeviceFrame(text))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('@tool-bridge/sdk/device neutral connection', () => {
  it('注入 RN transport 与 Authorization，完成 hello/ready/call/result', async () => {
    const harness = factoryHarness()
    const calls: unknown[] = []
    const connection = connectDevice({
      baseUrl: 'https://tb.example/base',
      deviceId: 'phone-01',
      expose: {
        nodes: [
          {
            path: 'camera',
            kind: 'tool',
            description: '相机',
            cmds: [{ name: 'capture', outputSchema: { type: 'object' } }],
          },
        ],
      },
      credentialProvider: {
        prepare: () => ({ headers: { authorization: 'Bearer device-secret' } }),
      },
      webSocketFactory: harness.factory,
      handler: async (call) => {
        calls.push(call)
        return { uri: 'file:///capture.jpg' }
      },
    })

    const socket = await connectAttempt(harness, 1)
    expect(harness.inputs).toEqual([
      {
        url: 'wss://tb.example/system/device/ws?deviceId=phone-01',
        headers: { authorization: 'Bearer device-secret' },
      },
    ])

    socket.open()
    expect(helloFrames(socket)).toEqual([
      {
        type: 'hello',
        deviceId: 'phone-01',
        expose: {
          nodes: [
            {
              path: 'camera',
              kind: 'tool',
              description: '相机',
              cmds: [{ name: 'capture', outputSchema: { type: 'object' } }],
            },
          ],
        },
      },
    ])

    socket.receive({ type: 'ready', mountPath: 'device/phone-01' })
    await expect(connection.ready).resolves.toBe('device/phone-01')
    expect(connection.state).toBe('ready')

    socket.sent.length = 0
    socket.receive({
      type: 'call',
      id: 'call-1',
      path: 'camera',
      tool: 'capture',
      arguments: { quality: 0.8 },
    })
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      id: 'call-1',
      path: 'camera',
      tool: 'capture',
      arguments: { quality: 0.8 },
      signal: { aborted: false },
    })
    expect(helloFrames(socket)).toEqual([
      { type: 'result', id: 'call-1', ok: true, value: { uri: 'file:///capture.jpg' } },
    ])

    connection.close()
    await connection.closed
    expect(connection.state).toBe('closed')
  })

  it('每次 restart 重新读取凭证', async () => {
    const harness = factoryHarness()
    let prepares = 0
    const connection = connectDevice({
      baseUrl: 'https://tb.example',
      deviceId: 'phone-02',
      expose: { nodes: [{ path: 'status', kind: 'context', description: '状态' }] },
      credentialProvider: {
        prepare: () => ({ headers: { authorization: `Bearer token-${++prepares}` } }),
      },
      webSocketFactory: harness.factory,
      handler: async () => null,
    })

    const first = await connectAttempt(harness, 1)
    first.open()
    first.receive({ type: 'ready', mountPath: 'device/phone-02' })
    await connection.ready
    connection.restart()
    const second = await connectAttempt(harness, 2)
    expect(harness.inputs.map(input => input.headers?.authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ])
    second.open()
    expect(helloFrames(second)[0]).toMatchObject({ type: 'hello', deviceId: 'phone-02' })
    connection.close()
  })

  it('suspend 停止连接，resume 以新 transport 恢复', async () => {
    const harness = factoryHarness()
    const states: string[] = []
    const connection = connectDevice({
      baseUrl: 'https://tb.example',
      deviceId: 'phone-03',
      expose: { nodes: [{ path: 'status', kind: 'context', description: '状态' }] },
      credentialProvider: { prepare: () => ({}) },
      webSocketFactory: harness.factory,
      handler: async () => null,
      onStateChange: state => states.push(state),
    })
    const first = await connectAttempt(harness, 1)
    first.open()
    first.receive({ type: 'ready', mountPath: 'device/phone-03' })
    await connection.ready

    connection.suspend()
    expect(connection.state).toBe('suspended')
    connection.resume()
    expect(connection.state).toBe('reconnecting')
    const second = await connectAttempt(harness, 2)
    second.open()
    second.receive({ type: 'ready', mountPath: 'device/phone-03' })
    await vi.waitFor(() => expect(connection.state).toBe('ready'))
    expect(states).toContain('suspended')
    connection.close()
  })

  it('网关 error 使 ready reject、凭证失效并终止重连', async () => {
    const harness = factoryHarness()
    const invalidated: unknown[] = []
    const connection = connectDevice({
      baseUrl: 'https://tb.example',
      deviceId: 'phone-04',
      expose: { nodes: [{ path: 'status', kind: 'context', description: '状态' }] },
      credentialProvider: {
        prepare: () => ({}),
        invalidate: reason => invalidated.push(reason),
      },
      webSocketFactory: harness.factory,
      handler: async () => null,
    })
    const socket = await connectAttempt(harness, 1)
    socket.open()
    socket.receive({
      type: 'error',
      error: { code: 'permission_denied', message: 'register denied', retryable: false },
    })
    await expect(connection.ready).rejects.toMatchObject({
      code: 'permission_denied',
      message: 'register denied',
    })
    await connection.closed
    expect(connection.state).toBe('closed')
    expect(invalidated).toEqual([
      { code: 'permission_denied', message: 'register denied', retryable: false },
    ])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(harness.sockets).toHaveLength(1)
  })

  it('安全作者面拒绝非规范路径', async () => {
    const harness = factoryHarness()
    const connection = connectDevice({
      baseUrl: 'https://tb.example',
      deviceId: 'phone-05',
      expose: { nodes: [{ path: '/camera', kind: 'tool', description: '相机' }] },
      credentialProvider: { prepare: () => ({}) },
      webSocketFactory: harness.factory,
      handler: async () => null,
    })
    await expect(connection.ready).rejects.toMatchObject({ code: 'invalid_argument' })
    await connection.closed
    expect(harness.sockets).toEqual([])
  })
})

describe('React Native WebSocket adapter', () => {
  it('仅在 adapter 内使用第三参数 headers', () => {
    const calls: unknown[][] = []
    const Constructor = function (
      this: unknown,
      ...args: unknown[]
    ): FakeRawWebSocket {
      calls.push(args)
      return new FakeRawWebSocket(String(args[0]))
    } as unknown as ReactNativeWebSocketConstructor
    const factory = createReactNativeWebSocketFactory(Constructor)
    factory.open({
      url: 'wss://tb.example/system/device/ws?deviceId=phone',
      protocols: ['tb-device'],
      headers: { authorization: 'Bearer secret' },
    })
    expect(calls).toEqual([
      [
        'wss://tb.example/system/device/ws?deviceId=phone',
        ['tb-device'],
        { headers: { authorization: 'Bearer secret' } },
      ],
    ])
  })
})
