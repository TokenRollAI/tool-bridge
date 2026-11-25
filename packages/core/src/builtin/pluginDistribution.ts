import { z } from 'zod/v4'
import type { PluginModuleDeps } from './plugin'
import type { Scope } from '../types'
import { httpsReleaseUrl, type InstalledRelease, type PluginRelease, type PluginUpgradePreview, type PreparePluginImage, type ReleaseReceipt, releaseReceipt, type ResolvedPluginRelease } from '../plugin/release'
import { NODE_KIND_BY_PROFILE, type PluginDescribe, resolvePluginExport, validatePluginContract } from '../plugin/contract'
import { canonicalCatalogJson, catalogDigest } from '../plugin/catalog'
import { type PluginManifest } from '../plugin/manifest'
import { assertSecretRefUse } from '../auth/secretRef'
import { NodeRegistryStore } from '../tree/registry'
import { isTBError, TBError } from '../errors'
import { crypto, URL } from '../webGlobals'
import { checkScopes } from '../auth/scope'
import { KEY_PLUGIN } from '../store'

export interface Distribution {
  active: InstalledRelease
  origin?: string
  previous?: InstalledRelease
  rolledBackFrom?: InstalledRelease
}

export interface ManagedPlugin extends PluginManifest {
  describe: PluginDescribe
  distribution: Distribution
  revision: number
}

export interface DistributionDeps {
  prepareImage?: PreparePluginImage
  resolveRelease?: (source: string) => Promise<ResolvedPluginRelease>
  verifyReleaseAuth?: (manifest: PluginManifest) => Promise<void>
}

const source = z.string().min(1).max(2048)
export const installInput = z.strictObject({
  source,
  secretRef: z.string().min(1).max(128).regex(/^[^:\s]+$/),
  origin: z.string().max(2048).optional(),
})
export const previewInput = z.strictObject({ id: z.string().min(1), source: source.optional() })
export const upgradeInput = previewInput.extend({ candidateDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional() })

function approvedOrigin(url: string): string {
  return new URL(httpsReleaseUrl(url)).origin
}

export function manifestOf(record: PluginManifest): PluginManifest {
  const { id, protocolVersion, enabled, endpoint, healthPath, auth } = record
  return { id, protocolVersion, enabled, endpoint, healthPath, auth }
}

export function createDistribution(deps: PluginModuleDeps) {
  async function load(source: string) {
    if (!deps.resolveRelease || !deps.store.compareAndSwap)
      throw new TBError('unavailable', 'this host does not support plugin distribution')
    return deps.resolveRelease(source)
  }

  async function resolveCandidate(receipt: ReleaseReceipt, release: PluginRelease, origin?: string): Promise<InstalledRelease> {
    let endpoint: string
    if ('image' in release) {
      if (!deps.prepareImage) throw new TBError('unavailable', 'an administrator must configure the isolated plugin runner')
      endpoint = httpsReleaseUrl(await deps.prepareImage(release.id, release.image)).replace(/\/+$/, '')
    } else {
      endpoint = release.endpoint
      const trusted = origin ?? (receipt.resolvedSource.startsWith('https://') ? receipt.resolvedSource : undefined)
      if (!trusted || approvedOrigin(trusted) !== approvedOrigin(endpoint))
        throw new TBError('invalid_argument', 'hosted endpoint must match the approved HTTPS origin')
    }
    return { ...receipt, endpoint, healthPath: release.healthPath }
  }

  async function inspect(manifest: PluginManifest, distribution: Distribution) {
    if (!distribution.active.image && approvedOrigin(distribution.active.endpoint) !== distribution.origin)
      throw new TBError('conflict', 'candidate endpoint does not match the installation origin')
    const candidate = { ...manifest, distribution, endpoint: distribution.active.endpoint, healthPath: distribution.active.healthPath }
    const probed = await deps.probe(candidate)
    if (!probed.healthy) throw new TBError('unavailable', 'candidate plugin failed its health check', { retryable: true })
    const { describe: raw } = await deps.fetchContract(candidate)
    const describe = validatePluginContract({ manifest: candidate, describe: raw })
    return { ...candidate, describe }
  }

  async function verifyAuth(candidate: PluginManifest) {
    if (!deps.verifyReleaseAuth) throw new TBError('unavailable', 'plugin bearer verifier unavailable')
    await deps.verifyReleaseAuth(candidate)
  }

  async function activate(candidate: Awaited<ReturnType<typeof inspect>>, prior?: ManagedPlugin) {
    // Guarded upgrades have already matched the confirmation digest before sending the real bearer.
    await verifyAuth(candidate)
    // Fresh seeds also distinguish an in-flight update from a delete + reinstall.
    const revision = prior ? prior.revision + 1 : Number.parseInt(crypto.randomUUID().replace(/-/g, '').slice(0, 12), 16)
    const record: ManagedPlugin = { ...candidate, revision }
    if (!await deps.store.compareAndSwap?.(KEY_PLUGIN + candidate.id, prior?.revision ?? null, record))
      throw new TBError('conflict', 'plugin registration changed; reload before retrying')
    return { ...manifestOf(candidate), distribution: candidate.distribution, exports: candidate.describe.exports }
  }

  async function managed(id: string, scopes: Scope[]): Promise<ManagedPlugin> {
    const record = await deps.store.get(KEY_PLUGIN + id) as ManagedPlugin | null
    if (!record) throw new TBError('not_found', 'plugin not installed')
    if (!record.distribution) throw new TBError('conflict', 'plugin was registered manually; use plugin update')
    if (record.auth.kind !== 'bearer') throw new TBError('conflict', 'missing installation bearer reference')
    assertSecretRefUse(scopes, { authRef: record.auth.secretRef })
    return record
  }

  async function prepareUpgrade(record: ManagedPlugin, input: z.infer<typeof previewInput>, actor: string) {
    const { active } = record.distribution
    const source = input.source ?? active.source
    const resolved = await load(source)
    const { release } = resolved
    if (release.id !== input.id || ('image' in release) !== (active.image !== undefined))
      throw new TBError('invalid_argument', 'plugin identity or hosting mode changed')
    const receipt = await releaseReceipt(source, resolved, actor)
    for (const known of [active, record.distribution.previous, record.distribution.rolledBackFrom]) {
      if (known?.version === receipt.version && known.digest !== receipt.digest)
        throw new TBError('conflict', 'a known version cannot be replaced with a different manifest')
    }
    const next = await resolveCandidate(receipt, release, record.distribution.origin)
    if (active.digest === next.digest && active.endpoint !== next.endpoint)
      throw new TBError('conflict', 'an existing release cannot change endpoints')
    if (active.digest !== next.digest && active.endpoint === next.endpoint)
      throw new TBError('conflict', 'a new release needs its own endpoint so rollback remains possible')
    const distribution = active.digest === next.digest
      ? { ...record.distribution, active: next }
      : { origin: record.distribution.origin, active: next, previous: active }
    return inspect(manifestOf(record), distribution)
  }

  async function confirmationDigest(record: ManagedPlugin, candidate: Awaited<ReturnType<typeof inspect>>) {
    const { digest, resolvedSource } = candidate.distribution.active
    return 'sha256:' + await catalogDigest({
      id: record.id, revision: record.revision, resolvedSource, digest,
      endpoint: candidate.endpoint, describe: candidate.describe,
    })
  }

  return {
    async install(input: z.infer<typeof installInput>, actor: string) {
      const resolved = await load(input.source)
      const { release } = resolved
      if (await deps.store.get(KEY_PLUGIN + release.id)) throw new TBError('conflict', 'plugin is already registered')
      if (!await deps.secrets.resolve(input.secretRef)) throw new TBError('invalid_argument', 'plugin bearer secret is unavailable')
      const receipt = await releaseReceipt(input.source, resolved, actor)
      const active = await resolveCandidate(receipt, release, input.origin)
      return activate(await inspect({
        id: release.id, protocolVersion: 'plugin/v2', enabled: true,
        auth: { kind: 'bearer', secretRef: input.secretRef }, endpoint: active.endpoint, healthPath: active.healthPath,
      }, { active, ...(!active.image ? { origin: approvedOrigin(active.endpoint) } : {}) }))
    },
    async preview(input: z.infer<typeof previewInput>, scopes: Scope[], actor: string): Promise<PluginUpgradePreview> {
      const record = await managed(input.id, scopes)
      const candidate = await prepareUpgrade(record, input, actor)
      await verifyAuth(candidate)
      const before = new Map(record.describe.exports.map(e => [e.id, e]))
      const after = new Map(candidate.describe.exports.map(e => [e.id, e]))
      const addedExports = [...after.keys()].filter(id => !before.has(id)).sort()
      const removedExports = [...before.keys()].filter(id => !after.has(id)).sort()
      const changedExports = [...after.keys()].filter(id =>
        before.has(id) && canonicalCatalogJson(before.get(id)) !== canonicalCatalogJson(after.get(id)),
      ).sort()
      const affectedMounts: string[] = []
      const incompatibleMounts: string[] = []
      const kinds = Object.values(NODE_KIND_BY_PROFILE)
      for (const node of await new NodeRegistryStore(deps.store).subtree('')) {
        const cfg = node.config
        if (!cfg || !('provider' in cfg) || cfg.provider !== record.id || cfg.kind !== node.kind) continue
        const nodeKind = kinds.find(kind => kind === cfg.kind)
        if (!nodeKind || !checkScopes(scopes, node.path, 'read')) continue
        if (nodeKind === 'context' && ['storage', 's3', 'device-fs'].includes(cfg.provider)) continue
        const pc = 'providerConfig' in cfg ? cfg.providerConfig : undefined
        if (typeof pc?.deviceId === 'string' && typeof pc.mountPath === 'string') continue
        affectedMounts.push(node.path)
        try {
          resolvePluginExport(candidate.describe, {
            pluginId: record.id, nodeKind, exportId: 'export' in cfg ? cfg.export : undefined,
          })
        } catch (err) {
          if (!isTBError(err) || err.code !== 'invalid_argument') throw err
          incompatibleMounts.push(node.path)
        }
      }
      return {
        id: record.id, currentVersion: record.distribution.active.version,
        candidateVersion: candidate.distribution.active.version, candidateDigest: await confirmationDigest(record, candidate),
        addedExports, removedExports, changedExports, affectedMounts, incompatibleMounts,
        requiresRunner: candidate.distribution.active.image !== undefined,
      }
    },
    async upgrade(input: z.infer<typeof upgradeInput>, scopes: Scope[], actor: string) {
      const record = await managed(input.id, scopes)
      const candidate = await prepareUpgrade(record, input, actor)
      if (input.candidateDigest && input.candidateDigest !== await confirmationDigest(record, candidate))
        throw new TBError('conflict', 'candidate or active registration changed; preview again')
      return activate(candidate, record)
    },
    async rollback(id: string, scopes: Scope[], digest?: string) {
      const record = await managed(id, scopes)
      const { active, previous } = record.distribution
      if (digest === active.digest || (!digest && !previous && record.distribution.rolledBackFrom))
        return { ...manifestOf(record), distribution: record.distribution, exports: record.describe.exports }
      if (!previous || (digest && digest !== previous.digest))
        throw new TBError('conflict', 'requested rollback target is unavailable')
      if (previous.image) {
        if (!deps.prepareImage) throw new TBError('unavailable', 'isolated plugin runner unavailable')
        const endpoint = httpsReleaseUrl(await deps.prepareImage(id, previous.image)).replace(/\/+$/, '')
        if (endpoint !== previous.endpoint) throw new TBError('conflict', 'previous runner endpoint changed')
      }
      return activate(await inspect(manifestOf(record), { origin: record.distribution.origin, active: previous, rolledBackFrom: active }), record)
    },
  }
}
