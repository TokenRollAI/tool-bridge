import { defineConfig } from 'vitest/config'

/**
 * 宿主中立层的验证面:**普通 Node vitest,不挂 workerd pool**。
 *
 * 这里的测试经 `app.request()` 直接打 `createTbApp` 产出的 Hono app,不经过任何
 * 宿主适配器。中立性因此是被执行验证的,而不只是被 `types: []` 静态约束的——
 * 若 tbApp 树里混进宿主专属全局(`KVNamespace`/`caches.default`/`process`),
 * 这套测试会在 Node 下直接炸。
 *
 * 真吃 CF 语义的部分(DO WS hibernation、R2 binding、D1、Static Assets)仍留在
 * `packages/gateway/test` 的 workerd 套件,两边各自覆盖自己那一层。
 */
export default defineConfig({
  test: {
    environment: 'node',
  },
})
