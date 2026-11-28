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
import { setTimeout as delay } from 'node:timers/promises'
import { secureHeaders } from 'hono/secure-headers'
import { serveUiAssets } from '@tool-bridge/app'
import { bodyLimit } from 'hono/body-limit'
import { serve } from '@hono/node-server'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import pRetry from 'p-retry'
import { Hono } from 'hono'
import {
  BootstrapLockBusyError,
  type BootstrapSecrets,
  type BootstrapState,
  BootstrapStateStore,
} from './bootstrapState'
import {
  type MaintenanceHooks,
  MaintenanceManager,
} from './maintenanceManager'
import { RuntimeHandoffPendingError } from './pgMaintenanceFence'
import { createTbServer, type TbServer } from './server'
import pkg from '../package.json' with { type: 'json' }
import { MCP_AUTHORIZE_PATH } from './mcpOAuth'
import { resolveUiAssets } from './assets'
import { KeyManager } from './keyManager'

export interface ManagedServerOptions {
  directory: string
  host?: string
  pluginRunnerSocket?: string
  port?: number
  uiDir?: string
}

/** A limited bootstrap listener exists independently from the database and business app. */
export async function createManagedServer(options: ManagedServerOptions) {
  const store = new BootstrapStateStore(options.directory)
  let state: BootstrapState | undefined
  let phase: 'setup' | 'installing' | 'starting' | 'ready' | 'recovery' = 'setup'
  const startup = new AbortController()
  const ownershipLost = new AbortController()
  const drainDelay = new AbortController()
  let business: TbServer | undefined
  let listener: http.Server | undefined
  let listening: Promise<{ port: number }> | undefined
  let closePromise: Promise<void> | undefined
  let managementTask: Promise<unknown> | undefined
  let managementClosed = false
  let maintaining = false
  let draining = false
  let shutdownPromise: Promise<void> | undefined
  let lastShutdownDrainSec = 0
  const replicaId = randomUUID()
  const assets = resolveUiAssets(options.uiDir)
  const app = new Hono()
  const defaults = secureHeaders()
  const consent = secureHeaders({ referrerPolicy: 'same-origin' })
  // Chrome uses the document referrer policy when deriving Origin for a form POST.
  app.use('*', (c, next) => c.req.path === MCP_AUTHORIZE_PATH ? consent(c, next) : defaults(c, next))
  app.use('/~setup/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })

  const assertOwnershipIntact = () => {
    if (ownershipLost.signal.aborted) throw new TBError('unavailable', 'runtime ownership lost; restart required')
  }
  const handoffBlocked = () => ownershipLost.signal.aborted || phase === 'starting'
  const runtimeState = () => ownershipLost.signal.aborted ? 'ownership_lost' : phase
  const status = () => ({
    state: handoffBlocked() ? 'installing' : phase,
    instanceId: state?.instanceId,
    pairingRequired: !handoffBlocked() && phase !== 'ready',
  })
  const management: { keys?: KeyManager, maintenance?: MaintenanceManager }
    = {}
  const withManagementLock = <T>(run: () => Promise<T>) => store.exclusive(async () => {
    if (managementClosed) throw new TBError('unavailable', 'server is closed')
    const task = run()
    managementTask = task
    try {
      return await task
    } finally {
      managementTask = undefined
    }
  })
  const launch = async (
    current: BootstrapState,
    input?: SetupInput,
    restoredKeys?: BootstrapSecrets,
    signal?: AbortSignal,
  ): Promise<void> => {
    let candidateLost = false
    const checkLaunch = () => {
      signal?.throwIfAborted()
      assertOwnershipIntact()
      if (candidateLost) throw new TBError('unavailable', 'runtime ownership lost during preparation')
    }
    checkLaunch()
    if (!current.databaseUrl)
      throw new TBError('unavailable', 'bootstrap database connection is unavailable')
    const keys
      = restoredKeys ?? (await store.read<BootstrapSecrets>('keys.json'))
    if (!keys)
      throw new TBError(
        'unavailable',
        'local bootstrap secrets are unavailable',
      )
    checkLaunch()
    const sql = postgres(current.databaseUrl, {
      max: 1,
      connect_timeout: 5,
      onnotice: () => {},
    })
    const cancelIdentityCheck = () => {
      void sql.end({ timeout: 0 }).catch(() => {})
    }
    signal?.addEventListener('abort', cancelIdentityCheck, { once: true })
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
      signal?.removeEventListener('abort', cancelIdentityCheck)
      await sql.end({ timeout: 1 })
    }
    checkLaunch()
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
      pluginRunnerSocket: options.pluginRunnerSocket,
      ...(options.uiDir ? { uiDir: options.uiDir } : {}),
    }, () => {
      candidateLost = true
      if (business === candidate) ownershipLost.abort()
    })
    const cancelPreparation = () => {
      // launch awaits the same close in its catch before the startup task settles.
      void candidate.close().catch(() => {})
    }
    signal?.addEventListener('abort', cancelPreparation, { once: true })
    try {
      await candidate.prepare()
      checkLaunch()
      if (business) await business.close()
      checkLaunch()
    } catch (error) {
      await candidate.close()
      throw error
    } finally {
      signal?.removeEventListener('abort', cancelPreparation)
    }
    business = candidate
    if (draining) business.startDraining()
    if (listener) business.deviceHub.attach(listener)
  }

  const maintenanceHooks: MaintenanceHooks = {
    exclusive: withManagementLock,
    readSnapshot: async () => {
      const current = await store.state()
      if (!current?.databaseUrl)
        throw new TBError(
          'unavailable',
          'bootstrap database connection is unavailable',
        )
      return {
        revision: current.revision,
        replicaId,
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
      lastShutdownDrainSec = business?.shutdownDrainSec ?? lastShutdownDrainSec
      maintaining = true
      business?.startDraining()
      await business?.close({ excludeCurrentRequest: true })
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
    exclusive: withManagementLock,
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

  const recover = (stage: 'bootstrap' | 'launch', error: unknown) => {
    phase = 'recovery'
    let reason = 'dependency_or_io_failure'
    if (isTBError(error)) reason = error.code
    else if (error instanceof SyntaxError) reason = 'invalid_json'
    else if (error instanceof Error && error.name === 'ZodError') reason = 'invalid_configuration'
    console.error(JSON.stringify({ event: 'tool_bridge_recovery_required', stage, reason }))
  }
  let stage: 'bootstrap' | 'launch' = 'bootstrap'
  const attemptStartup = () => store.withStartupState(state?.instanceId, async (current) => {
    startup.signal.throwIfAborted()
    state = current
    if (state.phase !== 'initialized') {
      phase = state.phase
      return
    }
    stage = 'launch'
    await launch(state, undefined, undefined, startup.signal)
    phase = 'ready'
  })
  let reportContention!: () => void
  const contention = new Promise<void>((resolve) => {
    reportContention = resolve
  })
  const startupTask = pRetry(attemptStartup, {
    signal: startup.signal,
    retries: Infinity,
    minTimeout: 1000,
    maxTimeout: 10000,
    randomize: true,
    unref: true,
    shouldRetry: ({ error, attemptNumber }) => {
      if (!(error instanceof BootstrapLockBusyError || error instanceof RuntimeHandoffPendingError)) return false
      if (attemptNumber === 1) {
        phase = 'starting'
        console.info(JSON.stringify({ event: 'tool_bridge_waiting_for_runtime_owner' }))
        reportContention()
      }
      return true
    },
  }).catch((error: unknown) => {
    if (!startup.signal.aborted && !ownershipLost.signal.aborted) recover(stage, error)
  })
  await Promise.race([startupTask, contention])

  app.get('/~setup/status', c => c.json(status()))
  app.use('/~setup/*', async (c, next) => {
    if (handoffBlocked())
      return c.json({ code: 'unavailable', state: runtimeState() }, 503)
    await next()
  })
  app.use('/~setup/*', bodyLimit({ maxSize: 65536 }))
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
    withManagementLock(async () => {
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
      assertOwnershipIntact()
      phase = 'installing'
      await store.write(
        recovery ? 'bootstrap-pending.json' : 'bootstrap.json',
        next,
      )
      if (!recovery) state = next
      try {
        await launch(next, input, restoredKeys)
        assertOwnershipIntact()
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
      state: runtimeState(),
      instanceId: state?.instanceId,
    }),
  )
  app.get('/readyz', async c =>
    business && phase === 'ready' && !maintaining && !ownershipLost.signal.aborted
      ? business.app.fetch(c.req.raw)
      : c.json({ ready: false, state: runtimeState() }, 503),
  )
  app.all('*', async (c) => {
    if (phase === 'ready' && business && !maintaining && !ownershipLost.signal.aborted)
      return business.app.fetch(c.req.raw)
    if (handoffBlocked())
      return c.json({ code: 'unavailable', state: runtimeState() }, 503)
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
  const startDraining = (): void => {
    draining = true
    startup.abort()
    business?.startDraining()
  }
  const close = (): Promise<void> => closePromise ??= (async () => {
    startDraining()
    drainDelay.abort()
    // listen(host) can still be resolving the hostname when close is called.
    await listening?.catch(() => {})
    const socket = listener
    const closed = socket?.listening
      ? new Promise<void>((resolve, reject) => {
          socket.close(error => (error ? reject(error) : resolve()))
          socket.closeIdleConnections()
        })
      : Promise.resolve()
    let previous: TbServer | undefined
    const closeRuntime = async () => {
      await startupTask
      previous = business
      await previous?.close()
    }
    // This listener also owns HTTP connections that never reached the business app.
    const disconnectClients = () => socket?.closeAllConnections()
    ownershipLost.signal.addEventListener('abort', disconnectClients, { once: true })
    if (ownershipLost.signal.aborted) disconnectClients()
    try {
      const [runtime, connections] = await Promise.allSettled([closeRuntime(), closed])
      // Embedded callers can also have an admitted setup or reload without an HTTP socket.
      managementClosed = true
      await managementTask?.catch(() => {})
      if (business !== previous) await business?.close()
      if (runtime.status === 'rejected') throw runtime.reason
      if (connections.status === 'rejected') throw connections.reason
    } finally {
      ownershipLost.signal.removeEventListener('abort', disconnectClients)
      listener = undefined
      business = undefined
    }
  })()
  return {
    app,
    store,
    ownershipLost: ownershipLost.signal,
    async start(): Promise<{ port: number }> {
      if (draining) throw new TBError('unavailable', 'server is shutting down')
      return listening ??= (async () => {
        // Maintenance may already have held the lock at boot. Use the persisted
        // bind address for this listener; admission always re-reads under lock.
        const bind = state ?? (phase === 'starting' ? await store.state() : undefined)
        return new Promise<{ port: number }>((resolve, reject) => {
          listener = serve(
            {
              fetch: app.fetch,
              port: options.port ?? bind?.port ?? 8787,
              hostname: options.host ?? bind?.host ?? '0.0.0.0',
            },
            (info) => {
              if (listener && !draining && !ownershipLost.signal.aborted) business?.deviceHub.attach(listener)
              resolve({ port: info.port })
            },
          ) as http.Server
          listener.once('error', reject)
        })
      })()
    },
    startDraining,
    close,
    shutdown(): Promise<void> {
      if (closePromise) return closePromise
      shutdownPromise ??= (async () => {
        startDraining()
        // Read the successfully applied local snapshot; shutdown cannot wait on PG.
        const seconds = business?.shutdownDrainSec ?? lastShutdownDrainSec
        if (seconds > 0) {
          try {
            await delay(seconds * 1000, undefined, { signal: drainDelay.signal })
          } catch (error) {
            if (!drainDelay.signal.aborted) throw error
          }
        }
        await close()
      })()
      return shutdownPromise
    },
  }
}
