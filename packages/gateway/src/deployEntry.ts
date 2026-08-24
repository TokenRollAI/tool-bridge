import { BUILTIN_CATALOG, builtinPluginBindings, type BuiltinPluginEnv } from '@tool-bridge/plugins'
import { cleanupDefaultStoreFromEnv, createApp, type Env } from './app'

export { createApp, type Env } from './app'
export { DeviceSession } from './deviceSession'
export { D1SearchIndex } from './search/d1SearchIndex'
export type { PluginBindingHandler, PluginBindings } from '@tool-bridge/app'

/**
 * Workers 入口。Hono 实例实现了 `fetch(request, env, ctx)`,可直接作为 default export
 * 交给 workerd(同一 app 挂到 Workers export / Node adapter)。
 *
 * **本文件是本仓库自己的部署入口**(`wrangler.jsonc` 的 `main` 指它),内置插件目录
 * **全量装配**。三点说明:
 *
 * 1. `builtinPluginBindings` 只建 Map + 闭包,**不 import 任何插件模块**。真正的加载发生
 *    在某个 binding 首次被调用时,故装配全量不等于启动即付全量代价。
 * 2. 但**代码体积是全量的** —— Worker 没有文件系统,动态 import 的目标必须全部打进
 *    bundle。部署前以当前构建产物与平台限制为准核验体积；逼近上限时用 `opts.include`
 *    在构建期裁剪集合。
 * 3. 传的是**工厂而不是表**:`builtinPluginBindings(env)` 要读 env(按白名单收窄后递给
 *    插件,见 plugins/registry.ts 的 `narrowPluginEnv`),而 env 在此刻还不存在。
 *    工厂由 `createApp` 在每 isolate 首次请求时调一次。
 *
 * 那个 `as` 是必要的:`Env` 含 `Fetcher` / `DurableObjectNamespace` 等非字符串 binding,
 * 与 `BuiltinPluginEnv` 的 `[key: string]: string | undefined` 索引签名不兼容。收窄的
 * **实质保证在 `narrowPluginEnv` 里**(只有白名单键会被递给插件),不在这个类型转换上 ——
 * 换句话说这里放行的是类型形状,不是安全边界。
 *
 * **npm 消费者不吃这份装配**:`dist/index.js`(tsup 产物,见 `tsup.config.ts` 的 entry)
 * 只导出 `createApp` 等库面,自己决定装配哪些插件。把完整目录塞进库产物既无必要,
 * 也会让 `@modelcontextprotocol/sdk` 的传递依赖(`pkce-challenge`)成为 gateway 的
 * 运行时依赖。
 */
const app = createApp({
  pluginBindings: env => builtinPluginBindings(env as unknown as BuiltinPluginEnv),
  pluginCatalog: BUILTIN_CATALOG,
})

const handler: ExportedHandler<Env> = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(cleanupDefaultStoreFromEnv(env).catch(() => {
      // Store errors may carry internal driver detail; scheduled logs keep a fixed safe shape.
      console.warn(JSON.stringify({ event: 'tool_bridge_store_cleanup_failed' }))
      throw new Error('Store cleanup failed')
    }))
  },
}

export default handler
