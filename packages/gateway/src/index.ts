import { createApp } from './app'

export { createApp, type Env } from './app'
export { DeviceSession } from './deviceSession'
export { D1SearchIndex } from './search/d1SearchIndex'
export type { PluginBindingHandler, PluginBindings } from '@tool-bridge/app'

/**
 * Workers 入口(**库形态**)。Hono 实例实现了 `fetch(request, env, ctx)`,可直接作为
 * default export 交给 workerd。
 *
 * 这里**不装配任何内置插件** —— npm 消费者用 `createApp({ pluginBindings })` 自己决定
 * 装哪些(`@tool-bridge/plugins` 的 `builtinPluginBindings(env, { include })`)。理由:
 * 把 97 个迁移产物塞进库产物会让每个消费者都吞下约 6 MB 代码与
 * `@modelcontextprotocol/sdk` 的传递依赖,而多数消费者只需要其中几个、或者一个都不要。
 *
 * **本仓库自己的部署入口是 `deployEntry.ts`**(`wrangler.jsonc` 的 `main` 指它),
 * 那里全量装配。两个入口分开正是为了让"我们的生产形态"与"库的默认形态"互不牵连。
 */
const app = createApp()

export default app
