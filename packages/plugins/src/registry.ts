/**
 * 内置插件目录的装配面。
 *
 * 每个 `src/<name>/` 文件夹 = 一个插件(纯源码,不是 workspace 包);loader 用动态
 * import 懒加载——"可用 ≠ 实例化":未被注册/调用的插件连模块都不会加载。
 *
 * **loader 表本身由 `scripts/generateRegistry.mjs` 从磁盘目录生成**
 * (`registry.generated.ts`),因为它必须与 `src/` 的目录集合逐字一致 —— 少一行那个
 * 插件就挂不上树,而且没有任何报错。本文件留的是**判断**:env 白名单(安全边界)
 * 与装配逻辑。
 */

import { BUILTIN_PLUGIN_LOADERS, type BuiltinPluginModule } from './registry.generated'

export { BUILTIN_PLUGIN_LOADERS, type BuiltinPluginModule }

/**
 * 宿主传给插件的 env。
 *
 * **不是宿主的全环境**。进程内插件与网关同权(plugin-in-process-catalog 决策),把
 * `process.env` 整份递给它们,任一 handler 一行 `ctx.env.TB_SECRET_ENCRYPTION_KEY` 就拿到
 * SecretStore 主密钥,`TB_BOOTSTRAP_ADMIN_SK`、KV 凭据同理 —— "凭证不出网关"整条防线归零,
 * 而且没有任何隔离层能拦。这正是那份决策留的未决项「binding 插件的 env(secrets)注入形态」。
 *
 * 所以这里定成**白名单**:平台统一的 `PLUGIN_TOKEN`,加上各插件自己声明的配置项
 * (`BUILTIN_PLUGIN_ENV_KEYS`)。`builtinPluginBindings` 只把白名单内的键递下去,宿主传进来
 * 什么都不影响 —— 这条约束由代码保证,不靠接线的人记得。
 */
export interface BuiltinPluginEnv {
  [key: string]: string | undefined
  /** 平台调用插件时携带的 Bearer token(注册时由平台 mint)。 */
  PLUGIN_TOKEN?: string
}

/**
 * 各内置插件声明的**非机密**配置键(除 PLUGIN_TOKEN 之外)。
 *
 * 加插件时若需要新的配置项,在这里登记 —— 没登记的键不会被递进插件,即便宿主环境里有。
 * 机器迁移的 provider 一个都不需要(它们的配置走挂载的 providerConfig 与 authRef)。
 */
export const BUILTIN_PLUGIN_ENV_KEYS: readonly string[] = [
  // feishu:官方 MCP / 换发端点的 override(测试用)与工具白名单。
  'FEISHU_ALLOWED_TOOLS',
  'FEISHU_AUTH_URL',
  'FEISHU_MCP_URL',
]

/**
 * 从宿主环境里挑出允许递给插件的键。导出供测试直接断言 —— 这条约束是安全边界,
 * 得能被直接钉住,而不是只能从行为侧间接推断。
 *
 * 注意返回值里的 `TB_PLUGIN_IN_PROCESS: true` 是**布尔字面量**,而 `BuiltinPluginEnv`
 * 的索引签名只收 `string | undefined` —— 宿主环境里的同名变量(只可能是字符串 `'true'`)
 * 因此无法伪造它。这不是巧合,是刻意的:那个标记让 plugin-sdk 跳过 token 校验,
 * 能被环境变量伪造就等于把 fail-closed 拆了。见下方 `builtinPluginBindings` 的说明。
 */
export function narrowPluginEnv(env: BuiltinPluginEnv): BuiltinPluginEnv {
  const narrowed: BuiltinPluginEnv = {}
  if (env.PLUGIN_TOKEN !== undefined) narrowed.PLUGIN_TOKEN = env.PLUGIN_TOKEN
  for (const key of BUILTIN_PLUGIN_ENV_KEYS) {
    const value = env[key]
    if (value !== undefined) narrowed[key] = value
  }
  return narrowed
}

/**
 * 组装 pluginBindings(binding 名 → fetch handler)。返回 Map 与 gateway 的
 * `PluginBindings` 结构兼容(此包不依赖 gateway,靠结构类型对接)。
 * opts.include 给出时只装配指定子集(CF 宿主按构建体积裁剪集合)。
 *
 * `env` 会先经白名单收窄(见 `BuiltinPluginEnv`):宿主可以放心把整份 `process.env` 传进来。
 *
 * **递下去的 env 带 `TB_PLUGIN_IN_PROCESS: true`**,plugin-sdk 见到它就跳过 PLUGIN_TOKEN
 * 校验。理由:进程内直调的调用方就是平台本身,token 比对是同义反复 —— 平台从 SecretStore
 * 取出自己 mint 的 token、发给同进程的自己去比对;而宿主装配时根本拿不到那个值
 * (它在注册时才生成、按 plugin id 存 `plugin-token:<id>`),这条路从来打不通。
 * 生产实测:99 个 binding 插件全部报「未配置 PLUGIN_TOKEN」,一个都调不动。
 *
 * 走 **env 而不是请求头**是这个修法成立的前提:env 由本函数在装配期闭包持有,
 * 任何网络请求都碰不到;而 `true` 是布尔字面量,宿主环境变量(只能是字符串)伪造不出来。
 * 外挂 https 插件仍走 token 比对,那条 fail-closed 一点没动。
 */
export function builtinPluginBindings(
  env: BuiltinPluginEnv,
  opts: { include?: readonly string[] } = {},
): Map<string, (request: Request) => Promise<Response>> {
  const names = opts.include ?? Object.keys(BUILTIN_PLUGIN_LOADERS)
  // 收窄一次,之后每个插件拿到的都是这份 —— 而不是宿主原始环境。
  const pluginEnv = { ...narrowPluginEnv(env), TB_PLUGIN_IN_PROCESS: true }
  const bindings = new Map<string, (request: Request) => Promise<Response>>()
  for (const name of names) {
    const loader = BUILTIN_PLUGIN_LOADERS[name]
    if (loader === undefined) throw new Error(`unknown builtin plugin '${name}'`)
    let loaded: Promise<BuiltinPluginModule> | undefined
    bindings.set(name, async (request) => {
      loaded ??= loader()
      const mod = await loaded
      return await mod.default.fetch(request, pluginEnv as never)
    })
  }
  return bindings
}
