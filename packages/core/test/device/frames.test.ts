import { describe, expect, it } from 'vitest'
import {
  decodeDeviceFrame,
  deviceErrorFrame,
  type DeviceFrame,
  encodeDeviceFrame,
  PING_FRAME_JSON,
  PONG_FRAME_JSON,
} from '../../src/device/frames'
import { isTBError, TBError } from '../../src/errors'

/** 执行并返回 TBError code(未抛 → null)。 */
function codeOf(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (e) {
    return isTBError(e) ? e.code : `非TBError:${String(e)}`
  }
}

describe('encode/decode 往返', () => {
  const frames: DeviceFrame[] = [
    {
      type: 'hello',
      deviceId: 'build-01',
      expose: { shell: { description: 'ci shell', allow: ['echo', 'git'] } },
    },
    {
      type: 'hello',
      deviceId: 'build-01',
      mountPath: 'teams/a/build-01',
      expose: {
        fs: { roots: ['/srv/data'], readOnly: true },
        nodes: [
          {
            path: 'db',
            kind: 'context',
            description: '本地 DB',
            config: { kind: 'context', provider: 'file' },
          },
        ],
      },
    },
    { type: 'ready', mountPath: 'device/build-01' },
    { type: 'error', error: { code: 'permission_denied', message: 'nope', retryable: false } },
    { type: 'call', id: 'r1', path: 'shell', tool: 'exec', arguments: { command: 'echo hi' } },
    { type: 'result', id: 'r1', ok: true, value: { stdout: 'hi\n', stderr: '', exitCode: 0 } },
    {
      type: 'result',
      id: 'r2',
      ok: false,
      error: { code: 'unavailable', message: 'down', retryable: true },
    },
    { type: 'ping' },
    { type: 'pong' },
    { type: 'cancel', id: 'r1' },
  ]

  it('每种帧 encode → decode 结构保持', () => {
    for (const frame of frames) {
      expect(decodeDeviceFrame(encodeDeviceFrame(frame)), `帧:${frame.type}`).toEqual(frame)
    }
  })

  it('nodes 的 config 等扩展字段经解码原样保留(passthrough)', () => {
    const hello = frames[1]
    const decoded = decodeDeviceFrame(encodeDeviceFrame(hello as DeviceFrame))
    expect(decoded).toMatchObject({
      expose: { nodes: [{ config: { kind: 'context', provider: 'file' } }] },
    })
  })

  it('hello 的 node 可携带 cmds 工具表,往返保持', () => {
    const hello: DeviceFrame = {
      type: 'hello',
      deviceId: 'sdk-01',
      expose: {
        nodes: [
          {
            path: 'tools/echo',
            kind: 'tool',
            description: '回声工具',
            cmds: [
              {
                name: 'echo',
                description: '原样返回',
                inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
                effect: 'read',
              },
              { name: 'wipe', effect: 'destructive', confirm: true },
            ],
          },
        ],
      },
    }
    expect(decodeDeviceFrame(encodeDeviceFrame(hello))).toEqual(hello)
  })

  it('node 不带 cmds 向后兼容(老客户端);cmds 形状非法 → invalid_argument', () => {
    const plain
      = '{"type":"hello","deviceId":"d","expose":{"nodes":[{"path":"x","kind":"tool","description":"t"}]}}'
    expect(decodeDeviceFrame(plain)).toMatchObject({
      expose: { nodes: [{ path: 'x', kind: 'tool' }] },
    })
    const bad = [
      // cmds 非数组
      '{"type":"hello","deviceId":"d","expose":{"nodes":[{"path":"x","kind":"tool","description":"t","cmds":{}}]}}',
      // cmd 缺 name
      '{"type":"hello","deviceId":"d","expose":{"nodes":[{"path":"x","kind":"tool","description":"t","cmds":[{"description":"m"}]}]}}',
      // name 空串
      '{"type":"hello","deviceId":"d","expose":{"nodes":[{"path":"x","kind":"tool","description":"t","cmds":[{"name":""}]}]}}',
    ]
    for (const text of bad) {
      expect(
        codeOf(() => decodeDeviceFrame(text)),
        `应拒绝:${text}`,
      ).toBe('invalid_argument')
    }
  })

  it('ping/pong 序列化为稳定字面量(DO autoResponse 精确匹配)', () => {
    expect(encodeDeviceFrame({ type: 'ping' })).toBe(PING_FRAME_JSON)
    expect(encodeDeviceFrame({ type: 'pong' })).toBe(PONG_FRAME_JSON)
    expect(PING_FRAME_JSON).toBe('{"type":"ping"}')
    expect(PONG_FRAME_JSON).toBe('{"type":"pong"}')
  })

  it('encode 产出紧凑 JSON(无空白)', () => {
    const text = encodeDeviceFrame({ type: 'ready', mountPath: 'device/x' })
    expect(text).toBe('{"type":"ready","mountPath":"device/x"}')
  })
})

describe('decode 拒绝非法输入 → invalid_argument', () => {
  it('非 JSON / 非对象', () => {
    expect(codeOf(() => decodeDeviceFrame('not json'))).toBe('invalid_argument')
    expect(codeOf(() => decodeDeviceFrame('"str"'))).toBe('invalid_argument')
    expect(codeOf(() => decodeDeviceFrame('[1]'))).toBe('invalid_argument')
    expect(codeOf(() => decodeDeviceFrame('null'))).toBe('invalid_argument')
  })

  it('未知 type / 缺 type', () => {
    expect(codeOf(() => decodeDeviceFrame('{"type":"nope"}'))).toBe('invalid_argument')
    expect(codeOf(() => decodeDeviceFrame('{"id":"x"}'))).toBe('invalid_argument')
    expect(codeOf(() => decodeDeviceFrame('{"type":1}'))).toBe('invalid_argument')
  })

  it('缺字段 / 字段类型错', () => {
    const bad = [
      '{"type":"hello"}', // 缺 deviceId/expose
      '{"type":"hello","deviceId":"","expose":{}}', // deviceId 空
      '{"type":"hello","deviceId":"d","expose":{"fs":{"roots":[]}}}', // roots 空数组
      '{"type":"hello","deviceId":"d","expose":{"nodes":[{"path":"x"}]}}', // node 缺 kind/description
      '{"type":"hello","deviceId":"d","expose":{"nodes":[{"path":"x","kind":"nope","description":""}]}}', // 未知 kind
      '{"type":"ready"}', // 缺 mountPath
      '{"type":"error","error":{"code":"nope","message":"m","retryable":false}}', // 非法错误码
      '{"type":"error","error":{"code":"internal","message":"m"}}', // 缺 retryable
      '{"type":"call","id":"1","tool":"t","arguments":{}}', // 缺 path
      '{"type":"call","id":"1","path":"p","tool":"t","arguments":"x"}', // arguments 非对象
      '{"type":"result","id":"1"}', // 缺 ok
      '{"type":"result","id":"1","ok":false}', // ok:false 缺 error
      '{"type":"cancel"}', // 缺 id
    ]
    for (const text of bad) {
      expect(
        codeOf(() => decodeDeviceFrame(text)),
        `应拒绝:${text}`,
      ).toBe('invalid_argument')
    }
  })

  it('未知顶层字段被剥离(strip)', () => {
    const decoded = decodeDeviceFrame('{"type":"ready","mountPath":"m","extra":1}')
    expect(decoded).toEqual({ type: 'ready', mountPath: 'm' })
  })
})

describe('deviceErrorFrame', () => {
  it('TBError → 拒绝帧 body', () => {
    const frame = deviceErrorFrame(new TBError('permission_denied', 'no register scope'))
    expect(frame).toEqual({
      type: 'error',
      error: { code: 'permission_denied', message: 'no register scope', retryable: false },
    })
  })
})
