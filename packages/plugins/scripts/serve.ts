import { serve } from '@hono/node-server'
/**
 * 把某个内置插件按"外挂 HTTP plugin"形态起成本地服务(开发/Compose 用):
 *   TB_PLUGIN_NAME=feishu PORT=8788 tsx scripts/serve.ts
 * env 原样透传 process.env(插件自取所需变量,如 PLUGIN_TOKEN / FEISHU_*)。
 * 生产的进程内路径不经此脚本——这只是外挂通道的开发替身。
 */
import process from 'node:process'
import { BUILTIN_PLUGIN_LOADERS } from '../src/registry'

const name = process.env.TB_PLUGIN_NAME ?? 'feishu'
const loader = BUILTIN_PLUGIN_LOADERS[name]
if (loader === undefined) {
  console.error(`unknown builtin plugin '${name}' (known: ${Object.keys(BUILTIN_PLUGIN_LOADERS).join(', ')})`)
  process.exit(1)
}
const mod = await loader()
const port = Number(process.env.PORT ?? 8788)
const hostname = process.env.HOST ?? '0.0.0.0'
serve({
  fetch: request => mod.default.fetch(request, process.env as never),
  port,
  hostname,
}, () => {
  console.log(`builtin plugin '${name}' listening on http://${hostname}:${port}`)
})
