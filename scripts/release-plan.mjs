#!/usr/bin/env node
/**
 * 发布计划(**纯读**:不写盘、不打 tag、不发包)。
 *
 *   node scripts/release-plan.mjs           # 人类可读
 *   node scripts/release-plan.mjs --json    # 供 workflow 消费
 *
 * 回答三个每轮发布都要手工回答一遍的问题:
 * 1. 哪些 public 包的本地版本领先 registry(= 待发);
 * 2. 按什么顺序发(唯一硬约束:`server` 的 regular dep 是 `@tool-bridge/dashboard`,
 *    `pnpm pack` 会把 `workspace:*` 改写成具体版本 —— dashboard 没发,server 装不上);
 * 3. 有没有"发出去就装不上"的组合(某包 tarball 引用了 registry 上不存在的版本)。
 *
 * 之所以值得一个脚本:这三问此前靠人对着 `npm view` 逐包比,而漏判的代价不对称 ——
 * npm 版本号**不可回收**,发错一个就只能再 bump 一版。
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'
import { join } from 'node:path'

/** 可发布包(private 的 core/plugins 由各产物 bundle,不单独发)。 */
const PUBLIC_PACKAGES = ['app', 'cli', 'dashboard', 'gateway', 'plugin-sdk', 'sdk', 'server']

/**
 * 发布顺序的硬约束:`依赖 → 依赖它的包`。
 *
 * 只有一条真约束(server→dashboard)。其余包互不依赖(它们各自 bundle core/app),
 * 顺序随意 —— 故这里不硬编一张全序表,只声明偏序,让拓扑排序去定顺序。
 */
const MUST_PRECEDE = [['dashboard', 'server']]

const ROOT = join(import.meta.dirname, '..')

function manifestOf(pkg) {
  return JSON.parse(readFileSync(join(ROOT, 'packages', pkg, 'package.json'), 'utf8'))
}

/** registry 上的 latest;包不存在(首发)→ null。网络失败会抛,不静默当成"没发过"。 */
async function registryVersion(name) {
  const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`registry ${name} → HTTP ${res.status}`)
  const body = await res.json()
  return body['dist-tags']?.latest ?? null
}

/** 该包发布后,哪些 workspace 依赖会被 pnpm pack 改写成具体版本。 */
function workspaceDeps(manifest) {
  const deps = manifest.dependencies ?? {}
  return Object.entries(deps)
    .filter(([name, range]) => name.startsWith('@tool-bridge/') && String(range).startsWith('workspace:'))
    .map(([name]) => name.replace('@tool-bridge/', ''))
}

/** 偏序 → 全序(稳定:同层按字母序,便于结果可复现)。 */
function topoSort(names) {
  const pending = [...names].sort()
  const out = []
  while (pending.length > 0) {
    const idx = pending.findIndex(
      n => !MUST_PRECEDE.some(([before, after]) => after === n && pending.includes(before)),
    )
    if (idx < 0) throw new Error(`发布顺序有环:${pending.join(', ')}`)
    out.push(pending.splice(idx, 1)[0])
  }
  return out
}

const entries = []
for (const pkg of PUBLIC_PACKAGES) {
  const manifest = manifestOf(pkg)
  const local = manifest.version
  const published = await registryVersion(manifest.name)
  entries.push({
    pkg,
    name: manifest.name,
    local,
    published,
    needsPublish: published !== local,
    firstRelease: published === null,
    deps: workspaceDeps(manifest),
    tag: `${pkg}-v${local}`,
  })
}

const byPkg = new Map(entries.map(e => [e.pkg, e]))
const pending = entries.filter(e => e.needsPublish)
const order = topoSort(pending.map(e => e.pkg))

/**
 * "发出去装不上"检查:某个待发包的 workspace 依赖,发布后会被改写成**本地**版本号,
 * 而那个版本此刻可能还不在 registry 上。若该依赖也在本轮待发列表里,顺序能解决;
 * 若它不在(比如有人只 bump 了 server),那就是硬错误。
 */
const blockers = []
for (const entry of pending) {
  for (const dep of entry.deps) {
    const target = byPkg.get(dep)
    if (target === undefined) continue
    if (target.published === target.local) continue
    if (!target.needsPublish) continue
    if (!order.includes(dep)) {
      blockers.push(
        `${entry.name}@${entry.local} 会引用 ${target.name}@${target.local},`
        + `但 registry 上是 ${target.published ?? '(未发布)'} —— 必须同轮先发 ${dep}`,
      )
    }
  }
}

// 反向:某包**不**待发,但它依赖的包 bump 了 —— 那个包的已发 tarball 引用的是旧版本,
// 没问题;真正的坑是"依赖 bump 了而自己没 bump",消费者拿不到新依赖。仅提示。
const staleConsumers = []
for (const entry of entries) {
  if (entry.needsPublish) continue
  for (const dep of entry.deps) {
    const target = byPkg.get(dep)
    if (target?.needsPublish === true) {
      staleConsumers.push(`${entry.name} 未 bump,但其依赖 ${target.name} 本轮要发新版`)
    }
  }
}

const plan = {
  order,
  packages: entries,
  blockers,
  staleConsumers,
  tags: order.map(p => byPkg.get(p).tag),
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(plan, null, 2))
  process.exit(blockers.length > 0 ? 1 : 0)
}

console.log('包状态(local vs registry latest):')
for (const e of entries) {
  const mark = e.needsPublish ? (e.firstRelease ? '首发' : '待发') : ' ok '
  console.log(
    `  [${mark}] ${e.name.padEnd(26)} ${String(e.published ?? '-').padStart(8)} → ${e.local}`,
  )
}

if (pending.length === 0) {
  console.log('\n没有待发包:全部与 registry 对齐。')
  process.exit(0)
}

console.log(`\n发布顺序(${order.length} 个):`)
order.forEach((p, i) => {
  const e = byPkg.get(p)
  const why = e.deps.length > 0 ? `  ← 依赖 ${e.deps.join(', ')}` : ''
  console.log(`  ${i + 1}. ${p} → ${e.tag}${why}`)
})

if (staleConsumers.length > 0) {
  console.log('\n提示:')
  for (const s of staleConsumers) console.log(`  · ${s}`)
}

if (blockers.length > 0) {
  console.log('\n阻塞项(发了会装不上):')
  for (const b of blockers) console.log(`  ✗ ${b}`)
  process.exit(1)
}

console.log('\n一条命令跑完:gh workflow run release.yml')
console.log('(它按上面的顺序逐个触发 publish-*.yml,失败即停,不必手工打 tag)')
