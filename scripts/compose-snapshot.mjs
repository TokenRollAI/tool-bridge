import { chmod, lstat, mkdir, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { list as listTar } from 'tar'
import { tmpdir } from 'node:os'
import { z } from 'zod'

export const COMPOSE_FILE = fileURLToPath(new URL('../docker-compose.yml', import.meta.url))
export const VOLUMES = ['bootstrap', 'postgres-data', 'objects-data', 'pg-secrets', 's3-secrets']
const SERVICES = ['init', 'postgres', 'objects', 'init-bucket', 'app']
const RUNTIME_SERVICES = ['app', 'postgres', 'objects']
const PROJECT = /^[a-z0-9][a-z0-9_-]{0,62}$/
const DIGEST = /^sha256:[a-f0-9]{64}$/
const HASH = /^[a-f0-9]{64}$/
const imageSchema = z.strictObject({
  ref: z.string().min(1), id: z.string().regex(DIGEST), architecture: z.string().min(1),
  os: z.literal('linux'), repoDigests: z.array(z.string()),
})
const volumeSchema = z.strictObject({
  name: z.enum(VOLUMES), file: z.string(), sha256: z.string().regex(HASH), size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
})
const metadataSchema = z.strictObject({
  version: z.literal(1), createdAt: z.iso.datetime(), sourceProject: z.string().regex(PROJECT),
  instanceId: z.uuid(), composeSha256: z.string().regex(HASH), postgresMajor: z.literal(18),
  originalRunning: z.array(z.enum(RUNTIME_SERVICES)),
  images: z.strictObject(Object.fromEntries(SERVICES.map(service => [service, imageSchema]))),
  volumes: z.array(volumeSchema).length(VOLUMES.length),
})

export function projectName(value) {
  if (!PROJECT.test(value)) throw new Error('project 必须是 1–63 位小写字母、数字、下划线或连字符')
  return value
}
export function portNumber(value) {
  if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error('port 必须是 0–65535；0 使用随机 loopback 端口')
  return Number(value)
}
export function validateMetadata(value) {
  const meta = metadataSchema.parse(value)
  if (new Set(meta.volumes.map(volume => volume.name)).size !== VOLUMES.length) throw new Error('备份卷清单重复或缺失')
  for (const volume of meta.volumes) {
    if (volume.file !== `${volume.name}.tar.gz`) throw new Error('备份归档文件名不符合固定卷清单')
  }
  return meta
}

/** No shell is involved. Docker subcommands and container entrypoints are fixed by this module. */
export async function dockerCommand(args, { inputFile, outputFile, signal, allowFailure = false } = {}) {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], signal })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-65536)
  })
  let stdout = ''
  const output = outputFile === undefined
    ? (async () => {
        for await (const chunk of child.stdout) {
          stdout += chunk.toString()
          if (stdout.length > 2 * 1024 * 1024) throw new Error('Docker 元数据输出超过限制')
        }
      })()
    : pipeline(child.stdout, createWriteStream(outputFile, { flags: 'wx', mode: 0o600 }), { signal })
  const input = inputFile === undefined
    ? Promise.resolve(child.stdin.end())
    : pipeline(createReadStream(inputFile), child.stdin, { signal })
  const exit = new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('close', code => resolveExit(code ?? 1))
  })
  const stopOnStreamFailure = (error) => {
    child.kill('SIGTERM')
    throw error
  }
  const results = await Promise.allSettled([exit, input.catch(stopOnStreamFailure), output.catch(stopOnStreamFailure)])
  for (const result of results) if (result.status === 'rejected') throw result.reason
  const code = results[0].value
  if (code !== 0 && !allowFailure) throw new Error(`Docker 命令失败 (${code}): ${stderr.trim()}`)
  return { stdout, code }
}

const compose = (project, ...args) => ['compose', '--project-name', project, '--file', COMPOSE_FILE, ...args]
async function jsonCommand(run, args, signal) {
  return JSON.parse((await run(args, { signal })).stdout)
}
async function fileHash(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
async function syncFile(path) {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
async function privateJson(path, value) {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n')
    await handle.sync()
  } finally { await handle.close() }
}

export async function inspectArchive(path) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('归档必须是普通文件')
  let invalid = false
  let entries = 0
  await listTar({ file: path, strict: true, onReadEntry(entry) {
    entries++
    const name = entry.path
    if (!['File', 'Directory'].includes(entry.type) || entry.linkpath
      || name.startsWith('/') || /^[a-z]:/i.test(name) || /[\\\0\r\n]/.test(name)
      || name.split('/').includes('..')) invalid = true
  } })
  if (invalid || entries === 0) throw new Error('归档包含不支持的路径、链接或特殊文件；默认卷快照只接受普通文件和目录')
}

async function configuredLayout(project, run, signal) {
  const config = await jsonCommand(run, compose(project, 'config', '--format', 'json'), signal)
  for (const name of SERVICES) if (!config.services?.[name]?.image) throw new Error(`Compose 缺少固定服务 ${name}`)
  if (!config.services.postgres.image.startsWith('postgres:18.')) throw new Error('仅支持默认 PostgreSQL 18 Compose 布局')
  const volumes = {}
  for (const name of VOLUMES) {
    const volume = config.volumes?.[name]
    if (volume?.name !== `${project}_${name}` || volume.external) throw new Error(`卷 ${name} 不是该隔离 Compose project 的默认 named volume`)
    volumes[name] = volume.name
  }
  const mounts = [['app', 'bootstrap', '/data'], ['postgres', 'postgres-data', '/var/lib/postgresql'],
    ['postgres', 'pg-secrets', '/run/tb-postgres'], ['objects', 'objects-data', '/data'], ['objects', 's3-secrets', '/run/tb-s3']]
  for (const [service, source, target] of mounts) {
    if (!config.services[service].volumes?.some(volume => volume.type === 'volume' && volume.source === source && volume.target === target)) {
      throw new Error(`服务 ${service} 的持久卷挂载不符合默认布局`)
    }
  }
  if (config.networks?.default?.name !== `${project}_default` || config.networks.default.external) throw new Error('默认网络未按 project 隔离，拒绝跨实例 DNS/数据库访问')
  return { config, volumes }
}
async function configuredImages(config, run, signal) {
  const inspected = new Map()
  const images = {}
  for (const service of SERVICES) {
    const ref = config.services[service].image
    let image = inspected.get(ref)
    if (!image) {
      const [record] = await jsonCommand(run, ['image', 'inspect', ref], signal)
      image = imageSchema.parse({ ref, id: record.Id, architecture: record.Architecture, os: record.Os, repoDigests: record.RepoDigests ?? [] })
      inspected.set(ref, image)
    }
    images[service] = image
  }
  return images
}
async function containers(project, run, signal) {
  const result = {}
  for (const service of SERVICES) {
    const ids = (await run(compose(project, 'ps', '--all', '--quiet', service), { signal })).stdout.trim().split(/\s+/).filter(Boolean)
    if (ids.length > 1) throw new Error('物理快照只支持默认单副本 Compose')
    if (ids.length === 1) {
      const [container] = await jsonCommand(run, ['inspect', ids[0]], signal)
      if (container.Config.Labels?.['com.docker.compose.project'] !== project
        || container.Config.Labels?.['com.docker.compose.service'] !== service) throw new Error('容器不属于指定的 project/service')
      result[service] = container
    }
  }
  return result
}
async function validateVolumes(project, names, run, signal, allowMissing = false) {
  const listed = (await run(['volume', 'ls', '--format', '{{json .}}'], { signal })).stdout.trim()
  const existing = new Set(listed === '' ? [] : listed.split('\n').map(line => JSON.parse(line).Name))
  for (const name of VOLUMES) {
    if (!existing.has(names[name])) {
      if (allowMissing) continue
      throw new Error(`缺少目标卷 ${names[name]}`)
    }
    const [volume] = await jsonCommand(run, ['volume', 'inspect', names[name]], signal)
    if (volume.Labels?.['com.docker.compose.project'] !== project || volume.Labels?.['com.docker.compose.volume'] !== name) {
      throw new Error('拒绝访问不属于指定 Compose project 的卷')
    }
  }
}
async function assertNoForeignMounts(project, volumes, run, signal, allStopped = false) {
  const ids = new Set()
  for (const volume of Object.values(volumes)) {
    const output = (await run(['ps', '--quiet', '--filter', `volume=${volume}`], { signal })).stdout.trim()
    for (const id of output.split(/\s+/).filter(Boolean)) ids.add(id)
  }
  for (const id of ids) {
    const [container] = await jsonCommand(run, ['inspect', id], signal)
    if (allStopped || container.Config.Labels?.['com.docker.compose.project'] !== project
      || !RUNTIME_SERVICES.includes(container.Config.Labels?.['com.docker.compose.service'])) {
      throw new Error('持久卷还被其他运行容器使用，拒绝非独占物理快照或替换')
    }
  }
}
function assertNoInitializerRunning(records) {
  if (records.init?.State.Running || records['init-bucket']?.State.Running) throw new Error('初始化服务仍在运行，请等待安装完成后再做物理快照')
}
async function helper(run, image, volume, entrypoint, args, options = {}) {
  const name = `tb-snapshot-${randomUUID()}`
  try {
    return await run(['run', '--rm', ...(options.inputFile ? ['--interactive'] : []), '--name', name, '--network', options.network ?? 'none', ...(options.environment ? ['--env', options.environment] : []), '--read-only', '--user', '0:0',
      '--mount', `type=volume,source=${volume},target=/snapshot${options.write ? '' : ',readonly'}`,
      '--entrypoint', entrypoint, image, ...args], options)
  } finally {
    await run(['rm', '--force', name], { allowFailure: true }).catch(() => {})
  }
}
async function identity(run, image, volume, signal) {
  const code = 'try{const fs=require(\'node:fs\');const root=JSON.parse(fs.readFileSync(\'/snapshot/bootstrap/identity.json\',\'utf8\'));const marker=JSON.parse(fs.readFileSync(\'/snapshot/bootstrap/initialized.json\',\'utf8\'));const state=JSON.parse(fs.readFileSync(\'/snapshot/bootstrap/bootstrap.json\',\'utf8\'));const url=new URL(state.databaseUrl);if(marker.instanceId!==root.instanceId||state.instanceId!==root.instanceId||url.hostname!==\'postgres\'||(url.port&&url.port!==\'5432\')||url.pathname!==\'/toolbridge\'||url.search)throw Error();process.stdout.write(JSON.stringify({instanceId:root.instanceId}));}catch{process.stderr.write(\'default Compose bootstrap identity/storage check failed\');process.exit(1)}'
  const result = await helper(run, image, volume, 'node', ['-e', code], { signal })
  return z.strictObject({ instanceId: z.uuid() }).parse(JSON.parse(result.stdout)).instanceId
}
async function stopServices(project, run, signal, override, requireClean = true, beforeDataStop) {
  const base = override === undefined ? [] : ['--file', override]
  await run(compose(project, ...base, 'stop', '--timeout', '300', 'app'), { signal })
  await beforeDataStop?.()
  await run(compose(project, ...base, 'stop', '--timeout', '120', 'postgres', 'objects'), { signal })
  const stopped = await containers(project, run, signal)
  if (RUNTIME_SERVICES.some(service => stopped[service]?.State.Running)) throw new Error('服务未完全停止，拒绝读取或替换卷')
  if (requireClean && stopped.postgres && stopped.postgres.State.ExitCode !== 0) throw new Error('PostgreSQL 未正常关闭，拒绝声明一致的物理快照')
}
async function verifyInternalAuthority(run, postgresId, instanceId, signal) {
  const query = 'SELECT json_build_object(\'instanceId\',(SELECT instance_id FROM tb_instance WHERE id=1),\'endpoints\',COALESCE((SELECT json_agg(record->>\'endpoint\') FROM tb_storage_backends),\'[]\'::json))'
  const result = await run(['exec', postgresId, 'psql', '--no-psqlrc', '--username', 'postgres', '--dbname', 'toolbridge',
    '--no-align', '--tuples-only', '--set', 'ON_ERROR_STOP=1', '--command', query], { signal })
  const authority = JSON.parse(result.stdout)
  if (authority.instanceId !== instanceId || !Array.isArray(authority.endpoints) || authority.endpoints.length === 0
    || authority.endpoints.some(endpoint => endpoint !== 'http://objects:8333')) {
    throw new Error('物理快照只支持身份一致的默认内置 PG/S3；外部数据库或桶必须另行备份')
  }
}
async function startOriginal(project, services, run, override) {
  const base = override === undefined ? [] : ['--file', override]
  const infrastructure = ['postgres', 'objects'].filter(service => services.includes(service))
  if (infrastructure.length > 0) await run(compose(project, ...base, 'start', ...infrastructure))
  if (services.includes('app')) await run(compose(project, ...base, 'start', 'app'))
}
async function captureVolume(run, image, volume, output, signal) {
  const partial = `${output}.partial`
  await helper(run, image, volume, 'tar', ['--numeric-owner', '-C', '/snapshot', '-czpf', '-', '.'], { outputFile: partial, signal })
  await chmod(partial, 0o600)
  await inspectArchive(partial)
  await syncFile(partial)
  await rename(partial, output)
  return { size: (await lstat(output)).size, sha256: await fileHash(output) }
}
async function replaceVolume(run, image, volume, archive, signal) {
  const clear = 'const fs=require(\'node:fs/promises\');(async()=>{for(const name of await fs.readdir(\'/snapshot\'))await fs.rm(\'/snapshot/\'+name,{recursive:true,force:true});})().catch(()=>process.exit(1));'
  await helper(run, image, volume, 'node', ['-e', clear], { write: true, signal })
  await helper(run, image, volume, 'tar', ['--numeric-owner', '--same-owner', '--same-permissions', '-C', '/snapshot', '-xzpf', '-'], { write: true, inputFile: archive, signal })
}

export async function backupCompose({ project, out, signal }, run = dockerCommand) {
  projectName(project)
  const directory = resolve(out)
  const layout = await configuredLayout(project, run, signal)
  const images = await configuredImages(layout.config, run, signal)
  const records = await containers(project, run, signal)
  assertNoInitializerRunning(records)
  for (const service of RUNTIME_SERVICES) {
    if (!records[service] || records[service].Image !== images[service].id) throw new Error('源服务缺失或镜像与当前 Compose 版本不一致')
  }
  if (!records.postgres.State.Running) throw new Error('源 PostgreSQL 必须运行，以便验证实例及内置存储归属')
  await validateVolumes(project, layout.volumes, run, signal)
  await assertNoForeignMounts(project, layout.volumes, run, signal)
  const instanceId = await identity(run, images.app.id, layout.volumes.bootstrap, signal)
  const originalRunning = RUNTIME_SERVICES.filter(service => records[service].State.Running)
  await mkdir(dirname(directory), { recursive: true, mode: 0o700 })
  await mkdir(directory, { mode: 0o700 })
  const meta = { version: 1, createdAt: new Date().toISOString(), sourceProject: project, instanceId,
    composeSha256: await fileHash(COMPOSE_FILE), postgresMajor: 18, originalRunning, images, volumes: [] }
  try {
    console.log('停止应用与 PG/S3，创建一致的持久卷快照…')
    await stopServices(project, run, signal, undefined, true, () => verifyInternalAuthority(run, records.postgres.Id, instanceId, signal))
    await assertNoForeignMounts(project, layout.volumes, run, signal, true)
    for (const name of VOLUMES) {
      const file = `${name}.tar.gz`
      const details = await captureVolume(run, images.app.id, layout.volumes[name], join(directory, file), signal)
      meta.volumes.push({ name, file, ...details })
    }
    await privateJson(join(directory, 'meta.json'), validateMetadata(meta))
    await syncFile(directory)
  } finally {
    await startOriginal(project, originalRunning, run)
  }
  return { directory, instanceId }
}

export async function verifySnapshot(directoryInput) {
  const directory = resolve(directoryInput)
  const info = await lstat(join(directory, 'meta.json'))
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576) throw new Error('备份元数据文件无效')
  const meta = validateMetadata(JSON.parse(await readFile(join(directory, 'meta.json'), 'utf8')))
  if (await fileHash(COMPOSE_FILE) !== meta.composeSha256) throw new Error('Compose 文件与备份版本不同；请使用创建备份时的仓库版本')
  for (const volume of meta.volumes) {
    const path = join(directory, volume.file)
    const file = await lstat(path)
    if (!file.isFile() || file.isSymbolicLink() || file.size !== volume.size || await fileHash(path) !== volume.sha256) throw new Error(`卷 ${volume.name} 的大小或 SHA-256 校验失败`)
    await inspectArchive(path)
  }
  return { directory, meta }
}
function existingPort(record) {
  const bindings = record?.HostConfig.PortBindings?.['8787/tcp']
  if (!bindings) return undefined
  if (bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1') throw new Error('目标应用端口不是默认单一 loopback 绑定')
  return portNumber(bindings[0].HostPort)
}
async function s3DataReady(project, postgresId, storage, run, signal) {
  const query = 'SELECT COALESCE(json_agg(DISTINCT record->>\'bucket\'),\'[]\'::json) FROM tb_storage_backends WHERE id=(SELECT backend_id FROM tb_storage_active WHERE id=1) OR id IN (SELECT backend_id FROM tb_store_objects WHERE status=\'ready\')'
  const raw = await run(['exec', postgresId, 'psql', '--no-psqlrc', '--username', 'postgres', '--dbname', 'toolbridge',
    '--no-align', '--tuples-only', '--set', 'ON_ERROR_STOP=1', '--command', query], { signal })
  const buckets = JSON.parse(raw.stdout)
  if (!Array.isArray(buckets) || buckets.length === 0 || buckets.some(bucket => typeof bucket !== 'string')) return false
  // HEAD only proves filer metadata is ready. A bounded GET also needs volume registration.
  // Credentials stay inside the read-only mounted secret volume and never appear in argv/output.
  const code = `const fs=require('node:fs');const req=require('node:module').createRequire('/app/package.json');
const {S3Client,ListObjectsV2Command,HeadObjectCommand,GetObjectCommand}=req('@aws-sdk/client-s3');
const {NodeHttpHandler}=req('@smithy/node-http-handler');
(async()=>{const raw=JSON.parse(fs.readFileSync('/snapshot/admin.json','utf8'));
const client=new S3Client({endpoint:'http://objects:8333',region:'us-east-1',forcePathStyle:true,maxAttempts:1,
credentials:{accessKeyId:raw.accessKeyId,secretAccessKey:raw.secretAccessKey},requestHandler:new NodeHttpHandler({connectionTimeout:1000,requestTimeout:2000})});
try{for(const Bucket of JSON.parse(process.env.TB_SNAPSHOT_BUCKETS)){
const listed=await client.send(new ListObjectsV2Command({Bucket,MaxKeys:1}),{abortSignal:AbortSignal.timeout(2000)});
const Key=listed.Contents?.[0]?.Key;if(Key===undefined)continue;
const head=await client.send(new HeadObjectCommand({Bucket,Key}),{abortSignal:AbortSignal.timeout(2000)});
const response=await client.send(new GetObjectCommand({Bucket,Key,...(head.ContentLength>0?{Range:'bytes=0-0'}:{})}),{abortSignal:AbortSignal.timeout(2000)});
let bytes=0;for await(const chunk of response.Body){bytes+=chunk.length;break;}if(head.ContentLength>0&&bytes===0)throw Error();}
process.stdout.write('ready');}finally{client.destroy();}})().catch(()=>{process.stderr.write('S3 data path not ready');process.exitCode=2});`
  const result = await helper(run, storage.image, storage.volume, 'node', ['-e', code], {
    network: `${project}_default`, environment: `TB_SNAPSHOT_BUCKETS=${JSON.stringify(buckets)}`, allowFailure: true, signal,
  })
  return result.code === 0
}
export async function waitRestoredReady(project, expectedIdentity, run, signal, storage, {
  attempts = 60, fetcher = fetch, pause = () => delay(1000, undefined, { signal }),
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal?.throwIfAborted()
    const records = await containers(project, run, signal)
    const binding = records.app?.NetworkSettings.Ports?.['8787/tcp']?.[0]
    if (binding?.HostIp === '127.0.0.1' && /^\d+$/.test(binding.HostPort)) {
      const baseUrl = `http://127.0.0.1:${binding.HostPort}`
      try {
        const response = await fetcher(`${baseUrl}/~setup/status`, { signal: AbortSignal.any([AbortSignal.timeout(2000), ...(signal ? [signal] : [])]) })
        if (response.ok) {
          const status = await response.json()
          if (status.state === 'ready' && status.instanceId === expectedIdentity) {
            const readiness = await fetcher(`${baseUrl}/readyz`, { signal: AbortSignal.any([AbortSignal.timeout(2000), ...(signal ? [signal] : [])]) })
            if (readiness.ok && (await readiness.json()).ready === true
              && await s3DataReady(project, records.postgres.Id, storage, run, signal)) return baseUrl
          }
          if (status.instanceId && status.instanceId !== expectedIdentity) throw new Error('恢复后的实例身份不匹配')
        }
      } catch (error) {
        if (error.message === '恢复后的实例身份不匹配') throw error
      }
    }
    await pause()
  }
  throw new Error('恢复后的应用未就绪，将回滚目标卷')
}

export async function restoreCompose({ project, from, replace, port, signal }, run = dockerCommand) {
  projectName(project)
  if (!replace) throw new Error('恢复必须显式传入 --replace，授权替换指定隔离 project 的卷')
  const { directory, meta } = await verifySnapshot(from)
  if (project === meta.sourceProject || project === 'tool-bridge') throw new Error('仅允许恢复至不同于源项目和默认 tool-bridge 的隔离 project')
  const layout = await configuredLayout(project, run, signal)
  const images = await configuredImages(layout.config, run, signal)
  for (const service of SERVICES) {
    const actual = images[service]
    const expected = meta.images[service]
    if (actual.ref !== expected.ref || actual.id !== expected.id || actual.architecture !== expected.architecture || actual.os !== expected.os) {
      throw new Error(`服务 ${service} 的镜像与备份不一致；PostgreSQL 物理恢复必须使用完全相同的镜像`)
    }
  }
  await validateVolumes(project, layout.volumes, run, signal, true)
  await assertNoForeignMounts(project, layout.volumes, run, signal)
  const previous = await containers(project, run, signal)
  assertNoInitializerRunning(previous)
  for (const service of RUNTIME_SERVICES) if (previous[service] && previous[service].Image !== images[service].id) throw new Error('现有目标服务镜像与备份不一致')
  const previousPort = existingPort(previous.app)
  if (previousPort !== undefined && port !== undefined && port !== previousPort) throw new Error('恢复已有目标时保留原端口；--port 只为新项目选择端口')
  const chosenPort = port ?? previousPort ?? 0
  const rollback = await mkdtemp(join(tmpdir(), 'tb-compose-restore-'))
  await chmod(rollback, 0o700)
  const override = join(rollback, 'restore.yml')
  await privateJson(join(rollback, 'restore-metadata.json'), { project, createdAt: new Date().toISOString() })
  const overrideHandle = await open(override, 'wx', 0o600)
  try {
    await overrideHandle.writeFile(`services:\n  app:\n    ports: !override\n      - "127.0.0.1:${chosenPort}:8787"\n`)
  } finally { await overrideHandle.close() }
  const base = ['--file', override]
  const originalRunning = RUNTIME_SERVICES.filter(service => previous[service]?.State.Running)
  let targetStopped = false
  let modified = false
  let retainRollback = false
  try {
    await run(compose(project, ...base, 'create', '--no-build', '--no-recreate', '--pull', 'never', ...SERVICES), { signal })
    await validateVolumes(project, layout.volumes, run, signal)
    targetStopped = true
    await stopServices(project, run, signal, override)
    await assertNoForeignMounts(project, layout.volumes, run, signal, true)
    for (const name of VOLUMES) await captureVolume(run, images.app.id, layout.volumes[name], join(rollback, `${name}.tar.gz`), signal)
    console.log('校验已通过，替换指定隔离项目的卷…')
    modified = true
    for (const volume of meta.volumes) await replaceVolume(run, images.app.id, layout.volumes[volume.name], join(directory, volume.file), signal)
    await run(compose(project, ...base, 'up', '--detach', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '120', 'postgres', 'objects'), { signal })
    await run(compose(project, ...base, 'up', '--detach', '--no-deps', '--no-build', '--pull', 'never', 'app'), { signal })
    const baseUrl = await waitRestoredReady(project, meta.instanceId, run, signal, { image: images.app.id, volume: layout.volumes['s3-secrets'] })
    return { project, baseUrl, instanceId: meta.instanceId }
  } catch (error) {
    if (modified) {
      try {
        await stopServices(project, run, undefined, override, false)
        for (const name of VOLUMES) await replaceVolume(run, images.app.id, layout.volumes[name], join(rollback, `${name}.tar.gz`))
      } catch {
        retainRollback = true
        throw new Error(`恢复与目标回滚均失败；目标保持停止，人工恢复快照位于 ${rollback}`, { cause: error })
      }
    }
    if (targetStopped) await startOriginal(project, originalRunning, run, override)
    throw error
  } finally {
    if (!retainRollback) await rm(rollback, { recursive: true, force: true })
  }
}
