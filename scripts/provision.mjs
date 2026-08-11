#!/usr/bin/env node
import { applyEdits, findNodeAtLocation, modify, parseTree } from 'jsonc-parser'
import { readFileSync, writeFileSync } from 'node:fs'
/**
 * 幂等 provision:创建 KV namespace、R2 bucket 与 D1 search database(存在即跳过)。
 * 名称从 TB_NAME_PREFIX 派生。
 *
 * 用成熟 CLI(wrangler)完成,不手写 CF API 调用。凭据走 wrangler OAuth
 * 或 CLOUDFLARE_API_TOKEN(见 .env)。**本脚本由主协调者在部署前执行,worker 不运行它。**
 *
 * 完成后把新建 KV / D1 的 id 回填到 packages/gateway/wrangler.jsonc。
 */
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { parseEnv } from 'node:util'

const root = join(import.meta.dirname, '..')

// 读取 .env 取前缀与账户(存在即用;缺失回退到进程环境变量)。
let env = {}
try {
  env = parseEnv(readFileSync(join(root, '.env'), 'utf8'))
} catch {
  // 无 .env 时依赖已导出的环境变量
}
const prefix = env.TB_NAME_PREFIX || process.env.TB_NAME_PREFIX || 'tb'
const accountId = env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID
const apiToken = env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN

const kvTitle = `${prefix}-kv`
const r2Bucket = `${prefix}-r2`
const d1Name = `${prefix}-search`
const wranglerPath = resolve(
  root,
  process.env.TB_PROVISION_WRANGLER_CONFIG ?? join('packages', 'gateway', 'wrangler.jsonc'),
)

const childEnv = { ...process.env }
if (accountId) childEnv.CLOUDFLARE_ACCOUNT_ID = accountId
if (apiToken) childEnv.CLOUDFLARE_API_TOKEN = apiToken

/** 调 wrangler(项目 pin 版本经 npx 解析);capture=true 时返回 stdout;quiet=true 时吞掉 stderr(用于预期内失败的探测)。 */
function wrangler(args, { capture = false, quiet = false } = {}) {
  return execFileSync('npx', ['wrangler', ...args], {
    cwd: root,
    env: childEnv,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', quiet ? 'pipe' : 'inherit'] : 'inherit',
  })
}

/** 保留 JSONC 注释/结构,只替换目标 binding 的 id(jsonc-parser 精确编辑,不依赖字段顺序/空白)。 */
function backfillId(arrayKey, binding, idKey, id, label) {
  const src = readFileSync(wranglerPath, 'utf8')
  const tree = parseTree(src)
  const arr = tree ? findNodeAtLocation(tree, [arrayKey]) : undefined
  const idx = (arr?.children ?? []).findIndex(item =>
    (item.children ?? []).some(prop =>
      prop.children?.[0]?.value === 'binding' && prop.children?.[1]?.value === binding))
  if (idx < 0) {
    throw new Error(`could not locate ${label} in ${wranglerPath}`)
  }
  if (findNodeAtLocation(tree, [arrayKey, idx, idKey])?.value === id) {
    console.log(`${label} already points to id=${id}`)
    return
  }
  const edits = modify(src, [arrayKey, idx, idKey], id, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  })
  writeFileSync(wranglerPath, applyEdits(src, edits))
  console.log(`已回填 ${label}=${id} → ${wranglerPath}`)
}

function backfillKvId(id) {
  backfillId('kv_namespaces', 'TB_KV', 'id', id, 'TB_KV.id')
}

function backfillD1Id(id) {
  backfillId('d1_databases', 'TB_SEARCH', 'database_id', id, 'TB_SEARCH.database_id')
}

function ensureKv() {
  const out = wrangler(['kv', 'namespace', 'list'], { capture: true })
  let list = []
  try {
    list = JSON.parse(out)
  } catch {
    console.warn('warn: could not parse `kv namespace list` output; attempting create anyway')
  }
  const existing = list.find(ns => ns.title === kvTitle)
  if (existing) {
    backfillKvId(existing.id)
    console.log(`KV namespace '${kvTitle}' exists (id=${existing.id}) — skip`)
    return existing.id
  }
  console.log(`creating KV namespace '${kvTitle}'...`)
  wrangler(['kv', 'namespace', 'create', kvTitle])
  // create 不回吐 id,重新 list 取新建 namespace 的 id 并回填(干净环境 deploy:all 不断链)。
  const after = wrangler(['kv', 'namespace', 'list'], { capture: true })
  let created
  try {
    created = JSON.parse(after).find(ns => ns.title === kvTitle)
  } catch {
    // 解析失败走下方手动提示
  }
  if (created) {
    backfillKvId(created.id)
    return created.id
  }
  console.log(
    `created KV '${kvTitle}' but could not read its new id — copy it into packages/gateway/wrangler.jsonc TB_KV.id`,
  )
}

function ensureR2() {
  // `r2 bucket list` 无 --json;改用 `r2 bucket info <name> --json` 做结构化存在性探测:
  // 存在 → exit 0 + JSON;不存在 → 非零退出(API 10006,2026-08-11 实测),走 create。
  try {
    const out = wrangler(['r2', 'bucket', 'info', r2Bucket, '--json'], { capture: true, quiet: true })
    JSON.parse(out)
    console.log(`R2 bucket '${r2Bucket}' exists — skip`)
    return
  } catch {
    // 不存在(或探测失败):尝试创建;真实错误(如认证)会在 create 时以非零退出暴露。
  }
  console.log(`creating R2 bucket '${r2Bucket}'...`)
  wrangler(['r2', 'bucket', 'create', r2Bucket])
}

function listD1() {
  const out = wrangler(['d1', 'list', '--json'], { capture: true })
  const parsed = JSON.parse(out)
  if (!Array.isArray(parsed)) throw new Error('`wrangler d1 list --json` did not return an array')
  return parsed
}

function ensureD1() {
  const list = listD1()
  const existing = list.find(db => db?.name === d1Name && typeof db?.uuid === 'string')
  if (existing) {
    backfillD1Id(existing.uuid)
    console.log(`D1 database '${d1Name}' exists (id=${existing.uuid}) — skip`)
    return existing.uuid
  }

  console.log(`creating D1 database '${d1Name}'...`)
  wrangler(['d1', 'create', d1Name])
  const created = listD1().find(db => db?.name === d1Name && typeof db?.uuid === 'string')
  if (!created) {
    throw new Error(`created D1 '${d1Name}' but could not read its new id`)
  }
  backfillD1Id(created.uuid)
  return created.uuid
}

console.log(`provisioning with prefix '${prefix}'${accountId ? ` (account ${accountId})` : ''}`)
ensureKv()
ensureR2()
ensureD1()
console.log('provision done.')
