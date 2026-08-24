#!/usr/bin/env node
import { applyEdits, findNodeAtLocation, getNodeValue, modify, parseTree } from 'jsonc-parser'
import { readFileSync, writeFileSync } from 'node:fs'
/**
 * 幂等 provision:**Cloudflare 宿主专用**的可选步骤,不是通用部署入口。
 * Node/Docker 自部署(`@tool-bridge/server`)与 SDK 内嵌都不需要它——那两条路径没有
 * 需要预先创建的云资源,数据落在 `TB_DATA_DIR`。
 *
 * 缺省做两件事:
 * 1. 创建 R2 bucket / 一个 D1 database(state 与 search 同库;存在即跳过),名称从 TB_NAME_PREFIX 派生;
 * 2. 把**账户特定配置**从 .env 回填进 packages/gateway/wrangler.jsonc——account_id、
 *    custom domain 路由、TB_CANONICAL_ORIGIN、R2 S3 端点与前缀派生的资源名/新建资源 id。
 *    仓库里那份 wrangler.jsonc 因此保持中立(无账户 id、无域名),谁 clone 都能直接用。
 *
 * 用成熟 CLI(wrangler)完成,不手写 CF API 调用。凭据走 wrangler OAuth
 * 或 CLOUDFLARE_API_TOKEN(见 .env)。CI 对已经 provision 的 production 设置
 * TB_PROVISION_CONFIG_ONLY=true + TB_PROVISION_D1_DATABASE_ID,只回填中立配置,不再管理资源。
 */
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { parseEnv } from 'node:util'

const root = join(import.meta.dirname, '..')

// 读取 .env 取前缀与账户(存在即用;缺失回退到进程环境变量)。
// TB_PROVISION_ENV_FILE 只为测试提供确定性:指向 fixture .env,不受开发机真实 .env 影响。
let env = {}
try {
  env = parseEnv(readFileSync(resolve(root, process.env.TB_PROVISION_ENV_FILE ?? '.env'), 'utf8'))
} catch {
  // 无 .env 时依赖已导出的环境变量
}
const prefix = env.TB_NAME_PREFIX || process.env.TB_NAME_PREFIX || 'tb'
const accountId = env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID
const apiToken = env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN
const domain = env.TB_DOMAIN || process.env.TB_DOMAIN
const baseUrl = env.TB_BASE_URL || process.env.TB_BASE_URL
const configOnly = (env.TB_PROVISION_CONFIG_ONLY || process.env.TB_PROVISION_CONFIG_ONLY) === 'true'
const provisionedD1Id = env.TB_PROVISION_D1_DATABASE_ID
  || process.env.TB_PROVISION_D1_DATABASE_ID

const r2Bucket = `${prefix}-r2`
// ADR-001:权威状态与搜索索引同在一个 D1 库(KV 已从 Cloudflare 宿主撤出)。
// TB_STATE / TB_SEARCH 两个 binding 指向同一库——binding 表达用途,库表达存储位置。
const d1Name = `${prefix}-db`
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

/** 保留 JSONC 注释/结构,只改目标路径的值(jsonc-parser 精确编辑,不依赖字段顺序/空白)。 */
function setConfigPath(path, value, label) {
  const src = readFileSync(wranglerPath, 'utf8')
  const tree = parseTree(src)
  const parent = path.length > 1 && tree ? findNodeAtLocation(tree, path.slice(0, -1)) : tree
  // 父节点不存在就跳过:配置被裁剪过时给提示,而不是凭空造出一段结构。
  if (parent === undefined) {
    console.warn(`warn: ${wranglerPath} 无 ${path.slice(0, -1).join('.')},跳过 ${label}`)
    return false
  }
  const current = findNodeAtLocation(tree, path)
  if (current !== undefined && JSON.stringify(getNodeValue(current)) === JSON.stringify(value)) {
    return false
  }
  const edits = modify(src, path, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  })
  writeFileSync(wranglerPath, applyEdits(src, edits))
  console.log(`已写入 ${label} → ${wranglerPath}`)
  return true
}

/** 在 binding 数组里按 binding 名定位元素下标(顺序无关)。 */
function bindingIndex(tree, arrayKey, binding) {
  const arr = tree ? findNodeAtLocation(tree, [arrayKey]) : undefined
  return (arr?.children ?? []).findIndex(item =>
    (item.children ?? []).some(prop =>
      prop.children?.[0]?.value === 'binding' && prop.children?.[1]?.value === binding))
}

/** 定位 binding 后改它的某个字段;定位不到则抛(配置被删了绑定,继续 deploy 只会更晚炸)。 */
function setBindingField(arrayKey, binding, key, value, label) {
  const idx = bindingIndex(parseTree(readFileSync(wranglerPath, 'utf8')), arrayKey, binding)
  if (idx < 0) {
    throw new Error(`could not locate ${label} in ${wranglerPath}`)
  }
  return setConfigPath([arrayKey, idx, key], value, label)
}

function backfillId(arrayKey, binding, idKey, id, label) {
  if (!setBindingField(arrayKey, binding, idKey, id, `${label}=${id}`)) {
    console.log(`${label} already points to id=${id}`)
  }
}

function backfillD1Id(binding, id) {
  backfillId('d1_databases', binding, 'database_id', id, `${binding}.database_id`)
}

function backfillBothD1Ids(id) {
  backfillD1Id('TB_STATE', id)
  backfillD1Id('TB_SEARCH', id)
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
    backfillBothD1Ids(existing.uuid)
    console.log(`D1 database '${d1Name}' exists (id=${existing.uuid}) — skip`)
    return existing.uuid
  }

  console.log(`creating D1 database '${d1Name}'...`)
  wrangler(['d1', 'create', d1Name])
  const created = listD1().find(db => db?.name === d1Name && typeof db?.uuid === 'string')
  if (!created) {
    throw new Error(`created D1 '${d1Name}' but could not read its new id`)
  }
  backfillBothD1Ids(created.uuid)
  return created.uuid
}

/**
 * 把 .env 的账户特定配置回填进 wrangler.jsonc。仓库里那份保持中立,这里是唯一的
 * "填进去"的地方——缺哪个变量就跳过哪一项并说清后果,不静默生成半个配置。
 */
function applyDeployTargets() {
  if (accountId) {
    setConfigPath(['account_id'], accountId, 'account_id')
    setConfigPath(
      ['vars', 'TB_R2_S3_ENDPOINT'],
      `https://${accountId}.r2.cloudflarestorage.com`,
      'vars.TB_R2_S3_ENDPOINT',
    )
  } else {
    console.log('CLOUDFLARE_ACCOUNT_ID 未设置 → 不写 account_id(多账户 OAuth 下 wrangler 会要求显式指定)')
  }
  if (domain) {
    setConfigPath(['workers_dev'], false, 'workers_dev')
    setConfigPath(['preview_urls'], false, 'preview_urls')
    setConfigPath(['routes'], [{ pattern: domain, custom_domain: true }], 'routes')
  } else {
    // 没有自定义域时显式恢复开发入口；复跑时也会清掉旧 custom route。
    setConfigPath(['workers_dev'], true, 'workers_dev')
    setConfigPath(['preview_urls'], true, 'preview_urls')
    setConfigPath(['routes'], [], 'routes')
    console.log('TB_DOMAIN 未设置 → 启用 workers.dev 入口并清空 custom routes')
  }
  if (baseUrl) {
    setConfigPath(['vars', 'TB_CANONICAL_ORIGIN'], baseUrl, 'vars.TB_CANONICAL_ORIGIN')
  } else {
    console.log('TB_BASE_URL 未设置 → TB_CANONICAL_ORIGIN 留空(OAuth redirect_uri 不钉死)')
  }
  // 前缀派生的资源名:provision 按前缀创建,配置里的名字必须跟着走,否则 deploy 绑到不存在的资源。
  setConfigPath(['vars', 'TB_R2_BUCKET'], r2Bucket, 'vars.TB_R2_BUCKET')
  setBindingField('r2_buckets', 'TB_R2', 'bucket_name', r2Bucket, 'TB_R2.bucket_name')
  setBindingField('d1_databases', 'TB_STATE', 'database_name', d1Name, 'TB_STATE.database_name')
  setBindingField('d1_databases', 'TB_SEARCH', 'database_name', d1Name, 'TB_SEARCH.database_name')
}

console.log(`provisioning with prefix '${prefix}'${accountId ? ` (account ${accountId})` : ''}`)
applyDeployTargets()
if (configOnly) {
  if (!accountId) throw new Error('TB_PROVISION_CONFIG_ONLY=true requires CLOUDFLARE_ACCOUNT_ID')
  if (!provisionedD1Id) {
    throw new Error('TB_PROVISION_CONFIG_ONLY=true requires TB_PROVISION_D1_DATABASE_ID')
  }
  backfillBothD1Ids(provisionedD1Id)
  console.log('config-only mode: existing R2/D1 targets backfilled; resource API calls skipped')
} else {
  ensureR2()
  ensureD1()
  console.log(
    `performance: enable D1 Read Replication for '${d1Name}' in Cloudflare Dashboard → D1 → Settings; `
    + 'the gateway already uses request-scoped Sessions API and remains correct before replicas are enabled.',
  )
}
console.log('provision done.')
