import type * as http from 'node:http'
import {
  isTBError,
  recoveryInputSchema,
  runtimeConfigSchema,
  type SetupInput,
  setupInputSchema,
  statusForCode,
  TBError,
  validateEncryptionKeyring,
  validateStoreTokenKeyring,
} from '@tool-bridge/core'
import { BUILTIN_CATALOG, builtinPluginBindings } from '@tool-bridge/plugins'
import { serve, type ServerType } from '@hono/node-server'
import { secureHeaders } from 'hono/secure-headers'
import { serveUiAssets } from '@tool-bridge/app'
import { bodyLimit } from 'hono/body-limit'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { Hono } from 'hono'
import {
  type BootstrapSecrets,
  type BootstrapState,
  BootstrapStateStore,
} from './bootstrapState'
import {
  type MaintenanceHooks,
  MaintenanceManager,
} from './maintenanceManager'
import { createTbServer, type TbServer } from './server'
import pkg from '../package.json' with { type: 'json' }
import { resolveUiAssets } from './assets'
import { KeyManager } from './keyManager'

export interface ManagedServerOptions {
  directory: string
  host?: string
  port?: number
  uiDir?: string
}

/** A limited bootstrap listener exists independently from the database and business app. */
export async function createManagedServer(options: ManagedServerOptions) {
  const store = new BootstrapStateStore(options.directory)
  let state: BootstrapState | undefined
  let phase: 'setup' | 'installing' | 'ready' | 'recovery' = 'setup'
  let business: TbServer | undefined
  let listener: ServerType | undefined
  let maintaining = false
  let actualPort = options.port ?? 8787
  const replicaId = randomUUID()
  const assets = resolveUiAssets(options.uiDir)
  const app = new Hono()
  app.use('*', secureHeaders())
  app.use('/~setup/*', bodyLimit({ maxSize: 65536 }))
  app.use('/~setup/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })

  const status = () => ({
    state: phase,
    instanceId: state?.instanceId,
    pairingRequired: phase !== 'ready',
  })
  const management: { keys?: KeyManager, maintenance?: MaintenanceManager }
    = {}
  const launch = async (
    current: BootstrapState,
    input?: SetupInput,
    restoredKeys?: BootstrapSecrets,
  ): Promise<void> => {
    const keys
      = restoredKeys ?? (await store.read<BootstrapSecrets>('keys.json'))
    if (!keys || !current.databaseUrl)
      throw new TBError(
        'unavailable',
        'local bootstrap secrets or database connection are unavailable',
      )
    const sql = postgres(current.databaseUrl, {
      max: 1,
      connect_timeout: 5,
      onnotice: () => {},
    })
    try {
      await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(7283020)`
        await tx`CREATE TABLE IF NOT EXISTS tb_instance (id integer PRIMARY KEY CHECK(id=1),instance_id text NOT NULL UNIQUE)`
        const [existing] = await tx<
          { instance_id: string }[]
        >`SELECT instance_id FROM tb_instance WHERE id=1`
        if (existing && existing.instance_id !== current.instanceId) {
          throw new TBError(
            'conflict',
            'database belongs to a different instance',
          )
        }
        if (!existing && current.phase === 'initialized') {
          throw new TBError(
            'conflict',
            'initialized instance cannot attach an empty database',
          )
        }
        if (!existing)
          await tx`INSERT INTO tb_instance(id,instance_id) VALUES(1,${current.instanceId})`
      })
    } finally {
      await sql.end({ timeout: 1 })
    }
    const settings = input?.settings ?? runtimeConfigSchema.parse({})
    const candidate = createTbServer({
      databaseUrl: current.databaseUrl,
      encryptionKey: keys.keyring.keys[keys.keyring.activeKeyId]!,
      encryptionKeyring: keys.keyring,
      storeTokenKeyring: keys.storeTokenKeyring,
      oauthKey: keys.oauthKey,
      adminSk: current.phase === 'initialized' ? undefined : keys.adminSk,
      dataDir: options.directory,
      host: current.host,
      port: 0,
      instanceId: current.instanceId,
      replicaId,
      internalS3Origin: current.internalS3Origin,
      redisUrl: current.redisUrl,
      allowInsecureHttp: false,
      remote: {
        allowInsecure: false,
        allowlist: [],
        maxHops: 4,
        instanceId: current.instanceId,
      },
      deviceReclaimSec: settings.deviceReclaimSec,
      storeCleanupIntervalSec: settings.storeCleanupIntervalSec,
      ...(input?.storage ? { objectStore: input.storage } : {}),
      managedSettings: settings,
      maintenanceManagement: management.maintenance,
      keyManagement: management.keys,
      adminAudit: async (event) => {
        const current = await store.state()
        if (!current?.databaseUrl)
          throw new TBError('unavailable', 'audit authority unavailable')
        const auditSql = postgres(current.databaseUrl, {
          max: 1,
          connect_timeout: 5,
          onnotice: () => {},
        })
        try {
          await auditSql`INSERT INTO tb_admin_audit(id,actor,action,outcome) VALUES(${event.id},${event.actor},${event.action},${event.outcome})
            ON CONFLICT(id) DO UPDATE SET outcome=excluded.outcome,updated_at=now()`
        } finally {
          await auditSql.end({ timeout: 1 })
        }
      },
      pluginBindings: builtinPluginBindings({}),
      pluginCatalog: BUILTIN_CATALOG,
      ...(options.uiDir ? { uiDir: options.uiDir } : {}),
    })
    try {
      await candidate.prepare()
    } catch (error) {
      await candidate.close()
      throw error
    }
    await business?.close()
    business = candidate
    if (listener) business.deviceHub.attach(listener as http.Server)
  }

  const maintenanceHooks: MaintenanceHooks = {
    exclusive: run => store.exclusive(run),
    readSnapshot: async () => {
      const current = await store.state()
      if (!current?.databaseUrl)
        throw new TBError(
          'unavailable',
          'bootstrap database connection is unavailable',
        )
      return {
        revision: current.revision,
        instanceId: current.instanceId,
        databaseUrl: current.databaseUrl,
        ...(current.redisUrl ? { redisUrl: current.redisUrl } : {}),
      }
    },
    readDatabaseAdminUrl: async () =>
      (await store.defaults())?.databaseAdminUrl,
    readJournal: () => store.read('maintenance.json'),
    writeJournal: journal => store.write('maintenance.json', journal),
    quiesce: async () => {
      const previous = state
      maintaining = true
      business?.startDraining()
      await business?.close()
      business = undefined
      return {
        resume: async () => {
          if (!business && previous) {
            await launch(previous)
            state = previous
            phase = 'ready'
          }
          maintaining = false
        },
      }
    },
    commit: async (next) => {
      const current = await store.state()
      if (!current || current.revision !== next.expectedRevision)
        throw new TBError('conflict', 'bootstrap revision changed')
      const candidate: BootstrapState = {
        ...current,
        revision: current.revision + 1,
        ...(next.databaseUrl ? { databaseUrl: next.databaseUrl } : {}),
        ...(next.redisUrl === undefined
          ? {}
          : { redisUrl: next.redisUrl ?? undefined }),
      }
      await launch(candidate)
      try {
        await store.write('bootstrap.json', candidate)
      } catch (error) {
        await business?.close()
        business = undefined
        throw error
      }
      state = candidate
      phase = 'ready'
      maintaining = false
      return { revision: candidate.revision }
    },
  }
  management.maintenance = new MaintenanceManager(maintenanceHooks)
  management.keys = new KeyManager({
    exclusive: run => store.exclusive(run),
    readSnapshot: async () => ({
      ...(await maintenanceHooks.readSnapshot()),
      replicaId,
    }),
    quiesce: () => maintenanceHooks.quiesce(),
    readKeys: async () => {
      const keys = await store.read<BootstrapSecrets>('keys.json')
      if (!keys)
        throw new TBError('unavailable', 'local key file requires a backup')
      return keys
    },
    writeKeys: async (keys) => {
      const current = await store.state()
      if (!current)
        throw new TBError('unavailable', 'bootstrap state unavailable')
      await store.write('keys.json', keys)
      const next = { ...current, revision: current.revision + 1 }
      await store.write('bootstrap.json', next)
      state = next
      return next.revision
    },
    reload: async () => {
      const current = await store.state()
      if (!current)
        throw new TBError('unavailable', 'bootstrap state unavailable')
      await launch(current)
      state = current
      phase = 'ready'
    },
  })

  try {
    state = await store.initialize()
    if (state.phase === 'initialized') {
      try {
        await launch(state)
        phase = 'ready'
      } catch {
        phase = 'recovery'
      }
    } else phase = state.phase
  } catch {
    phase = 'recovery'
  }

  app.get('/~setup/status', c => c.json(status()))
  app.get('/~setup/defaults', async (c) => {
    await store.authorize(
      c.req.header('x-tb-setup-token'),
      phase === 'recovery' ? 'recovery' : 'setup',
    )
    const defaults = await store.defaults()
    return c.json({
      databaseConfigured: Boolean(defaults?.databaseUrl),
      storageConfigured: Boolean(defaults?.storage),
      ...(defaults?.databaseUrl
        ? { databaseHost: new URL(defaults.databaseUrl).hostname }
        : {}),
      ...(defaults?.storage
        ? {
            storage: {
              endpoint: defaults.storage.endpoint,
              bucket: defaults.storage.bucket,
              region: defaults.storage.region,
            },
          }
        : {}),
      redisConfigured: Boolean(defaults?.redisUrl),
    })
  })
  const configure = async (request: Request, recovery: boolean) =>
    store.exclusive(async () => {
      const current = await store.authorize(
        request.headers.get('x-tb-setup-token') ?? undefined,
        recovery ? 'recovery' : 'setup',
      )
      const raw = await request.json()
      const recoveryBody = recovery
        ? recoveryInputSchema.parse(raw)
        : undefined
      const body = recoveryBody ?? setupInputSchema.parse(raw)
      let restoredKeys: BootstrapSecrets | undefined
      if (recoveryBody?.backup) {
        const backup = recoveryBody.backup
        if (backup.instanceId !== current.instanceId || backup.version !== 1)
          throw new TBError(
            'conflict',
            'key backup belongs to a different instance',
          )
        const keyring = validateEncryptionKeyring(backup.keyring)
        const storeTokenKeyring = validateStoreTokenKeyring(
          backup.storeTokenKeyring,
        )
        validateEncryptionKeyring(backup.oauthKey)
        let previous: BootstrapSecrets | undefined
        try {
          previous = await store.read<BootstrapSecrets>('keys.json')
        } catch {
          /* the backup repairs this file */
        }
        restoredKeys = {
          keyring,
          storeTokenKeyring,
          oauthKey: backup.oauthKey,
          adminSk: previous?.adminSk ?? '',
          ...(backup.signingRetireAfter
            ? { signingRetireAfter: backup.signingRetireAfter }
            : {}),
        }
      }
      const defaults = await store.defaults()
      const input: SetupInput = {
        ...defaults,
        ...body,
        databaseUrl: body.databaseUrl ?? defaults?.databaseUrl,
        storage: body.storage ?? defaults?.storage,
      }
      if (!input.databaseUrl || (!recovery && !input.storage)) {
        throw new TBError(
          'invalid_argument',
          'database and storage connections are required',
        )
      }
      const next: BootstrapState = {
        ...current,
        phase: recovery ? current.phase : 'installing',
        databaseUrl: input.databaseUrl,
        redisUrl: input.redisUrl,
        // Trust comes only from the local installer defaults, never from the web form.
        internalS3Origin: defaults?.storage
          ? new URL(defaults.storage.endpoint).origin
          : current.internalS3Origin,
        revision: current.revision + 1,
      }
      phase = 'installing'
      await store.write(
        recovery ? 'bootstrap-pending.json' : 'bootstrap.json',
        next,
      )
      if (!recovery) state = next
      try {
        await launch(next, input, restoredKeys)
        if (restoredKeys) await store.write('keys.json', restoredKeys)
        await store.finish(next)
        state = await store.state()
        phase = 'ready'
        const keys = await store.read<BootstrapSecrets>('keys.json')
        return {
          state: 'ready',
          adminSk: recovery ? undefined : keys?.adminSk,
          baseUrl: new URL(request.url).origin,
        }
      } catch (error) {
        phase = recovery ? 'recovery' : 'installing'
        throw error
      }
    })
  app.post('/~setup/configure', async c =>
    c.json(await configure(c.req.raw, false)),
  )
  app.post('/~setup/recover', async c =>
    c.json(await configure(c.req.raw, true)),
  )
  app.get('/livez', c => c.json({ live: true }))
  app.get('/healthz', c =>
    c.json({
      healthy: true,
      version: pkg.version,
      state: phase,
      instanceId: state?.instanceId,
    }),
  )
  app.get('/readyz', async c =>
    business && phase === 'ready' && !maintaining
      ? business.app.fetch(c.req.raw)
      : c.json({ ready: false, state: phase }, 503),
  )
  app.all('*', async (c) => {
    if (phase === 'ready' && business && !maintaining)
      return business.app.fetch(c.req.raw)
    const path = new URL(c.req.url).pathname
    if ((path === '/ui' || path.startsWith('/ui/')) && assets)
      return serveUiAssets(c.req.raw, assets)
    if (path === '/') return c.redirect('/ui/setup')
    return c.json(
      {
        code: 'unavailable',
        message:
          'complete local pairing and setup before using business services',
        state: phase,
      },
      503,
    )
  })
  app.onError((error, c) => {
    if (isTBError(error))
      return new Response(JSON.stringify(error.toJSON()), {
        status: statusForCode(error.code),
        headers: { 'content-type': 'application/json' },
      })
    if ((error as { name?: string }).name === 'ZodError')
      return c.json(
        { code: 'invalid_argument', message: 'invalid setup configuration' },
        400,
      )
    if ((error as { code?: string }).code === 'ELOCKED')
      return c.json(
        {
          code: 'conflict',
          message: 'another local maintenance operation is running',
        },
        409,
      )
    return c.json(
      {
        code: 'unavailable',
        message:
          'setup could not complete; verify the connection and local bootstrap files',
      },
      503,
    )
  })
  return {
    app,
    store,
    async start(): Promise<{ port: number }> {
      return new Promise((resolve, reject) => {
        listener = serve(
          {
            fetch: app.fetch,
            port: options.port ?? state?.port ?? 8787,
            hostname: options.host ?? state?.host ?? '0.0.0.0',
          },
          (info) => {
            actualPort = info.port
            business?.deviceHub.attach(listener as http.Server)
            resolve({ port: actualPort })
          },
        )
        listener.once('error', reject)
      })
    },
    startDraining(): void {
      business?.startDraining()
    },
    async close(): Promise<void> {
      const closed = listener
        ? new Promise<void>((resolve, reject) => {
            listener!.close(error => (error ? reject(error) : resolve()));
            (listener as http.Server).closeIdleConnections?.()
          })
        : Promise.resolve()
      await business?.close()
      await closed
    },
  }
}
