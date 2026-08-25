#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import process from 'node:process'

/** CLI 输入里的逗号分隔包名；去空白、去重但保留用户顺序。 */
export function parseRequestedPackages(value) {
  const out = []
  const seen = new Set()
  for (const raw of String(value ?? '').split(',')) {
    const pkg = raw.trim()
    if (pkg === '' || seen.has(pkg)) continue
    seen.add(pkg)
    out.push(pkg)
  }
  return out
}

/**
 * 从 release-plan JSON 选择发布子集，同时闭包所有尚未发布的 workspace 前置依赖。
 *
 * 空选择仍只返回 npm 待发 plan.order；显式选择允许包已在 npm，
 * 用于恢复 CLI/server 的镜像等非 npm 产物。
 */
export function selectReleasePackages(plan, requestedValue = '') {
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TypeError('release plan must be an object')
  }
  if (!Array.isArray(plan.order) || !Array.isArray(plan.packages)) {
    throw new TypeError('release plan must contain order and packages arrays')
  }

  const order = plan.order.map(String)
  const requested = parseRequestedPackages(requestedValue)
  if (requested.length === 0) return order

  const entries = new Map(plan.packages.map(entry => [entry.pkg, entry]))
  const pending = new Set(order)
  const unknown = requested.filter(pkg => !entries.has(pkg))
  if (unknown.length > 0) {
    throw new Error(`这些包不在发布计划里:${unknown.join(', ')}`)
  }

  const selected = new Set(requested)
  const queue = [...requested]
  while (queue.length > 0) {
    const pkg = queue.pop()
    const entry = entries.get(pkg)
    if (entry === undefined || !Array.isArray(entry.deps)) {
      throw new Error(`release plan 缺少 ${pkg} 的依赖信息`)
    }
    for (const dependency of entry.deps) {
      const depEntry = entries.get(dependency)
      if (depEntry?.needsPublish !== true) continue
      if (!pending.has(dependency)) {
        throw new Error(`${pkg} 的待发前置依赖 ${dependency} 不在 release order 中`)
      }
      if (selected.has(dependency)) continue
      selected.add(dependency)
      queue.push(dependency)
    }
  }

  // 对显式选中的已发布包重算局部拓扑序；plan.packages 的稳定
  // 顺序用作同层 tie-breaker，待发依赖仍必须先出现。
  const remaining = plan.packages.map(entry => entry.pkg).filter(pkg => selected.has(pkg))
  const result = []
  while (remaining.length > 0) {
    const index = remaining.findIndex((pkg) => {
      const deps = entries.get(pkg)?.deps ?? []
      return !deps.some(dependency => remaining.includes(dependency))
    })
    if (index < 0) throw new Error(`发布子集依赖有环:${remaining.join(', ')}`)
    result.push(remaining.splice(index, 1)[0])
  }
  return result
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const isMain = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === process.argv[1]

if (isMain) {
  try {
    const source = await readStdin()
    const plan = JSON.parse(source)
    process.stdout.write(`${JSON.stringify(selectReleasePackages(plan, process.argv[2]))}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
