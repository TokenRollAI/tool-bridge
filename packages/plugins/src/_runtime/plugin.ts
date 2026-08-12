/**
 * 从 open-connector 迁移过来的 provider 共用的装配骨架。
 *
 * 每个迁移产物都是同一个形状:一个 tools export、一张 `<service>Actions` 规格表
 * (`schema.ts`,由 scripts/migrate 生成)、一张同名 handler 表(`api.ts`,人工机械改写)。
 * 这里把"按规格表逐个 register + 取上游凭证"这段样板收成一处,让每个 provider 的
 * `index.ts` 只剩它自己的东西。
 */

import type { InputSchemaLike, OperationSpec } from '@tool-bridge/core'
import { createPlugin, type Plugin, type PluginCallContext, TBError } from '@tool-bridge/plugin-sdk'

/** 迁移产物统一的 env(平台注册时 mint 的回调令牌)。 */
export interface ProviderEnv {
  PLUGIN_TOKEN?: string
}

/** handler 拿到的上下文:入参已按 Zod schema 校验过。 */
export interface ProviderContext {
  /** 挂载 providerConfig 里的非敏感配置(region / domain / accountId 之类)。 */
  readonly config: Record<string, unknown> | undefined
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

type Spec = OperationSpec<InputSchemaLike>
type Handler = (input: never, ctx: ProviderContext) => unknown | Promise<unknown>

export interface ProviderPluginInput {
  /** 规格表:action 名 → OperationSpec(来自生成的 schema.ts)。 */
  actions: Record<string, Spec>
  description: string
  /** tools export id;缺省 'actions'(与其他 in-repo plugin 一致)。 */
  exportId?: string
  /** handler 表:键必须与 actions 完全一致。 */
  handlers: Record<string, Handler>
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
  for (const name of names) {
    tools.register(name, input.actions[name]!, (args, ctx: PluginCallContext<ProviderEnv>) =>
      input.handlers[name]!(args as never, { upstreamAuth: ctx.upstreamAuth, config: ctx.mountConfig }))
  }
  return plugin
}
