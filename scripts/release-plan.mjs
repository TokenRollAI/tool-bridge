#!/usr/bin/env node
/**
 * 发布计划(不改版本、不打 tag、不发包;`--json-file` 只写快照输出)。
 *
 *   node scripts/release-plan.mjs                         # 人类可读
 *   node scripts/release-plan.mjs --json                  # 供单一消费者
 *   node scripts/release-plan.mjs --json-file <snapshot>  # 同一快照供多消费者复用
 *
 * 回答两个每轮发布都要手工回答一遍的问题:
 * 1. 哪些 public 包的本地精确版本尚未存在于 registry(= 待发);
 * 2. 按什么顺序发(唯一硬约束:`server` 的 regular dep 是 `@tool-bridge/dashboard`,
 *    `pnpm pack` 会把 `workspace:*` 改写成具体版本 —— dashboard 没发,server 装不上);
 *
 * 之所以值得一个脚本:这两问此前靠人对着 `npm view` 逐包比,而漏判的代价不对称 ——
 * npm 版本号**不可回收**,发错一个就只能再 bump 一版。
 */

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import process from 'node:process'
import { join } from 'node:path'
import { npmRegistrySnapshot } from './npm-registry-version.mjs'

/** 可发布包(private 的 core/plugins 由各产物 bundle,不单独发)。 */
export const PUBLIC_PACKAGES = ['app', 'cli', 'dashboard', 'gateway', 'plugin-sdk', 'sdk', 'server']

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

export async function buildReleasePlan({
  fetcher = globalThis.fetch,
  manifestLoader = manifestOf,
  packages = PUBLIC_PACKAGES,
} = {}) {
  if (typeof fetcher !== 'function') throw new TypeError('fetcher must be a function')
  if (typeof manifestLoader !== 'function') throw new TypeError('manifestLoader must be a function')

  // 同一调用内每包只取一次 snapshot;latest 与 exact 不会来自两个时刻。
  const entries = await Promise.all(packages.map(async (pkg) => {
    const manifest = await manifestLoader(pkg)
    const local = manifest.version
    const snapshot = await npmRegistrySnapshot(manifest.name, fetcher)
    return {
      pkg,
      name: manifest.name,
      local,
      published: snapshot.latest,
      needsPublish: !snapshot.versions.has(local),
      firstRelease: !snapshot.exists,
      deps: workspaceDeps(manifest),
      tag: `${pkg}-v${local}`,
    }
  }))

  const byPkg = new Map(entries.map(e => [e.pkg, e]))
  const pending = entries.filter(e => e.needsPublish)
  const order = topoSort(pending.map(e => e.pkg))

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

  return {
    order,
    packages: entries,
    staleConsumers,
    tags: order.map(p => byPkg.get(p).tag),
  }
}

export function formatReleasePlan(plan) {
  const lines = ['包状态(local exact version;latest 仅供参考):']
  for (const entry of plan.packages) {
    const mark = entry.needsPublish ? (entry.firstRelease ? '首发' : '待发') : ' ok '
    const state = entry.needsPublish
      ? `${String(entry.published ?? '-').padStart(8)} → ${entry.local}`
      : `${entry.local} 已存在${entry.published !== entry.local ? ` (latest ${entry.published ?? '-'})` : ''}`
    lines.push(`  [${mark}] ${entry.name.padEnd(26)} ${state}`)
  }

  if (plan.order.length === 0) {
    lines.push('', '没有待发包:全部精确版本已在 registry。')
    return lines.join('\n')
  }

  const byPkg = new Map(plan.packages.map(entry => [entry.pkg, entry]))
  lines.push('', `发布顺序(${plan.order.length} 个):`)
  plan.order.forEach((pkg, index) => {
    const entry = byPkg.get(pkg)
    const why = entry.deps.length > 0 ? `  ← 依赖 ${entry.deps.join(', ')}` : ''
    lines.push(`  ${index + 1}. ${pkg} → ${entry.tag}${why}`)
  })

  if (plan.staleConsumers.length > 0) {
    lines.push('', '提示:', ...plan.staleConsumers.map(message => `  · ${message}`))
  }
  lines.push(
    '',
    '一条命令跑完:gh workflow run release.yml',
    '(它按上面的顺序逐个触发 publish-*.yml,失败即停,不必手工打 tag)',
  )
  return lines.join('\n')
}

async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'json': { type: 'boolean' },
      'json-file': { type: 'string' },
    },
    strict: true,
  })
  const plan = await buildReleasePlan()
  const json = `${JSON.stringify(plan, null, 2)}\n`
  if (values['json-file'] !== undefined) await writeFile(values['json-file'], json)
  process.stdout.write(values.json ? json : `${formatReleasePlan(plan)}\n`)
}

const isMain = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === process.argv[1]

if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
