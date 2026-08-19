/**
 * HTBP 线上形状(与 core 的 HelpJson/TreeJson/TBError 对齐)。
 * Dashboard 是纯 API 客户端,不 import core——形状按网关契约手抄,字段不多不少。
 */

export type NodeKind
  = | 'directory'
    | 'builtin'
    | 'mcp'
    | 'http'
    | 'remote'
    | 'context'
    | 'skillhub'
    | 'device'
    | 'tool'

export type Action = 'read' | 'write' | 'call' | 'register' | 'admin'

export const ACTIONS: readonly Action[] = ['read', 'write', 'call', 'register', 'admin']

export interface Scope {
  actions: Action[]
  /** 默认 allow;deny 优先于一切 allow。 */
  effect?: 'allow' | 'deny'
  /** 树路径 glob:"**" | "docs/**"。 */
  pattern: string
}

export interface TBErrorBody {
  code:
    | 'not_found'
    | 'permission_denied'
    | 'invalid_argument'
    | 'conflict'
    | 'unavailable'
    | 'rate_limited'
    | 'internal'
  message: string
  retryable: boolean
}

export interface HelpCmd {
  confirm?: boolean
  effect?: string
  h?: string
  inputSchema?: Record<string, unknown>
  method: 'POST'
  name: string
  path: string
  returns?: string
  scope: Action
}

export interface HelpJson {
  children?: Array<{ description: string, kind: NodeKind, path: string }>
  cmds: HelpCmd[]
  /** Agent feedback 默认区块(头部条目,只含 id/title/score)。 */
  feedback?: Array<{ id: string, score: number, title: string }>
  htbp: string
  node: { description: string, kind: NodeKind, path: string }
  /** 管理员补充说明(system/annotation,网关 ~help 注入)。 */
  note?: string
}

/** ~feedback 端点的条目视图(list 不含 detail;get 含)。 */
export interface FeedbackView {
  at: string
  by: string
  detail?: string
  down: number
  id: string
  score: number
  title: string
  up: number
}

/**
 * device presence 三态(对齐 core 的 `device/presence.ts`)。
 * `online` 只是连接建立/拆除的事件位;拆除事件可能永不到达,所以读路径由宿主结合
 * `lastSeenAt` 的新鲜度投影为三态,`stale` = 连接位仍为真但存活观察已超时。
 */
export type PresenceState = 'online' | 'stale' | 'offline'

/** `~tree` 上 device 节点的在线状态形状;取代旧版裸 `online` 布尔。 */
export interface Presence {
  /** 最近一次观察到设备存活的时刻;缺省表示从未观察(旧连接或旧数据)。 */
  lastSeenAt?: string
  state: PresenceState
}

export interface TreeJson {
  children?: TreeJson[]
  description: string
  kind: NodeKind
  path: string
  /** 仅 device:宿主已投影好的三态在线状态。 */
  presence?: Presence
  truncated?: boolean
}

/**
 * system/registry 返回的节点(builtin/registry.ts 的 Node 面 = 存储层 TreeNode)。
 *
 * 注意与 `TreeJson` 的差别:registry 是**存储态**,保留裸 `online`(连接事件位)+ `lastSeenAt`,
 * 不做投影;`~tree` 是**读投影**,只给 `presence`。消费时别把两者混为一谈——registry 侧要三态
 * 得自己过 `lib/presence.ts` 的 `derivePresence`。
 */
export interface RegistryNode {
  config?: Record<string, unknown>
  createdAt?: string
  description: string
  kind: NodeKind
  /** 仅 device:最近一次存活观察(hello / 心跳 / 成功调用)。 */
  lastSeenAt?: string
  /** 仅 device:连接是否已建立。不等于"此刻可路由",须结合 `lastSeenAt` 判新鲜度。 */
  online?: boolean
  path: string
  registeredBy?: string
  updatedAt?: string
  virtualize?: Record<string, unknown>
}

/** system/sk 返回的 SecretKey(无 hash)。 */
export interface SecretKeyInfo {
  createdAt?: string
  description?: string
  disabled?: boolean
  expiresAt?: string
  id: string
  owner: string
  registerPaths?: string[]
  scopes: Scope[]
}

export interface Page<T> {
  cursor?: string
  items: T[]
}

/** root `~search` 返回的虚拟化后 ToolSpec。 */
export interface ToolSpec {
  confirm?: boolean
  description?: string
  effect?: string
  inputSchema?: unknown
  name: string
}

export interface ToolSearchItem {
  path: string
  tool: ToolSpec
}

/** system/federation list 的一行:remote 联邦 host 白名单合并视图。 */
export interface FederationHost {
  host: string
  removable: boolean
  source: 'env' | 'store'
  updatedAt?: string
}

/** system/plugin 的 manifest（plugin/manifest.ts + builtin/plugin.ts 的 PluginView 契约手抄）。 */
export type PluginProfile = 'tools/v1' | 'context/v1'

/** `~describe` 里的一个 export：plugin/v2 把「提供什么」从部署身份移到了 export 上。 */
/**
 * 多字段凭证的一个字段声明(来自 plugin 的 `~describe`,注册时缓存进 manifest)。
 *
 * **`secret` 只管展示,不管通道**:声明了 `credentialFields` 的 export,它的**全部**字段
 * 都进 authRef 指向的那个 secret(运行时 `parseCredentialValues` 就是这个口径)。
 * `secret: false` 的含义仅是"这个值不敏感,输入框不必遮蔽" —— 比如 baseUrl。
 *
 * 曾按它把字段分流进 providerConfig,那是个真 bug:照分流后的引导操作,挂载必被拒
 * (8 个 provider 中招)。非凭证的挂载配置该由 export 独立声明,不混在凭证字段里。
 */
export interface PluginCredentialField {
  description?: string
  key: string
  label?: string
  required?: boolean
  /** 仅控制输入是否遮蔽;不影响存储通道。 */
  secret?: boolean
}

/**
 * 非凭证挂载配置的字段声明(providerConfig,如 baseUrl / region)。
 *
 * 与 {@link PluginCredentialField} 是两条通道:凭证进加密的 SecretStore,这里的值明文进
 * 节点记录(`system/registry get` 会回显)。**故没有 `secret` 字段** —— 密钥永远走
 * credentialFields。`required` 缺省视为非必填(providerConfig "有就用、没有走默认")。
 */
export interface PluginMountConfigField {
  description?: string
  key: string
  label?: string
  required?: boolean
}

export type PluginExportAuth
  = | { kind: 'none' }
    | { description?: string, kind: 'single', label?: string, required?: boolean }

export interface PluginExport {
  /** 明确声明无凭证/单值凭证；与 oauth/credentialFields 三选一。 */
  auth?: PluginExportAuth
  capabilities?: string[]
  /** 该 export 需要的多字段凭证;缺省表示单值 API key(或不需要凭证)。 */
  credentialFields?: PluginCredentialField[]
  /** 挂载时平台会用真实凭证空参调一次这个只读工具,当场判定凭证可用。 */
  credentialProbe?: string
  description?: string
  id: string
  methods?: string[]
  /** 该 export 挂载时需要的非凭证配置(如 baseUrl);缺省表示无需额外配置。 */
  mountConfigFields?: PluginMountConfigField[]
  /** 声明了它就走平台托管的 OAuth2 授权码流程(与 credentialFields/Probe 互斥)。 */
  oauth?: {
    authorizationUrl: string
    scopes?: string[]
    tokenUrl: string
  }
  profile: PluginProfile
}

export interface PluginManifest {
  auth: { kind: 'platform-token' } | { kind: 'bearer', secretRef: string }
  enabled: boolean
  /** https:// 或 `binding:<name>`。 */
  endpoint: string
  /** 注册时缓存的 `~describe.exports`（挂载时 config.export 从中选）。 */
  exports: PluginExport[]
  /** 如 "/healthz";必须以 '/' 开头。 */
  healthPath: string
  id: string
  /** 传输协议版本；当前仅 "plugin/v2"。 */
  protocolVersion: string
}

/**
 * 内置集成目录的一项(`system/catalog` list/search;对等 `tb integration catalog`)。
 *
 * 这是**挂载向导的数据源**:它直接回答"能挂成什么 kind、有哪几个 export、要填哪些凭证
 * 字段、要不要再授权一步",故表单可以从它生成而不必让用户去翻插件源码。
 *
 * 内置集成**不落库**；目录项与它的代码是同一份构建产物。
 */
export interface CatalogListItem {
  description?: string
  /** descriptor 指纹(升级检测/三宿主对拍)。 */
  digest: string
  /** 每个 export 的精确 auth/config/kind 契约；挂载逻辑的唯一真源。 */
  exportDetails: Record<string, CatalogExportDetails>
  /** 可挂载的 export id;长度 > 1 时挂载必须显式选一个。 */
  exports: string[]
  id: string
  nodeKinds: Array<'context' | 'tool'>
}

export type CatalogExportAuth
  = | { fields: PluginCredentialField[], kind: 'fields' }
    | { kind: 'none' }
    | { kind: 'oauth' }
    | { description?: string, kind: 'single', label?: string, required: boolean }

export interface CatalogExportDetails {
  auth: CatalogExportAuth
  description?: string
  id: string
  kind: 'context' | 'tool'
  mountConfigFields?: PluginMountConfigField[]
}

/** write/update 返回:pluginToken 仅该次响应出现一次(auth=platform-token 时)。 */
export interface PluginRegistration extends PluginManifest {
  pluginToken?: string
}

/** system/plugin health cmd 返回(按需探活)。 */
export interface PluginHealth {
  checkedAt: string
  healthy: boolean
  id: string
}

/** context 条目元数据(ContextEntryMeta)。 */
export interface ContextEntryMeta {
  contentType: string
  metadata: Record<string, string>
  size?: number
  updatedAt: string
  /** node://<namespace-path>/<entry-path>。 */
  uri: string
  version: string
}

/** context 条目(含内容;大对象 content = { $ref })。 */
export interface ContextEntry extends ContextEntryMeta {
  content: string | unknown
}

/** skillhub 目录条目摘要(List/Search 返回的 SkillSummary)。 */
export interface SkillSummary {
  description: string
  id: string
  name: string
  updatedAt?: string
  version?: string
}

/** skillhub 技能内文件(Get{id,file} 返回;大对象 content = { $ref })。 */
export interface SkillFile {
  content?: string | { $ref: string }
  contentType: string
  path: string
  size?: number
  version: string
}

/** skillhub 技能详情(Get{id} 返回:SKILL.md 正文 + 文件清单)。 */
export interface SkillDetail extends SkillSummary {
  /** SKILL.md 正文(YAML frontmatter + Markdown)。 */
  content: string
  files: SkillFile[]
}
