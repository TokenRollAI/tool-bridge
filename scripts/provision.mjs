#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
/**
 * 幂等 provision:创建 KV namespace 与 R2 bucket(存在即跳过)。名称从 TB_NAME_PREFIX 派生。
 *
 * 用成熟 CLI(wrangler)完成,不手写 CF API 调用。凭据走 wrangler OAuth
 * 或 CLOUDFLARE_API_TOKEN(见 .env)。**本脚本由主协调者在部署前执行,worker 不运行它。**
 *
 * 完成后需把新建 KV namespace 的 id 回填到 packages/gateway/wrangler.jsonc 的 TB_KV.id。
 */
import { execFileSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import { join } from 'node:path'

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

const childEnv = { ...process.env }
if (accountId) childEnv.CLOUDFLARE_ACCOUNT_ID = accountId
if (apiToken) childEnv.CLOUDFLARE_API_TOKEN = apiToken

/** 调 wrangler(项目 pin 版本经 npx 解析);capture=true 时返回 stdout。 */
function wrangler(args, { capture = false } = {}) {
  return execFileSync('npx', ['wrangler', ...args], {
    cwd: root,
    env: childEnv,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })
}

/** create 分支专用:重新 list 取新 id,回填 wrangler.jsonc 的 TB_KV.id(保留注释/结构)。 */
function backfillKvId(id) {
  const wranglerPath = join(root, 'packages', 'gateway', 'wrangler.jsonc')
  const src = readFileSync(wranglerPath, 'utf8')
  const next = src.replace(/("binding":\s*"TB_KV",\s*"id":\s*")[^"]*(")/, `$1${id}$2`)
  if (next === src) {
    console.warn(`warn: could not locate TB_KV.id in ${wranglerPath}; write id=${id} manually`)
    return
  }
  writeFileSync(wranglerPath, next)
  console.log(`已回填 TB_KV.id=${id} → packages/gateway/wrangler.jsonc`)
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
  const out = wrangler(['r2', 'bucket', 'list'], { capture: true })
  // list 无 --json,按行解析 `name: <bucket>` 做全等比较(对齐 ensureKv 的精确匹配,消除子串假阳性)。
  const names = out
    .split('\n')
    .map(line => line.match(/^\s*name:\s*(.+?)\s*$/))
    .filter(m => m !== null)
    .map(m => m[1])
  if (names.includes(r2Bucket)) {
    console.log(`R2 bucket '${r2Bucket}' exists — skip`)
    return
  }
  console.log(`creating R2 bucket '${r2Bucket}'...`)
  wrangler(['r2', 'bucket', 'create', r2Bucket])
}

console.log(`provisioning with prefix '${prefix}'${accountId ? ` (account ${accountId})` : ''}`)
ensureKv()
ensureR2()
console.log('provision done.')
