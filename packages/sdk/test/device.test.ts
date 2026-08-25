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
      path: 'camera/capture',
      arguments: { quality: 0.8 },
      context: {
        caller: { keyId: 'sk_1', owner: 'agent:researcher' },
        traceId: 'trace-1',
        createdAt: '2026-08-19T00:00:00.000Z',
        expiresAt: '2026-08-19T00:01:00.000Z',
      },
    })
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      id: 'call-1',
      path: 'camera/capture',
      arguments: { quality: 0.8 },
      signal: { aborted: false },
      context: {
        caller: { keyId: 'sk_1', owner: 'agent:researcher' },
        traceId: 'trace-1',
        expiresAt: '2026-08-19T00:01:00.000Z',
      },
    })
    expect(helloFrames(socket)).toEqual([
      { type: 'result', id: 'call-1', ok: true, value: { uri: 'file:///capture.jpg' } },
    ])

    connection.close()
    await connection.closed
    expect(connection.state).toBe('closed')
  })

  it('兼容:老网关 call 不带 context → consumer handler 的 context 为 undefined', async () => {
    const harness = factoryHarness()
    const calls: Array<Record<string, unknown>> = []
    const connection = connectDevice({
      baseUrl: 'https://tb.example',
      deviceId: 'phone-legacy',
      expose: { nodes: [{ path: 'status', kind: 'context', description: '状态' }] },
      credentialProvider: { prepare: () => ({ headers: {} }) },
      webSocketFactory: harness.factory,
      handler: async (call) => {
        calls.push(call)
        return null
      },
    })

    const socket = await connectAttempt(harness, 1)
    socket.open()
    socket.receive({ type: 'ready', mountPath: 'device/phone-legacy' })
    await connection.ready
    socket.receive({ type: 'call', id: 'c1', path: 'status/get', arguments: {} })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).not.toHaveProperty('context')
    expect(calls[0]?.context).toBeUndefined()

    connection.close()
    await connection.closed
  })

  it('call.uploadObject 只用 call capability 创建 relay upload，并返回稳定 Store URI', async () => {
    const harness = factoryHarness()
    const preparePurposes: Array<string | undefined> = []
    const httpCalls: Array<{ init?: RequestInit, input: Parameters<typeof fetch>[0] }> = []
    let handlerContext: unknown
    const readyObject = {
      uri: 'store://default/call-photo-01',
      contentType: 'image/jpeg',
      filename: 'capture.jpg',
      size: 4,
      createdAt: '2099-08-24T11:59:00.000Z',
      readyAt: '2099-08-24T12:00:00.000Z',
    }
    const grant = {
      uploadId: 'call-upload-01',
      objectUri: readyObject.uri,
      transport: 'relay',
      method: 'PUT',
      url: 'https://tb.example/~store/uploads/call-upload-01',
      headers: { 'content-type': 'image/jpeg' },
      expiresAt: '2099-08-24T12:10:00.000Z',
      maxBytes: 1024,
      uploadToken: 'upload-session-secret',
    }
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      httpCalls.push({ input, init })
      return httpCalls.length === 1
        ? new Response(JSON.stringify(grant), { status: 200 })
        : new Response(JSON.stringify(readyObject), { status: 200 })
    })
    const connection = connectDevice({
      baseUrl: 'https://tb.example',
      deviceId: 'phone-store',
      expose: { nodes: [{ path: 'camera', kind: 'tool', description: '相机' }] },
      credentialProvider: {
        prepare: ({ purpose }) => {
          preparePurposes.push(purpose)
          return { headers: { authorization: 'Bearer device-secret' } }
        },
      },
      fetcher,
      webSocketFactory: harness.factory,
      handler: async (call) => {
        handlerContext = call.context
        return await call.uploadObject({
          body: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
          contentType: 'image/jpeg',
          filename: 'capture.jpg',
        })
      },
    })

    const socket = await connectAttempt(harness, 1)
    socket.open()
    socket.receive({ type: 'ready', mountPath: 'device/phone-store' })
    await connection.ready
    socket.sent.length = 0
    socket.receive({
      type: 'call',
      id: 'call-store-01',
      path: 'camera/capture',
      arguments: {},
      context: {
        caller: { keyId: 'sk-caller', owner: 'agent:caller' },
        traceId: 'trace-store-01',
        createdAt: '2099-08-24T11:59:00.000Z',
        expiresAt: '2099-08-24T12:10:00.000Z',
        upload: {
          token: 'call-capability-secret',
          expiresAt: '2099-08-24T12:10:00.000Z',
          maxBytes: 1024,
          maxObjects: 1,
        },
      },
    } as unknown as DeviceFrame)

    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
    expect(helloFrames(socket)).toEqual([
      { type: 'result', id: 'call-store-01', ok: true, value: readyObject },
    ])
    expect(handlerContext).toMatchObject({
      upload: {
        expiresAt: '2099-08-24T12:10:00.000Z',
        maxBytes: 1024,
        maxObjects: 1,
      },
    })
    expect(handlerContext).not.toHaveProperty('upload.token')
    expect(JSON.stringify(handlerContext)).not.toContain('call-capability-secret')
    expect(socket.sent.join('\n')).not.toContain('call-capability-secret')
    expect(httpCalls).toHaveLength(2)
    const createHeaders = new Headers(httpCalls[0]?.init?.headers)
    expect(createHeaders.get('x-tb-store-capability')).toBe('call-capability-secret')
    expect(createHeaders.get('authorization')).toBeNull()
    expect(preparePurposes).toEqual(['websocket'])
    const relayHeaders = new Headers(httpCalls[1]?.init?.headers)
    expect(relayHeaders.get('x-tb-store-upload')).toBe('upload-session-secret')

    connection.close()
  })

  it('本地校验/网络失败不消耗 SDK 对象额度，后续尝试仍交给服务端权威 reservation', async () => {
    const harness = factoryHarness()
    const readyObject = {
      uri: 'store://default/retried-photo-01',
      contentType: 'image/jpeg',
      size: 1,
      createdAt: '2099-08-24T11:59:00.000Z',
      readyAt: '2099-08-24T12:00:00.000Z',
    }
    const grant = {
      uploadId: 'retry-upload-01',
      objectUri: readyObject.uri,
      transport: 'relay',
      method: 'PUT',
      url: 'https://tb.example/~store/uploads/retry-upload-01',
      headers: { 'content-type': 'image/jpeg' },
      expiresAt: '2099-08-24T12:10:00.000Z',
      maxBytes: 1024,
      uploadToken: 'retry-session-secret',
    }
    const fetcher: typeof fetch = vi.fn()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(new Response(JSON.stringify(grant), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(readyObject), { status: 200 }))
    const failures: string[] = []
    const connection = connectDevice({
      baseUrl: 'https://tb.example',
      deviceId: 'phone-retry-store',
      expose: { nodes: [{ path: 'camera', kind: 'tool', description: '相机' }] },
      credentialProvider: { prepare: () => ({}) },
      fetcher,
      webSocketFactory: harness.factory,
      handler: async (call) => {
        try {
          await call.uploadObject({ body: new Uint8Array([1]), contentType: '' })
        } catch (error) {
          failures.push((error as { code?: string }).code ?? 'unknown')
        }
        try {
          await call.uploadObject({ body: new Uint8Array([1]), contentType: 'image/jpeg' })
        } catch (error) {
          failures.push((error as { code?: string }).code ?? 'unknown')
        }
        return await call.uploadObject({ body: new Uint8Array([1]), contentType: 'image/jpeg' })
      },
    })
    const socket = await connectAttempt(harness, 1)
    socket.open()
    socket.receive({ type: 'ready', mountPath: 'device/phone-retry-store' })
    await connection.ready
    socket.sent.length = 0
    socket.receive({
      type: 'call',
      id: 'retry-store-call',
      path: 'camera/capture',
      arguments: {},
      context: {
        caller: { keyId: 'sk-caller', owner: 'agent:caller' },
        traceId: 'trace-retry-store',
        createdAt: '2099-08-24T11:59:00.000Z',
        expiresAt: '2099-08-24T12:10:00.000Z',
        upload: {
          token: 'retry-call-capability',
          expiresAt: '2099-08-24T12:10:00.000Z',
          maxBytes: 1024,
          maxObjects: 1,
        },
      },
    } as unknown as DeviceFrame)

    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
    expect(failures).toEqual(['invalid_argument', 'unavailable'])
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(helloFrames(socket)).toEqual([
      { type: 'result', id: 'retry-store-call', ok: true, value: readyObject },
    ])
    connection.close()
  })

  it('老网关不带 capability 时 call.uploadObject 明确 unavailable，仍不发 HTTP', async () => {
    const harness = factoryHarness()
    const fetcher: typeof fetch = vi.fn()
    const connection = connectDevice({
      baseUrl: 'https://tb.example',
      deviceId: 'phone-no-store-cap',
      expose: { nodes: [{ path: 'camera', kind: 'tool', description: '相机' }] },
      credentialProvider: { prepare: () => ({}) },
      fetcher,
      webSocketFactory: harness.factory,
      handler: async call => await call.uploadObject({
        body: new Uint8Array([1]),
        contentType: 'image/jpeg',
      }),
    })

    const socket = await connectAttempt(harness, 1)
    socket.open()
    socket.receive({ type: 'ready', mountPath: 'device/phone-no-store-cap' })
    await connection.ready
    socket.sent.length = 0
    socket.receive({ type: 'call', id: 'legacy-call', path: 'camera/capture', arguments: {} })
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
    expect(helloFrames(socket)).toEqual([{
      type: 'result',
      id: 'legacy-call',
      ok: false,
      error: {
        code: 'unavailable',
        message: 'device call does not include a usable Store upload capability',
        retryable: false,
      },
    }])
    expect(fetcher).not.toHaveBeenCalled()
    connection.close()
  })

  it('call.uploadObject 在 capability 过期或已知 body 超限时本地拒绝', async () => {
    const harness = factoryHarness()
    const fetcher: typeof fetch = vi.fn()
    const connection = connectDevice({
      baseUrl: 'https://tb.example',
      deviceId: 'phone-limited-store',
      expose: { nodes: [{ path: 'camera', kind: 'tool', description: '相机' }] },
      credentialProvider: { prepare: () => ({}) },
      fetcher,
      webSocketFactory: harness.factory,
      handler: async call => await call.uploadObject({
        body: new Uint8Array([1, 2, 3, 4]),
        contentType: 'image/jpeg',
      }),
    })
    const socket = await connectAttempt(harness, 1)
    socket.open()
    socket.receive({ type: 'ready', mountPath: 'device/phone-limited-store' })
    await connection.ready
    socket.sent.length = 0

    const baseContext = {
      caller: { keyId: 'sk-caller', owner: 'agent:caller' },
      traceId: 'trace-limited',
      createdAt: '2099-08-24T11:59:00.000Z',
      expiresAt: '2099-08-24T12:10:00.000Z',
    }
    socket.receive({
      type: 'call',
      id: 'expired-upload',
      path: 'camera/capture',
      arguments: {},
      context: {
        ...baseContext,
        upload: {
          token: 'expired-capability',
          expiresAt: '2000-01-01T00:00:00.000Z',
          maxBytes: 1024,
          maxObjects: 1,
        },
      },
    } as unknown as DeviceFrame)
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
    expect(helloFrames(socket)[0]).toMatchObject({
      type: 'result',
      id: 'expired-upload',
      ok: false,
      error: { code: 'unavailable' },
    })

    socket.receive({
      type: 'call',
      id: 'oversize-upload',
      path: 'camera/capture',
      arguments: {},
      context: {
        ...baseContext,
        upload: {
          token: 'small-capability',
          expiresAt: '2099-08-24T12:10:00.000Z',
          maxBytes: 3,
          maxObjects: 1,
        },
      },
    } as unknown as DeviceFrame)
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2))
    expect(helloFrames(socket)[1]).toMatchObject({
      type: 'result',
      id: 'oversize-upload',
      ok: false,
      error: { code: 'invalid_argument', message: expect.stringContaining('maxBytes') },
    })
    expect(fetcher).not.toHaveBeenCalled()
    connection.close()
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
