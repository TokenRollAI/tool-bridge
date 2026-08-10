import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { delimiter, join } from 'node:path'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import test from 'node:test'

const root = join(import.meta.dirname, '..')
const provisionScript = join(root, 'scripts', 'provision.mjs')

const fakeNpx = String.raw`#!/usr/bin/env node
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const statePath = process.env.TB_PROVISION_FAKE_STATE
const logPath = process.env.TB_PROVISION_FAKE_LOG
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, 'utf8'))
  : { kv: false, r2: false, d1: false }
const args = process.argv.slice(2)
if (args.shift() !== 'wrangler') process.exit(64)
const command = args.join(' ')
writeFileSync(logPath, command + '\n', { flag: 'a' })
if (command === 'kv namespace list') {
  console.log(JSON.stringify(state.kv ? [{ title: 'tb-kv', id: 'kv-id' }] : []))
} else if (command === 'kv namespace create tb-kv') {
  state.kv = true
} else if (command === 'r2 bucket list') {
  if (state.r2) console.log('name: tb-r2')
} else if (command === 'r2 bucket create tb-r2') {
  state.r2 = true
} else if (command === 'd1 list --json') {
  console.log(JSON.stringify(state.d1 ? [{ name: 'tb-search', uuid: 'd1-id' }] : []))
} else if (command === 'd1 create tb-search') {
  state.d1 = true
} else {
  console.error('unexpected fake wrangler command: ' + command)
  process.exit(64)
}
writeFileSync(statePath, JSON.stringify(state))
`

function runProvision(binDir, configPath, statePath, logPath) {
  return spawnSync(process.execPath, [provisionScript], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      TB_PROVISION_FAKE_LOG: logPath,
      TB_PROVISION_FAKE_STATE: statePath,
      TB_PROVISION_WRANGLER_CONFIG: configPath,
    },
  })
}

test('provision creates KV/R2/D1 once, backfills ids, then skips all existing resources', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tool-bridge-provision-'))
  try {
    const binDir = join(dir, 'bin')
    const npxPath = join(binDir, 'npx')
    const configPath = join(dir, 'wrangler.jsonc')
    const statePath = join(dir, 'state.json')
    const logPath = join(dir, 'calls.log')
    await mkdir(binDir)
    await writeFile(npxPath, fakeNpx)
    await chmod(npxPath, 0o755)
    await writeFile(configPath, `{
  "kv_namespaces": [{ "binding": "TB_KV", "id": "kv-placeholder" }],
  "d1_databases": [{
    "binding": "TB_SEARCH",
    "database_name": "tb-search",
    "database_id": "d1-placeholder"
  }]
}\n`)

    const first = runProvision(binDir, configPath, statePath, logPath)
    assert.equal(first.status, 0, first.stderr)
    const second = runProvision(binDir, configPath, statePath, logPath)
    assert.equal(second.status, 0, second.stderr)
    assert.match(second.stdout, /D1 database 'tb-search' exists .* — skip/)

    const calls = (await readFile(logPath, 'utf8')).trim().split('\n')
    assert.equal(calls.filter(call => call === 'kv namespace create tb-kv').length, 1)
    assert.equal(calls.filter(call => call === 'r2 bucket create tb-r2').length, 1)
    assert.equal(calls.filter(call => call === 'd1 create tb-search').length, 1)
    assert.equal(calls.filter(call => call === 'd1 list --json').length, 3)

    const config = await readFile(configPath, 'utf8')
    assert.match(config, /"binding": "TB_KV", "id": "kv-id"/)
    assert.match(config, /"database_id": "d1-id"/)
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
})
