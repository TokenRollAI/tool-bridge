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

export interface TreeJson {
  children?: TreeJson[]
  description: string
  kind: NodeKind
  online?: boolean
  path: string
  truncated?: boolean
}

/** system/registry 返回的节点(builtin/registry.ts 的 Node 面)。 */
export interface RegistryNode {
  config?: Record<string, unknown>
  createdAt?: string
  description: string
  kind: NodeKind
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

export interface PluginExport {
  capabilities?: string[]
  /** 该 export 需要的多字段凭证;缺省表示单值 API key(或不需要凭证)。 */
  credentialFields?: PluginCredentialField[]
  /** 挂载时平台会用真实凭证空参调一次这个只读工具,当场判定凭证可用。 */
  credentialProbe?: string
  description?: string
  id: string
  methods?: string[]
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
  /** 注册时缓存的 `~describe.exports`（挂载时 config.export 从中选）；老记录可能缺省。 */
  exports?: PluginExport[]
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
 * 与 {@link PluginCatalogItem} 的差别:那个是 admin 面的"装配了哪些 binding + 注册状态",
 * 这个是 read 面的"每个集成声明了什么"。内置集成**不落库**,所以这里没有 registered ——
 * 目录项与它的代码是同一份构建产物。
 */
export interface CatalogListItem {
  /** 声明了多字段凭证时给出字段名(不含值);单值凭证为 undefined。 */
  credentialFields?: PluginCredentialField[]
  description?: string
  /** descriptor 指纹(升级检测/三宿主对拍)。 */
  digest: string
  /** 可挂载的 export id;长度 > 1 时挂载必须显式选一个。 */
  exports: string[]
  id: string
  /** 声明了 oauth → 挂载后还要授权一步。 */
  needsOAuth: boolean
  nodeKinds: Array<'context' | 'tool'>
}

/**
 * 宿主装配的一个进程内插件("可用目录"里的一项;对等 `tb plugin catalog`)。
 *
 * **装配 ≠ 注册 ≠ 挂载**:装配是"这个宿主的构建里带了这段代码",注册是"它进了 plugin 表、
 * 拿到了 pluginToken",挂载才是"树上有个节点指向它"。三步都做完才能被 agent 调到。
 *
 * 注意:**内置插件不再走注册**(descriptor 由 catalog 提供),故它们在这里恒为
 * `registered: false` —— 那不是"没配好",而是"不需要"。要看内置集成用
 * {@link CatalogListItem}。
 */
export interface PluginCatalogItem {
  /** 注册时填这个值(`binding:<name>`)。 */
  endpoint: string
  /** binding 名 = 宿主装配表的 key。 */
  name: string
  /** 已注册时给出注册记录的 id(通常与 name 同,但注册方可以另起)。 */
  pluginId?: string
  registered: boolean
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
