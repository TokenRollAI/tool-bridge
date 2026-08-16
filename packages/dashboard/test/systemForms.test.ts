import { describe, expect, it } from 'vitest'
import {
  buildRegistryConfig,
  buildRegistryWriteArgs,
  catalogPluginsForMount,
  credentialPlanFor,
  exportOptionsFor,
  INITIAL_REGISTRY_MOUNT_FORM,
  type RegistryMountFormState,
  showsAuthorizeAction,
} from '../src/pages/system/forms/registryConfig'
import {
  buildPluginManifestFields,
  INITIAL_MANIFEST_FORM,
  manifestFormState,
} from '../src/pages/system/forms/pluginManifest'
import {
  buildSkWriteArgs,
  INITIAL_SK_FORM,
} from '../src/pages/system/forms/skConfig'

const mount = (patch: Partial<RegistryMountFormState>): RegistryMountFormState => ({
  ...INITIAL_REGISTRY_MOUNT_FORM,
  path: ' providers/demo ',
  description: ' Demo provider ',
  ...patch,
})

describe('registry mount config', () => {
  it('构造 MCP 认证、headers 与虚拟化 payload', () => {
    const args = buildRegistryWriteArgs(
      mount({
        kind: 'mcp',
        mcpUrl: ' https://mcp.example.com/mcp ',
        mcpAuthMode: 'authRef',
        mcpAuthRef: ' upstream ',
        mcpAuthHeader: ' X-Token ',
        mcpSchemeMode: 'raw',
        mcpHeadersSpec: 'X-Tenant=alpha\nX-Mode=read=only',
        prefix: 'demo__ ',
        renameSpec: 'search=find',
        hideSpec: 'remove, reset',
        describeSpec: 'find=Search safely',
      }),
      { context: [], tool: [] },
    )
    expect(args).toEqual({
      path: 'providers/demo',
      kind: 'mcp',
      description: 'Demo provider',
      config: {
        kind: 'mcp',
        url: 'https://mcp.example.com/mcp',
        authRef: 'upstream',
        authHeader: 'X-Token',
        authScheme: '',
        headers: { 'X-Tenant': 'alpha', 'X-Mode': 'read=only' },
      },
      virtualize: {
        prefix: 'demo__',
        rename: { search: 'find' },
        hide: ['remove', 'reset'],
        describe: { find: 'Search safely' },
      },
    })
  })

  it('逐项校验并规范化 HTTP ToolDef', () => {
    const config = buildRegistryConfig(
      mount({
        kind: 'http',
        endpoint: ' https://api.example.com ',
        httpAuthRef: 'api-token',
        authHeader: 'X-Api-Key',
        httpSchemeMode: 'raw',
        toolsJson: JSON.stringify([
          {
            name: 'get-item',
            description: 'Get one item',
            method: 'get',
            pathTemplate: '/items/{id}',
            inputSchema: { type: 'object' },
            ignored: true,
          },
        ]),
      }),
      { context: [], tool: [] },
    )
    expect(config).toEqual({
      kind: 'http',
      endpoint: 'https://api.example.com',
      authRef: 'api-token',
      authHeader: 'X-Api-Key',
      authScheme: '',
      tools: [{
        name: 'get-item',
        description: 'Get one item',
        method: 'GET',
        pathTemplate: '/items/{id}',
        inputSchema: { type: 'object' },
      }],
    })
  })

  it('拒绝无 authRef 的 HTTP 认证定制与畸形 ToolDef', () => {
    expect(() => buildRegistryConfig(
      mount({ kind: 'http', endpoint: 'https://api.example.com', authHeader: 'X-Token' }),
      { context: [], tool: [] },
    )).toThrow('只有同时填写 authRef')
    expect(() => buildRegistryConfig(
      mount({
        kind: 'http',
        endpoint: 'https://api.example.com',
        toolsJson: JSON.stringify([{ name: 'broken', method: 'PATCH' }]),
      }),
      { context: [], tool: [] },
    )).toThrow('description')
  })

  it('自定义 authScheme 不能静默回退为 Bearer', () => {
    expect(() => buildRegistryConfig(
      mount({
        kind: 'mcp',
        mcpUrl: 'https://mcp.example.com',
        mcpAuthMode: 'authRef',
        mcpAuthRef: 'upstream',
        mcpSchemeMode: 'custom',
      }),
      { context: [], tool: [] },
    )).toThrow('自定义 authScheme 前缀必填')
    expect(() => buildRegistryConfig(
      mount({
        kind: 'http',
        endpoint: 'https://api.example.com',
        httpAuthRef: 'upstream',
        httpSchemeMode: 'custom',
      }),
      { context: [], tool: [] },
    )).toThrow('自定义 authScheme 前缀必填')
  })

  it('对齐 context、skillhub 与 plugin export 选择规则', () => {
    expect(buildRegistryConfig(
      mount({ kind: 'context', provider: 'r2', ctxPrefix: 'docs/', ttl: '60', readOnly: true }),
      { context: [], tool: [] },
    )).toEqual({
      kind: 'context',
      provider: 'r2',
      providerConfig: { prefix: 'docs/' },
      readOnly: true,
      ttl: 60,
    })
    expect(() => buildRegistryConfig(
      mount({ kind: 'tool', toolProvider: 'multi' }),
      {
        context: [],
        tool: [
          { id: 'one', profile: 'tools/v1' },
          { id: 'two', profile: 'tools/v1' },
        ],
      },
    )).toThrow('挂载须指定 export')
    expect(buildRegistryConfig(
      mount({ kind: 'skillhub', skillProvider: 's3', s3Endpoint: 'https://s3.example.com', s3Bucket: 'skills', ctxAuthRef: 's3-main' }),
      { context: [], tool: [] },
    )).toMatchObject({ kind: 'skillhub', provider: 's3', authRef: 's3-main' })
  })

  it('拒绝非法 ttl、pair 与空基础身份', () => {
    expect(() => buildRegistryWriteArgs(
      mount({ path: ' ', kind: 'remote', baseUrl: 'https://remote.example.com' }),
      { context: [], tool: [] },
    )).toThrow('path 与描述必填')
    expect(() => buildRegistryConfig(
      mount({ kind: 'context', ttl: '0' }),
      { context: [], tool: [] },
    )).toThrow('正整数')
    expect(() => buildRegistryWriteArgs(
      mount({ kind: 'mcp', mcpUrl: 'https://mcp.example.com', renameSpec: 'broken' }),
      { context: [], tool: [] },
    )).toThrow('from=to')
  })

  it('内置 catalog 可进入高级挂载并携带 providerConfig + 虚拟化', () => {
    const plugins = catalogPluginsForMount([{
      digest: 'd',
      exportDetails: {
        actions: {
          auth: { kind: 'single', required: true },
          id: 'actions',
          kind: 'tool',
          mountConfigFields: [{ key: 'baseUrl', required: true }],
        },
      },
      exportKinds: { actions: 'tool' },
      exports: ['actions'],
      id: 'posthog',
      needsOAuth: false,
      nodeKinds: ['tool'],
    }])
    const exports = exportOptionsFor(plugins, 'posthog', 'tools/v1')
    const args = buildRegistryWriteArgs(
      mount({
        kind: 'tool',
        toolProvider: 'posthog',
        toolExport: 'actions',
        toolAuthRef: 'posthog-key',
        pluginConfig: { baseUrl: ' https://eu.posthog.com ' },
        prefix: 'ph__',
      }),
      { context: [], tool: exports },
    )
    expect(args.config).toEqual({
      kind: 'tool',
      provider: 'posthog',
      export: 'actions',
      authRef: 'posthog-key',
      providerConfig: { baseUrl: 'https://eu.posthog.com' },
    })
    expect(args.virtualize).toEqual({ prefix: 'ph__' })
  })

  it('高级挂载按 export 拒绝缺失配置/凭证与 auth:none 的多余 authRef', () => {
    const required = [{
      auth: { kind: 'single' as const, required: true },
      id: 'actions',
      profile: 'tools/v1' as const,
      mountConfigFields: [{ key: 'baseUrl', required: true }],
    }]
    expect(() => buildRegistryConfig(
      mount({ kind: 'tool', toolProvider: 'posthog', toolExport: 'actions' }),
      { context: [], tool: required },
    )).toThrow(/authRef|baseUrl/)

    expect(() => buildRegistryConfig(
      mount({ kind: 'tool', toolProvider: 'notes', toolAuthRef: 'unused' }),
      {
        context: [],
        tool: [{ auth: { kind: 'none' }, id: 'actions', profile: 'tools/v1' }],
      },
    )).toThrow(/无需凭证/)
  })
})

describe('plugin manifest config', () => {
  it('生成 plugin/v2 默认 manifest 并规范化 bearer 引用', () => {
    expect(buildPluginManifestFields({
      ...INITIAL_MANIFEST_FORM,
      endpoint: ' https://plugin.example.com ',
      healthPath: '',
      authKind: 'bearer',
      secretRef: ' plugin-token ',
      enabled: false,
    })).toEqual({
      protocolVersion: 'plugin/v2',
      endpoint: 'https://plugin.example.com',
      auth: { kind: 'bearer', secretRef: 'plugin-token' },
      healthPath: '/healthz',
      enabled: false,
    })
  })

  it('从 manifest 回填表单并拒绝无效认证或 healthPath', () => {
    expect(manifestFormState({
      id: 'demo',
      protocolVersion: 'plugin/v2',
      endpoint: 'https://plugin.example.com',
      healthPath: '/ready',
      auth: { kind: 'platform-token' },
      enabled: true,
    })).toEqual({
      endpoint: 'https://plugin.example.com',
      healthPath: '/ready',
      authKind: 'platform-token',
      secretRef: '',
      enabled: true,
    })
    expect(() => buildPluginManifestFields({
      ...INITIAL_MANIFEST_FORM,
      endpoint: 'https://plugin.example.com',
      authKind: 'bearer',
    })).toThrow('secretRef')
    expect(() => buildPluginManifestFields({
      ...INITIAL_MANIFEST_FORM,
      endpoint: 'https://plugin.example.com',
      healthPath: 'healthz',
    })).toThrow('必须以 / 开头')
  })
})

describe('secret key config', () => {
  it('构造 allow/deny、registerPaths 与 ISO expiresAt', () => {
    expect(buildSkWriteArgs({
      ...INITIAL_SK_FORM,
      owner: ' agent:reader ',
      description: ' docs only ',
      scopes: [
        { pattern: ' docs/** ', actions: ['read', 'call'], effect: 'allow' },
        { pattern: ' docs/private/** ', actions: ['read'], effect: 'deny' },
      ],
      registerPaths: 'device/a,b/**\ndevice/b/**',
      expiresAt: '2030-01-02T03:04',
    })).toEqual({
      owner: 'agent:reader',
      description: 'docs only',
      scopes: [
        { pattern: 'docs/**', actions: ['read', 'call'] },
        { pattern: 'docs/private/**', actions: ['read'], effect: 'deny' },
      ],
      registerPaths: ['device/a,b/**', 'device/b/**'],
      expiresAt: new Date('2030-01-02T03:04').toISOString(),
    })
  })

  it('半填 scope、空 owner 与非法时间均 fail closed', () => {
    expect(() => buildSkWriteArgs({
      ...INITIAL_SK_FORM,
      scopes: [{ pattern: '', actions: ['read'], effect: 'allow' }],
    })).toThrow('owner')
    expect(() => buildSkWriteArgs({
      ...INITIAL_SK_FORM,
      owner: 'agent:reader',
      scopes: [{ pattern: '', actions: ['read'], effect: 'allow' }],
    })).toThrow('第 1 条 scope')
    expect(() => buildSkWriteArgs({
      ...INITIAL_SK_FORM,
      owner: 'agent:reader',
      expiresAt: 'not-a-date',
    })).toThrow('过期时间格式非法')
  })
})

/**
 * 授权入口的显示条件(对等 `tb tool auth` 的可达性)。
 *
 * 这条以前是 JSX 里的内联条件、无测试:`node.kind === 'mcp' && config.auth === 'oauth'`
 * —— 于是 provider 型 oauth 挂载(kind:'tool')在 Dashboard 上**完全没有授权入口**,
 * 是个管理旁路。抽成纯函数就是为了让它有闸门。
 */
describe('showsAuthorizeAction', () => {
  it('auth:oauth 的 mcp 挂载:显示', () => {
    expect(showsAuthorizeAction({ kind: 'mcp', config: { auth: 'oauth' } })).toBe(true)
  })

  it('普通 mcp 挂载(authRef 或公开):不显示', () => {
    expect(showsAuthorizeAction({ kind: 'mcp', config: { authRef: 'x' } })).toBe(false)
    expect(showsAuthorizeAction({ kind: 'mcp' })).toBe(false)
  })

  it('**plugin tool 挂载:显示** —— oauth 声明在 ~describe 里,列表页判不出,故一律给入口', () => {
    expect(showsAuthorizeAction({ kind: 'tool', config: { provider: 'gmail', authRef: 'c' } })).toBe(true)
    // 连不带 authRef 的也显示:判不出就不能替用户断言"这个不需要授权"。
    expect(showsAuthorizeAction({ kind: 'tool', config: { provider: 'notes' } })).toBe(true)
  })

  it('其余 kind:不显示', () => {
    for (const kind of ['http', 'context', 'skillhub', 'remote', 'device']) {
      expect(showsAuthorizeAction({ kind }), kind).toBe(false)
    }
  })
})

/**
 * 挂载表单的凭证提示。数据早就有(注册时缓存的 `~describe`),但 Dashboard 的
 * `PluginExport` 类型漏了 credentialFields/credentialProbe/oauth 三个字段 ——
 * 于是挂载 deepseek / feishu_custom_bot / jira 时,表单只给一个空的 authRef 输入框,
 * 用户看不到该填什么。这几条钉住"从缓存的 export 推出配置需求"。
 */
describe('credentialPlanFor', () => {
  /**
   * **`secret: false` 不分流**。此前这里断言按该标志把字段拆成 authRef / providerConfig
   * 两组,把一个真 bug 固化成了规格:运行时 `assertToolConfig` 把整个 credentialFields
   * 交给 core `parseCredentialValues`,后者要求每个 `required !== false` 的字段都在 authRef
   * 解出的 JSON 里。照分流后的引导操作 → 挂载被拒("缺少必填字段:baseUrl")。
   * 精确影响 8 个声明了 `secret: false` 的 provider,且它们的 handler 也都从
   * `ctx.credentials` 取这些字段 —— 通道从来只有一条。
   */
  it('多字段:全部字段都进 authRef 那个 secret(secret:false 只是展示语义)', () => {
    // jira 的真实形状(线上 ~describe 实测):baseUrl 标了 secret:false,但它同样经
    // ctx.credentials 取(见 plugins/src/jira/api.ts 的 requireCredential)。
    const plan = credentialPlanFor([{
      id: 'actions',
      profile: 'tools/v1',
      credentialProbe: 'list_projects',
      credentialFields: [
        { key: 'baseUrl', label: 'Instance URL', required: true, secret: false },
        { key: 'personalAccessToken', label: 'PAT', required: true, secret: true },
      ],
    }], 'actions')
    expect(plan.kind).toBe('fields')
    expect(plan.secretFields.map(f => f.key)).toEqual(['baseUrl', 'personalAccessToken'])
    expect(plan.probe).toBe('list_projects')
  })

  it('secret 缺省同样进凭证(与 core parseCredentialValues 的口径一致)', () => {
    const plan = credentialPlanFor([{
      id: 'actions',
      profile: 'tools/v1',
      credentialFields: [{ key: 'apiKey', label: 'API key' }],
    }], 'actions')
    expect(plan.secretFields.map(f => f.key)).toEqual(['apiKey'])
  })

  it('oauth:不列字段,authRef 存 clientId/clientSecret,且要提示授权一步', () => {
    const plan = credentialPlanFor([{
      id: 'actions',
      profile: 'tools/v1',
      oauth: {
        authorizationUrl: 'https://sentry.io/oauth/authorize/',
        tokenUrl: 'https://sentry.io/oauth/token/',
        scopes: ['org:read'],
      },
    }], 'actions')
    expect(plan.kind).toBe('oauth')
    expect(plan.oauth?.scopes).toEqual(['org:read'])
  })

  it('都没声明:单值 API key(deepseek 这类)', () => {
    const plan = credentialPlanFor([{ id: 'actions', profile: 'tools/v1' }], 'actions')
    expect(plan.kind).toBe('single')
  })

  it('exportId 留空时取第一个(与"单 export 可留空"的表单语义一致)', () => {
    const plan = credentialPlanFor([{
      id: 'actions',
      profile: 'tools/v1',
      credentialFields: [{ key: 'apiKey', label: 'k', secret: true }],
    }], '  ')
    expect(plan.secretFields.map(f => f.key)).toEqual(['apiKey'])
  })

  it('exports 为空或 id 对不上:退化成 single,不炸', () => {
    expect(credentialPlanFor([], 'actions').kind).toBe('single')
    expect(credentialPlanFor([{ id: 'a', profile: 'tools/v1' }], 'nope').kind).toBe('single')
  })
})
