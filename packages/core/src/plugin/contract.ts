/**
 * 注册时契约校验(plugin/v2)。
 *
 * 输入 = manifest + 平台抓取的 `/~describe` JSON;纯逻辑,抓取本身在宿主。
 *
 * **v2 的 `~describe` 返回 exports 列表**,每个 export 声明自己的 `profile`
 * (tools/v1 或 context/v1)与实际提供的操作:
 *
 * ```json
 * { "protocolVersion": "plugin/v2",
 *   "exports": [
 *     { "id": "actions",   "profile": "tools/v1",   "description": "Feishu actions" },
 *     { "id": "documents", "profile": "context/v1", "methods": ["Get","List","Search"] } ] }
 * ```
 *
 * v1 需要额外抓 `~help` 来数方法,是因为方法集合无处声明;v2 由 export 自报 `methods`,
 * 校验不再依赖 `~help` 抓取(少一次往返,也不再受 help 表现形态影响)。
 *
 * context/v1 的 `methods` 与 Round 7 的「按 handler 存在性推导能力」同一套语义:
 * 声明多少就是多少,平台只调用声明过的动词。
 */

import { z } from 'zod'
import type { PluginManifest } from './manifest'
import { type PluginOAuth, pluginOAuthSchema } from './oauth'
import { CONTEXT_METHODS } from '../context/capabilities'
import { TBError } from '../errors'

/** export 的语义档位。 */
export type PluginProfile = 'tools/v1' | 'context/v1'

export const PLUGIN_PROFILES: readonly PluginProfile[] = ['tools/v1', 'context/v1']

/** profile → 可挂载的树节点 kind(挂载校验用)。 */
export const NODE_KIND_BY_PROFILE: Record<PluginProfile, 'tool' | 'context'> = {
  'tools/v1': 'tool',
  'context/v1': 'context',
}

/**
 * capability 基名 → 可选方法名(context/v1)。
 * 限定词(如 `search:semantic`)按 ':' 前的基名判定;未知基名忽略(向前兼容)。
 */
const OPTIONAL_METHOD_BY_CAPABILITY: Record<string, string> = {
  search: 'Search',
  delete: 'Delete',
}

/**
 * capabilities → 已声明的可选方法名集合(去重;未知基名忽略)。
 * 挂载后 `~help` 只列"核心动词 + 已声明可选方法"的过滤依据。
 */
export function optionalMethodsForCapabilities(capabilities: readonly string[]): Set<string> {
  const methods = new Set<string>()
  for (const capability of capabilities) {
    const base = capability.split(':', 1)[0] ?? capability
    const method = OPTIONAL_METHOD_BY_CAPABILITY[base]
    if (method !== undefined) methods.add(method)
  }
  return methods
}

// export id 与 plugin id 同规则:会进挂载配置并被路径化引用。
const EXPORT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const exportAuthSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('single'),
    description: z.string().optional(),
    label: z.string().optional(),
    required: z.boolean().optional(),
  }),
])

const exportSchema = z.object({
  id: z.string().regex(EXPORT_ID_RE, 'export id 须为 [A-Za-z0-9._-] 且不以标点开头'),
  profile: z.enum(PLUGIN_PROFILES),
  description: z.string().optional(),
  /** context/v1:实际提供的动词;tools/v1 由运行时 List 发现,可省。 */
  methods: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  /** export 的单值/无凭证声明;多字段与 OAuth 继续由各自字段表达。 */
  auth: exportAuthSchema.optional(),
  /**
   * tools/v1 可选:一个**只读、零副作用、无必填入参**的工具名,平台在挂载时拿它做一次
   * 真实调用来验证 `authRef` 指向的凭证可用(见 `credentialProbe` 的类型注释)。
   */
  credentialProbe: z.string().optional(),
  /**
   * 多字段凭证的字段声明(tools/v1)。声明了它,平台就知道该 secret 存的是一个 JSON
   * 对象而非单值,并在挂载时校验字段齐全 —— 见 `credentialFields` 的类型注释。
   */
  /**
   * provider 型 OAuth2 的声明(tools/v1)。声明了它,平台就托管授权码流程:
   * `POST /<path>/~authorize` 发起、回调兑换、调用时自动刷新,插件只拿到 access token。
   */
  oauth: pluginOAuthSchema.optional(),
  credentialFields: z.array(z.object({
    key: z.string().regex(/^[A-Za-z_][\w]*$/, '字段名须为合法标识符'),
    label: z.string().optional(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    /** 敏感字段:管理面不回显、日志不打印。缺省按敏感处理(fail safe)。 */
    secret: z.boolean().optional(),
  })).min(1).optional(),
  /**
   * 非凭证的挂载配置字段(如 baseUrl / instanceUrl / region)。声明了它,平台就知道
   * 该 export 挂载时还需要哪些 `providerConfig`,管理面据此渲染带标签的输入框而不是让
   * 用户对着一个自由 k=v 框猜 —— 见 `mountConfigFields` 的类型注释。
   */
  mountConfigFields: z.array(z.object({
    key: z.string().regex(/^[A-Za-z_][\w]*$/, '字段名须为合法标识符'),
    label: z.string().optional(),
    description: z.string().optional(),
    required: z.boolean().optional(),
  })).min(1).optional(),
})

const describeSchema = z.object({
  protocolVersion: z.string().min(1),
  exports: z.array(exportSchema).min(1, '至少声明一个 export'),
})

/** 单个 export 的声明。 */
export interface PluginExport {
  /** 明确声明无需凭证,或声明单值凭证的展示/必填语义；与 oauth/credentialFields 三选一。 */
  auth?: PluginExportAuth
  capabilities?: string[]
  /**
   * 多字段凭证的字段声明(仅 tools/v1)。
   *
   * 平台的凭证通道 `X-TB-Upstream-Auth` 传的是**一个字符串**:多数 provider 只要一个
   * API key,够用。但一批 provider 需要多个字段(飞书要 app_id + app_secret、S3 要
   * access key + secret + region…),此前只能靠"把 JSON 塞进那个单值"的**约定**——
   * 平台不知道里面是什么,配错了要到第一次调用才发现,管理面也没法提示该填哪些字段。
   *
   * 声明了它:
   * - `tb secret set <name> --field appId=x --field appSecret=y` 存成 JSON 对象;
   * - 挂载时平台校验必填字段齐全,缺了当场拒并说清缺哪个;
   * - 传输契约**不变**(仍是那个 base64url 字符串,内容是 JSON),故已有 plugin 零影响。
   */
  credentialFields?: PluginCredentialField[]
  /**
   * 凭证探针:一个只读、零副作用、无必填入参的工具名(仅 tools/v1)。
   *
   * 存在的问题:平台的凭证是 `tb secret set` 存进 SecretStore、挂载只写 `authRef`,
   * 插件要到**第一次业务调用**才拿得到它 —— 配错的 key 不会在存入或挂载时报错,
   * 而是等到某个 agent 真去调用时才 401。
   *
   * 声明了它,挂载时平台就用注入的凭证真实调一次这个工具:通则凭证可用,401/403 则
   * 当场拒绝挂载并说清是凭证问题。用现有的 Call 通道,不新增协议动词 —— 上游
   * open-connector 的 `credentialValidators`("打最便宜的接口试凭证")正是这个语义。
   */
  credentialProbe?: string
  description?: string
  id: string
  methods?: string[]
  /**
   * 非凭证的挂载配置字段声明。声明了它,平台就知道该 export 挂载时还需要
   * 哪些 `providerConfig`(如 memos 的 baseUrl),管理面据此渲染带标签的输入框、缺必填项
   * 可在挂载前拦下 —— 此前这些需求只写在插件源码注释里,用户要到运行时才发现。
   *
   * 见 {@link PluginMountConfigField}:它与 `credentialFields` 是两条通道,值明文进节点记录,
   * 故只放非密钥配置。
   */
  mountConfigFields?: PluginMountConfigField[]
  /**
   * provider 型 OAuth2 的声明(仅 tools/v1)。
   *
   * 与 mcp 上游的托管 OAuth 是两套机制:那条从资源服务器 discovery + 动态注册客户端(DCR),
   * 这条的端点是写死的已知值、client 由用户自己在 provider 后台注册。共用"授权码 + PKCE"
   * 骨架与 state 密封,但配置来源不同,合并会让两边都变形。
   *
   * 声明了它,挂载配的 `authRef` 指向的 secret 存的是 **client 凭证**
   * (`clientId` + `clientSecret`,见 `OAUTH_CLIENT_FIELDS`),而不是直接的 access token ——
   * 后者由平台跑完授权流程后自己保管并按需刷新。
   */
  oauth?: PluginOAuth
  profile: PluginProfile
}

/** 多字段凭证的单个字段声明。 */
export interface PluginCredentialField {
  description?: string
  key: string
  label?: string
  required?: boolean
  /** 敏感字段:管理面不回显、日志不打印。缺省按敏感处理。 */
  secret?: boolean
}

/**
 * 非凭证挂载配置的单个字段声明(providerConfig)。
 *
 * 与 `PluginCredentialField` 的分工是硬边界,不是风格选择:凭证走 `authRef` → 加密的
 * SecretStore(只写不读);这里的值明文进节点记录,`system/registry get` 会回显给任何
 * 对该节点有 `read` 的 SK。**所以这里没有 `secret` 字段** —— 能声明"遮蔽输入"会诱导作者
 * 把密钥放进来,而那条通道根本不加密。密钥永远走 `credentialFields`。
 *
 * 典型值:自建实例的 `baseUrl`/`instanceUrl`、`region`、`workspaceId`。`required` 缺省
 * 视为**非必填**(与 providerConfig "有就用、没有走默认" 的既有语义一致;凭证字段那边
 * 缺省是必填,方向相反是因为两者的失败代价不同 —— 少个 baseUrl 多半有云端兜底,
 * 少个凭证字段则必然调不通)。
 */
export interface PluginMountConfigField {
  description?: string
  key: string
  label?: string
  required?: boolean
}

/** export 的上游凭证形态补充;多字段与 OAuth 由既有声明表达。 */
export type PluginExportAuth
  = | { kind: 'none' }
    | { description?: string, kind: 'single', label?: string, required?: boolean }

/** `/~describe` 响应形状(v2)。 */
export interface PluginDescribe {
  exports: PluginExport[]
  protocolVersion: string
}

export interface PluginContractInput {
  /** 抓取到的 `/~describe` JSON(已 parse 的值)。 */
  describe: unknown
  manifest: PluginManifest
}

/** 契约校验入口;通过则返回解析后的 ~describe(exports 缓存供挂载与 ~help 使用)。 */
export function validatePluginContract(input: PluginContractInput): PluginDescribe {
  const { manifest } = input

  const parsed = describeSchema.safeParse(input.describe)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new TBError(
      'invalid_argument',
      `plugin '${manifest.id}' 的 ~describe 形状非法(需 {protocolVersion, exports[]}):`
      + `${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`,
    )
  }
  const describe = parsed.data

  if (describe.protocolVersion !== manifest.protocolVersion) {
    throw new TBError(
      'invalid_argument',
      `plugin '${manifest.id}' 的 ~describe.protocolVersion '${describe.protocolVersion}' `
      + `与 manifest '${manifest.protocolVersion}' 不符`,
    )
  }

  const seen = new Set<string>()
  for (const exported of describe.exports) {
    if (seen.has(exported.id)) {
      throw new TBError('invalid_argument', `plugin '${manifest.id}' 的 export id 重复:'${exported.id}'`)
    }
    seen.add(exported.id)

    if (
      exported.auth === undefined
      && exported.oauth === undefined
      && exported.credentialFields === undefined
    ) {
      throw new TBError(
        'invalid_argument',
        `plugin '${manifest.id}' export '${exported.id}' 必须显式声明 auth、oauth 或 credentialFields`,
      )
    }

    if (exported.auth !== undefined) {
      if (exported.oauth !== undefined || exported.credentialFields !== undefined) {
        throw new TBError(
          'invalid_argument',
          `plugin '${manifest.id}' export '${exported.id}' 的 auth 不能与 oauth/credentialFields 同时声明`,
        )
      }
      if (exported.auth.kind === 'none' && exported.credentialProbe !== undefined) {
        throw new TBError(
          'invalid_argument',
          `plugin '${manifest.id}' export '${exported.id}' 声明 auth:none,不能再声明 credentialProbe`,
        )
      }
    }

    // credentialProbe 只对 tools/v1 有意义(context/v1 的动词表本身就够平台探活)。
    // 声明在错的 profile 上是配置错误,不是"忽略即可"的多余字段 —— 否则作者会以为
    // 挂载时验了凭证,实际上什么都没发生。
    if (exported.credentialProbe !== undefined && exported.profile !== 'tools/v1') {
      throw new TBError(
        'invalid_argument',
        `plugin '${manifest.id}' export '${exported.id}' 在 ${exported.profile} 上声明了 `
        + 'credentialProbe,该字段仅 tools/v1 支持',
      )
    }
    if (exported.oauth !== undefined) {
      if (exported.profile !== 'tools/v1') {
        throw new TBError(
          'invalid_argument',
          `plugin '${manifest.id}' export '${exported.id}' 在 ${exported.profile} 上声明了 oauth,`
          + '该字段仅 tools/v1 支持',
        )
      }
      // 挂载期的探针会拿 authRef 去调用,而 oauth 模式下那个 secret 存的是 client 凭证 ——
      // 平台已改为"oauth 挂载不跑探针",但**声明本身仍是矛盾的**:作者会以为挂载时验了
      // 凭证,实际什么都没发生。与下面 credentialFields 那条同一个理由,当场拒。
      if (exported.credentialProbe !== undefined) {
        throw new TBError(
          'invalid_argument',
          `plugin '${manifest.id}' export '${exported.id}' 不能同时声明 oauth 与 credentialProbe:`
          + 'oauth 的凭证可用性由授权流程本身证明,挂载期不会跑探针',
        )
      }
      // 两者都在描述"authRef 指向的 secret 里存什么",同时声明会矛盾:oauth 模式下那个
      // secret 固定存 clientId/clientSecret(OAUTH_CLIENT_FIELDS),不由 plugin 自定义。
      if (exported.credentialFields !== undefined) {
        throw new TBError(
          'invalid_argument',
          `plugin '${manifest.id}' export '${exported.id}' 不能同时声明 oauth 与 credentialFields:`
          + 'oauth 模式下 authRef 指向的 secret 固定存 clientId/clientSecret',
        )
      }
    }
    if (exported.credentialFields !== undefined) {
      if (exported.profile !== 'tools/v1') {
        throw new TBError(
          'invalid_argument',
          `plugin '${manifest.id}' export '${exported.id}' 在 ${exported.profile} 上声明了 `
          + 'credentialFields,该字段仅 tools/v1 支持',
        )
      }
      const keys = new Set<string>()
      for (const field of exported.credentialFields) {
        if (keys.has(field.key)) {
          throw new TBError(
            'invalid_argument',
            `plugin '${manifest.id}' export '${exported.id}' 的 credentialFields 有重复字段 '${field.key}'`,
          )
        }
        keys.add(field.key)
      }
    }
    if (exported.mountConfigFields !== undefined) {
      const keys = new Set<string>()
      for (const field of exported.mountConfigFields) {
        if (keys.has(field.key)) {
          throw new TBError(
            'invalid_argument',
            `plugin '${manifest.id}' export '${exported.id}' 的 mountConfigFields 有重复字段 '${field.key}'`,
          )
        }
        keys.add(field.key)
      }
    }

    if (exported.profile === 'context/v1') {
      const known = new Set<string>(CONTEXT_METHODS)
      const unknown = (exported.methods ?? []).filter(m => !known.has(m))
      if (unknown.length > 0) {
        throw new TBError(
          'invalid_argument',
          `plugin '${manifest.id}' export '${exported.id}' 声明了未知动词:${unknown.join(', ')}`,
        )
      }
      // 声明了可选能力就必须同时把对应动词列进 methods —— 否则平台永远不会调用它,
      // 属于自相矛盾的声明(与 v1 "capability 必须有对应 cmd" 同一意图)。
      if (exported.methods !== undefined) {
        const declared = new Set(exported.methods)
        for (const capability of exported.capabilities ?? []) {
          const base = capability.split(':', 1)[0] ?? capability
          const method = OPTIONAL_METHOD_BY_CAPABILITY[base]
          if (method !== undefined && !declared.has(method)) {
            throw new TBError(
              'invalid_argument',
              `plugin '${manifest.id}' export '${exported.id}' 声明 capability '${capability}' `
              + `但 methods 未含 '${method}'`,
            )
          }
        }
      }
    }
  }

  return describe
}

/**
 * 按挂载配置选出目标 export。
 * - 显式 `exportId`:必须存在,且 profile 与节点 kind 相符;
 * - 省略且**恰好一个** export:取它(单 export plugin 的挂载不必写 export);
 * - 省略但有多个:invalid_argument(要求显式指定,不猜)。
 */
export function resolvePluginExport(
  describe: PluginDescribe,
  opts: { exportId?: string, nodeKind: 'tool' | 'context', pluginId: string },
): PluginExport {
  const { exports } = describe
  let chosen: PluginExport | undefined
  if (opts.exportId !== undefined) {
    chosen = exports.find(e => e.id === opts.exportId)
    if (chosen === undefined) {
      throw new TBError(
        'invalid_argument',
        `plugin '${opts.pluginId}' 无 export '${opts.exportId}'(现有:${exports.map(e => e.id).join(', ')})`,
      )
    }
  } else if (exports.length === 1) {
    chosen = exports[0]
  } else {
    throw new TBError(
      'invalid_argument',
      `plugin '${opts.pluginId}' 有多个 export(${exports.map(e => e.id).join(', ')}),挂载须指定 config.export`,
    )
  }
  if (chosen === undefined) {
    throw new TBError('invalid_argument', `plugin '${opts.pluginId}' 无可用 export`)
  }
  if (NODE_KIND_BY_PROFILE[chosen.profile] !== opts.nodeKind) {
    throw new TBError(
      'invalid_argument',
      `plugin '${opts.pluginId}' 的 export '${chosen.id}' 是 ${chosen.profile},`
      + `不能挂成 kind:'${opts.nodeKind}' 节点`,
    )
  }
  return chosen
}
