import type { PluginManifest } from '@/lib/types'

export interface ManifestFormState {
  authKind: 'platform-token' | 'bearer'
  enabled: boolean
  endpoint: string
  healthPath: string
  secretRef: string
}

export const INITIAL_MANIFEST_FORM: ManifestFormState = {
  endpoint: '',
  healthPath: '/healthz',
  authKind: 'platform-token',
  secretRef: '',
  enabled: true,
}

export function manifestFormState(manifest: PluginManifest): ManifestFormState {
  return {
    endpoint: manifest.endpoint,
    healthPath: manifest.healthPath,
    authKind: manifest.auth.kind,
    secretRef: manifest.auth.kind === 'bearer' ? manifest.auth.secretRef : '',
    enabled: manifest.enabled,
  }
}

export function buildPluginManifestFields(state: ManifestFormState) {
  const endpoint = state.endpoint.trim()
  if (endpoint === '') throw new Error('Endpoint 必填。')
  if (state.authKind === 'bearer' && state.secretRef.trim() === '') {
    throw new Error('Bearer 认证需要 secretRef。')
  }
  const healthPath = state.healthPath.trim() || '/healthz'
  if (!healthPath.startsWith('/')) throw new Error('Health path 必须以 / 开头。')
  return {
    protocolVersion: 'plugin/v2',
    endpoint,
    auth:
      state.authKind === 'bearer'
        ? { kind: 'bearer' as const, secretRef: state.secretRef.trim() }
        : { kind: 'platform-token' as const },
    healthPath,
    enabled: state.enabled,
  }
}
