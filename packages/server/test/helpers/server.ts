import type { S3StoreConfig } from '@tool-bridge/app'
import { runtimeConfigSchema } from '@tool-bridge/core'
import { createHash, randomUUID } from 'node:crypto'
import { afterAll } from 'vitest'
import postgres from 'postgres'
import type { ServerConfig } from '../../src/config'

const schemas = new Set<string>()

export function testS3Config(): S3StoreConfig {
  const endpoint = process.env.TB_TEST_S3_ENDPOINT
  const bucket = process.env.TB_TEST_S3_BUCKET
  const accessKeyId = process.env.TB_TEST_S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.TB_TEST_S3_SECRET_ACCESS_KEY
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey)
    throw new Error('S3 integration fixture was not initialized')
  return { endpoint, bucket, accessKeyId, secretAccessKey }
}

export async function testServerConfig(
  overrides: Partial<ServerConfig> = {},
): Promise<ServerConfig> {
  const database = process.env.TB_TEST_DATABASE_URL
  if (!database) throw new Error('PG integration fixture was not initialized')
  const schema = `tb_http_${createHash('sha256')
    .update(overrides.dataDir ?? randomUUID())
    .digest('hex')
    .slice(0, 20)}`
  const url = new URL(database)
  if (!overrides.databaseUrl && !schemas.has(schema)) {
    const admin = postgres(database, { max: 1, onnotice: () => {} })
    try {
      await admin.unsafe(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
    } finally {
      await admin.end({ timeout: 1 })
    }
    schemas.add(schema)
  }
  url.searchParams.set('options', `-c search_path=${schema},public`)
  const s3 = testS3Config()
  return {
    databaseUrl: url.toString(),
    encryptionKey: '3ZwpbBkSrp3eT9ylcZedfN33yq9fJLlmeusH98qNbt8',
    dataDir: overrides.dataDir ?? `/tmp/${schema}`,
    host: '127.0.0.1',
    port: 0,
    adminSk: 'tbk_server_test_admin_00000000',
    allowInsecureHttp: true,
    deviceReclaimSec: 86_400,
    storeCleanupIntervalSec: 900,
    remote: { allowlist: [], maxHops: 4, allowInsecure: true },
    objectStore: s3,
    internalS3Origin: s3.endpoint,
    ...overrides,
    managedSettings:
      overrides.managedSettings
      ?? runtimeConfigSchema.parse(
        Object.fromEntries(
          Object.keys(runtimeConfigSchema.shape)
            .filter(key => overrides[key as keyof ServerConfig] !== undefined)
            .map(key => [key, overrides[key as keyof ServerConfig]]),
        ),
      ),
  }
}

afterAll(async () => {
  if (!schemas.size) return
  const admin = postgres(process.env.TB_TEST_DATABASE_URL!, {
    max: 1,
    onnotice: () => {},
  })
  try {
    for (const schema of schemas)
      await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  } finally {
    await admin.end({ timeout: 2 })
  }
})
