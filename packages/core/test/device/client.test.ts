import { describe, expect, it } from 'vitest'
import { DeviceClient, type DeviceClientState, type DeviceSocket } from '../../src/device/client'
import { decodeDeviceFrame, type DeviceFrame, encodeDeviceFrame } from '../../src/device/frames'
import { TBError, type TBErrorBody } from '../../src/errors'

function fakeSocket() {
  const sent: DeviceFrame[] = []
  const closed: Array<number | undefined> = []
  const socket: DeviceSocket = {
    send: data => sent.push(decodeDeviceFrame(data)),
    close: code => closed.push(code),
  }
  return { socket, sent, closed }
}

function makeClient(overrides: Partial<ConstructorParameters<typeof DeviceClient>[0]> = {}) {
  const states: DeviceClientState[] = []
  const readies: string[] = []
  const rejections: TBErrorBody[] = []
  const client = new DeviceClient({
    deviceId: 'd1',
    expose: { shell: { allow: ['echo'] } },
    handler: async () => 'ok',
    onStateChange: s => states.push(s),
    onReady: m => readies.push(m),
    onRejected: e => rejections.push(e),
    ...overrides,
  })
  return { client, states, readies, rejections }
}

const READY = encodeDeviceFrame({ type: 'ready', mountPath: 'device/d1' })

describe('握手与状态', () => {
  it('socketOpened → 发 hello(deviceId/expose;mountPath 缺省不出现)', () => {
    const { client } = makeClient()
    const { socket, sent } = fakeSocket()
    client.socketOpened(socket)
    expect(sent).toEqual([
      { type: 'hello', deviceId: 'd1', expose: { shell: { allow: ['echo'] } } },
    ])
  })

  it('mountPath 显式声明时进 hello 帧', () => {
    const { client } = makeClient({ mountPath: 'teams/a/d1' })
    const { socket, sent } = fakeSocket()
    client.socketOpened(socket)
    expect(sent[0]).toMatchObject({ type: 'hello', mountPath: 'teams/a/d1' })
  })

  it('ready 帧 → state ready + onReady(mountPath)', async () => {
    const { client, readies } = makeClient()
    const { socket } = fakeSocket()
    client.socketOpened(socket)
    expect(client.state).toBe('connecting')
    await client.socketMessage(READY)
    expect(client.state).toBe('ready')
    expect(readies).toEqual(['device/d1'])
  })

  it('error 帧 = 权限拒绝 → closed 不重连', async () => {
    const { client, rejections } = makeClient()
    const { socket } = fakeSocket()
    client.socketOpened(socket)
    await client.socketMessage(
      encodeDeviceFrame({
        type: 'error',
        error: { code: 'permission_denied', message: 'nope', retryable: false },
      }),
    )
    expect(client.state).toBe('closed')
    expect(rejections).toEqual([{ code: 'permission_denied', message: 'nope', retryable: false }])
    client.socketClosed() // 网关随后关闭连接
    expect(client.state).toBe('closed') // 不进入 reconnecting
  })
})

describe('call 处理与幂等', () => {
  const CALL = encodeDeviceFrame({
    type: 'call',
    id: 'r1',
    path: 'shell',
    tool: 'exec',
    arguments: { command: 'echo hi' },
  })

  it('call → handler 执行 → 回 ok result', async () => {
    const calls: unknown[] = []
    const { client } = makeClient({
      handler: async (call) => {
        calls.push(call)
        return { stdout: 'hi\n' }
      },
    })
    const { socket, sent } = fakeSocket()
    client.socketOpened(socket)
    await client.socketMessage(READY)
    sent.length = 0
    await client.socketMessage(CALL)
    expect(calls).toEqual([{ path: 'shell', tool: 'exec', arguments: { command: 'echo hi' } }])
    expect(sent).toEqual([{ type: 'result', id: 'r1', ok: true, value: { stdout: 'hi\n' } }])
  })

  it('handler 抛 TBError → 回错误 result(码保真)', async () => {
    const { client } = makeClient({
      handler: async () => {
        throw new TBError('permission_denied', '命令不在白名单')
      },
    })
    const { socket, sent } = fakeSocket()
    client.socketOpened(socket)
    await client.socketMessage(READY)
    sent.length = 0
    await client.socketMessage(CALL)
    expect(sent).toEqual([
      {
        type: 'result',
        id: 'r1',
        ok: false,
        error: { code: 'permission_denied', message: '命令不在白名单', retryable: false },
      },
    ])
  })

  it('handler 抛非 TBError → internal', async () => {
    const { client } = makeClient({
      handler: async () => {
        throw new Error('boom')
      },
    })
    const { socket, sent } = fakeSocket()
    client.socketOpened(socket)
    await client.socketMessage(READY)
    sent.length = 0
    await client.socketMessage(CALL)
    expect(sent[0]).toMatchObject({
      type: 'result',
      ok: false,
      error: { code: 'internal', message: 'boom' },
    })
  })

  it('重复 call id → handler 只执行一次,以缓存结果幂等应答', async () => {
    let runs = 0
    const { client } = makeClient({
      handler: async () => {
        runs++
        return runs
      },
    })
    const { socket, sent } = fakeSocket()
    client.socketOpened(socket)
    await client.socketMessage(READY)
    sent.length = 0
    await client.socketMessage(CALL)
    await client.socketMessage(CALL)
    expect(runs).toBe(1)
    expect(sent).toEqual([
      { type: 'result', id: 'r1', ok: true, value: 1 },
      { type: 'result', id: 'r1', ok: true, value: 1 },
    ])
  })

  it('执行中收到重复 call id → 不再起第二次执行', async () => {
    let release: (() => void) | undefined
    let runs = 0
    const { client } = makeClient({
      handler: () => {
        runs++
        return new Promise((resolve) => {
          release = () => resolve('done')
        })
      },
    })
    const { socket, sent } = fakeSocket()
    client.socketOpened(socket)
    await client.socketMessage(READY)
    sent.length = 0
    const first = client.socketMessage(CALL)
    const second = client.socketMessage(CALL) // in-flight 重复:忽略
    await second
    expect(runs).toBe(1)
    release?.()
    await first
    expect(sent).toEqual([{ type: 'result', id: 'r1', ok: true, value: 'done' }])
  })

  it('缓存有界:超上限逐最旧', async () => {
    const { client } = makeClient({ maxCachedResults: 1, handler: async () => 'v' })
    const { socket, sent } = fakeSocket()
    client.socketOpened(socket)
    await client.socketMessage(READY)
    const callFrame = (id: string) =>
      encodeDeviceFrame({ type: 'call', id, path: 'shell', tool: 'exec', arguments: {} })
    await client.socketMessage(callFrame('a'))
    await client.socketMessage(callFrame('b')) // 逐出 a
    sent.length = 0
    await client.socketMessage(callFrame('a')) // 缓存已无 a:重新执行
    expect(sent).toEqual([{ type: 'result', id: 'a', ok: true, value: 'v' }])
  })
})

describe('心跳、重连与关闭', () => {
  it('ping → 回 pong', async () => {
    const { client } = makeClient()
    const { socket, sent } = fakeSocket()
    client.socketOpened(socket)
    sent.length = 0
    await client.socketMessage('{"type":"ping"}')
    expect(sent).toEqual([{ type: 'pong' }])
  })

  it('非法帧忽略(不崩、不回帧)', async () => {
    const { client } = makeClient()
    const { socket, sent } = fakeSocket()
    client.socketOpened(socket)
    sent.length = 0
    await client.socketMessage('not json')
    await client.socketMessage('{"type":"nope"}')
    expect(sent).toEqual([])
  })

  it('断线 → reconnecting;重连 socketOpened → 重发 hello', async () => {
    const { client, states } = makeClient()
    const first = fakeSocket()
    client.socketOpened(first.socket)
    await client.socketMessage(READY)
    client.socketClosed()
    expect(client.state).toBe('reconnecting')
    const second = fakeSocket()
    client.socketOpened(second.socket)
    expect(second.sent).toEqual([
      { type: 'hello', deviceId: 'd1', expose: { shell: { allow: ['echo'] } } },
    ])
    await client.socketMessage(encodeDeviceFrame({ type: 'ready', mountPath: 'device/d1' }))
    expect(states).toEqual(['ready', 'reconnecting', 'ready'])
  })

  it('close():closed + 关 socket;之后 socketClosed 不改状态、socketOpened 直接关新连接', () => {
    const { client } = makeClient()
    const first = fakeSocket()
    client.socketOpened(first.socket)
    client.close()
    expect(client.state).toBe('closed')
    expect(first.closed).toEqual([1000])
    client.socketClosed()
    expect(client.state).toBe('closed')
    const second = fakeSocket()
    client.socketOpened(second.socket)
    expect(second.closed).toEqual([1000])
    expect(second.sent).toEqual([])
  })
})
