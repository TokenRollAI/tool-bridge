/** 迁移可行性探针:对给定 provider 跑 schema 生成 + 等价比对,只报告不落盘。 */
import process from 'node:process'
import { normalize, toJsonSchema } from './parity.mjs'
import { toZod } from './jsonSchemaToZod.mjs'
import { firstDiff } from './diff.mjs'

const [sourceRoot, ...services] = process.argv.slice(2)
let total = 0
let clean = 0
const problems = []

for (const service of services) {
  const mod = await import(`${sourceRoot}/src/providers/${service}/definition.ts`)
  for (const action of mod.provider.actions) {
    total += 1
    let ok = true
    for (const [field, io] of [['inputSchema', 'input'], ['outputSchema', 'output']]) {
      const upstream = action[field]
      if (upstream === undefined) continue
      let derived
      try {
        derived = toJsonSchema(toZod(upstream, `${action.id}.${field}`), io)
      } catch (error) {
        problems.push({ action: action.id, field, kind: 'codegen', message: String(error?.message ?? error) })
        ok = false
        continue
      }
      const d = firstDiff(normalize(upstream), normalize(derived))
      if (d !== null) {
        problems.push({ action: action.id, field, kind: 'mismatch', ...d })
        ok = false
      }
    }
    if (ok) clean += 1
  }
}

console.log(`\naction 总数 ${total},完全等价 ${clean},有分歧 ${total - clean}`)
const buckets = new Map()
for (const p of problems) {
  const sig = p.kind === 'codegen'
    ? `codegen: ${p.message.split('——')[0].split(':').pop().trim().slice(0, 60)}`
    : `mismatch @ …${p.path.split('/').filter(Boolean).slice(-2).join('/')}: ${JSON.stringify(p.left)?.slice(0, 40)} ≠ ${JSON.stringify(p.right)?.slice(0, 40)}`
  const b = buckets.get(sig) ?? { n: 0, sample: p }
  b.n += 1
  buckets.set(sig, b)
}
console.log('\n按根因分桶:')
for (const [sig, b] of [...buckets].sort((a, c) => c[1].n - a[1].n)) {
  console.log(`  ${String(b.n).padStart(3)} × ${sig}`)
  console.log(`        e.g. ${b.sample.action} [${b.sample.field}] ${b.sample.path ?? ''}`)
}
