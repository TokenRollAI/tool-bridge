import { describe, expect, it } from 'vitest'
import type { DeviceFrame, HelloFrame } from '../../src/device/frames'
import {
  DEVICE_CALL_TIMEOUT_MS,
  DEVICE_REJECT_CLOSE_CODE,
  type DeviceCallResult,
  DeviceGatewaySession,
  type SetTimer,
} from '../../src/device/session'
import { TBError } from '../../src/errors'

/** 手动时钟:fire(i) 触发第 i 个未取消的定时器。 */
function fakeTimer() {
  const timers: Array<{ cb: () => void; ms: number; cancelled: boolean }> = []
  const setTimer: SetTimer = (cb, ms) => {
    const entry = { cb, ms, cancelled: false }
    timers.push(entry)
    return () => {
      entry.cancelled = true
    }
  }
  return { timers, setTimer }
}

function makeSession(opts: { timeoutMs?: number } = {}) {
  const sent: DeviceFrame[] = []
  const closed: number[] = []
  const hellos: HelloFrame[] = []
  const stored: Array<[string, DeviceCallResult]> = []
  const { timers, setTimer } = fakeTimer()
  const session = new DeviceGatewaySession(
    {
      send: (frame) => sent.push(frame),
      close: (code) => closed.push(code),
      onHello: (hello) => hellos.push(hello),
      onResult: (id, result) => stored.push([id, result]),
    },
    { setTimer, timeoutMs: opts.timeoutMs },
  )
  return { session, sent, closed, hellos, stored, timers }
}

const HELLO: HelloFrame = { type: 'hello', deviceId: 'd1', expose: { shell: {} } }

function readySession() {
  const s = makeSession()
  s.session.handleFrame(HELLO)
  s.session.accept('device/d1')
  s.sent.length = 0
  return s
}

describe('握手状态机', () => {
  it('hello → onHello;accept → ready 帧 + phase ready', () => {
    const { session, sent, hellos } = makeSession()
    expect(session.phase).toBe('awaiting-hello')
    session.handleFrame(HELLO)
    expect(hellos).toEqual([HELLO])
    expect(sent).toEqual([]) // 判定在胶水层,未 accept 前不回帧
    session.accept('device/d1')
    expect(session.phase).toBe('ready')
    expect(sent).toEqual([{ type: 'ready', mountPath: 'device/d1' }])
  })

  it('未 hello 先发非 hello 帧 → 拒绝帧 + close(1008)', () => {
    const { session, sent, closed } = makeSession()
    session.handleFrame({ type: 'result', id: 'r1', ok: true, value: 1 })
    expect(sent).toEqual([
      { type: 'error', error: expect.objectContaining({ code: 'invalid_argument' }) },
    ])
    expect(closed).toEqual([DEVICE_REJECT_CLOSE_CODE])
    expect(session.phase).toBe('closed')
  })

  it('hello 重复(accept 前)→ 拒', () => {
    const { session, sent, closed } = makeSession()
    session.handleFrame(HELLO)
    session.handleFrame(HELLO)
    expect(sent).toEqual([
      { type: 'error', error: expect.objectContaining({ code: 'invalid_argument' }) },
    ])
    expect(closed).toEqual([DEVICE_REJECT_CLOSE_CODE])
  })

  it('hello 重复(ready 后)→ 拒', () => {
    const { session, sent, closed } = readySession()
    session.handleFrame(HELLO)
    expect(sent[0]).toMatchObject({ type: 'error' })
    expect(closed).toEqual([DEVICE_REJECT_CLOSE_CODE])
  })

  it('reject(权限拒绝):拒绝帧承载 TBError body 后关闭', () => {
    const { session, sent, closed } = makeSession()
    session.handleFrame(HELLO)
    session.reject(new TBError('permission_denied', 'registerPaths 不匹配'))
    expect(sent).toEqual([
      {
        type: 'error',
        error: { code: 'permission_denied', message: 'registerPaths 不匹配', retryable: false },
      },
    ])
    expect(closed).toEqual([DEVICE_REJECT_CLOSE_CODE])
    expect(session.phase).toBe('closed')
  })

  it('设备发出网关方向帧(如 call)→ 拒', () => {
    const { session, sent, closed } = readySession()
    session.handleFrame({ type: 'call', id: 'x', path: 'shell', tool: 'exec', arguments: {} })
    expect(sent[0]).toMatchObject({ type: 'error' })
    expect(closed).toEqual([DEVICE_REJECT_CLOSE_CODE])
  })

  it('closed 后来帧静默忽略', () => {
    const { session, sent } = makeSession()
    session.reject(new TBError('permission_denied', 'x'))
    sent.length = 0
    session.handleFrame(HELLO)
    expect(sent).toEqual([])
  })
})

describe('call 与 requestId 幂等', () => {
  const REQ = { id: 'r1', path: 'shell', tool: 'exec', arguments: { command: 'echo hi' } }

  it('call → 下发 call 帧;result → 回调调用方并入幂等表', () => {
    const { session, sent, stored } = readySession()
    const got: DeviceCallResult[] = []
    session.call(REQ, (r) => got.push(r))
    expect(sent).toEqual([{ type: 'call', ...REQ }])
    session.handleFrame({ type: 'result', id: 'r1', ok: true, value: 'out' })
    expect(got).toEqual([{ ok: true, value: 'out' }])
    expect(stored).toEqual([['r1', { ok: true, value: 'out' }]])
  })

  it('重复 id(已有结果)→ 以首次结果立即应答,不再下发', () => {
    const { session, sent } = readySession()
    session.call(REQ, () => {})
    session.handleFrame({ type: 'result', id: 'r1', ok: true, value: 'first' })
    sent.length = 0
    const got: DeviceCallResult[] = []
    session.call(REQ, (r) => got.push(r))
    expect(got).toEqual([{ ok: true, value: 'first' }])
    expect(sent).toEqual([])
  })

  it('重复 id(结果未到)→ 不重复下发,同一 result 一并应答', () => {
    const { session, sent } = readySession()
    const got1: DeviceCallResult[] = []
    const got2: DeviceCallResult[] = []
    session.call(REQ, (r) => got1.push(r))
    session.call(REQ, (r) => got2.push(r))
    expect(sent.filter((f) => f.type === 'call')).toHaveLength(1)
    session.handleFrame({
      type: 'result',
      id: 'r1',
      ok: false,
      error: { code: 'internal', message: 'boom', retryable: false },
    })
    expect(got1).toEqual(got2)
    expect(got1).toEqual([
      { ok: false, error: { code: 'internal', message: 'boom', retryable: false } },
    ])
  })

  it('重复 result 帧:以首次为准', () => {
    const { session } = readySession()
    const got: DeviceCallResult[] = []
    session.call(REQ, (r) => got.push(r))
    session.handleFrame({ type: 'result', id: 'r1', ok: true, value: 'first' })
    session.handleFrame({ type: 'result', id: 'r1', ok: true, value: 'second' })
    session.call(REQ, (r) => got.push(r))
    expect(got).toEqual([
      { ok: true, value: 'first' },
      { ok: true, value: 'first' },
    ])
  })

  it('seedResult:回放种子供重复 id 应答', () => {
    const { session, sent } = readySession()
    session.seedResult('r9', { ok: true, value: 42 })
    const got: DeviceCallResult[] = []
    session.call({ ...REQ, id: 'r9' }, (r) => got.push(r))
    expect(got).toEqual([{ ok: true, value: 42 }])
    expect(sent).toEqual([])
  })
})

describe('超时语义(60s → unavailable retryable + cancel 帧)', () => {
  const REQ = { id: 'r1', path: 'shell', tool: 'exec', arguments: {} }

  it('缺省超时 = DEVICE_CALL_TIMEOUT_MS(60s,区别于 Plugin 30s)', () => {
    expect(DEVICE_CALL_TIMEOUT_MS).toBe(60_000)
    const { session, timers } = readySession()
    session.call(REQ, () => {})
    expect(timers[0]?.ms).toBe(DEVICE_CALL_TIMEOUT_MS)
  })

  it('到期:调用方收 unavailable(retryable:true),设备收 cancel 帧', () => {
    const { session, sent, timers } = readySession()
    const got: DeviceCallResult[] = []
    session.call(REQ, (r) => got.push(r))
    timers[0]?.cb()
    expect(got).toEqual([
      {
        ok: false,
        error: expect.objectContaining({ code: 'unavailable', retryable: true }),
      },
    ])
    expect(sent.at(-1)).toEqual({ type: 'cancel', id: 'r1' })
  })

  it('迟到的 result 仅入幂等表(不再回调),后续重复 id 以真实结果应答', () => {
    const { session, timers, stored } = readySession()
    const got: DeviceCallResult[] = []
    session.call(REQ, (r) => got.push(r))
    timers[0]?.cb()
    session.handleFrame({ type: 'result', id: 'r1', ok: true, value: 'late' })
    expect(got).toHaveLength(1) // 只有超时那次
    expect(stored).toEqual([['r1', { ok: true, value: 'late' }]])
    session.call(REQ, (r) => got.push(r))
    expect(got.at(-1)).toEqual({ ok: true, value: 'late' })
  })

  it('结果按时到达:定时器被取消', () => {
    const { session, timers } = readySession()
    session.call(REQ, () => {})
    session.handleFrame({ type: 'result', id: 'r1', ok: true, value: 1 })
    expect(timers[0]?.cancelled).toBe(true)
  })
})

describe('心跳与断线', () => {
  it('ping → 回 pong;pong → 忽略', () => {
    const { session, sent } = readySession()
    session.handleFrame({ type: 'ping' })
    expect(sent).toEqual([{ type: 'pong' }])
    session.handleFrame({ type: 'pong' })
    expect(sent).toHaveLength(1)
  })

  it('dispose:待决调用回 unavailable(retryable),定时器取消', () => {
    const { session, timers } = readySession()
    const got: DeviceCallResult[] = []
    session.call({ id: 'r1', path: 'shell', tool: 'exec', arguments: {} }, (r) => got.push(r))
    session.dispose()
    expect(got).toEqual([
      { ok: false, error: expect.objectContaining({ code: 'unavailable', retryable: true }) },
    ])
    expect(timers[0]?.cancelled).toBe(true)
    expect(session.phase).toBe('closed')
  })

  it('closed 后 call → 立即 unavailable(设备离线)', () => {
    const { session } = readySession()
    session.dispose()
    const got: DeviceCallResult[] = []
    session.call({ id: 'rx', path: 'shell', tool: 'exec', arguments: {} }, (r) => got.push(r))
    expect(got).toEqual([
      { ok: false, error: expect.objectContaining({ code: 'unavailable', retryable: true }) },
    ])
  })
})
