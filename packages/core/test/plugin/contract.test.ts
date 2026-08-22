import { describe, expect, it } from 'vitest'
import type { PluginManifest } from '../../src/plugin/manifest'
import {
  optionalMethodsForCapabilities,
  type PluginDescribe,
  resolvePluginExport,
  validatePluginContract,
} from '../../src/plugin/contract'
import { isTBError } from '../../src/errors'

const MANIFEST: PluginManifest = {
  id: 'feishu',
  protocolVersion: 'plugin/v2',
  endpoint: 'https://plugin.example.com',
  auth: { kind: 'platform-token' },
  healthPath: '/healthz',
  enabled: true,
}

/** 一个 plugin 同时导出 tools 与 context —— v1 表达不了的形态。 */
const DUAL_EXPORT = {
  protocolVersion: 'plugin/v2',
  exports: [
    { auth: { kind: 'none' }, id: 'actions', profile: 'tools/v1', description: 'Feishu actions' },
    {
      id: 'documents',
      auth: { kind: 'none' },
      profile: 'context/v1',
      description: 'Feishu documents',
      methods: ['get', 'list', 'search'],
      capabilities: ['search'],
    },
  ],
}

function expectInvalid(describe: unknown): { code: string, message: string } {
  let caught: unknown
  try {
    validatePluginContract({ manifest: MANIFEST, describe })
  } catch (err) {
    caught = err
  }
  expect(isTBError(caught)).toBe(true)
  expect((caught as { code: string }).code).toBe('invalid_argument')
  return caught as { code: string, message: string }
}

describe('validatePluginContract(plugin/v2)', () => {
  it('单个 plugin 同时导出 tools 与 context → 通过', () => {
    const parsed = validatePluginContract({ manifest: MANIFEST, describe: DUAL_EXPORT })
    expect(parsed.exports.map(e => e.id)).toEqual(['actions', 'documents'])
    expect(parsed.exports.map(e => e.profile)).toEqual(['tools/v1', 'context/v1'])
  })

  it('tools/v1 无需声明 methods(运行时经 List 发现)', () => {
    const parsed = validatePluginContract({
      manifest: MANIFEST,
      describe: { protocolVersion: 'plugin/v2', exports: [{ auth: { kind: 'none' }, id: 'a', profile: 'tools/v1' }] },
    })
    expect(parsed.exports[0]?.methods).toBeUndefined()
  })

  it('每个 export 必须显式声明凭证形态', () => {
    const err = expectInvalid({
      protocolVersion: 'plugin/v2',
      exports: [{ id: 'a', profile: 'tools/v1' }],
    })
    expect(err.message).toContain('必须显式声明')
  })

  it('形状非法(缺 exports / 空 exports)→ invalid_argument', () => {
    expectInvalid({ protocolVersion: 'plugin/v2' })
    expectInvalid({ protocolVersion: 'plugin/v2', exports: [] })
  })

  it('protocolVersion 与 manifest 不符 → invalid_argument', () => {
    const err = expectInvalid({ ...DUAL_EXPORT, protocolVersion: 'plugin/v1' })
    expect(err.message).toContain('protocolVersion')
  })

  it('export id 重复 → invalid_argument', () => {
    const err = expectInvalid({
      protocolVersion: 'plugin/v2',
      exports: [
        { auth: { kind: 'none' }, id: 'dup', profile: 'tools/v1' },
        { auth: { kind: 'none' }, id: 'dup', profile: 'context/v1' },
      ],
    })
    expect(err.message).toContain('重复')
  })

  it('未知 profile → invalid_argument', () => {
    expectInvalid({
      protocolVersion: 'plugin/v2',
      exports: [{ id: 'x', profile: 'widgets/v1' }],
    })
  })

  it('context/v1 声明未知动词 → invalid_argument', () => {
    const err = expectInvalid({
      protocolVersion: 'plugin/v2',
      exports: [{ auth: { kind: 'none' }, id: 'c', profile: 'context/v1', methods: ['get', 'Frobnicate'] }],
    })
    expect(err.message).toContain('Frobnicate')
  })

  it('声明 capability 却未把对应动词列进 methods → invalid_argument(自相矛盾)', () => {
    const err = expectInvalid({
      protocolVersion: 'plugin/v2',
      exports: [
        { auth: { kind: 'none' }, id: 'c', profile: 'context/v1', methods: ['get', 'list'], capabilities: ['search'] },
      ],
    })
    expect(err.message).toContain('search')
  })

  it('tools/v1 声明 mountConfigFields → 通过并原样保留', () => {
    const parsed = validatePluginContract({
      manifest: MANIFEST,
      describe: {
        protocolVersion: 'plugin/v2',
        exports: [{
          id: 'actions',
          auth: { kind: 'none' },
          profile: 'tools/v1',
          mountConfigFields: [{ key: 'baseUrl', label: '实例地址', required: true }],
        }],
      },
    })
    expect(parsed.exports[0]?.mountConfigFields).toEqual([
      { key: 'baseUrl', label: '实例地址', required: true },
    ])
  })

  it('context/v1 声明 mountConfigFields → 通过并原样保留', () => {
    const parsed = validatePluginContract({
      manifest: MANIFEST,
      describe: {
        protocolVersion: 'plugin/v2',
        exports: [{
          id: 'docs',
          auth: { kind: 'none' },
          profile: 'context/v1',
          methods: ['get'],
          mountConfigFields: [{ key: 'workspace' }],
        }],
      },
    })
    expect(parsed.exports[0]?.mountConfigFields).toEqual([{ key: 'workspace' }])
  })

  it('auth:none 与 credentialProbe 冲突 → invalid_argument', () => {
    const err = expectInvalid({
      protocolVersion: 'plugin/v2',
      exports: [{
        auth: { kind: 'none' },
        credentialProbe: 'ping',
        id: 'actions',
        profile: 'tools/v1',
      }],
    })
    expect(err.message).toContain('auth:none')
  })

  it('mountConfigFields 有重复字段名 → invalid_argument', () => {
    const err = expectInvalid({
      protocolVersion: 'plugin/v2',
      exports: [{
        auth: { kind: 'none' },
        id: 'actions',
        profile: 'tools/v1',
        mountConfigFields: [{ key: 'baseUrl' }, { key: 'baseUrl' }],
      }],
    })
    expect(err.message).toContain('重复')
  })
})

describe('resolvePluginExport', () => {
  const describe_ = validatePluginContract({
    manifest: MANIFEST,
    describe: DUAL_EXPORT,
  }) satisfies PluginDescribe

  it('显式 export id + profile 相符 → 命中', () => {
    const chosen = resolvePluginExport(describe_, {
      exportId: 'documents',
      nodeKind: 'context',
      pluginId: 'feishu',
    })
    expect(chosen.id).toBe('documents')
  })

  it('省略 export 且恰好一个 → 取它(单 export plugin 挂载不必写 export)', () => {
    const single = validatePluginContract({
      manifest: MANIFEST,
      describe: { protocolVersion: 'plugin/v2', exports: [{ auth: { kind: 'none' }, id: 'only', profile: 'tools/v1' }] },
    })
    expect(resolvePluginExport(single, { nodeKind: 'tool', pluginId: 'feishu' }).id).toBe('only')
  })

  it('省略 export 但有多个 → invalid_argument(要求显式指定,不猜)', () => {
    let caught: unknown
    try {
      resolvePluginExport(describe_, { nodeKind: 'tool', pluginId: 'feishu' })
    } catch (err) {
      caught = err
    }
    expect(isTBError(caught)).toBe(true)
    expect((caught as { message: string }).message).toContain('config.export')
  })

  it('未知 export id → invalid_argument 且列出现有 id', () => {
    let caught: unknown
    try {
      resolvePluginExport(describe_, { exportId: 'nope', nodeKind: 'tool', pluginId: 'feishu' })
    } catch (err) {
      caught = err
    }
    expect((caught as { message: string }).message).toContain('actions')
  })

  it('profile 与节点 kind 不符 → invalid_argument(context export 不能挂成 tool 节点)', () => {
    let caught: unknown
    try {
      resolvePluginExport(describe_, {
        exportId: 'documents',
        nodeKind: 'tool',
        pluginId: 'feishu',
      })
    } catch (err) {
      caught = err
    }
    expect((caught as { message: string }).message).toContain('context/v1')
  })
})

describe('optionalMethodsForCapabilities', () => {
  it('基名映射 + 限定词按 ":" 前判定 + 未知基名忽略', () => {
    expect([...optionalMethodsForCapabilities(['search:semantic', 'delete', 'future'])].sort())
      .toEqual(['delete', 'search'])
  })
})
