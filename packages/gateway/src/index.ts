import { createApp } from './app'

export { DeviceSession } from './deviceSession'

/**
 * Workers 入口。Hono 实例实现了 `fetch(request, env, ctx)`,可直接作为 default export
 * 交给 workerd(同一 app 挂到 Workers export / Node adapter)。
 */
const app = createApp()

export default app
