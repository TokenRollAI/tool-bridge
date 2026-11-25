import {
  adminBootstrapInput,
  canonicalizePath,
  DEFAULT_MAX_HOPS,
  KEY_BOOTSTRAPPED,
  KEY_SK_HASH,
  KEY_SK_ID,
  MemoryStateStore,
  mintKey,
  NODE_KIND_BY_PROFILE,
  PLUGIN_PROTOCOL_VERSION,
  type PluginExport,
  type PluginRegistration,
  SecretStoreImpl,
} from '@tool-bridge/core'
import { createTbApp, type PluginBindingHandler, runBootstrap } from '@tool-bridge/app'
import { randomBytes } from 'node:crypto'
import pkg from '../../package.json' with { type: 'json' }
import { CliError } from '../http'

const PLUGIN_ID = 'dev'
const TOKEN_REF = 'dev-plugin-transport'

// Stage the tree, plugin registration and tool caches privately for each reload.
// Gateway keys and upstream secrets belong to the session and can change while staging.
class RevisionState extends MemoryStateStore {
  constructor(private readonly keys: MemoryStateStore) {
    super()
  }

  private isKey(key: string): boolean {
    return key.startsWith(KEY_SK_ID) || key.startsWith(KEY_SK_HASH)
  }

  override get(key: string) {
    return this.isKey(key) ? this.keys.get(key) : super.get(key)
  }

  override async getMany(keys: readonly string[]) {
    const values = await Promise.all(keys.map(async key => [key, await this.get(key)] as const))
    return new Map(values.filter(([, value]) => value !== null))
  }

  override list(prefix: string, opts?: { cursor?: string, limit?: number }) {
    return this.isKey(prefix) ? this.keys.list(prefix, opts) : super.list(prefix, opts)
  }

  override put(key: string, value: unknown) {
    return this.isKey(key) ? this.keys.put(key, value) : super.put(key, value)
  }

  override putIfAbsent(key: string, value: unknown) {
    return this.isKey(key) ? this.keys.putIfAbsent(key, value) : super.putIfAbsent(key, value)
  }

  override delete(key: string) {
    return this.isKey(key) ? this.keys.delete(key) : super.delete(key)
  }

  override compareAndSwap(key: string, revision: number | null, value: unknown) {
    return this.isKey(key)
      ? this.keys.compareAndSwap(key, revision, value)
      : super.compareAndSwap(key, revision, value)
  }
}

export async function createDevIdentity() {
  const now = new Date().toISOString()
  const { secret: sk } = await mintKey(adminBootstrapInput(), now)
  const token = randomBytes(32).toString('base64url')
  const keys = new MemoryStateStore()
  const secrets = new SecretStoreImpl(new MemoryStateStore(), randomBytes(32).toString('base64url'))
  await runBootstrap(keys, { adminSk: sk })
  await secrets.set(TOKEN_REF, token, now)
  return { keys, secrets, sk, token }
}

export interface DevGateway {
  fetch(request: Request): Promise<Response>
  manualExports: string[]
  mounts: string[]
}

function requiresMountConfig(spec: PluginExport): boolean {
  return spec.credentialFields !== undefined
    || spec.oauth !== undefined
    || (spec.auth?.kind === 'single' && spec.auth.required === true)
    || spec.mountConfigFields?.some(field => field.required === true) === true
}

export async function prepareDevGateway(
  identity: Awaited<ReturnType<typeof createDevIdentity>>,
  handler: PluginBindingHandler,
  signal: AbortSignal,
): Promise<DevGateway> {
  const state = new RevisionState(identity.keys)
  await state.put(KEY_BOOTSTRAPPED, true)
  await runBootstrap(state)
  let staging: AbortSignal | undefined = signal
  const app = createTbApp({
    state,
    secrets: identity.secrets,
    pluginBindings: new Map([[PLUGIN_ID, request => handler(staging === undefined
      ? request
      : new Request(request, { signal: AbortSignal.any([request.signal, staging]) }))]]),
    allowInsecureHttp: false,
    remote: { allowlist: [], maxHops: DEFAULT_MAX_HOPS, allowInsecure: false },
    version: pkg.version,
  })
  const headers = { accept: 'application/json', authorization: `Bearer ${identity.sk}` }
  const request = async (path: string, body?: unknown): Promise<Response> => {
    signal.throwIfAborted()
    const response = await app.request(`http://127.0.0.1/${path}`, body === undefined
      ? { headers }
      : { body: JSON.stringify(body), headers: { ...headers, 'content-type': 'application/json' }, method: 'POST' })
    signal.throwIfAborted()
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { message?: unknown } | null
      const detail = typeof data?.message === 'string' ? data.message : `HTTP ${response.status}`
      throw new CliError(`${path}: ${detail}`)
    }
    return response
  }

  const registered = await request('system/plugin/write', {
    id: PLUGIN_ID,
    protocolVersion: PLUGIN_PROTOCOL_VERSION,
    endpoint: `binding:${PLUGIN_ID}`,
    auth: { kind: 'bearer', secretRef: TOKEN_REF },
    healthPath: '/healthz',
    enabled: true,
  })
  const { exports } = await registered.json() as PluginRegistration
  await request('system/registry/write', { path: PLUGIN_ID, kind: 'directory', description: 'Local plugin' })
  const mounts: string[] = []
  const manualExports: string[] = []
  for (const spec of exports) {
    if ((spec.profile !== 'tools/v1' && spec.profile !== 'context/v1') || requiresMountConfig(spec)) {
      manualExports.push(spec.id)
      continue
    }
    const path = canonicalizePath(`${PLUGIN_ID}/${spec.id}`)
    const kind = NODE_KIND_BY_PROFILE[spec.profile]
    await request('system/registry/write', {
      path,
      kind,
      description: spec.description || spec.id,
      config: { kind, provider: PLUGIN_ID, export: spec.id },
    })
    await request(`${path}/~help`)
    mounts.push(path)
  }
  staging = undefined
  return { fetch: async request => await app.fetch(request), manualExports, mounts }
}
