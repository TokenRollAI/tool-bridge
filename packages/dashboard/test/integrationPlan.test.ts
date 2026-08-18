import { describe, expect, it } from 'vitest'
import type { CatalogListItem } from '../src/lib/types'
import {
  buildIntegrationCalls,
  defaultMountPath,
  derivedSecretName,
  INITIAL_INTEGRATION_FORM,
  type IntegrationFormState,
  integrationPlan,
  SINGLE_FIELD_KEY,
} from '../src/pages/system/forms/integrationPlan'

/**
 * 集成向导的纯逻辑。对等 CLI 的 `tb integration add` —— 两个操作面共用同一套判断
 * (该填什么、authRef 怎么来、要不要授权),故这里的断言与 cli/test/integration.test.ts
 * 是同一组语义。
 */

const TAVILY: CatalogListItem = {
  id: 'tavily',
  digest: 'd1',
  exports: ['actions'],
  exportDetails: {
    actions: { auth: { kind: 'single', required: false }, id: 'actions', kind: 'tool' },
  },
  nodeKinds: ['tool'],
  description: 'Tavily',
}

const JIRA: CatalogListItem = {
  id: 'jira',
  digest: 'd2',
  exports: ['actions'],
  exportDetails: {
    actions: {
      auth: {
        kind: 'fields',
        fields: [
          { key: 'baseUrl', label: 'Instance URL', required: true, secret: false },
          { key: 'personalAccessToken', label: 'PAT', required: true, secret: true },
        ],
      },
      id: 'actions',
      kind: 'tool',
    },
  },
  nodeKinds: ['tool'],
}

const SENTRY: CatalogListItem = {
  id: 'sentry',
  digest: 'd3',
  exports: ['actions'],
  exportDetails: {
    actions: { auth: { kind: 'oauth' }, id: 'actions', kind: 'tool' },
  },
  nodeKinds: ['tool'],
}

const MULTI: CatalogListItem = {
  id: 'notes',
  digest: 'd4',
  exports: ['actions', 'documents'],
  exportDetails: {
    actions: { auth: { kind: 'none' }, id: 'actions', kind: 'tool' },
    documents: { auth: { kind: 'none' }, id: 'documents', kind: 'context' },
  },
  nodeKinds: ['context', 'tool'],
}

const PER_EXPORT: CatalogListItem = {
  id: 'mixed',
  digest: 'd6',
  exports: ['actions', 'documents'],
  exportDetails: {
    actions: {
      auth: { kind: 'none' },
      id: 'actions',
      kind: 'tool',
      mountConfigFields: [{ key: 'workspace' }],
    },
    documents: {
      auth: { kind: 'fields', fields: [{ key: 'readerToken', required: true }] },
      id: 'documents',
      kind: 'context',
      mountConfigFields: [{ key: 'tenant', required: true }],
    },
  },
  nodeKinds: ['context', 'tool'],
}

/** 自建实例型:单值凭证 + 一个必配的非凭证 baseUrl(如 memos)。 */
const MEMOS: CatalogListItem = {
  id: 'memos',
  digest: 'd5',
  exports: ['actions'],
  exportDetails: {
    actions: {
      auth: { kind: 'single', required: false },
      id: 'actions',
      kind: 'tool',
      mountConfigFields: [{ key: 'baseUrl', label: '实例地址', required: true }],
    },
  },
  nodeKinds: ['tool'],
}

const form = (patch: Partial<IntegrationFormState>): IntegrationFormState => ({
  ...INITIAL_INTEGRATION_FORM,
  path: 'tools/x',
  ...patch,
})

describe('integrationPlan', () => {
  it('四种形态互斥:none / oauth / 多字段 / 单值', () => {
    expect(integrationPlan(SENTRY).kind).toBe('oauth')
    expect(integrationPlan(JIRA).kind).toBe('fields')
    expect(integrationPlan(TAVILY).kind).toBe('single')
    expect(integrationPlan(PER_EXPORT, 'actions').kind).toBe('none')
  })

  it('多字段:全部字段都列出来(secret:false 不再被分流走)', () => {
    expect(integrationPlan(JIRA).fields.map(f => f.key)).toEqual([
      'baseUrl',
      'personalAccessToken',
    ])
  })

  it('多 export 要选一个', () => {
    expect(integrationPlan(MULTI).needsExportChoice).toBe(true)
    expect(integrationPlan(TAVILY).needsExportChoice).toBe(false)
  })

  it('目录里没有(external plugin)→ 退化成单值,不报错', () => {
    expect(integrationPlan(undefined).kind).toBe('single')
  })

  it('暴露 mountConfigFields —— 向导据此渲染带标签的非凭证配置输入', () => {
    expect(integrationPlan(MEMOS).mountConfigFields).toEqual([
      { key: 'baseUrl', label: '实例地址', required: true },
    ])
    // 未声明的 provider 是空数组(而非 undefined),渲染端不必判空。
    expect(integrationPlan(TAVILY).mountConfigFields).toEqual([])
    expect(integrationPlan(undefined).mountConfigFields).toEqual([])
  })

  it('多 export 只读取当前选择的 auth/config,不会拿第一份汇总套给全部', () => {
    expect(integrationPlan(PER_EXPORT, 'actions')).toMatchObject({
      authRequired: false,
      kind: 'none',
      mountConfigFields: [{ key: 'workspace' }],
    })
    expect(integrationPlan(PER_EXPORT, 'documents')).toMatchObject({
      authRequired: true,
      kind: 'fields',
      fields: [{ key: 'readerToken', required: true }],
      mountConfigFields: [{ key: 'tenant', required: true }],
    })
  })
})

describe('derivedSecretName', () => {
  it('由路径派生 —— authRef 不再是两处要打对的自由文本', () => {
    expect(derivedSecretName('tools/tavily')).toBe('integration-tools%2Ftavily')
    expect(derivedSecretName(' a/b/c ')).toBe('integration-a%2Fb%2Fc')
  })

  it('完整路径编码不会把 slash 与 dash 压成同一槽位', () => {
    expect(derivedSecretName('a/b')).not.toBe(derivedSecretName('a-b'))
  })
})

describe('buildIntegrationCalls', () => {
  it('单值凭证:先写 secret 再挂载,authRef 自动对上', () => {
    const calls = buildIntegrationCalls(
      form({ provider: 'tavily', credentials: { [SINGLE_FIELD_KEY]: ' tvly-k ' } }),
      TAVILY,
    )
    expect(calls.secret).toEqual({ name: 'integration-tools%2Fx', value: 'tvly-k' })
    // 单 export 时不写 export 字段(平台按 resolvePluginExport 自己选唯一那个),
    // 与 CLI `tb integration add` 一致 —— 两个操作面发出的 wire payload 应当同形。
    expect(calls.mount.config).toEqual({
      kind: 'tool',
      provider: 'tavily',
      authRef: 'integration-tools%2Fx',
    })
    expect(calls.needsAuthorize).toBe(false)
  })

  it('多字段:编码成键序固定的 JSON 对象', () => {
    const calls = buildIntegrationCalls(
      form({
        provider: 'jira',
        exportId: 'actions',
        credentials: { personalAccessToken: 'pat', baseUrl: 'https://x' },
      }),
      JIRA,
    )
    expect(calls.secret?.value).toBe('{"baseUrl":"https://x","personalAccessToken":"pat"}')
  })

  it('缺必填字段 → 抛错并点名(不等平台拒)', () => {
    expect(() =>
      buildIntegrationCalls(
        form({ provider: 'jira', exportId: 'actions', credentials: { baseUrl: 'https://x' } }),
        JIRA,
      )).toThrow(/personalAccessToken/)
  })

  it('required:false 的字段留空不算缺', () => {
    const optional: CatalogListItem = {
      ...JIRA,
      exportDetails: {
        actions: {
          auth: {
            kind: 'fields',
            fields: [
              { key: 'apiKey', required: true },
              { key: 'workspace', required: false },
            ],
          },
          id: 'actions',
          kind: 'tool',
        },
      },
    }
    const calls = buildIntegrationCalls(
      form({ provider: 'jira', exportId: 'actions', credentials: { apiKey: 'k' } }),
      optional,
    )
    expect(JSON.parse(calls.secret!.value)).toEqual({ apiKey: 'k' })
  })

  it('oauth:secret 存 clientId/clientSecret,并标出要授权', () => {
    const calls = buildIntegrationCalls(
      form({
        provider: 'sentry',
        exportId: 'actions',
        credentials: { clientId: 'cid', clientSecret: 'cs' },
      }),
      SENTRY,
    )
    expect(JSON.parse(calls.secret!.value)).toEqual({ clientId: 'cid', clientSecret: 'cs' })
    expect(calls.needsAuthorize).toBe(true)
  })

  it('oauth 缺 client 凭证 → 抛错', () => {
    expect(() =>
      buildIntegrationCalls(
        form({ provider: 'sentry', exportId: 'actions', credentials: { clientId: 'cid' } }),
        SENTRY,
      )).toThrow(/clientSecret/)
  })

  it('复用已有 secret:不写 secret,authRef 用给定名字', () => {
    const calls = buildIntegrationCalls(
      form({ provider: 'tavily', mode: 'existing', existingSecret: ' shared-key ' }),
      TAVILY,
    )
    expect(calls.secret).toBeUndefined()
    expect(calls.mount.config).toMatchObject({ authRef: 'shared-key' })
  })

  it('复用模式没选 secret → 抛错', () => {
    expect(() =>
      buildIntegrationCalls(form({ provider: 'tavily', mode: 'existing' }), TAVILY)).toThrow(
      /已保存凭证|填写新凭证/,
    )
  })

  it('"暂不配置":既不写 secret 也不带 authRef', () => {
    const calls = buildIntegrationCalls(form({ provider: 'tavily', mode: 'none' }), TAVILY)
    expect(calls.secret).toBeUndefined()
    expect(calls.mount.config).toEqual({ kind: 'tool', provider: 'tavily' })
  })

  it('单值留空 = 该集成不需要凭证(不强制)', () => {
    const calls = buildIntegrationCalls(form({ provider: 'tavily' }), TAVILY)
    expect(calls.secret).toBeUndefined()
    expect(calls.mount.config).not.toHaveProperty('authRef')
  })

  it('providerConfig:空 key/value 被剔除', () => {
    const calls = buildIntegrationCalls(
      form({
        provider: 'tavily',
        credentials: { [SINGLE_FIELD_KEY]: 'k' },
        config: { 'baseUrl': ' https://m.example.com ', '': 'x', 'region': '  ' },
      }),
      TAVILY,
    )
    expect(calls.mount.config.providerConfig).toEqual({ baseUrl: 'https://m.example.com' })
  })

  it('缺必填 mountConfig(baseUrl)→ 抛错并点名(不等平台/探针拒)', () => {
    expect(() =>
      buildIntegrationCalls(
        form({ provider: 'memos', credentials: { [SINGLE_FIELD_KEY]: 'k' } }),
        MEMOS,
      )).toThrow(/baseUrl/)
  })

  it('给了必填 mountConfig 就正常挂载', () => {
    const calls = buildIntegrationCalls(
      form({
        provider: 'memos',
        credentials: { [SINGLE_FIELD_KEY]: 'k' },
        config: { baseUrl: 'https://memos.example.com' },
      }),
      MEMOS,
    )
    expect(calls.mount.config.providerConfig).toEqual({ baseUrl: 'https://memos.example.com' })
  })

  it('context/v1 的集成挂成 kind:context', () => {
    const ctxEntry: CatalogListItem = {
      ...TAVILY,
      id: 'docs',
      nodeKinds: ['context'],
      exportDetails: {
        actions: { auth: { kind: 'single', required: false }, id: 'actions', kind: 'context' },
      },
    }
    const calls = buildIntegrationCalls(form({ provider: 'docs', mode: 'none' }), ctxEntry)
    expect(calls.mount.kind).toBe('context')
    expect(calls.mount.config.kind).toBe('context')
  })

  /**
   * 跨 kind 多 export(notes):选 context export 时按 exportDetails 挂成 context,
   * 不能从 nodeKinds=['context','tool'] 落到默认 'tool'(那样平台会拒且用户无解)。
   */
  it('跨 kind provider 按选中 export 定 kind(context export → context)', () => {
    const ctx = buildIntegrationCalls(
      form({ provider: 'notes', exportId: 'documents', mode: 'none' }),
      MULTI,
    )
    expect(ctx.mount.kind).toBe('context')
    expect(ctx.mount.config.kind).toBe('context')

    const tool = buildIntegrationCalls(
      form({ provider: 'notes', exportId: 'actions', mode: 'none' }),
      MULTI,
    )
    expect(tool.mount.kind).toBe('tool')
  })

  it('逐 export 编译:auth:none 不建 secret;另一个 export 校验自己的字段与配置', () => {
    const actions = buildIntegrationCalls(
      form({ provider: 'mixed', exportId: 'actions', mode: 'none' }),
      PER_EXPORT,
    )
    expect(actions.secret).toBeUndefined()
    expect(actions.mount.config).toMatchObject({ kind: 'tool', export: 'actions' })

    const documents = buildIntegrationCalls(
      form({
        provider: 'mixed',
        exportId: 'documents',
        credentials: { readerToken: 'r' },
        config: { tenant: 'acme' },
      }),
      PER_EXPORT,
    )
    expect(documents.mount.config).toMatchObject({
      kind: 'context',
      export: 'documents',
      providerConfig: { tenant: 'acme' },
    })
    expect(JSON.parse(documents.secret!.value)).toEqual({ readerToken: 'r' })
  })

  it('auth:none 不接受复用 secret;必填凭证 export 不接受“暂不配置”', () => {
    expect(() => buildIntegrationCalls(
      form({ provider: 'mixed', exportId: 'actions', mode: 'existing', existingSecret: 'x' }),
      PER_EXPORT,
    )).toThrow(/不需要凭证/)
    expect(() => buildIntegrationCalls(
      form({ provider: 'mixed', exportId: 'documents', mode: 'none' }),
      PER_EXPORT,
    )).toThrow(/需要凭证/)
  })

  it('多 export 未选 → 抛错;选了不存在的也抛错', () => {
    expect(() => buildIntegrationCalls(form({ provider: 'notes', mode: 'none' }), MULTI))
      .toThrow(/多个 export/)
    expect(() =>
      buildIntegrationCalls(
        form({ provider: 'notes', exportId: 'nope', mode: 'none' }),
        MULTI,
      )).toThrow(/没有 export/)
  })

  it('path 与 provider 必填', () => {
    expect(() => buildIntegrationCalls(form({ path: '  ', provider: 'tavily' }), TAVILY))
      .toThrow(/path/)
    expect(() => buildIntegrationCalls(form({ provider: ' ' }), TAVILY)).toThrow(/集成/)
  })

  it('描述留空时派生一句', () => {
    const calls = buildIntegrationCalls(form({ provider: 'tavily', mode: 'none' }), TAVILY)
    expect(calls.mount.description).toBe('tavily integration at tools/x')
  })

  /** external plugin 不在 catalog 里:仍能挂,只是没有字段提示。 */
  it('目录里没有该 provider 时仍能构造出挂载', () => {
    const calls = buildIntegrationCalls(
      form({ provider: 'my-ext', credentials: { [SINGLE_FIELD_KEY]: 'k' } }),
      undefined,
    )
    expect(calls.mount.config).toMatchObject({ kind: 'tool', provider: 'my-ext' })
  })
})

describe('defaultMountPath', () => {
  it('tool 型 → tools/<id>,context 型 → notes/<id>', () => {
    expect(defaultMountPath(TAVILY)).toBe('tools/tavily')
    expect(defaultMountPath({ ...TAVILY, id: 'docs', nodeKinds: ['context'] })).toBe('notes/docs')
  })

  it('多 kind 或无目录项时退回 tools/(拿不到唯一 kind)', () => {
    expect(defaultMountPath(MULTI)).toBe('tools/notes')
    expect(defaultMountPath(undefined)).toBe('')
  })
})
