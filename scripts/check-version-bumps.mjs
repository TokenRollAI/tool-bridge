#!/usr/bin/env node
/**
 * "改了 public 包的 src 却没 bump 版本" 的**提醒**(退出码恒 0,不拦 PR)。
 *
 *   node scripts/check-version-bumps.mjs [base-ref]     # 默认 origin/main
 *
 * 为什么不拦:哪些包该 bump 是 public artifact ownership 的判断 —— 改的是内部实现
 * 还是消费者可感知的契约,机器判不了(新增路由、改变既有配置的接受/拒绝行为,
 * 这些 `index.ts` 的 diff 是空的,但对消费者是可感知变化)。
 *
 * 为什么仍值得存在:漏 bump 的表现是"这一轮发布里某个包静默落后",要到下一轮
 * `release-plan` 才被发现,而那时改动已经合进 main 很久了。当场看见最便宜。
 *
 * 也报**反向**问题:bundle 了 private 包(core/plugins/app)的产物,在那些 private 包
 * 变更时行为会跟着变 —— 那是消费者可感知的,却最容易被忘掉(它们的 src diff 是空的)。
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { join } from 'node:path'

const PUBLIC_PACKAGES = ['app', 'cli', 'dashboard', 'gateway', 'plugin-sdk', 'sdk', 'server']

/**
 * 谁 bundle 了哪些 private 包(tsup 的 noExternal)。private 包变更 → 这些产物的行为变。
 * 与各包 tsup.config.ts 的 noExternal 保持一致。
 */
const BUNDLES = {
  'app': ['core'],
  'cli': ['core'],
  'gateway': ['core', 'app'],
  'sdk': ['core', 'app'],
  'server': ['core', 'app', 'plugins'],
  'plugin-sdk': ['core'],
  'dashboard': [],
}

const ROOT = join(import.meta.dirname, '..')
const base = process.argv[2] ?? 'origin/main'

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

let mergeBase
try {
  mergeBase = git('merge-base', base, 'HEAD')
} catch {
  console.log(`(拿不到 ${base} 的 merge-base,跳过版本检查)`)
  process.exit(0)
}

const changed = git('diff', '--name-only', `${mergeBase}..HEAD`).split('\n').filter(Boolean)

function versionChanged(pkg) {
  const diff = git('diff', `${mergeBase}..HEAD`, '--', `packages/${pkg}/package.json`)
  return /^\+\s*"version":/m.test(diff)
}

const notes = []
for (const pkg of PUBLIC_PACKAGES) {
  const srcTouched = changed.some(f => f.startsWith(`packages/${pkg}/src/`))
  const bundledTouched = (BUNDLES[pkg] ?? []).filter(dep =>
    changed.some(f => f.startsWith(`packages/${dep}/src/`)),
  )
  if (!srcTouched && bundledTouched.length === 0) continue
  if (versionChanged(pkg)) continue

  const version = JSON.parse(
    readFileSync(join(ROOT, 'packages', pkg, 'package.json'), 'utf8'),
  ).version
  const why = srcTouched
    ? 'src 有改动'
    : `bundle 的 private 包有改动(${bundledTouched.join(', ')})`
  notes.push(`@tool-bridge/${pkg}@${version}:${why},但版本未 bump`)
}

if (notes.length === 0) {
  console.log('版本检查:无遗漏(改动的 public 包都 bump 了)')
  process.exit(0)
}

// GitHub Actions 的 warning 注解:在 PR 的 Checks 页直接可见。
for (const note of notes) {
  console.log(`::warning::${note}`)
  console.log(`  · ${note}`)
}
console.log(
  '\n若这些改动对消费者不可感知(纯内部实现/注释/测试),忽略本提醒即可;'
  + '\n否则按 CLAUDE.md 的 public artifact ownership 判据 bump 后再合。',
)
process.exit(0)
