import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { delimiter, join } from 'node:path'
import assert from 'node:assert/strict'
import { parseEnv } from 'node:util'
import { tmpdir } from 'node:os'
import test from 'node:test'

const root = join(import.meta.dirname, '..')
const provisionScript = join(root, 'scripts', 'provision.mjs')

const fakeNpx = String.raw`#!/usr/bin/env node
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const statePath = process.env.TB_PROVISION_FAKE_STATE
const logPath = process.env.TB_PROVISION_FAKE_LOG
const p = process.env.TB_PROVISION_FAKE_PREFIX || 'tb'
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, 'utf8'))
  : { r2: false, d1: false }
const args = process.argv.slice(2)
if (args.shift() !== 'wrangler') process.exit(64)
const command = args.join(' ')
writeFileSync(logPath, command + '\n', { flag: 'a' })
if (command === 'r2 bucket info ' + p + '-r2 --json') {
  if (!state.r2) {
    console.error('The specified bucket does not exist. [code: 10006]')
    process.exit(1)
  }
  console.log(JSON.stringify({ name: p + '-r2' }))
} else if (command === 'r2 bucket create ' + p + '-r2') {
  state.r2 = true
} else if (command === 'd1 list --json') {
  console.log(JSON.stringify(state.d1 ? [{ name: p + '-db', uuid: 'd1-id' }] : []))
} else if (command === 'd1 create ' + p + '-db') {
  state.d1 = true
} else {
  console.error('unexpected fake wrangler command: ' + command)
  process.exit(64)
}
writeFileSync(statePath, JSON.stringify(state))
`

// 仓库里那份 wrangler.jsonc 的相关形状(中立占位),provision 只应改这些位置。
const NEUTRAL_CONFIG = `{
  "name": "tb-gateway",
  "workers_dev": false,
  "routes": [],
  "vars": {
    "TB_CANONICAL_ORIGIN": "",
    "TB_R2_BUCKET": "tb-r2"
  },
  "d1_databases": [{
    "binding": "TB_STATE",
    "database_name": "tb-db",
    "database_id": "d1-placeholder"
  }, {
    "binding": "TB_SEARCH",
    "database_name": "tb-db",
    "database_id": "d1-placeholder"
  }],
  "r2_buckets": [{ "binding": "TB_R2", "bucket_name": "tb-r2" }]
}
`

/**
 * 环境显式清空 CLOUDFLARE_ACCOUNT_ID / TB_* :provision 的 .env 缺失项会回退到进程
 * 环境变量,开发机上导出的真实值会让断言随机漂移。TB_PROVISION_ENV_FILE 指向 fixture。
 */
function runProvision({ binDir, configPath, statePath, logPath, envFile, prefix = 'tb' }) {
  return spawnSync(process.execPath, [provisionScript], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: '',
      CLOUDFLARE_API_TOKEN: '',
      TB_BASE_URL: '',
      TB_DOMAIN: '',
      TB_NAME_PREFIX: '',
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      TB_PROVISION_ENV_FILE: envFile,
      TB_PROVISION_FAKE_LOG: logPath,
      TB_PROVISION_FAKE_PREFIX: prefix,
      TB_PROVISION_FAKE_STATE: statePath,
      TB_PROVISION_WRANGLER_CONFIG: configPath,
    },
  })
}

/** 临时工作区:fake npx(PATH 前置)+ 一份中立 wrangler.jsonc + 一份 fixture .env。 */
async function workspace(envContent) {
  const dir = await mkdtemp(join(tmpdir(), 'tool-bridge-provision-'))
  const binDir = join(dir, 'bin')
  const npxPath = join(binDir, 'npx')
  await mkdir(binDir)
  await writeFile(npxPath, fakeNpx)
  await chmod(npxPath, 0o755)
  const configPath = join(dir, 'wrangler.jsonc')
  const envFile = join(dir, 'env')
  await writeFile(configPath, NEUTRAL_CONFIG)
  await writeFile(envFile, envContent)
  return {
    dir,
    binDir,
    configPath,
    envFile,
    logPath: join(dir, 'calls.log'),
    statePath: join(dir, 'state.json'),
  }
}

test('provision creates R2/D1 once, backfills both D1 binding ids, then skips existing resources', async () => {
  const ws = await workspace('TB_NAME_PREFIX=tb\n')
  try {
    const first = runProvision(ws)
    assert.equal(first.status, 0, first.stderr)
    const second = runProvision(ws)
    assert.equal(second.status, 0, second.stderr)
    assert.match(second.stdout, /D1 database 'tb-db' exists .* — skip/)

    const calls = (await readFile(ws.logPath, 'utf8')).trim().split('\n')
    assert.equal(calls.filter(call => call === 'r2 bucket create tb-r2').length, 1)
    assert.equal(calls.filter(call => call === 'd1 create tb-db').length, 1)
    assert.equal(calls.filter(call => call === 'd1 list --json').length, 3)

    const config = JSON.parse(await readFile(ws.configPath, 'utf8'))
    // 单库两 binding:TB_STATE 与 TB_SEARCH 必须回填到同一个 database_id。
    assert.equal(config.d1_databases[0].database_id, 'd1-id')
    assert.equal(config.d1_databases[1].database_id, 'd1-id')
    // 无自定义域时必须主动打开 workers.dev，首次部署才能得到可访问入口。
    assert.equal(config.account_id, undefined)
    assert.equal(config.workers_dev, true)
    assert.deepEqual(config.routes, [])
    assert.equal(config.vars.TB_CANONICAL_ORIGIN, '')
    assert.equal(config.vars.TB_R2_S3_ENDPOINT, undefined)
    assert.match(first.stdout, /CLOUDFLARE_ACCOUNT_ID 未设置/)
    assert.match(first.stdout, /TB_DOMAIN 未设置 → 启用 workers.dev/)
  } finally {
    await rm(ws.dir, { force: true, recursive: true })
  }
})

test('provision backfills account/domain/origin and prefix-derived names from .env', async () => {
  const ws = await workspace([
    'TB_NAME_PREFIX=acme',
    'CLOUDFLARE_ACCOUNT_ID=acct123',
    'TB_DOMAIN=tb.acme.example',
    'TB_BASE_URL=https://tb.acme.example',
    '',
  ].join('\n'))
  try {
    const first = runProvision({ ...ws, prefix: 'acme' })
    assert.equal(first.status, 0, first.stderr)

    const config = JSON.parse(await readFile(ws.configPath, 'utf8'))
    assert.equal(config.account_id, 'acct123')
    assert.equal(config.workers_dev, false)
    assert.deepEqual(config.routes, [{ pattern: 'tb.acme.example', custom_domain: true }])
    assert.equal(config.vars.TB_CANONICAL_ORIGIN, 'https://tb.acme.example')
    assert.equal(config.vars.TB_R2_S3_ENDPOINT, 'https://acct123.r2.cloudflarestorage.com')
    // 前缀改了,资源名与新建资源必须一起改,否则 deploy 绑到不存在的 bucket/DB。
    assert.equal(config.vars.TB_R2_BUCKET, 'acme-r2')
    assert.equal(config.r2_buckets[0].bucket_name, 'acme-r2')
    assert.equal(config.d1_databases[0].database_name, 'acme-db')
    assert.equal(config.d1_databases[1].database_name, 'acme-db')

    const calls = (await readFile(ws.logPath, 'utf8')).trim().split('\n')
    assert.ok(calls.includes('r2 bucket create acme-r2'))
    assert.ok(calls.includes('d1 create acme-db'))

    // 幂等:同一份 .env 复跑不再改写配置。
    const second = runProvision({ ...ws, prefix: 'acme' })
    assert.equal(second.status, 0, second.stderr)
    assert.doesNotMatch(second.stdout, /已写入/)
  } finally {
    await rm(ws.dir, { force: true, recursive: true })
  }
})

test('Deploy Button collects both trust-root secrets without shipping shared defaults', async () => {
  const example = parseEnv(await readFile(join(root, 'template', '.dev.vars.example'), 'utf8'))
  assert.deepEqual(Object.keys(example).sort(), [
    'TB_BOOTSTRAP_ADMIN_SK',
    'TB_SECRET_ENCRYPTION_KEY',
  ])
  assert.equal(example.TB_BOOTSTRAP_ADMIN_SK, '')
  assert.equal(example.TB_SECRET_ENCRYPTION_KEY, '')

  const manifest = JSON.parse(await readFile(join(root, 'template', 'package.json'), 'utf8'))
  assert.match(manifest.cloudflare.bindings.TB_BOOTSTRAP_ADMIN_SK.description, /Required.*password manager/)
  assert.match(manifest.cloudflare.bindings.TB_SECRET_ENCRYPTION_KEY.description, /Required.*root key/)
})
