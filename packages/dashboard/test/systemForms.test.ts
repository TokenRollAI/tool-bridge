import { describe, expect, it } from 'vitest'
import {
  buildRegistryConfig,
  buildRegistryWriteArgs,
  INITIAL_REGISTRY_MOUNT_FORM,
  type RegistryMountFormState,
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
