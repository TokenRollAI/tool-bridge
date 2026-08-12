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
  brave_search: () => import('./brave_search/index') as Promise<BuiltinPluginModule>,
  clerk: () => import('./clerk/index') as Promise<BuiltinPluginModule>,
  coinranking: () => import('./coinranking/index') as Promise<BuiltinPluginModule>,
  fathom: () => import('./fathom/index') as Promise<BuiltinPluginModule>,
  feishu: () => import('./feishu/index') as Promise<BuiltinPluginModule>,
  ipqualityscore: () => import('./ipqualityscore/index') as Promise<BuiltinPluginModule>,
  langbase: () => import('./langbase/index') as Promise<BuiltinPluginModule>,
  lightfield: () => import('./lightfield/index') as Promise<BuiltinPluginModule>,
  logsnag: () => import('./logsnag/index') as Promise<BuiltinPluginModule>,
  meituan: () => import('./meituan/index') as Promise<BuiltinPluginModule>,
  notes: () => import('./notes/index') as Promise<BuiltinPluginModule>,
  opensea: () => import('./opensea/index') as Promise<BuiltinPluginModule>,
  resend: () => import('./resend/index') as Promise<BuiltinPluginModule>,
  screenshot_fyi: () => import('./screenshot_fyi/index') as Promise<BuiltinPluginModule>,
  stripe: () => import('./stripe/index') as Promise<BuiltinPluginModule>,
  telnyx: () => import('./telnyx/index') as Promise<BuiltinPluginModule>,
}

/** 宿主传给插件的 env(Node 宿主常用 process.env;CF 宿主用 Worker env)。 */
export type BuiltinPluginEnv = Record<string, string | undefined>

/**
 * 组装 pluginBindings(binding 名 → fetch handler)。返回 Map 与 gateway 的
 * `PluginBindings` 结构兼容(此包不依赖 gateway,靠结构类型对接)。
 * opts.include 给出时只装配指定子集(CF 宿主按构建体积裁剪集合)。
 */
export function builtinPluginBindings(
  env: BuiltinPluginEnv,
  opts: { include?: readonly string[] } = {},
): Map<string, (request: Request) => Promise<Response>> {
  const names = opts.include ?? Object.keys(BUILTIN_PLUGIN_LOADERS)
  const bindings = new Map<string, (request: Request) => Promise<Response>>()
  for (const name of names) {
    const loader = BUILTIN_PLUGIN_LOADERS[name]
    if (loader === undefined) throw new Error(`unknown builtin plugin '${name}'`)
    let loaded: Promise<BuiltinPluginModule> | undefined
    bindings.set(name, async (request) => {
      loaded ??= loader()
      const mod = await loaded
      return await mod.default.fetch(request, env as never)
    })
  }
  return bindings
}
