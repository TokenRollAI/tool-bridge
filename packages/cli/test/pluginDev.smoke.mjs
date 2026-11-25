import { access, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { execFile, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// Build cli and plugin-sdk first, then run this file with Node.js.
// An optional argument points to the compiled tb binary.
import assert from 'node:assert/strict'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { tmpdir } from 'node:os'

const exec = promisify(execFile)
const root = await mkdtemp(join(tmpdir(), 'tb-author-smoke-'))
const dir = join(root, 'hello')
const [file, ...prefix] = process.argv[2] === undefined
  ? [process.execPath, fileURLToPath(new URL('../dist/index.js', import.meta.url))]
  : [resolve(process.argv[2])]
const tb = (...args) => exec(file, [...prefix, ...args], { cwd: root, timeout: 10_000 })
const npm = (cwd, ...args) => exec(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
  cwd,
  env: { ...process.env, npm_config_cache: join(root, 'cache') },
  timeout: 20_000,
})

async function packDependencies() {
  const sdkDir = fileURLToPath(new URL('../../plugin-sdk/', import.meta.url))
  const sdk = JSON.parse(await readFile(join(sdkDir, 'package.json'), 'utf8'))
  const sdkPackage = join(root, 'sdk-package')
  await mkdir(sdkPackage)
  await cp(join(sdkDir, 'dist'), join(sdkPackage, 'dist'), { recursive: true })
  await writeFile(join(sdkPackage, 'package.json'), JSON.stringify({
    name: sdk.name,
    version: sdk.version,
    type: sdk.type,
    exports: sdk.publishConfig.exports,
    dependencies: { zod: '^4.2.0' },
  }))
  const zodPackage = fileURLToPath(new URL('.', import.meta.resolve('zod/package.json')))
  const adapter = fileURLToPath(new URL('../node_modules/@hono/node-server/', import.meta.url))
  const hono = fileURLToPath(new URL('../../app/node_modules/hono/', import.meta.url))
  const packs = [sdkPackage, zodPackage, adapter, hono].map(async (path) => {
    const { stdout } = await npm(root, 'pack', path, '--offline', '--ignore-scripts', '--json')
    return join(root, JSON.parse(stdout)[0].filename)
  })
  return await Promise.all(packs)
}

let dev
let exited
let exitResult
let stderr = ''
const events = []
async function waitFor(select) {
  for (let i = 0; i < 100; i++) {
    const result = select()
    if (result) return result
    if (exitResult) break
    await delay(100)
  }
  const error = events.find(event => event.ok === false)?.error
  throw new Error(`Local gateway did not reach the expected state. ${error ?? stderr.trim()}`)
}

try {
  await tb('plugin', 'init', dir)
  await assert.rejects(tb('plugin', 'init', dir), /already exists/)
  await npm(dir, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', ...await packDependencies())
  console.log('Scaffold and explicit offline installation passed.')

  dev = spawn(file, [...prefix, 'plugin', 'dev', '--json'], {
    cwd: dir,
    env: { ...process.env, TB_BASE_URL: 'http://127.0.0.1:1', TB_SK: 'irrelevant-profile-key' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  exited = once(dev, 'close').then((result) => {
    exitResult = result
    return result
  })
  dev.stderr.setEncoding('utf8').on('data', (line) => {
    stderr += line
  })
  createInterface({ input: dev.stdout }).on('line', line => events.push(JSON.parse(line)))
  const { envFile, source: sourceCommand } = await waitFor(() => events.find(event => event.event === 'ready'))
  assert.match(sourceCommand, /^source /)
  assert.equal((await stat(envFile)).mode & 0o777, 0o600)
  const credentials = await readFile(envFile, 'utf8')
  const baseUrl = /^export TB_BASE_URL='([^']+)'$/m.exec(credentials)?.[1]
  const sk = /^export TB_SK='(tbk_[^']+)'$/m.exec(credentials)?.[1]
  assert.ok(sk)
  assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/)
  const call = (...args) => exec(file, [...prefix, '--json', ...args], {
    cwd: root,
    env: { ...process.env, TB_BASE_URL: baseUrl, TB_SK: sk },
    timeout: 10_000,
  })
    .then(({ stdout }) => JSON.parse(stdout))
  assert.equal((await fetch(`${baseUrl}/dev/~tree`)).status, 401)
  assert.equal((await call('tree', 'dev')).children[0].path, 'dev/actions')
  assert.equal((await call('help', 'dev/actions')).cmds[0].name, 'greet')
  assert.deepEqual(await call('call', 'dev/actions/greet', '{"name":"Ada"}'), { message: 'Hello, Ada!' })
  console.log('Authenticated discovery and SDK invocation passed.')

  const entry = join(dir, 'src', 'index.js')
  const source = await readFile(entry, 'utf8')
  await writeFile(entry, 'export default {')
  await waitFor(() => stderr.includes('Still serving the previous version'))
  assert.deepEqual(await call('call', 'dev/actions/greet', '{"name":"Ada"}'), { message: 'Hello, Ada!' })
  await writeFile(entry, source.replace('\'actions\'', '\'extra\'').replace('Hello,', 'Hi,'))
  await waitFor(() => events.find(event => event.event === 'reloaded' && event.mounts.includes('dev/extra')))
  assert.equal((await fetch(`${baseUrl}/dev/actions/~help`, { headers: { authorization: `Bearer ${sk}` } })).status, 404)
  assert.deepEqual(await call('call', 'dev/extra/greet', '{"name":"Ada"}'), { message: 'Hi, Ada!' })
  console.log('Failed save kept serving the old plugin. The fixed save switched the exports with the original key.')
  assert.equal(await readFile(envFile, 'utf8'), credentials)
  assert.ok(!JSON.stringify(events).includes(sk) && !stderr.includes(sk), 'the session key must stay out of CLI output')

  dev.kill('SIGINT')
  assert.deepEqual(await exited, [0, null])
  await assert.rejects(access(envFile), { code: 'ENOENT' })
  await assert.rejects(fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(1000) }))
  console.log('SIGINT closed the gateway.')
} finally {
  if (dev && !exitResult) {
    dev.kill('SIGKILL')
    await exited
  }
  await rm(root, { recursive: true, force: true })
}
