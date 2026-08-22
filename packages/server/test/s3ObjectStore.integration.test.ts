/**
 * 平台对象存储 = S3/R2 兼容端点的集成测试。
 *
 * 证明 TB_OBJECT_STORE_* 配上后,context 的 `$ref` 大对象真落在 S3 而非容器本地 FS
 * —— 这是容器无状态横向扩容的前提(FS 落点多副本互不可见、容器重建即丢)。
 * 断言不只看 HTTP 通,还直接查 dataDir 下没有对象文件、且 S3 里确实有 key。
 *
 * 需要一个 S3 兼容端点(设 TB_TEST_S3_ENDPOINT 等);缺省整组 skip。本地可用 MinIO:
 *
 *   docker run -d --name tb-minio -p 9000:9000 \
 *     -e MINIO_ROOT_USER=tbminio -e MINIO_ROOT_PASSWORD=tbminio123 \
 *     minio/minio server /data
 */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { AwsClient } from 'aws4fetch'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { configFromEnv, createTbServer, type TbServer } from '../src'

const ADMIN_SK = 'tbk_server_test_admin_00000000'
const ENCRYPTION_KEY = '3ZwpbBkSrp3eT9ylcZedfN33yq9fJLlmeusH98qNbt8'

const ENDPOINT = process.env.TB_TEST_S3_ENDPOINT
const BUCKET = process.env.TB_TEST_S3_BUCKET
const ACCESS_KEY_ID = process.env.TB_TEST_S3_ACCESS_KEY_ID
const SECRET_ACCESS_KEY = process.env.TB_TEST_S3_SECRET_ACCESS_KEY
const ready = [ENDPOINT, BUCKET, ACCESS_KEY_ID, SECRET_ACCESS_KEY].every(
  v => v !== undefined && v.length > 0,
)
const suite = ready ? describe : describe.skip

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

function tmpDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-s3-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

async function startServer(
  dataDir: string,
  extraEnv: Record<string, string> = {},
): Promise<{ baseUrl: string, server: TbServer }> {
  const config = configFromEnv({
    TB_PORT: '0',
    TB_HOST: '127.0.0.1',
    TB_DATA_DIR: dataDir,
    TB_BOOTSTRAP_ADMIN_SK: ADMIN_SK,
    TB_SECRET_ENCRYPTION_KEY: ENCRYPTION_KEY,
    // MinIO 是本地 http 端点,需显式放行不安全出站。
    TB_ALLOW_INSECURE_HTTP: 'true',
    TB_OBJECT_STORE_ENDPOINT: ENDPOINT as string,
    TB_OBJECT_STORE_BUCKET: BUCKET as string,
    TB_OBJECT_STORE_ACCESS_KEY_ID: ACCESS_KEY_ID as string,
    TB_OBJECT_STORE_SECRET_ACCESS_KEY: SECRET_ACCESS_KEY as string,
    ...extraEnv,
  })
  const server = createTbServer(config)
  const { port } = await server.start()
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return await fetch(`${baseUrl}/${path}`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${ADMIN_SK}`,
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function mountNamespace(baseUrl: string, path: string): Promise<Response> {
  return await postJson(baseUrl, `${path}/~register`, {
    path,
    kind: 'context',
    description: 's3-backed platform objects',
    config: { kind: 'context', provider: 'r2' },
  })
}

async function ctxCall(
  baseUrl: string,
  path: string,
  command: string,
  args: unknown,
): Promise<Response> {
  // 直连唯一形态:命令进 URL 末段,body 即裸 arguments。
  return await postJson(baseUrl, `${path}/${command}`, args)
}

/** 直接向 S3 列举,确认对象真在桶里(绕开被测服务自己的读路径)。 */
async function listBucket(prefix: string): Promise<string[]> {
  const client = new AwsClient({
    accessKeyId: ACCESS_KEY_ID as string,
    secretAccessKey: SECRET_ACCESS_KEY as string,
    service: 's3',
    region: 'auto',
  })
  const base = (ENDPOINT as string).replace(/\/+$/, '')
  const url = `${base}/${BUCKET}?list-type=2&prefix=${encodeURIComponent(prefix)}`
  const response = await client.fetch(url)
  expect(response.status).toBe(200)
  const xml = await response.text()
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1] as string)
}

suite('平台对象存储 = S3 兼容端点', () => {
  it('context 四动词往返,对象落在 S3 而非本地 dataDir', async () => {
    const dataDir = tmpDataDir()
    const { server, baseUrl } = await startServer(dataDir)
    cleanups.push(async () => await server.close())
    expect((await mountNamespace(baseUrl, 'ctxs3/basic')).status).toBe(200)

    const write = await ctxCall(baseUrl, 'ctxs3/basic', 'write', {
      path: 's3probe.txt',
      entry: { contentType: 'text/plain', content: 's3 platform object' },
    })
    expect(write.status).toBe(200)

    const get = await ctxCall(baseUrl, 'ctxs3/basic', 'get', { path: 's3probe.txt' })
    expect(get.status).toBe(200)
    expect(((await get.json()) as { content: unknown }).content).toBe('s3 platform object')

    // 对象在桶里…
    const keys = await listBucket('ctx/ctxs3/basic')
    expect(keys.some(key => key.endsWith('s3probe.txt'))).toBe(true)

    // …而不在容器本地 FS(dataDir 下不应出现 objects/ 目录)。
    expect(readdirSync(dataDir)).not.toContain('objects')

    const del = await ctxCall(baseUrl, 'ctxs3/basic', 'delete', { path: 's3probe.txt' })
    expect(del.status).toBe(200)
    const after = await ctxCall(baseUrl, 'ctxs3/basic', 'get', { path: 's3probe.txt' })
    expect(after.status).toBe(404)
  })

  it('超阈值大对象 → $ref 用 S3 presign 直连,不经网关中转', async () => {
    const { server, baseUrl } = await startServer(tmpDataDir(), {
      TB_REF_THRESHOLD_BYTES: '16',
    })
    cleanups.push(async () => await server.close())
    expect((await mountNamespace(baseUrl, 'ctxs3/big')).status).toBe(200)

    const bigContent = 'y'.repeat(64)
    expect((await ctxCall(baseUrl, 'ctxs3/big', 'write', {
      path: 'big.txt',
      entry: { contentType: 'text/plain', content: bigContent },
    })).status).toBe(200)

    const get = await ctxCall(baseUrl, 'ctxs3/big', 'get', { path: 'big.txt' })
    expect(get.status).toBe(200)
    const entry = (await get.json()) as { content: { $ref?: string } }
    const refUrl = entry.content.$ref ?? ''

    // S3 后端支持 presign,故 $ref 指向对象存储自身而非 /~ref 中转 ——
    // 这正是外置对象存储的收益:大对象下载不再穿过网关进程。
    expect(refUrl).not.toContain('/~ref/')
    expect(refUrl).toContain(BUCKET as string)

    const download = await fetch(refUrl)
    expect(download.status).toBe(200)
    expect(await download.text()).toBe(bigContent)
  })

  /**
   * 对象内容不随容器本地卷消失。
   *
   * 注意 dataDir 复用是**必要**的:它同时装着 SQLite 状态(节点注册表)。换新 dataDir
   * 会让 `ctxs3/persist` 这个节点本身不存在而返回 404 —— 那验证的是状态存储,不是
   * 对象存储。要让状态也无状态化得配 TB_DATABASE_URL(见 pgServer.e2e)。
   * 这里只隔离对象存储这一个变量:同一状态、进程重启,对象仍在 S3。
   */
  it('进程重启后对象仍可读(对象不在容器进程内)', async () => {
    const dataDir = tmpDataDir()
    const first = await startServer(dataDir)
    expect((await mountNamespace(first.baseUrl, 'ctxs3/persist')).status).toBe(200)
    expect((await ctxCall(first.baseUrl, 'ctxs3/persist', 'write', {
      path: 'keep.txt',
      entry: { contentType: 'text/plain', content: 'survives restart' },
    })).status).toBe(200)
    await first.server.close()

    const second = await startServer(dataDir)
    cleanups.push(async () => await second.server.close())
    const get = await ctxCall(second.baseUrl, 'ctxs3/persist', 'get', { path: 'keep.txt' })
    expect(get.status).toBe(200)
    expect(((await get.json()) as { content: unknown }).content).toBe('survives restart')
    // 对象始终只在 S3,本地 dataDir 没有 objects/ 落点。
    expect(readdirSync(dataDir)).not.toContain('objects')
  })

  /**
   * 真正的"容器重建后一切都在":状态在 PG + 对象在 S3,两者都外置。
   * 这是横向扩容/无状态部署的完整形态,需要同时配 TB_DATABASE_URL 才有意义,
   * 故额外门控在 PG 可用时才跑。
   */
  it.runIf(process.env.TB_TEST_DATABASE_URL !== undefined)(
    '状态在 PG + 对象在 S3 时,换全新 dataDir 仍能读回',
    async () => {
      const databaseUrl = process.env.TB_TEST_DATABASE_URL as string
      const schema = 'tb_s3_stateless'
      const url = new URL(databaseUrl)
      url.searchParams.set('options', `-c search_path=${schema},public`)
      const admin = postgres(databaseUrl, { max: 2, onnotice: () => {} })
      await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
      await admin.unsafe(`CREATE SCHEMA ${schema}`)
      cleanups.push(async () => {
        await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
        await admin.end({ timeout: 5 })
      })
      const pgEnv = { TB_DATABASE_URL: url.toString() }

      const first = await startServer(tmpDataDir(), pgEnv)
      expect((await mountNamespace(first.baseUrl, 'ctxs3/stateless')).status).toBe(200)
      expect((await ctxCall(first.baseUrl, 'ctxs3/stateless', 'write', {
        path: 'keep.txt',
        entry: { contentType: 'text/plain', content: 'survives container rebuild' },
      })).status).toBe(200)
      await first.server.close()

      // 全新 dataDir = 容器重建,本地卷全丢。状态在 PG、对象在 S3,故都还在。
      const second = await startServer(tmpDataDir(), pgEnv)
      cleanups.push(async () => await second.server.close())
      const get = await ctxCall(second.baseUrl, 'ctxs3/stateless', 'get', { path: 'keep.txt' })
      expect(get.status).toBe(200)
      expect(((await get.json()) as { content: unknown }).content)
        .toBe('survives container rebuild')
    },
  )
})
