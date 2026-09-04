import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { create as createTar } from 'tar'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { backupCompose, COMPOSE_FILE, inspectArchive, projectName, restoreCompose, validateMetadata, verifySnapshot, VOLUMES, waitRestoredReady } from './compose-snapshot.mjs'

const instanceId = '00000000-0000-4000-8000-000000000001'
const image = (ref, digit) => ({ ref, id: `sha256:${digit.repeat(64)}`, architecture: 'arm64', os: 'linux', repoDigests: [] })
const app = image('tool-bridge:local', 'a')
const images = { 'init': app, app, 'init-bucket': app, 'postgres': image('postgres:18.4-bookworm', 'b'), 'objects': image('seaweed:test', 'c') }
const digest = value => createHash('sha256').update(value).digest('hex')

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'tb-backup-test-'))
  try {
    const directory = join(root, 'backup')
    const content = join(root, 'content')
    await mkdir(directory, { mode: 0o700 })
    await mkdir(content)
    await writeFile(join(content, 'data'), 'persistent-data', { mode: 0o600 })
    const volumes = []
    for (const name of VOLUMES) {
      const file = `${name}.tar.gz`
      await createTar({ file: join(directory, file), cwd: content, gzip: true }, ['.'])
      const data = await readFile(join(directory, file))
      volumes.push({ name, file, size: data.length, sha256: digest(data) })
    }
    const meta = { version: 1, createdAt: new Date().toISOString(), sourceProject: 'source', instanceId,
      composeSha256: digest(await readFile(COMPOSE_FILE)), postgresMajor: 18,
      originalRunning: ['app', 'postgres', 'objects'], images, volumes }
    await writeFile(join(directory, 'meta.json'), JSON.stringify(meta), { mode: 0o600 })
    await run({ root, directory, content, meta })
  } finally { await rm(root, { recursive: true, force: true }) }
}
function layout(project) {
  const services = Object.fromEntries(Object.entries(images).map(([service, record]) => [service, { image: record.ref, volumes: [] }]))
  for (const [service, source, target] of [['app', 'bootstrap', '/data'], ['postgres', 'postgres-data', '/var/lib/postgresql'],
    ['postgres', 'pg-secrets', '/run/tb-postgres'], ['objects', 'objects-data', '/data'], ['objects', 's3-secrets', '/run/tb-s3']]) {
    services[service].volumes.push({ type: 'volume', source, target })
  }
  return { services, volumes: Object.fromEntries(VOLUMES.map(name => [name, { name: `${project}_${name}` }])), networks: { default: { name: `${project}_default` } } }
}
const json = value => ({ stdout: JSON.stringify(value), code: 0 })

test('rejects unsafe project names and ambiguous volume manifests', async () => {
  for (const name of ['../prod', '--project', 'A', '$(touch x)', 'a;rm', '']) assert.throws(() => projectName(name))
  assert.equal(projectName('isolated-restore_01'), 'isolated-restore_01')
  await fixture(async ({ meta }) => {
    assert.throws(() => validateMetadata({ ...meta, volumes: [...meta.volumes.slice(0, 4), meta.volumes[0]] }))
    assert.throws(() => validateMetadata({ ...meta, volumes: meta.volumes.map((volume, i) => i === 0 ? { ...volume, file: '../../escape' } : volume) }))
  })
})

test('validates every archive and rejects links before Docker receives any mutation', async () => {
  await fixture(async ({ directory, content }) => {
    assert.equal((await verifySnapshot(directory)).meta.instanceId, instanceId)
    await symlink('../outside', join(content, 'link'))
    const archive = join(directory, 'unsafe.tar.gz')
    await createTar({ file: archive, cwd: content, gzip: true }, ['.'])
    await assert.rejects(inspectArchive(archive), /路径、链接或特殊文件/)
  })
})

test('missing --replace, source project, and checksum tampering never call Docker', async () => {
  const never = async () => {
    throw new Error('Docker must not be called')
  }
  await assert.rejects(restoreCompose({ project: 'isolated', from: '/missing' }, never), /--replace/)
  await fixture(async ({ directory }) => {
    await assert.rejects(restoreCompose({ project: 'source', from: directory, replace: true }, never), /隔离 project/)
    await writeFile(join(directory, 'bootstrap.tar.gz'), 'corrupt')
    await assert.rejects(restoreCompose({ project: 'isolated', from: directory, replace: true }, never), /SHA-256/)
  })
})

test('image mismatch is rejected before creating or stopping target services', async () => {
  await fixture(async ({ directory }) => {
    const calls = []
    const run = async (args) => {
      calls.push(args)
      if (args.includes('config')) return json(layout('isolated'))
      if (args[0] === 'image') {
        const record = Object.values(images).find(candidate => candidate.ref === args[2])
        return json([{ Id: `sha256:${'f'.repeat(64)}`, Architecture: record.architecture, Os: record.os, RepoDigests: [] }])
      }
      throw new Error('unexpected Docker mutation')
    }
    await assert.rejects(restoreCompose({ project: 'isolated', from: directory, replace: true }, run), /镜像与备份不一致/)
    assert.equal(calls.some(args => args.includes('stop') || args.includes('create')), false)
  })
})

test('failed archive creation restarts exactly the original services and keeps partial files private', async () => {
  await fixture(async ({ root }) => {
    const running = new Set(['app', 'postgres', 'objects'])
    const calls = []
    const project = 'source'
    const run = async (args, options = {}) => {
      calls.push(args)
      if (args[0] === 'compose') {
        if (args.includes('config')) return json(layout(project))
        if (args.includes('ps')) return { stdout: `container-${args.at(-1)}`, code: 0 }
        if (args.includes('stop')) {
          for (const service of ['app', 'postgres', 'objects']) if (args.includes(service)) running.delete(service)
          return { stdout: '', code: 0 }
        }
        if (args.includes('start')) {
          for (const service of ['app', 'postgres', 'objects']) if (args.includes(service)) running.add(service)
          return { stdout: '', code: 0 }
        }
      }
      if (args[0] === 'image') {
        const record = Object.values(images).find(candidate => candidate.ref === args[2])
        return json([{ Id: record.id, Architecture: record.architecture, Os: record.os, RepoDigests: [] }])
      }
      if (args[0] === 'inspect') {
        const service = args[1].slice('container-'.length)
        return json([{ Id: args[1], Image: images[service].id, State: { Running: running.has(service), ExitCode: 0 },
          Config: { Labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': service } } }])
      }
      if (args[0] === 'volume' && args[1] === 'ls') return { stdout: VOLUMES.map(name => JSON.stringify({ Name: `${project}_${name}` })).join('\n'), code: 0 }
      if (args[0] === 'volume') return json([{ Labels: { 'com.docker.compose.project': project, 'com.docker.compose.volume': args[2].slice(project.length + 1) } }])
      if (args[0] === 'exec') return json({ instanceId, endpoints: ['http://objects:8333'] })
      if (args[0] === 'ps') return { stdout: '', code: 0 }
      if (args[0] === 'rm') return { stdout: '', code: 0 }
      if (args[0] === 'run' && options.outputFile) {
        await writeFile(options.outputFile, 'invalid archive', { flag: 'wx', mode: 0o600 })
        return { stdout: '', code: 0 }
      }
      if (args[0] === 'run') return json({ instanceId })
      throw new Error('unexpected command')
    }
    const out = join(root, 'failed-snapshot')
    await assert.rejects(backupCompose({ project, out }, run))
    assert.deepEqual([...running].sort(), ['app', 'objects', 'postgres'])
    assert.deepEqual(calls.filter(args => args.includes('stop')).map(args => args.slice(args.indexOf('stop'))), [
      ['stop', '--timeout', '300', 'app'], ['stop', '--timeout', '120', 'postgres', 'objects'],
    ])
    assert.equal((await stat(out)).mode & 0o777, 0o700)
    assert.equal((await stat(join(out, 'bootstrap.tar.gz.partial'))).mode & 0o777, 0o600)
    await assert.rejects(readFile(join(out, 'meta.json')))
  })
})

test('HTTP and HEAD readiness cannot report recovery complete when the S3 data probe fails', async () => {
  let probeCode = 2
  let probes = 0
  const run = async (args) => {
    if (args[0] === 'compose') return { stdout: `container-${args.at(-1)}`, code: 0 }
    if (args[0] === 'inspect') {
      const service = args[1].slice('container-'.length)
      return json([{ Id: args[1], Config: { Labels: { 'com.docker.compose.project': 'isolated', 'com.docker.compose.service': service } },
        NetworkSettings: { Ports: { '8787/tcp': [{ HostIp: '127.0.0.1', HostPort: '12345' }] } } }])
    }
    if (args[0] === 'exec') return json(['tb-objects'])
    if (args[0] === 'rm') return { stdout: '', code: 0 }
    if (args[0] === 'run') {
      probes++
      assert.equal(args[args.indexOf('--network') + 1], 'isolated_default')
      return { stdout: '', code: probeCode }
    }
    throw new Error('unexpected command')
  }
  const fetcher = async url => new Response(JSON.stringify(url.endsWith('/readyz')
    ? { ready: true, checks: { objects: { ok: true } } }
    : { state: 'ready', instanceId }))
  const options = { attempts: 1, pause: async () => {}, fetcher }
  const storage = { image: app.id, volume: 'isolated_s3-secrets' }
  await assert.rejects(waitRestoredReady('isolated', instanceId, run, undefined, storage, options), /未就绪/)
  assert.equal(probes, 1)
  probeCode = 0
  assert.equal(await waitRestoredReady('isolated', instanceId, run, undefined, storage, options), 'http://127.0.0.1:12345')
})
