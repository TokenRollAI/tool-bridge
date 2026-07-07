import { describe, expect, it } from 'vitest'
import { TBError } from '../../src/errors'
import {
  assertPluginPayloadSize,
  decodeCallContext,
  decodePluginCall,
  encodeCallContext,
  encodePluginCall,
  HEADER_TB_CONTEXT,
  HEADER_TB_REQUEST_ID,
  PLUGIN_PAYLOAD_MAX_BYTES,
} from '../../src/plugin/envelope'
import type { CallContext } from '../../src/types'

const CTX: CallContext = {
  keyId: 'sk_01',
  owner: 'user:alice',
  scopes: [
    { pattern: 'docs/**', actions: ['read', 'write'] },
    { pattern: 'docs/secret/**', actions: ['read'], effect: 'deny' },
  ],
  registerPaths: ['device/build-01/**'],
  traceId: 'trace-1',
}

function expectInvalid(fn: () => unknown): TBError {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(TBError)
    expect((e as TBError).code).toBe('invalid_argument')
    return e as TBError
  }
  throw new Error('expected invalid_argument')
}

describe('CallContext 编解码(X-TB-Context)', () => {
  it('往返恒等(含 deny scope 与 registerPaths)', () => {
    expect(decodeCallContext(encodeCallContext(CTX))).toEqual(CTX)
  })

  it('registerPaths 缺省的最小上下文往返恒等', () => {
    const min: CallContext = { keyId: 'k', owner: 'agent:a', scopes: [], traceId: 't' }
    expect(decodeCallContext(encodeCallContext(min))).toEqual(min)
  })

  it('编码产物是 base64url(无 +/=,可进 HTTP header)', () => {
    const header = encodeCallContext(CTX)
    expect(header).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('未知字段解码时剥离(消费方忽略未知字段)', () => {
    const withExtra = { ...CTX, future: 'x' }
    const header = encodeCallContext(withExtra as CallContext)
    expect(decodeCallContext(header)).toEqual(CTX)
  })

  it('非法 base64url 字符 → invalid_argument', () => {
    expectInvalid(() => decodeCallContext('not+valid/base64='))
  })

  it('合法 base64url 但非 JSON → invalid_argument', () => {
    expectInvalid(() => decodeCallContext('aGVsbG8')) // "hello"
  })

  it('JSON 但缺必填字段 → invalid_argument', () => {
    const noKeyId = encodeCallContext({ ...CTX, keyId: undefined } as unknown as CallContext)
    expectInvalid(() => decodeCallContext(noKeyId))
  })

  it('scopes.actions 含非法动作 → invalid_argument', () => {
    const bad = {
      ...CTX,
      scopes: [{ pattern: '**', actions: ['fly'] }],
    } as unknown as CallContext
    expectInvalid(() => decodeCallContext(encodeCallContext(bad)))
  })

  it('header 常量逐字一致', () => {
    expect(HEADER_TB_CONTEXT).toBe('X-TB-Context')
    expect(HEADER_TB_REQUEST_ID).toBe('X-TB-Request-Id')
  })
})

describe('请求体构造/解析({"tool":"<Method>","arguments":{...}})', () => {
  it('往返恒等:arguments 按名传递,opts 整体传', () => {
    const call = { tool: 'List', arguments: { path: '', opts: { cursor: null, limit: 50 } } }
    const body = encodePluginCall(call)
    expect(JSON.parse(body)).toEqual(call)
    expect(decodePluginCall(body)).toEqual(call)
  })

  it('非 JSON body → invalid_argument', () => {
    expectInvalid(() => decodePluginCall('tool=List'))
  })

  it('缺 tool / tool 空串 → invalid_argument', () => {
    expectInvalid(() => decodePluginCall('{"arguments":{}}'))
    expectInvalid(() => decodePluginCall('{"tool":"","arguments":{}}'))
  })

  it('arguments 缺失或非对象 → invalid_argument', () => {
    expectInvalid(() => decodePluginCall('{"tool":"Get"}'))
    expectInvalid(() => decodePluginCall('{"tool":"Get","arguments":[1]}'))
  })
})

describe('体积守卫(≤ 1 MiB)', () => {
  it('上限常量 = 1 MiB', () => {
    expect(PLUGIN_PAYLOAD_MAX_BYTES).toBe(1024 * 1024)
  })

  it('恰好 1 MiB 通过', () => {
    expect(() => assertPluginPayloadSize('a'.repeat(PLUGIN_PAYLOAD_MAX_BYTES))).not.toThrow()
  })

  it('1 MiB + 1 字节 → invalid_argument', () => {
    expectInvalid(() => assertPluginPayloadSize('a'.repeat(PLUGIN_PAYLOAD_MAX_BYTES + 1)))
  })

  it('按 UTF-8 字节计而非字符数(多字节字符)', () => {
    // '好' 占 3 字节:1 MiB - 2 个 ASCII + 1 个 '好' = 1 MiB + 1 字节
    expectInvalid(() => assertPluginPayloadSize(`${'a'.repeat(PLUGIN_PAYLOAD_MAX_BYTES - 2)}好`))
  })

  it('encodePluginCall 超限 → invalid_argument', () => {
    expectInvalid(() =>
      encodePluginCall({
        tool: 'Write',
        arguments: { content: 'a'.repeat(PLUGIN_PAYLOAD_MAX_BYTES) },
      }),
    )
  })

  it('decodePluginCall 超限 → invalid_argument(不先 parse 大 JSON)', () => {
    const huge = `{"tool":"Write","arguments":{"content":"${'a'.repeat(PLUGIN_PAYLOAD_MAX_BYTES)}"}}`
    expectInvalid(() => decodePluginCall(huge))
  })
})
