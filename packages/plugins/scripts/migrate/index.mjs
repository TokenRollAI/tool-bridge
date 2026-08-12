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
import { emitSchemaModule } from './emit.mjs'

const [sourceRoot, ...services] = process.argv.slice(2)
if (!sourceRoot || services.length === 0) {
  throw new Error('用法: node scripts/migrate/index.mjs <open-connector 路径> <service>...')
}

const srcRoot = join(import.meta.dirname, '..', '..', 'src')
const written = []

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

  // 同时落一份上游 schema 快照:等价闸门(test/migration/schemaParity.test.ts)比对它而不是
  // 外部仓库,于是 CI 里也能跑,且仓库里留有"我们是从什么形状迁过来的"的凭据。
  await writeFile(
    join(targetDir, 'upstream.snapshot.json'),
    `${JSON.stringify({
      service: mod.provider.service,
      displayName: mod.provider.displayName,
      authTypes: mod.provider.authTypes,
      actions: mod.provider.actions.map(a => ({
        name: a.name,
        description: a.description,
        inputSchema: a.inputSchema,
        outputSchema: a.outputSchema,
      })),
    }, null, 2)}\n`,
  )
  console.log(
    `${service}: ${mod.provider.actions.length} actions`
    + `${handwritten.size > 0 ? `(${handwritten.size} 手写豁免)` : ''} → src/${service}/schema.ts`,
  )
}

// 生成物直接过仓库自己的 linter:产物要与手写代码同一风格,不是"生成的代码可以将就"。
// 这也是产物归本仓库所有的实际含义 —— 它得能通过和其他源码一样的闸门。
execFileSync('pnpm', ['exec', 'eslint', '--fix', ...written], {
  cwd: join(import.meta.dirname, '..', '..'),
  stdio: 'inherit',
})
console.log('已按仓库风格格式化')
