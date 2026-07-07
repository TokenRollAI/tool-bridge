import { describe, expect, it } from 'vitest'
import { TBError } from '../../src/errors'
import { renderHelpDsl } from '../../src/htbp/helpDsl'
import type { HelpModel } from '../../src/htbp/model'
import { validatePluginContract } from '../../src/plugin/contract'
import type { PluginManifest } from '../../src/plugin/manifest'

const CONTEXT_MANIFEST: PluginManifest = {
  id: 'feishu-docs',
  kind: 'context-provider',
  interfaceVersion: 'context-provider/v1',
  endpoint: 'https://feishu-docs-provider.example.workers.dev',
  auth: { kind: 'platform-token' },
  healthPath: '/healthz',
  enabled: true,
}

const TOOL_MANIFEST: PluginManifest = {
  ...CONTEXT_MANIFEST,
  id: 'orders',
  kind: 'tool-provider',
  interfaceVersion: 'tool-provider/v1',
}

/** ~help(JSON 表现)最小样例:给定方法名集合。 */
function helpJson(names: string[]): unknown {
  return {
    htbp: '0.1',
    node: { path: '', kind: 'context', description: 'stub' },
    cmds: names.map((name) => ({ name, method: 'POST', path: '/', scope: 'read' })),
  }
}

/** ~help(DSL 表现):经现有渲染器生成,验证退化解析走真实形状。 */
function helpDsl(names: string[]): string {
  const model: HelpModel = {
    node: { path: '', kind: 'context', description: 'stub' },
    cmds: names.map((name) => ({
      name,
      method: 'POST' as const,
      path: '/',
      scope: 'read' as const,
    })),
  }
  return renderHelpDsl(model)
}

function describeJson(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    kind: 'context-provider',
    interfaceVersion: 'context-provider/v1',
    capabilities: [],
    ...overrides,
  }
}

function expectInvalid(fn: () => void): TBError {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(TBError)
    expect((e as TBError).code).toBe('invalid_argument')
    return e as TBError
  }
  throw new Error('expected invalid_argument')
}

describe('HelpJson 优先:方法集合校验', () => {
  it('context-provider 四动词齐全 → 通过', () => {
    expect(() =>
      validatePluginContract({
        manifest: CONTEXT_MANIFEST,
        describe: describeJson(),
        help: helpJson(['List', 'Get', 'Update', 'Write']),
      }),
    ).not.toThrow()
  })

  it('tool-provider List/Get/Call 齐全 → 通过', () => {
    expect(() =>
      validatePluginContract({
        manifest: TOOL_MANIFEST,
        describe: describeJson({ kind: 'tool-provider', interfaceVersion: 'tool-provider/v1' }),
        help: helpJson(['List', 'Get', 'Call']),
      }),
    ).not.toThrow()
  })

  it('缺 Update → 拒,message 指出缺哪个方法', () => {
    const err = expectInvalid(() =>
      validatePluginContract({
        manifest: CONTEXT_MANIFEST,
        describe: describeJson(),
        help: helpJson(['List', 'Get', 'Write']),
      }),
    )
    expect(err.message).toContain('Update')
  })

  it('tool-provider 缺 Call → 拒', () => {
    const err = expectInvalid(() =>
      validatePluginContract({
        manifest: TOOL_MANIFEST,
        describe: describeJson({ kind: 'tool-provider', interfaceVersion: 'tool-provider/v1' }),
        help: helpJson(['List', 'Get']),
      }),
    )
    expect(err.message).toContain('Call')
  })

  it('方法集合是超集(多余 cmd)不拒', () => {
    expect(() =>
      validatePluginContract({
        manifest: CONTEXT_MANIFEST,
        describe: describeJson(),
        help: helpJson(['List', 'Get', 'Update', 'Write', 'Extra']),
      }),
    ).not.toThrow()
  })
})

describe('DSL 退化解析(~help 非 JSON 时)', () => {
  it('DSL 文本四动词齐全 → 通过', () => {
    expect(() =>
      validatePluginContract({
        manifest: CONTEXT_MANIFEST,
        describe: describeJson(),
        help: helpDsl(['List', 'Get', 'Update', 'Write']),
      }),
    ).not.toThrow()
  })

  it('DSL 缺方法 → 拒', () => {
    const err = expectInvalid(() =>
      validatePluginContract({
        manifest: CONTEXT_MANIFEST,
        describe: describeJson(),
        help: helpDsl(['List', 'Get']),
      }),
    )
    expect(err.message).toContain('Update')
    expect(err.message).toContain('Write')
  })

  it('既非 HelpJson 又无 cmd 行的文本 → 拒(等价于零方法)', () => {
    expectInvalid(() =>
      validatePluginContract({
        manifest: CONTEXT_MANIFEST,
        describe: describeJson(),
        help: 'hello world\nnothing here',
      }),
    )
  })
})

describe('~describe 与 manifest 一致性', () => {
  it('kind 不符 → 拒', () => {
    const err = expectInvalid(() =>
      validatePluginContract({
        manifest: CONTEXT_MANIFEST,
        describe: describeJson({ kind: 'tool-provider' }),
        help: helpJson(['List', 'Get', 'Update', 'Write']),
      }),
    )
    expect(err.message).toContain('kind')
  })

  it('interfaceVersion 不符 → 拒', () => {
    expectInvalid(() =>
      validatePluginContract({
        manifest: CONTEXT_MANIFEST,
        describe: describeJson({ interfaceVersion: 'context-provider/v2' }),
        help: helpJson(['List', 'Get', 'Update', 'Write']),
      }),
    )
  })

  it('~describe 非对象 / 缺字段 → 拒', () => {
    expectInvalid(() =>
      validatePluginContract({
        manifest: CONTEXT_MANIFEST,
        describe: 'not-json-object',
        help: helpJson(['List', 'Get', 'Update', 'Write']),
      }),
    )
    expectInvalid(() =>
      validatePluginContract({
        manifest: CONTEXT_MANIFEST,
        describe: { kind: 'context-provider' },
        help: helpJson(['List', 'Get', 'Update', 'Write']),
      }),
    )
  })
})

describe('capabilities ↔ 可选方法对齐', () => {
  it('声明 search 且 ~help 有 Search → 通过', () => {
    expect(() =>
      validatePluginContract({
        manifest: CONTEXT_MANIFEST,
        describe: describeJson({ capabilities: ['search'] }),
        help: helpJson(['List', 'Get', 'Update', 'Write', 'Search']),
      }),
    ).not.toThrow()
  })

  it('声明 search 但缺 Search cmd → 拒', () => {
    const err = expectInvalid(() =>
      validatePluginContract({
        manifest: CONTEXT_MANIFEST,
        describe: describeJson({ capabilities: ['search'] }),
        help: helpJson(['List', 'Get', 'Update', 'Write']),
      }),
    )
    expect(err.message).toContain('Search')
  })

  it('声明 delete 但缺 Delete cmd → 拒', () => {
    const err = expectInvalid(() =>
      validatePluginContract({
        manifest: CONTEXT_MANIFEST,
        describe: describeJson({ capabilities: ['delete'] }),
        help: helpJson(['List', 'Get', 'Update', 'Write']),
      }),
    )
    expect(err.message).toContain('Delete')
  })

  it('search:semantic 限定词按基名 search → Search 判定', () => {
    expectInvalid(() =>
      validatePluginContract({
        manifest: CONTEXT_MANIFEST,
        describe: describeJson({ capabilities: ['search:semantic'] }),
        help: helpJson(['List', 'Get', 'Update', 'Write']),
      }),
    )
  })

  it('未知 capability 忽略(向前兼容)', () => {
    expect(() =>
      validatePluginContract({
        manifest: CONTEXT_MANIFEST,
        describe: describeJson({ capabilities: ['telepathy'] }),
        help: helpJson(['List', 'Get', 'Update', 'Write']),
      }),
    ).not.toThrow()
  })
})
