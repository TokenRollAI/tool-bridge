#!/usr/bin/env node
/**
 * 幂等 provision:创建 KV namespace 与 R2 bucket(存在即跳过)。名称从 TB_NAME_PREFIX 派生。
 *
 * 用成熟 CLI(wrangler)完成,不手写 CF API 调用(LOOP.md 纪律 4)。凭据走 wrangler OAuth
 * 或 CLOUDFLARE_API_TOKEN(见 .env)。**本脚本由主协调者在部署前执行,worker 不运行它。**
 *
 * 完成后需把新建 KV namespace 的 id 回填到 packages/gateway/wrangler.jsonc 的 TB_KV.id。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

function ensureKv() {
  const out = wrangler(['kv', 'namespace', 'list'], { capture: true })
  let list = []
  try {
    list = JSON.parse(out)
  } catch {
    console.warn('warn: could not parse `kv namespace list` output; attempting create anyway')
  }
  const existing = list.find((ns) => ns.title === kvTitle)
  if (existing) {
    console.log(`KV namespace '${kvTitle}' exists (id=${existing.id}) — skip`)
    return existing.id
  }
  console.log(`creating KV namespace '${kvTitle}'...`)
  wrangler(['kv', 'namespace', 'create', kvTitle])
  console.log(`created KV '${kvTitle}' — copy its id into packages/gateway/wrangler.jsonc TB_KV.id`)
}

function ensureR2() {
  const out = wrangler(['r2', 'bucket', 'list'], { capture: true })
  if (out.includes(r2Bucket)) {
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
