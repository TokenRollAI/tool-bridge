import {
  createEncryptionKeyring,
  type EncryptionKeyring,
  type SetupInput,
  type StoreTokenKeyring,
  TBError,
} from '@tool-bridge/core'
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { chmod, mkdir, readFile, stat, unlink } from 'node:fs/promises'
import writeFileAtomic from 'write-file-atomic'
import lockfile from 'proper-lockfile'
import { join } from 'node:path'
import { z } from 'zod'

const stateSchema = z.strictObject({
  instanceId: z.uuid(),
  revision: z.number().int().positive(),
  phase: z.enum(['setup', 'installing', 'initialized']),
  databaseUrl: z.string().optional(),
  redisUrl: z.string().optional(),
  internalS3Origin: z.string().optional(),
  port: z.number().int().min(0).max(65535).default(8787),
  host: z.string().default('0.0.0.0'),
})
export type BootstrapState = z.infer<typeof stateSchema>
export interface BootstrapSecrets {
  adminSk: string
  keyring: EncryptionKeyring
  oauthKey: string
  signingRetireAfter?: Record<string, string>
  storeTokenKeyring: StoreTokenKeyring
}
interface Pairing {
  expiresAt: number
  instanceId: string
  mode: 'setup' | 'recovery'
  tokenHash: string
}

export class BootstrapStateStore {
  constructor(readonly directory: string) {}
  path(name: string): string {
    return join(this.directory, name)
  }

  async exclusive<T>(run: () => Promise<T>, retries = 0): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const release = await lockfile.lock(this.directory, {
      retries,
      stale: 60000,
      update: 10000,
    }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ELOCKED') {
        throw new TBError('conflict', 'another local maintenance operation is running')
      }
      throw error
    })
    try {
      return await run()
    } finally {
      await release()
    }
  }

  async read<T>(name: string): Promise<T | undefined> {
    try {
      const path = this.path(name)
      const info = await stat(path)
      if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
        throw new TBError(
          'unavailable',
          'bootstrap files must be readable only by their owner',
        )
      }
      return JSON.parse(await readFile(path, 'utf8')) as T
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async write(name: string, value: unknown): Promise<void> {
    await writeFileAtomic(this.path(name), JSON.stringify(value) + '\n', {
      mode: 0o600,
      fsync: true,
    })
  }

  async state(): Promise<BootstrapState | undefined> {
    const value = await this.read('bootstrap.json')
    return value === undefined ? undefined : stateSchema.parse(value)
  }

  async initialize(): Promise<BootstrapState> {
    return this.exclusive(async () => {
      const current = await this.state()
      if (current) {
        if (await this.read('initialized.json'))
          return { ...current, phase: 'initialized' }
        return current
      }
      // An identity without state means interrupted/corrupt provisioning, never a new public install.
      if (await this.read('identity.json'))
        throw new TBError(
          'unavailable',
          'bootstrap state requires local recovery',
        )
      const state: BootstrapState = {
        instanceId: randomUUID(),
        revision: 1,
        phase: 'setup',
        port: 8787,
        host: '0.0.0.0',
      }
      await this.write('identity.json', { instanceId: state.instanceId })
      await this.write('keys.json', {
        keyring: createEncryptionKeyring(randomBytes(32).toString('base64url')),
        storeTokenKeyring: createEncryptionKeyring(
          randomBytes(32).toString('base64url'),
        ),
        oauthKey: randomBytes(32).toString('base64url'),
        adminSk: `tb_sk_${randomBytes(32).toString('base64url')}`,
      })
      await this.write('bootstrap.json', state)
      await this.pair(state.instanceId, 'setup')
      return state
    }, 5)
  }

  private async pair(
    instanceId: string,
    mode: Pairing['mode'],
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url')
    await this.write('pairing.json', {
      instanceId,
      mode,
      tokenHash: this.hash(token),
      expiresAt: Date.now() + 3600000,
    })
    // Delivered by local CLI/file only. Never printed in service logs or put in a URL.
    await writeFileAtomic(this.path('pairing-token'), token + '\n', {
      mode: 0o600,
    })
    return token
  }

  async createLocalPairing(mode: Pairing['mode']): Promise<string> {
    return this.exclusive(async () => {
      let state: BootstrapState | undefined
      try {
        state = await this.state()
      } catch {
        /* local recovery may repair malformed bootstrap */
      }
      if (!state && mode === 'recovery') {
        const identity = await this.read<{ instanceId: string }>(
          'identity.json',
        )
        if (!identity || !z.uuid().safeParse(identity.instanceId).success)
          throw new TBError(
            'unavailable',
            'instance identity requires a local backup',
          )
        const initialized = await this.read('initialized.json')
        let keys = await this.read<BootstrapSecrets>('keys.json')
        if (!keys && !initialized) {
          keys = {
            keyring: createEncryptionKeyring(
              randomBytes(32).toString('base64url'),
            ),
            storeTokenKeyring: createEncryptionKeyring(
              randomBytes(32).toString('base64url'),
            ),
            oauthKey: randomBytes(32).toString('base64url'),
            adminSk: `tb_sk_${randomBytes(32).toString('base64url')}`,
          }
          await this.write('keys.json', keys)
        }
        state = {
          instanceId: identity.instanceId,
          phase: initialized ? 'initialized' : 'installing',
          revision: 1,
          port: 8787,
          host: '0.0.0.0',
        }
        await this.write('bootstrap.json', state)
      }
      if (!state)
        throw new TBError('unavailable', 'bootstrap state unavailable')
      if (
        mode === 'setup'
        && (state.phase === 'initialized' || (await this.read('initialized.json')))
      )
        throw new TBError('permission_denied', 'initial setup is closed')
      return this.pair(state.instanceId, mode)
    })
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }

  async authorize(
    token: string | undefined,
    mode: Pairing['mode'],
  ): Promise<BootstrapState> {
    const state = await this.state()
    const pair = await this.read<Pairing>('pairing.json')
    const initialized = await this.read<{ instanceId: string }>(
      'initialized.json',
    )
    if (
      !token
      || !state
      || !pair
      || pair.instanceId !== state.instanceId
      || pair.mode !== mode
      || pair.expiresAt <= Date.now()
      || (initialized && initialized.instanceId !== state.instanceId)
      || (mode === 'setup'
        && (state.phase === 'initialized' || initialized !== undefined))
      || !/^[0-9a-f]{64}$/.test(pair.tokenHash)
      || !timingSafeEqual(
        Buffer.from(this.hash(token)),
        Buffer.from(pair.tokenHash),
      )
    ) {
      throw new TBError(
        'permission_denied',
        'a valid local pairing credential is required',
      )
    }
    // finish() persists this marker before the final bootstrap write. Recovery
    // must retain its stronger phase if that second write was interrupted.
    return initialized ? { ...state, phase: 'initialized' } : state
  }

  async finish(state: BootstrapState): Promise<void> {
    await this.write('initialized.json', { instanceId: state.instanceId })
    await this.write('bootstrap.json', {
      ...state,
      phase: 'initialized',
      revision: state.revision + 1,
    })
    await unlink(this.path('pairing.json')).catch(() => {})
    await unlink(this.path('pairing-token')).catch(() => {})
  }

  async defaults(): Promise<
    (SetupInput & { databaseAdminUrl?: string }) | undefined
  > {
    return this.read<SetupInput & { databaseAdminUrl?: string }>(
      'install-defaults.json',
    )
  }

  async secureDirectory(): Promise<void> {
    await chmod(this.directory, 0o700)
  }
}
