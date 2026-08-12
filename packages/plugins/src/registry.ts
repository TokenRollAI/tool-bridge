/**
 * 内置插件目录的装配表(参考 open-connector 的 generated registry 形态;
 * 目录规模大了以后由 codegen 从 src/<name>/ 目录生成,现在先手写)。
 *
 * 每个 src/<name>/ 文件夹 = 一个插件(纯源码,不是 workspace 包);loader 用动态
 * import 懒加载——"可用 ≠ 实例化":未被注册/调用的插件连模块都不会加载。
 */

/** 插件模块形状:default export = plugin-sdk 产出的 `{ fetch(request, env) }`。 */
export interface BuiltinPluginModule {
  default: {
    fetch(request: Request, env: never): Promise<Response> | Response
  }
}

export const BUILTIN_PLUGIN_LOADERS: Record<string, () => Promise<BuiltinPluginModule>> = {
  alt_text_generator_ai: () => import('./alt_text_generator_ai/index') as Promise<BuiltinPluginModule>,
  apify: () => import('./apify/index') as Promise<BuiltinPluginModule>,
  brave_search: () => import('./brave_search/index') as Promise<BuiltinPluginModule>,
  clerk: () => import('./clerk/index') as Promise<BuiltinPluginModule>,
  cohere: () => import('./cohere/index') as Promise<BuiltinPluginModule>,
  convertapi: () => import('./convertapi/index') as Promise<BuiltinPluginModule>,
  currencyapi: () => import('./currencyapi/index') as Promise<BuiltinPluginModule>,
  dub: () => import('./dub/index') as Promise<BuiltinPluginModule>,
  feishu: () => import('./feishu/index') as Promise<BuiltinPluginModule>,
  feishu_custom_bot: () => import('./feishu_custom_bot/index') as Promise<BuiltinPluginModule>,
  firehydrant: () => import('./firehydrant/index') as Promise<BuiltinPluginModule>,
  fixer: () => import('./fixer/index') as Promise<BuiltinPluginModule>,
  front: () => import('./front/index') as Promise<BuiltinPluginModule>,
  geocodio: () => import('./geocodio/index') as Promise<BuiltinPluginModule>,
  graphhopper: () => import('./graphhopper/index') as Promise<BuiltinPluginModule>,
  ip2proxy: () => import('./ip2proxy/index') as Promise<BuiltinPluginModule>,
  ipgeolocation_io: () => import('./ipgeolocation_io/index') as Promise<BuiltinPluginModule>,
  ipqualityscore: () => import('./ipqualityscore/index') as Promise<BuiltinPluginModule>,
  lemlist: () => import('./lemlist/index') as Promise<BuiltinPluginModule>,
  logsnag: () => import('./logsnag/index') as Promise<BuiltinPluginModule>,
  mistral_ai: () => import('./mistral_ai/index') as Promise<BuiltinPluginModule>,
  mother_duck: () => import('./mother_duck/index') as Promise<BuiltinPluginModule>,
  ngrok: () => import('./ngrok/index') as Promise<BuiltinPluginModule>,
  notes: () => import('./notes/index') as Promise<BuiltinPluginModule>,
  open_exchange_rates: () => import('./open_exchange_rates/index') as Promise<BuiltinPluginModule>,
  openai: () => import('./openai/index') as Promise<BuiltinPluginModule>,
  opengraph_io: () => import('./opengraph_io/index') as Promise<BuiltinPluginModule>,
  paddle: () => import('./paddle/index') as Promise<BuiltinPluginModule>,
  prerender: () => import('./prerender/index') as Promise<BuiltinPluginModule>,
  readwise: () => import('./readwise/index') as Promise<BuiltinPluginModule>,
  render: () => import('./render/index') as Promise<BuiltinPluginModule>,
  resend: () => import('./resend/index') as Promise<BuiltinPluginModule>,
  rootly: () => import('./rootly/index') as Promise<BuiltinPluginModule>,
  scrapfly: () => import('./scrapfly/index') as Promise<BuiltinPluginModule>,
  scrapingbee: () => import('./scrapingbee/index') as Promise<BuiltinPluginModule>,
  screenshot_fyi: () => import('./screenshot_fyi/index') as Promise<BuiltinPluginModule>,
  shodan: () => import('./shodan/index') as Promise<BuiltinPluginModule>,
  stripe: () => import('./stripe/index') as Promise<BuiltinPluginModule>,
  telnyx: () => import('./telnyx/index') as Promise<BuiltinPluginModule>,
  uptimerobot: () => import('./uptimerobot/index') as Promise<BuiltinPluginModule>,
  workos: () => import('./workos/index') as Promise<BuiltinPluginModule>,
  zhihu: () => import('./zhihu/index') as Promise<BuiltinPluginModule>,
}

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
 */
export function builtinPluginBindings(
  env: BuiltinPluginEnv,
  opts: { include?: readonly string[] } = {},
): Map<string, (request: Request) => Promise<Response>> {
  const names = opts.include ?? Object.keys(BUILTIN_PLUGIN_LOADERS)
  // 收窄一次,之后每个插件拿到的都是这份 —— 而不是宿主原始环境。
  const pluginEnv = narrowPluginEnv(env)
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
