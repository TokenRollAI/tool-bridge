import { z } from 'zod/v4'
import { canonicalCatalogJson } from './catalog'
import { sha256Hex } from '../auth/sk'
import { TBError } from '../errors'
import { URL } from '../webGlobals'

export const pluginImageSchema = z.string().max(512).regex(
  /^[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?\/(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/,
  'expected registry/repository@sha256:<digest>',
)

// Exact SemVer, including prereleases and build metadata. No ranges or tags.
export const pluginVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[\da-zA-Z-]*[a-zA-Z-][\da-zA-Z-]*)(?:\.(?:0|[1-9]\d*|[\da-zA-Z-]*[a-zA-Z-][\da-zA-Z-]*))*)?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/

const fields = {
  schemaVersion: z.literal('tb-plugin-release/v1'),
  id: z.string().max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  version: z.string().max(128).regex(pluginVersionPattern),
  healthPath: z.string().max(256).regex(/^\/[a-zA-Z0-9_./~-]*$/).default('/healthz'),
}
const releaseSchema = z.union([
  z.strictObject({ ...fields, endpoint: z.string().max(2048) }),
  z.strictObject({ ...fields, image: pluginImageSchema }),
])
export type PluginRelease = z.infer<typeof releaseSchema>
export interface ResolvedPluginRelease {
  release: PluginRelease
  resolvedSource: string
}

export type PreparePluginImage = (id: string, image: string) => Promise<string>

export function httpsReleaseUrl(value: string): string {
  try {
    const url = new URL(value)
    if (value.startsWith('https://') && url.protocol === 'https:' && !url.username && !url.password && !/[?#\\\s]/.test(value))
      return url.toString()
  } catch { /* report a sanitized error; URLs may contain credentials */ }
  throw new TBError('invalid_argument', 'expected a credential-free HTTPS URL without query or fragment')
}

export function parsePluginRelease(input: unknown): PluginRelease {
  const result = releaseSchema.safeParse(input)
  if (!result.success) throw new TBError('invalid_argument', 'invalid tb-plugin-release/v1 manifest')
  if ('endpoint' in result.data) result.data.endpoint = httpsReleaseUrl(result.data.endpoint).replace(/\/+$/, '')
  return result.data
}

export interface ReleaseReceipt {
  approvedBy: string
  digest: string
  image?: string
  resolvedSource: string
  source: string
  version: string
}

export interface InstalledRelease extends ReleaseReceipt {
  endpoint: string
  healthPath: string
}

export async function releaseReceipt(source: string, { release, resolvedSource }: ResolvedPluginRelease, approvedBy: string): Promise<ReleaseReceipt> {
  return {
    source, resolvedSource, approvedBy, version: release.version,
    digest: 'sha256:' + await sha256Hex(canonicalCatalogJson(release)),
    ...('image' in release ? { image: release.image } : {}),
  }
}

export interface PluginUpgradePreview {
  addedExports: string[]
  affectedMounts: string[]
  candidateDigest: string
  candidateVersion: string
  changedExports: string[]
  currentVersion: string
  id: string
  incompatibleMounts: string[]
  removedExports: string[]
  requiresRunner: boolean
}
