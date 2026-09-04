import { CreateBucketCommand, DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { Redis } from 'ioredis'

const exec = promisify(execFile)
const REQUIRED = [
  'TB_TEST_DATABASE_URL',
  'TB_TEST_REDIS_URL',
  'TB_TEST_S3_ENDPOINT',
  'TB_TEST_S3_BUCKET',
  'TB_TEST_S3_ACCESS_KEY_ID',
  'TB_TEST_S3_SECRET_ACCESS_KEY',
]

export async function startTestInfra(): Promise<{
  close(): Promise<void>
  env: NodeJS.ProcessEnv
}> {
  if (REQUIRED.every(key => process.env[key])) {
    for (const key of [
      'TB_TEST_DATABASE_URL',
      'TB_TEST_REDIS_URL',
      'TB_TEST_S3_ENDPOINT',
    ]) {
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(
          new URL(process.env[key]!).hostname,
        )
      ) {
        throw new Error(
          'Integration fixtures must use local services; remote resources are not test targets',
        )
      }
    }
    return { close: async () => {}, env: { ...process.env } }
  }
  await exec('docker', ['version'], { timeout: 15_000 }).catch(() => {
    throw new Error(
      'Server integration tests require Docker. Start Docker and retry; required contracts are never skipped.',
    )
  })
  const id = `tb-test-${randomUUID().slice(0, 8)}`
  const directory = await mkdtemp(join(tmpdir(), 'tb-infra-'))
  const containers: string[] = []
  const password = randomBytes(24).toString('hex')
  const accessKey = 'tb-local-test'
  const secretKey = randomBytes(24).toString('hex')
  const close = async () => {
    await Promise.all(
      containers.map(name =>
        exec('docker', ['rm', '-fv', name]).catch(() => {}),
      ),
    )
    await rm(directory, { recursive: true, force: true })
  }
  async function run(
    name: string,
    port: number,
    args: string[],
  ): Promise<number> {
    const container = `${id}-${name}`
    await exec(
      'docker',
      ['run', '-d', '--name', container, '-p', `127.0.0.1::${port}`, ...args],
      { timeout: 120_000 },
    )
    containers.push(container)
    const mapped = (
      await exec('docker', ['port', container, `${port}/tcp`])
    ).stdout.trim()
    return Number(mapped.slice(mapped.lastIndexOf(':') + 1))
  }
  async function ready(check: () => Promise<unknown>): Promise<void> {
    const deadline = Date.now() + 45_000
    let error: unknown
    while (Date.now() < deadline) {
      try {
        await check()
        return
      } catch (caught) {
        error = caught
      }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error('Local test infrastructure did not become ready', {
      cause: error,
    })
  }
  try {
    const configFile = join(directory, 's3.json')
    await writeFile(
      configFile,
      JSON.stringify({
        identities: [
          {
            name: 'tb-local-test',
            credentials: [{ accessKey, secretKey }],
            actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
          },
        ],
      }),
      // The private host temp directory protects this test-only secret; the read-only
      // bind mount must also be readable by SeaweedFS uid 1000 on Linux runners.
      { mode: 0o644 },
    )
    const pgPort = await run('pg', 5432, [
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      '-e',
      'POSTGRES_USER=tbtest',
      '-e',
      'POSTGRES_DB=tbtest',
      'postgres:18.4-alpine',
    ])
    const redisPort = await run('redis', 6379, ['redis:8.10.1-alpine'])
    const s3Port = await run('s3', 8333, [
      '-v',
      `${configFile}:/etc/seaweedfs/s3.json:ro`,
      'chrislusf/seaweedfs:4.45@sha256:fc9f76fa993ad69966ffeb2f65d0318fcae39c6f8e20cf68ef7b3a5cb97769e5',
      'server',
      '-s3',
      '-s3.config=/etc/seaweedfs/s3.json',
      '-dir=/data',
      '-volume.max=32',
      '-master.volumeSizeLimitMB=64',
    ])
    const databaseUrl = `postgres://tbtest:${password}@127.0.0.1:${pgPort}/tbtest`
    const redisUrl = `redis://127.0.0.1:${redisPort}`
    const endpoint = `http://127.0.0.1:${s3Port}`
    const sql = postgres(databaseUrl, {
      max: 1,
      connect_timeout: 1,
      onnotice: () => {},
    })
    try {
      await ready(() => sql`SELECT 1`)
    } finally {
      await sql.end({ timeout: 1 })
    }
    const redis = new Redis(redisUrl, {
      lazyConnect: true,
      retryStrategy: () => null,
    })
    redis.on('error', () => {})
    try {
      await ready(async () => {
        if (redis.status === 'wait' || redis.status === 'end')
          await redis.connect()
        await redis.ping()
      })
    } finally {
      redis.disconnect()
    }
    const s3 = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      maxAttempts: 1,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    })
    try {
      await ready(() => s3.send(new CreateBucketCommand({ Bucket: 'tb-test' })))
      // S3's API can bind before its data volumes become writable.
      await ready(() => s3.send(new PutObjectCommand({ Bucket: 'tb-test', Key: '__fixture_ready', Body: 'ready' })))
      await s3.send(new DeleteObjectCommand({ Bucket: 'tb-test', Key: '__fixture_ready' }))
    } finally {
      s3.destroy()
    }
    return {
      close,
      env: {
        ...process.env,
        TB_TEST_PG_CONTAINER: `${id}-pg`,
        TB_TEST_DATABASE_URL: databaseUrl,
        TB_TEST_REDIS_URL: redisUrl,
        TB_TEST_S3_ENDPOINT: endpoint,
        TB_TEST_S3_BUCKET: 'tb-test',
        TB_TEST_S3_ACCESS_KEY_ID: accessKey,
        TB_TEST_S3_SECRET_ACCESS_KEY: secretKey,
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}
