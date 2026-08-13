/**
 * 从 `src/<name>/index.ts` 生成内置插件目录的装配表。
 *
 *   node scripts/generateRegistry.mjs          # 写入 src/registry.generated.ts
 *   node scripts/generateRegistry.mjs --check  # 只校验磁盘与生成物一致(CI 用,不写盘)
 *
 * 为什么要生成:这张表此前手写,而它必须与 `src/` 的目录集合**逐字一致** —— 少一行,
 * 那个插件挂不上树且**没有任何报错**(形状闸门是事后才抓到的)。实测在两轮批量迁移里
 * 各漏过一次。目录是磁盘上的事实,让机器去读它,比让人记得改一张 99 行的表可靠。
 *
 * **只生成 loader 表**。env 白名单(`BUILTIN_PLUGIN_ENV_KEYS`)与 `builtinPluginBindings`
 * 留在手写的 `registry.ts` 里:前者是安全边界(加键要有人过目),后者是装配逻辑。
 * 生成物只回答一个问题 —— "磁盘上有哪些插件"。
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import process from 'node:process'
import { join } from 'node:path'

const SRC = join(import.meta.dirname, '..', 'src')
const TARGET = join(SRC, 'registry.generated.ts')

/** 一个插件 = `src/<name>/index.ts` 存在的目录。`_runtime` 是共享代码,不是插件。 */
async function discoverPlugins() {
  const entries = await readdir(SRC, { withFileTypes: true })
  return entries
    .filter(e => e.isDirectory() && e.name !== '_runtime')
    .map(e => e.name)
    .filter(name => existsSync(join(SRC, name, 'index.ts')))
    .sort()
}

function emit(names) {
  const loaders = names
    .map(n => `  ${n}: () => import('./${n}/index') as Promise<BuiltinPluginModule>,`)
    .join('\n')
  return `/**
 * **此文件由 \`scripts/generateRegistry.mjs\` 生成,不要手改。**
 * 重新生成:\`pnpm --filter @tool-bridge/plugins generate:registry\`
 *
 * 内容 = \`src/<name>/index.ts\` 存在的全部目录。装配逻辑与 env 白名单在手写的
 * \`registry.ts\` 里 —— 那些是判断,这里只是磁盘事实。
 */

/** 插件模块形状:default export = plugin-sdk 产出的 \`{ fetch(request, env) }\`。 */
export interface BuiltinPluginModule {
  default: {
    fetch(request: Request, env: never): Promise<Response> | Response
  }
}

/** binding 名 → 懒加载器。"可用 ≠ 实例化":未被调用的插件连模块都不会加载。 */
export const BUILTIN_PLUGIN_LOADERS: Record<string, () => Promise<BuiltinPluginModule>> = {
${loaders}
}
`
}

const names = await discoverPlugins()
const source = emit(names)
const check = process.argv.includes('--check')

if (check) {
  let current = ''
  try {
    current = await readFile(TARGET, 'utf8')
  } catch {
    console.error(`缺 ${TARGET};跑 pnpm --filter @tool-bridge/plugins generate:registry`)
    process.exit(1)
  }
  if (current !== source) {
    console.error(
      '内置插件目录与生成物不一致(有人加/删了 src/<name>/ 却没重新生成)。\n'
      + '跑:pnpm --filter @tool-bridge/plugins generate:registry',
    )
    process.exit(1)
  }
  console.log(`registry.generated.ts 与磁盘一致(${names.length} 个插件)`)
} else {
  await writeFile(TARGET, source)
  console.log(`registry.generated.ts:${names.length} 个插件`)
}
