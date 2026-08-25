import { describe, expect, it } from 'vitest'
import {
  parseNonNegativeIntEnv,
  parsePortEnv,
  parsePositiveIntEnv,
  parseRuntimeEnv,
} from '../src/runtimeEnv'

describe('runtime env Zod parser', () => {
  it('保留非法值回退、小数向下取整与 port=0 契约', () => {
    expect(parsePositiveIntEnv('5.9')).toBe(5)
    expect(parsePositiveIntEnv('0')).toBeUndefined()
    expect(parsePositiveIntEnv('not-a-number')).toBeUndefined()
    expect(parseNonNegativeIntEnv('0')).toBe(0)
    expect(parseNonNegativeIntEnv('-1')).toBeUndefined()
    expect(parsePortEnv('0')).toBe(0)
    expect(parsePortEnv('65536')).toBeUndefined()
    expect(parsePortEnv('')).toBeUndefined()
  })

  it('一次产出 Node/Workers 共用 remote、TTL、Store 与 canonical origin', () => {
    expect(parseRuntimeEnv({
      TB_ALLOW_INSECURE_HTTP: 'true',
      TB_CANONICAL_ORIGIN: 'https://tb.example.com/ui?x=1',
      TB_INSTANCE_ID: 'edge-a',
      TB_MAX_HOPS: '6.9',
      TB_REF_TTL_SEC: '999999',
      TB_REMOTE_ALLOWLIST: ' example.com, api.example.net ,,',
      TB_STORE_CALL_ALLOWED_CONTENT_TYPES: 'image/*, application/pdf',
      TB_STORE_CALL_MAX_OBJECTS: '3',
      TB_STORE_TOKEN_SECRET: '0123456789abcdef',
      ignoredBinding: { fetch() {} },
    })).toMatchObject({
      allowInsecureHttp: true,
      canonicalOrigin: 'https://tb.example.com',
      refTtlSec: 604_800,
      remote: {
        allowInsecure: true,
        allowlist: ['example.com', 'api.example.net'],
        instanceId: 'edge-a',
        maxHops: 6,
      },
      storeCallAllowedContentTypes: ['image/*', 'application/pdf'],
      storeCallMaxObjects: 3,
      storeTokenSecret: '0123456789abcdef',
    })
  })

  it('安全配置保持 fail closed，普通正整数仍回退', () => {
    expect(() => parseRuntimeEnv({ TB_STORE_TOKEN_SECRET: 'too-short' }))
      .toThrow(/TB_STORE_TOKEN_SECRET/)
    expect(parseRuntimeEnv({ TB_STORE_CALL_MAX_BYTES: 'bad' }).storeCallMaxBytes)
      .toBeUndefined()
  })
})
