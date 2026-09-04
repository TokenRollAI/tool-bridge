import { z } from 'zod'
import type { EncryptionKeyring, StoreTokenKeyring } from './secret/keyring'

export type KeyTarget = 'encryption' | 'signing'
export interface KeyRotateInput { expectedRevision: number, revokeExisting?: boolean, target: KeyTarget }
export interface KeyRetireInput { expectedRevision: number, keyId: string, target: KeyTarget }
export interface KeyResumeInput { jobId: string }
export interface ManagedKeyView { active: boolean, keyId: string, references: number, retireAfter?: string }
export interface KeyRingStatus { activeKeyId: string, keys: ManagedKeyView[] }
export interface KeyJobView {
  changed: number
  error?: string
  id: string
  phase: 'secrets' | 'mailbox' | 'verify'
  status: 'running' | 'failed' | 'completed'
  targetKeyId: string
}
export interface KeyStatus {
  encryption: KeyRingStatus
  instanceId: string
  jobId?: string
  jobs: KeyJobView[]
  revision: number
  signing: KeyRingStatus
}
/** Explicit secret export. Never put this result into generic command history or logs. */
export interface KeyBackup {
  exportedAt: string
  instanceId: string
  keyring: EncryptionKeyring
  oauthKey: string
  signingRetireAfter?: Record<string, string>
  storeTokenKeyring: StoreTokenKeyring
  version: 1
}
export interface KeyManagement {
  backup(): Promise<KeyBackup>
  resume(input: KeyResumeInput): Promise<KeyStatus>
  retire(input: KeyRetireInput): Promise<KeyStatus>
  rotate(input: KeyRotateInput): Promise<KeyStatus>
  status(): Promise<KeyStatus>
}
export const keyRotateSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  target: z.enum(['encryption', 'signing']),
  revokeExisting: z.boolean().optional(),
})
export const keyRetireSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(), keyId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  target: z.enum(['encryption', 'signing']),
})
export const keyResumeSchema = z.strictObject({ jobId: z.string().min(1).max(128) })
