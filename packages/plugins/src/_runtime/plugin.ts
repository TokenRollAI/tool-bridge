/**
 * 从 open-connector 迁移过来的 provider 共用的装配骨架。
 *
 * 每个迁移产物都是同一个形状:一个 tools export、一张 `<service>Actions` 规格表
 * (`schema.ts`,由 scripts/migrate 生成)、一张同名 handler 表(`api.ts`,人工机械改写)。
 * 这里把"按规格表逐个 register + 取上游凭证"这段样板收成一处,让每个 provider 的
 * `index.ts` 只剩它自己的东西。
 */

import type { InputSchemaLike, OperationSpec, PluginCredentialField, PluginMountConfigField, PluginOAuth } from '@tool-bridge/core'
import { createPlugin, type Plugin, type PluginCallContext, TBError } from '@tool-bridge/plugin-sdk'

/** 迁移产物统一的 env(平台注册时 mint 的回调令牌)。 */
export interface ProviderEnv {
  PLUGIN_TOKEN?: string
}

/** handler 拿到的上下文:入参已按 Zod schema 校验过。 */
export interface ProviderContext {
  /** 挂载 providerConfig 里的非敏感配置(region / domain / accountId 之类)。 */
  readonly config: Record<string, unknown> | undefined
  /**
   * 多字段凭证的字段表(仅在 provider 声明了 `credentialFields` 时有值)。
   * `requireCredential()` 是取它的正规入口。
   */
  readonly credentials: Record<string, string> | undefined
  /** 平台解出的上游凭证明文;`requireApiKey()` 是取它的正规入口。 */
  readonly upstreamAuth: string | undefined
}

/** 取上游凭证;没配就 fail closed 并说清怎么修。 */
export function requireApiKey(ctx: ProviderContext, service: string): string {
  const key = ctx.upstreamAuth
  if (key === undefined || key === '') {
    // 缺凭证是**配置**问题,不是调用方无权,故 unavailable 而非 permission_denied。
    throw new TBError(
      'unavailable',
      `${service} 需要 API key:给挂载节点配 config.authRef 指向已存入 system/secret 的凭证`,
    )
  }
  return key
}

/**
 * 取多字段凭证里的一个字段。字段缺失由 SDK 在解析时就拦下了(按 `credentialFields` 的
 * required 校验),这里只处理"整份凭证都没配"和"provider 没声明多字段"两种配置错误。
 */
export function requireCredential(ctx: ProviderContext, service: string, field: string): string {
  const values = ctx.credentials
  if (values === undefined) {
    throw new TBError(
      'unavailable',
      `${service} 需要多字段凭证:给挂载节点配 config.authRef 指向已存入 system/secret 的凭证`
      + `(用 \`tb secret set <name> --field ...\` 写入)`,
    )
  }
  const value = values[field]
  if (value === undefined || value === '') {
    // 走到这里说明 provider 声明的字段表与 handler 实际取的字段不一致 —— 是 provider
    // 自身的 bug,不是用户配错。
    throw new TBError('internal', `${service} 的凭证字段 '${field}' 未在 credentialFields 里声明`)
  }
  return value
}

type Spec = OperationSpec<InputSchemaLike>
type Handler = (input: never, ctx: ProviderContext) => unknown | Promise<unknown>

export interface ProviderPluginInput {
  /** 规格表:action 名 → OperationSpec(来自生成的 schema.ts)。 */
  actions: Record<string, Spec>
  /**
   * 本 provider 需要**多字段凭证**时声明字段(缺省单值:一个 API key)。
   * 对应上游 open-connector 的 `custom_credential` auth 形态。
   */
  credentialFields?: PluginCredentialField[]
  /**
   * 凭证探针:一个**只读、零副作用、无必填入参**的 action 名。挂载时平台会用配置的
   * authRef 真实调它一次,验证凭证可用 —— 否则配错的 key 要等第一次业务调用才 401。
   *
   * 上游 open-connector 每个 provider 都带 `credentialValidators`("打最便宜的接口试凭证"),
   * 这是它在 tool-bridge 侧的落点。选不出合适的 action 就不写(例如全部 action 都要必填
   * 业务 id,拿不到一个"空转"调用)。
   */
  credentialProbe?: string
  description: string
  /** tools export id;缺省 'actions'(与其他 in-repo plugin 一致)。 */
  exportId?: string
  /** handler 表:键必须与 actions 完全一致。 */
  handlers: Record<string, Handler>
  /**
   * 本 provider 挂载时需要的**非凭证配置**字段(如自建实例的 baseUrl / instanceUrl /
   * region)。对应上游 open-connector 把这些放在 api_key `extraFields` 里 `secret: false`
   * 的那批。handler 里照常从 `ctx.config` 取(如 `ctx.config?.baseUrl`)。
   *
   * 声明了它,挂载向导就知道该配什么、必填项缺失可在挂载前拦 —— 而不是让用户对着自由
   * k=v 框猜。**只放非密钥**:值明文进节点记录,密钥走 `credentialFields`/authRef。
   */
  mountConfigFields?: PluginMountConfigField[]
  /**
   * 本 provider 走**平台托管的 OAuth2**(授权码 + PKCE)时声明端点与 scope。
   * 对应上游 open-connector 的 `OAuth2AuthDefinition`。
   *
   * handler 里照常 `requireApiKey(ctx, SERVICE)` —— 拿到的是平台换来并按需刷新的
   * access token,插件不需要知道它是 OAuth 来的。client_id/secret 不在这里:
   * 它们是每个部署自己去 provider 后台注册的,走 authRef 指向的 secret。
   *
   * 与 `credentialFields`/`credentialProbe` 互斥(SDK 侧当场拒)。
   */
  oauth?: PluginOAuth
}

/**
 * 装配一个迁移产物。规格表与 handler 表的键集合必须**完全吻合** —— 多一个少一个都在
 * 装配期炸,不留"宣告了但调用即 500"的幽灵工具,也不留"实现了但没人能调"的死代码。
 */
export function createProviderPlugin(input: ProviderPluginInput): Plugin<ProviderEnv> {
  const names = Object.keys(input.actions)
  const handlerNames = Object.keys(input.handlers)
  const missing = names.filter(name => !handlerNames.includes(name))
  const extra = handlerNames.filter(name => !names.includes(name))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `action 表与 handler 表不吻合:缺 handler [${missing.join(', ')}];多余 handler [${extra.join(', ')}]`,
    )
  }

  const plugin = createPlugin<ProviderEnv>({ token: env => env.PLUGIN_TOKEN })
  const tools = plugin.tools(input.exportId ?? 'actions', { description: input.description })
  if (input.oauth !== undefined) tools.oauth(input.oauth)
  if (input.credentialFields !== undefined) tools.credentials(input.credentialFields)
  if (input.mountConfigFields !== undefined) tools.mountConfig(input.mountConfigFields)
  for (const name of names) {
    tools.register(name, input.actions[name]!, (args, ctx: PluginCallContext<ProviderEnv>) =>
      input.handlers[name]!(args as never, {
        upstreamAuth: ctx.upstreamAuth,
        credentials: ctx.credentials,
        config: ctx.mountConfig,
      }))
  }
  if (input.credentialProbe !== undefined) {
    // 探针必须是只读的:平台会在**挂载**时调它,而挂载不该产生业务副作用。
    // (工具名是否存在由 SDK 的 probeCredentialWith 校验。)
    const effect = input.actions[input.credentialProbe]?.effect
    if (effect !== 'read') {
      throw new Error(
        `credentialProbe '${input.credentialProbe}' 的 effect 是 '${effect ?? '未声明'}',`
        + ' 探针必须是 read —— 挂载时会真实调用它',
      )
    }
    tools.probeCredentialWith(input.credentialProbe)
  }
  return plugin
}
