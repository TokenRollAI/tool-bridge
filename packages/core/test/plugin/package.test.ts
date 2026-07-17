import { describe, expect, it } from 'vitest'
import {
  assertBundleIntegrity,
  bytesSha256Hex,
  parsePluginIndex,
  parsePluginPackage,
  PLUGIN_BUNDLE_MAX_BYTES,
  type PluginPackage,
} from '../../src/plugin/package'
import { TBError } from '../../src/errors'

const ENTRY: Record<string, unknown> = {
  name: 'feishu',
  version: '1.2.3',
  bundleUrl: 'https://plugins.example.com/feishu/1.2.3/worker.js',
  sha256: 'a'.repeat(64),
  kind: 'tool-provider',
  interfaceVersion: 'tool-provider/v1',
  healthPath: '/healthz',
  description: '飞书消息与群管理',
  configSchema: {
    type: 'object',
    properties: { appId: { type: 'string' }, appSecret: { type: 'string' } },
    required: ['appId', 'appSecret'],
  },
  mountConfigSchema: { type: 'object', properties: { defaultChat: { type: 'string' } } },
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

describe('parsePluginPackage', () => {
  it('合法条目通过且未知字段剥离', () => {
    const pkg = parsePluginPackage({ ...ENTRY, future: 'x' })
    expect(pkg).not.toHaveProperty('future')
    expect(pkg.name).toBe('feishu')
    expect(pkg.configSchema).toEqual(ENTRY.configSchema)
  })

  it('configSchema/mountConfigSchema/description 可缺省', () => {
    const min = { ...ENTRY }
    delete (min as { configSchema?: unknown, description?: unknown, mountConfigSchema?: unknown }).configSchema
    delete (min as { configSchema?: unknown, description?: unknown, mountConfigSchema?: unknown }).mountConfigSchema
    delete (min as { configSchema?: unknown, description?: unknown, mountConfigSchema?: unknown }).description
    const pkg = parsePluginPackage(min)
    expect(pkg.configSchema).toBeUndefined()
    expect(pkg.mountConfigSchema).toBeUndefined()
  })

  it('name 非 path-segment 安全字符 → invalid_argument', () => {
    expectInvalid(() => parsePluginPackage({ ...ENTRY, name: 'a/b' }))
    expectInvalid(() => parsePluginPackage({ ...ENTRY, name: '-lead' }))
  })

  it('version 非 semver → invalid_argument', () => {
    expectInvalid(() => parsePluginPackage({ ...ENTRY, version: 'latest' }))
  })

  it('sha256 非 64 位 hex 小写 → invalid_argument', () => {
    expectInvalid(() => parsePluginPackage({ ...ENTRY, sha256: 'A'.repeat(64) }))
    expectInvalid(() => parsePluginPackage({ ...ENTRY, sha256: 'a'.repeat(63) }))
  })

  it('kind 与 interfaceVersion 前缀不一致 → invalid_argument', () => {
    expectInvalid(() => parsePluginPackage({ ...ENTRY, interfaceVersion: 'context-provider/v1' }))
  })

  it('bundleUrl http:// 默认拒;allowInsecureHttp 放行', () => {
    const insecure = { ...ENTRY, bundleUrl: 'http://127.0.0.1:39004/worker.js' }
    expectInvalid(() => parsePluginPackage(insecure))
    expect(parsePluginPackage(insecure, { allowInsecureHttp: true }).bundleUrl).toBe(
      insecure.bundleUrl,
    )
  })
})

describe('parsePluginIndex', () => {
  it('条目数组逐条校验通过', () => {
    const list = parsePluginIndex([ENTRY, { ...ENTRY, name: 'jira' }])
    expect(list.map((p: PluginPackage) => p.name)).toEqual(['feishu', 'jira'])
  })

  it('非数组 / 任一条目非法 → invalid_argument(不做部分容忍)', () => {
    expectInvalid(() => parsePluginIndex({ plugins: [] }))
    expectInvalid(() => parsePluginIndex([ENTRY, { ...ENTRY, sha256: 'bad' }]))
  })
})

describe('bundle 完整性(sha256 + 体积)', () => {
  // "worker" 的 ASCII 字节;避免依赖测试环境的 TextEncoder。
  const bytes = Uint8Array.from([0x77, 0x6f, 0x72, 0x6b, 0x65, 0x72])

  it('bytesSha256Hex 输出 64 位 hex 小写且可复算', async () => {
    const digest = await bytesSha256Hex(bytes)
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(await bytesSha256Hex(bytes)).toBe(digest)
  })

  it('哈希一致通过;不符 → invalid_argument(带预期/实际)', async () => {
    const digest = await bytesSha256Hex(bytes)
    await expect(assertBundleIntegrity(bytes, digest)).resolves.toBeUndefined()
    await expect(assertBundleIntegrity(bytes, 'b'.repeat(64))).rejects.toMatchObject({
      code: 'invalid_argument',
    })
  })

  it('超过 5 MiB → invalid_argument(先于哈希计算)', async () => {
    const big = new Uint8Array(PLUGIN_BUNDLE_MAX_BYTES + 1)
    await expect(assertBundleIntegrity(big, 'a'.repeat(64))).rejects.toMatchObject({
      code: 'invalid_argument',
    })
  })
})
