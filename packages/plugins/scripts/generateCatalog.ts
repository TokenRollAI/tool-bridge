/**
 * 从**求值**每个内置插件的 `/~describe` 生成目录 descriptor(`src/catalog.generated.ts`)。
 *
 *   pnpm --filter @tool-bridge/plugins generate:catalog
 *   pnpm --filter @tool-bridge/plugins generate:catalog --check   # CI:只比对不写盘
 *
 * **求值而不是解析源码**。`registry.generated.ts` 那份只回答"磁盘上有哪些插件",
 * 靠 readdir 就够;这份要回答"每个插件声明了什么 export、要哪些凭证字段",而那是
 * `createPlugin()` 链式调用的**运行时产物** —— 静态解析等于把 plugin-sdk 的构造语义
 * 抄第二遍,抄漏一处就是"契约与实现不一致且零报错"。所以这里直接 import 插件模块、
 * 真调它的 `fetch('/~describe')`,拿它自己吐出来的形状。
 *
 * 求值必须对所有 loader 成功,且保持零网络、零凭证、零 env(`~describe` 是纯内存的
 * 生命周期端点,见 plugin-sdk 的 GET 分支)。
 *
 * **刻意不收 action 表**。求值 tools `List` 也能成功(98/99,唯一失败的 feishu 是
 * proxyTools 要真实凭证),但那份产物 2.49 MiB —— 与 `src/<name>/schema.ts` 是同一份数据
 * 的第二个副本,而工具表运行时本就走 `toolcache:<path>`。收进来只会让仓库和 Worker bundle
 * 各多背 2.5 MiB,且任何一行 description 改动都会翻动 digest。
 */

import { canonicalCatalogJson, catalogDigest } from '@tool-bridge/core'
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { join } from 'node:path'
import { BUILTIN_PLUGIN_LOADERS } from '../src/registry'

const TARGET = join(import.meta.dirname, '..', 'src', 'catalog.generated.ts')

/**
 * canonical 形态(键序固定)。digest 由 core 的 {@link catalogDigest} 算 —— 生成脚本与
 * 运行时对拍必须用**同一份**实现,否则"生成时算的 digest"与"启动时校验的 digest"可能
 * 各自正确却互不相等,而那种不一致最难查。
 */
function canonical(value: unknown): unknown {
  return JSON.parse(canonicalCatalogJson(value))
}

interface RawDescribe {
  exports?: unknown[]
  protocolVersion?: string
}

/** 求值一个插件的 `~describe`。失败即抛 —— 目录不完整比目录缺一项更该早暴露。 */
async function describeOf(name: string): Promise<RawDescribe> {
  const loader = BUILTIN_PLUGIN_LOADERS[name]
  if (loader === undefined) throw new Error(`no loader for '${name}'`)
  const mod = await loader()
  const resp = await mod.default.fetch(
    new Request('https://catalog.invalid/~describe'),
    // `~describe` 不读 env(纯内存);给个空对象只为满足签名。
    {} as never,
  )
  if (resp.status !== 200) {
    throw new Error(`plugin '${name}' 的 ~describe 回 HTTP ${resp.status}`)
  }
  const describe = (await resp.json()) as RawDescribe
  if (!Array.isArray(describe.exports) || describe.exports.length === 0) {
    throw new Error(`plugin '${name}' 的 ~describe 没有 exports`)
  }
  return describe
}

async function build(): Promise<string> {
  const names = Object.keys(BUILTIN_PLUGIN_LOADERS).sort()
  const entries: Array<{ describe: unknown, digest: string, id: string }> = []
  for (const name of names) {
    const describe = await describeOf(name)
    entries.push({
      id: name,
      describe: canonical(describe),
      digest: await catalogDigest(describe),
    })
  }
  // 目录级 digest 只覆盖 (id, per-entry digest) 对 —— 理由见 core catalogSetDigest 的注释。
  // 这里不直接调它:那个函数吃已构造好的 BuiltinCatalog,而此刻还在生成阶段。
  const setDigest = await catalogDigest(entries.map(e => ({ id: e.id, digest: e.digest })))

  const body = entries
    .map(e => `  ${JSON.stringify(e.id)}: ${JSON.stringify({
      id: e.id,
      kind: 'builtin',
      endpoint: `binding:${e.id}`,
      digest: e.digest,
      describe: e.describe,
    })},`)
    .join('\n')

  return `/* eslint-disable @stylistic/quotes, @stylistic/quote-props, @stylistic/key-spacing, @stylistic/comma-spacing, @stylistic/object-curly-spacing -- 生成的数据字面量:JSON.stringify 输出,不按手写代码的风格规则排版 */
/**
 * **此文件由 \`scripts/generateCatalog.ts\` 生成,不要手改。**
 * 重新生成:\`pnpm --filter @tool-bridge/plugins generate:catalog\`
 *
 * 内容 = 每个内置插件 \`/~describe\` 的**求值**产物。这是编译期常量:内置插件的目录项
 * 与它的代码同一份构建产物,故不可能陈旧,也不需要落库(见
 * \`llmdoc/architecture/plugin-runtime.md\`)。
 *
 * **一行一个插件**是有意的:diff 只显示真正变化的那些条目,review 时看得清"谁的声明动了"。
 */

import type { BuiltinCatalog } from '@tool-bridge/core'

/** 目录级 digest:覆盖 (id, per-entry digest) 对。三宿主装配对拍用这一个值。 */
export const BUILTIN_CATALOG_DIGEST = ${JSON.stringify(setDigest)}

export const BUILTIN_CATALOG: BuiltinCatalog = {
${body}
}
`
}

const source = await build()

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = await readFile(TARGET, 'utf8')
  } catch {
    console.error(`缺 ${TARGET};跑 pnpm --filter @tool-bridge/plugins generate:catalog`)
    process.exit(1)
  }
  if (current !== source) {
    console.error(
      '内置插件目录 descriptor 与求值结果不一致(改了插件声明却没重新生成)。\n'
      + '跑:pnpm --filter @tool-bridge/plugins generate:catalog',
    )
    process.exit(1)
  }
  console.log('catalog.generated.ts 与求值结果一致')
} else {
  await writeFile(TARGET, source)
  const kib = (source.length / 1024).toFixed(1)
  console.log(`catalog.generated.ts:${Object.keys(BUILTIN_PLUGIN_LOADERS).length} 个插件,${kib} KiB`)
}
