/**
 * 迁移流水线 CLI。
 *
 *   node scripts/migrate/index.mjs <open-connector 路径> <service>...
 *
 * 做三件事:求值上游 action 定义 → 生成 Zod schema 源码 → 落到 src/<service>/schema.ts。
 * **不生成 handler**:业务逻辑(HTTP 拼参、分页、错误映射)由人按 `src/<service>/api.ts`
 * 机械改写,这一步刻意不自动化 —— 生成出来的 handler 骨架只会掩盖没迁完的事实。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { join } from 'node:path'
import { fingerprintProvider, NORMALIZE_VERSION } from './fingerprint.mjs'
import { emitSchemaModule } from './emit.mjs'
import { normalize } from './parity.mjs'

const [sourceRoot, ...services] = process.argv.slice(2)
if (!sourceRoot || services.length === 0) {
  throw new Error('用法: node scripts/migrate/index.mjs <open-connector 路径> <service>...')
}

const srcRoot = join(import.meta.dirname, '..', '..', 'src')
const written = []
/** 全局指纹清单的路径(等价闸门读它;见 fingerprint.mjs 为何不按 provider 分散存)。 */
const fingerprintPath = join(import.meta.dirname, '..', '..', 'migration-fingerprints.json')

/** 已有清单:本次只更新涉及的 provider,不动其余(增量迁移不该重写全表)。 */
let fingerprints = { normalizeVersion: NORMALIZE_VERSION, providers: {} }
try {
  fingerprints = JSON.parse(await readFile(fingerprintPath, 'utf8'))
  if (fingerprints.normalizeVersion !== NORMALIZE_VERSION) {
    // 规则变了,旧指纹全部作废 —— 与其留半新半旧的混合表,不如显式重建。
    console.warn(
      `normalizeVersion ${fingerprints.normalizeVersion} → ${NORMALIZE_VERSION}:`
      + ' 归一化规则已变,须对全部已迁 provider 重跑本脚本以重建指纹',
    )
    fingerprints.normalizeVersion = NORMALIZE_VERSION
  }
} catch { /* 首次运行 */ }

for (const service of services) {
  const mod = await import(`${sourceRoot}/src/providers/${service}/definition.ts`)
  const targetDir = join(srcRoot, service)
  await mkdir(targetDir, { recursive: true })

  let handwritten = new Set()
  try {
    handwritten = new Set(JSON.parse(await readFile(join(targetDir, 'handwritten.json'), 'utf8')).actions)
  } catch { /* 没有豁免清单 = 全部自动生成 */ }

  const source = emitSchemaModule(mod.provider, handwritten)
  const target = join(targetDir, 'schema.ts')
  await writeFile(target, source)
  written.push(target)

  fingerprints.providers[service] = await fingerprintProvider(mod.provider, normalize)

  console.log(
    `${service}: ${mod.provider.actions.length} actions`
    + `${handwritten.size > 0 ? `(${handwritten.size} 手写豁免)` : ''} → src/${service}/schema.ts`,
  )
}

// 全局指纹清单:一次写完(providers 按名排序,免得 diff 里出现无意义的顺序变动)。
const sortedProviders = {}
for (const key of Object.keys(fingerprints.providers).sort()) {
  sortedProviders[key] = fingerprints.providers[key]
}
await writeFile(
  fingerprintPath,
  `${JSON.stringify({ normalizeVersion: NORMALIZE_VERSION, providers: sortedProviders }, null, 2)}\n`,
)
console.log(`指纹清单:${Object.keys(sortedProviders).length} 个 provider → migration-fingerprints.json`)

// 生成物直接过仓库自己的 linter:产物要与手写代码同一风格,不是"生成的代码可以将就"。
// 这也是产物归本仓库所有的实际含义 —— 它得能通过和其他源码一样的闸门。
execFileSync('pnpm', ['exec', 'eslint', '--fix', ...written], {
  cwd: join(import.meta.dirname, '..', '..'),
  stdio: 'inherit',
})
console.log('已按仓库风格格式化')
