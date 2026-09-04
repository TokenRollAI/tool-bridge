import type { S3StoreConfig } from '@tool-bridge/app'
import type { Sql } from 'postgres'
import {
  type ObjectStore,
  type SecretStoreImpl,
  type StorageBackendView,
  type StorageManagement,
  type StoreBackendResolver,
  TBError,
} from '@tool-bridge/core'
import { randomUUID } from 'node:crypto'
import {
  createS3ObjectStore,
  type S3ObjectStore,
  type S3ObjectStoreOptions,
} from './s3Objects'
import { probeS3ObjectStore } from './s3Probe'

interface BackendRecord {
  authRef: string
  bucket: string
  credentialGeneration: number
  endpoint: string
  id: string
  name: string
  region: string
  revision: number
  validation?: StorageBackendView['validation']
}

/** The location is immutable. Only the verified credential generation may be replaced. */
export class StorageManager implements StorageManagement, StoreBackendResolver {
  private readonly drivers = new Map<string, S3ObjectStore>()

  constructor(
    private readonly sql: Sql,
    private readonly secrets: SecretStoreImpl,
    private readonly options: S3ObjectStoreOptions = {},
  ) {}

  private async record(id: string): Promise<BackendRecord> {
    const rows = await this.sql<
      { record: BackendRecord }[]
    >`SELECT record FROM tb_storage_backends WHERE id=${id}`
    if (!rows[0]) throw TBError.notFound('storage backend not found')
    return rows[0].record
  }

  private async view(record: BackendRecord): Promise<StorageBackendView> {
    const [active] = await this.sql<
      { backend_id: string, revision: number }[]
    >`SELECT backend_id, revision FROM tb_storage_active WHERE id=1`
    const safe: Omit<BackendRecord, 'authRef'> & { authRef?: string } = {
      ...record,
    }
    delete safe.authRef
    return {
      ...safe,
      active: active?.backend_id === record.id,
      activeRevision: Number(active?.revision ?? 0),
      credentialConfigured: true,
      validated:
        record.validation !== undefined
        && record.validation.cleanupSucceeded
        && Object.values(record.validation.checks).every(Boolean),
    }
  }

  async get({ id }: { id: string }): Promise<StorageBackendView> {
    return this.view(await this.record(id))
  }

  async list(): Promise<{ items: StorageBackendView[] }> {
    const rows = await this.sql<
      { record: BackendRecord }[]
    >`SELECT record FROM tb_storage_backends ORDER BY id`
    return {
      items: await Promise.all(rows.map(row => this.view(row.record))),
    }
  }

  private async connection(record: BackendRecord): Promise<S3StoreConfig> {
    const raw = await this.secrets.resolve(record.authRef)
    if (!raw)
      throw new TBError('unavailable', 'storage credentials are unavailable')
    const credential = JSON.parse(raw) as {
      accessKeyId: string
      secretAccessKey: string
    }
    return {
      endpoint: record.endpoint,
      bucket: record.bucket,
      region: record.region,
      ...credential,
    }
  }

  async resolveBackend(id: string): Promise<ObjectStore> {
    // Revision is read from the authority for every operation; notifications are not permission.
    const record = await this.record(id)
    const key = `${record.id}:${record.credentialGeneration}`
    const cached = this.drivers.get(key)
    if (cached) return cached
    const driver = createS3ObjectStore(
      await this.connection(record),
      this.options,
    )
    this.drivers.set(key, driver)
    return driver
  }

  async defaultBackend(): Promise<{ id: string, objects: ObjectStore }> {
    const [row] = await this.sql<
      { backend_id: string }[]
    >`SELECT backend_id FROM tb_storage_active WHERE id=1`
    if (!row) throw new TBError('unavailable', 'no active storage backend')
    const view = await this.get({ id: row.backend_id })
    if (!view.validated)
      throw new TBError(
        'unavailable',
        'active storage requires a successful capability test',
      )
    return {
      id: row.backend_id,
      objects: await this.resolveBackend(row.backend_id),
    }
  }

  async write(
    input: Parameters<StorageManagement['write']>[0],
  ): Promise<StorageBackendView> {
    // Constructor validates origin before any credential persistence or outbound I/O.
    const driver = createS3ObjectStore(input.connection, this.options)
    driver.close()
    const id = randomUUID()
    const authRef = `storage:${id}:1`
    await this.secrets.set(
      authRef,
      JSON.stringify({
        accessKeyId: input.connection.accessKeyId,
        secretAccessKey: input.connection.secretAccessKey,
      }),
      new Date().toISOString(),
    )
    const record: BackendRecord = {
      id,
      authRef,
      name: input.name,
      credentialGeneration: 1,
      revision: 1,
      endpoint: new URL(input.connection.endpoint).origin,
      bucket: input.connection.bucket,
      region: input.connection.region,
    }
    try {
      await this
        .sql`INSERT INTO tb_storage_backends(id,record) VALUES(${id},${this.sql.json(record as never)})`
    } catch (error) {
      await this.secrets.delete(authRef)
      throw error
    }
    return this.view(record)
  }

  private assertRevision(record: BackendRecord, revision: number): void {
    if (record.revision !== revision)
      throw new TBError('conflict', 'storage revision changed; reload first')
  }

  async test(
    input: Parameters<StorageManagement['test']>[0],
  ): Promise<StorageBackendView> {
    const record = await this.record(input.id)
    this.assertRevision(record, input.expectedRevision)
    const result = await probeS3ObjectStore(
      await this.connection(record),
      this.options,
    )
    const next: BackendRecord = {
      ...record,
      revision: record.revision + 1,
      validation: { ...result, at: new Date().toISOString() },
    }
    const rows = await this.sql`
      UPDATE tb_storage_backends SET record=${this.sql.json(next as never)}
      WHERE id=${input.id} AND (record->>'revision')::bigint=${input.expectedRevision}
    `
    if (!rows.count)
      throw new TBError('conflict', 'storage changed during validation')
    return this.view(next)
  }

  async activate(
    input: Parameters<StorageManagement['activate']>[0],
  ): Promise<StorageBackendView> {
    await this.sql.begin(async (tx) => {
      // A single advisory key also serializes creation of the initially absent pointer.
      await tx`SELECT pg_advisory_xact_lock(7283019)`
      const [active] = await tx<
        { revision: number }[]
      >`SELECT revision FROM tb_storage_active WHERE id=1 FOR UPDATE`
      if (Number(active?.revision ?? 0) !== input.expectedActiveRevision) {
        throw new TBError('conflict', 'active storage changed; reload first')
      }
      const [row] = await tx<
        { record: BackendRecord }[]
      >`SELECT record FROM tb_storage_backends WHERE id=${input.id} FOR UPDATE`
      if (!row) throw TBError.notFound('storage backend not found')
      this.assertRevision(row.record, input.expectedRevision)
      const validation = row.record.validation
      if (
        !validation
        || !validation.cleanupSucceeded
        || !Object.values(validation.checks).every(Boolean)
      ) {
        throw new TBError(
          'invalid_argument',
          'storage must pass all capability checks before activation',
        )
      }
      await tx`INSERT INTO tb_storage_active(id,backend_id,revision) VALUES(1,${input.id},1)
        ON CONFLICT(id) DO UPDATE SET backend_id=excluded.backend_id, revision=tb_storage_active.revision+1`
    })
    return this.get(input)
  }

  async update(
    input: Parameters<StorageManagement['update']>[0],
  ): Promise<StorageBackendView> {
    const record = await this.record(input.id)
    this.assertRevision(record, input.expectedRevision)
    const credentials = {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    }
    const result = await probeS3ObjectStore(
      { ...(await this.connection(record)), ...credentials },
      this.options,
    )
    if (
      !result.cleanupSucceeded
      || !Object.values(result.checks).every(Boolean)
    ) {
      throw new TBError(
        'invalid_argument',
        'replacement credentials failed storage capability checks',
      )
    }
    const authRef = `storage:${record.id}:${randomUUID()}`
    await this.secrets.set(
      authRef,
      JSON.stringify(credentials),
      new Date().toISOString(),
    )
    const next: BackendRecord = {
      ...record,
      authRef,
      credentialGeneration: record.credentialGeneration + 1,
      revision: record.revision + 1,
      validation: { ...result, at: new Date().toISOString() },
    }
    const updated = await this
      .sql`UPDATE tb_storage_backends SET record=${this.sql.json(next as never)}
      WHERE id=${input.id} AND (record->>'revision')::bigint=${input.expectedRevision}`
    if (!updated.count) {
      await this.secrets.delete(authRef)
      throw new TBError(
        'conflict',
        'storage changed during credential rotation',
      )
    }
    // Old encrypted generations remain until the recovery/in-flight retention window.
    return this.view(next)
  }

  async delete(
    input: Parameters<StorageManagement['delete']>[0],
  ): Promise<{ ok: true }> {
    try {
      await this.sql.begin(async (tx) => {
        const [row] = await tx<
          { record: BackendRecord }[]
        >`SELECT record FROM tb_storage_backends WHERE id=${input.id} FOR UPDATE`
        if (!row) throw TBError.notFound('storage backend not found')
        this.assertRevision(row.record, input.expectedRevision)
        await tx`DELETE FROM tb_storage_backends WHERE id=${input.id}`
      })
    } catch (error) {
      if ((error as { code?: string }).code === '23503') {
        throw new TBError(
          'conflict',
          'storage is active or still referenced by objects or sessions',
        )
      }
      throw error
    }
    return { ok: true }
  }

  close(): void {
    for (const driver of this.drivers.values()) driver.close()
    this.drivers.clear()
  }
}
