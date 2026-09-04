import { type ConfigStatus,
  configUpdateSchema,
  type RecoveryInput,
  recoveryInputSchema,
  type RecoveryResult,
  recoveryResultSchema,
  type RuntimeConfig,
  runtimeConfigSchema,

  type SetupDefaults,
  setupDefaultsSchema,
  type SetupInput,
  setupInputSchema,
  type SetupResult,
  setupResultSchema,
  type SetupStatus,
  setupStatusSchema,
  type StorageBackendView,
  storageRotateSchema,
  storageWriteSchema } from '@tool-bridge/core/management'
import { createToolBridgeClient, type ToolBridgeClientOptions } from './client'

export type { ConfigStatus, RecoveryInput, RecoveryResult, RuntimeConfig, SetupDefaults, SetupInput, SetupResult, SetupStatus, StorageBackendView }

function parsed<T>(schema: { safeParse(value: unknown): { data: T, success: true } | { success: false } }, value: unknown, label: string): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new Error(`Invalid ${label}; check the documented fields and required values`)
  return result.data
}

export const parseRuntimeConfig = (value: unknown): RuntimeConfig => parsed(runtimeConfigSchema, value, 'runtime settings')
export const parseSetupInput = (value: unknown): SetupInput => parsed(setupInputSchema, value, 'setup configuration')
export const parseConfigUpdate = (value: unknown): { expectedRevision: number, settings: RuntimeConfig } => parsed(configUpdateSchema, value, 'configuration update')
export const parseStorageWrite = (value: unknown): {
  connection: { accessKeyId: string, bucket: string, endpoint: string, region: string, secretAccessKey: string }
  name: string
} => parsed(storageWriteSchema, value, 'storage configuration')
export const parseStorageRotate = (value: unknown): {
  accessKeyId: string
  expectedRevision: number
  id: string
  secretAccessKey: string
} => parsed(storageRotateSchema, value, 'storage credential update')

/** Bootstrap uses its own one-time pairing credential and never sends an Admin SK. */
export function createSetupClient(options: Omit<ToolBridgeClientOptions, 'sk'>) {
  const request = async <T>(path: string, token?: string, body?: unknown): Promise<T> => {
    const baseFetch = options.fetcher ?? globalThis.fetch
    const client = createToolBridgeClient({
      ...options,
      fetcher: async (input, init) => {
        const headers = new Headers(init?.headers)
        headers.delete('authorization')
        if (token !== undefined) headers.set('x-tb-setup-token', token)
        return await baseFetch(input, { ...init, headers })
      },
    })
    return await client.json<T>({ path, authenticated: false, method: body === undefined ? 'GET' : 'POST', body })
  }
  return {
    status: async () => parsed(setupStatusSchema, await request('/~setup/status'), 'setup status'),
    defaults: async (token: string) => parsed(setupDefaultsSchema, await request('/~setup/defaults', token), 'setup defaults'),
    recover: async (token: string, input: unknown) => parsed(recoveryResultSchema, await request('/~setup/recover', token, parsed(recoveryInputSchema, input, 'recovery configuration')), 'recovery result'),
    configure: async (token: string, input: unknown) => parsed(setupResultSchema, await request('/~setup/configure', token, parseSetupInput(input)), 'setup result'),
  }
}
