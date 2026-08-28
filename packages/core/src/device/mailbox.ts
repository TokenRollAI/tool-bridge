/**
 * Durable device mailbox authority.
 *
 * Each operation owns one StateStore key and all mutable transitions use the
 * store's atomic compareAndSwap primitive. Arguments and terminal data are
 * encrypted with a mailbox-specific HKDF child key; the deployment root is
 * never persisted and this is deliberately at-rest rather than E2E encryption.
 */

import type { OwnerRef, Timestamp, TreePath } from '../types'
import type { StateStore } from '../store'
import { base64urlDecode, base64urlEncode } from '../encoding/base64url'
import { TBError, type TBErrorBody } from '../errors'
import { sha256Hex } from '../auth/sk'

// WebCrypto/TextEncoder are runtime globals in Workers and supported Node
// versions. Core's non-DOM tsconfig intentionally does not declare them, so
// keep the minimum portable surface local instead of importing node:crypto.
interface MailboxCryptoKey { readonly type: string }
interface MailboxSubtleCrypto {
  decrypt(
    algorithm: { additionalData: Uint8Array, iv: Uint8Array, name: 'AES-GCM' },
    key: MailboxCryptoKey,
    data: Uint8Array,
  ): Promise<ArrayBuffer>
  deriveKey(
    algorithm: {
      hash: 'SHA-256'
      info: Uint8Array
      name: 'HKDF'
      salt: Uint8Array
    },
    baseKey: MailboxCryptoKey,
    derivedKeyType: { length: 256, name: 'AES-GCM' },
    extractable: false,
    keyUsages: Array<'decrypt' | 'encrypt'>,
  ): Promise<MailboxCryptoKey>
  digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>
  encrypt(
    algorithm: { additionalData: Uint8Array, iv: Uint8Array, name: 'AES-GCM' },
    key: MailboxCryptoKey,
    data: Uint8Array,
  ): Promise<ArrayBuffer>
  importKey(
    format: 'raw',
    keyData: Uint8Array,
    algorithm: 'HKDF',
    extractable: false,
    keyUsages: Array<'deriveKey'>,
  ): Promise<MailboxCryptoKey>
}
declare const crypto: {
  getRandomValues(array: Uint8Array): Uint8Array
  subtle: MailboxSubtleCrypto
}
declare const TextEncoder: { new (): { encode(input: string): Uint8Array } }
declare const TextDecoder: { new (): { decode(input: ArrayBuffer | Uint8Array): string } }

export const KEY_DEVICE_OPERATION = 'deviceop:'

export const DEVICE_OPERATION_STATES = [
  'queued',
  'claimed',
  'succeeded',
  'rejected',
  'failed',
  'result_unknown',
  'cancelled',
  'expired',
] as const

export type DeviceOperationState = typeof DEVICE_OPERATION_STATES[number]
export type DeviceOperationTerminalState = Exclude<DeviceOperationState, 'queued' | 'claimed'>
export type DeviceOperationDeviceOutcome = Extract<
  DeviceOperationTerminalState,
  'succeeded' | 'rejected' | 'failed' | 'result_unknown'
>

export interface DeviceOperationCaller {
  keyId: string
  owner: OwnerRef
}

export interface DeviceOperationSummary {
  attempt: number
  caller: DeviceOperationCaller
  cancelRequestedAt?: Timestamp
  commandId: string
  createdAt: Timestamp
  deviceId: string
  executionMayHaveOccurred: boolean
  expiresAt: Timestamp
  leaseUntil?: Timestamp
  mountPath: TreePath
  operationId: string
  state: DeviceOperationState
  targetPath: TreePath
  terminalAt?: Timestamp
  traceId: string
  updatedAt: Timestamp
}

export interface DeviceOperationDetail extends DeviceOperationSummary {
  error?: TBErrorBody
  result?: unknown
}

export interface DeviceOperationClaim {
  arguments: Record<string, unknown>
  attempt: number
  caller: DeviceOperationCaller
  cancelRequestedAt?: Timestamp
  commandId: string
  createdAt: Timestamp
  expiresAt: Timestamp
  leaseId: string
  leaseUntil: Timestamp
  operationId: string
  path: string
  targetPath: TreePath
  traceId: string
}

export type DeviceOperationCompletion
  = | { outcome: 'succeeded', result: unknown }
    | { error: TBErrorBody, outcome: 'rejected' | 'failed' }
    | { error?: TBErrorBody, outcome: 'result_unknown' }

export interface DeviceOperationEnqueueInput {
  arguments: Record<string, unknown>
  caller: DeviceOperationCaller
  deviceId: string
  deviceKeyId: string
  idempotencyKey?: string
  mountPath: TreePath
  path: string
  targetPath: TreePath
  traceId: string
  ttlSeconds?: number
}

export interface DeviceOperationListInput {
  cursor?: string
  deviceId: string
  limit?: number
  states?: readonly DeviceOperationState[]
}

export interface DeviceOperationClaimInput {
  authorize?: (target: DeviceOperationAuthorizationTarget) => Promise<void> | void
  cursor?: string
  deviceId: string
  deviceKeyId: string
  limit?: number
}

export interface DeviceOperationLeaseInput {
  authorize?: (target: DeviceOperationAuthorizationTarget) => Promise<void> | void
  deviceId: string
  deviceKeyId: string
  leaseId: string
  operationId: string
}

export interface DeviceOperationAuthorizationTarget {
  deviceId: string
  deviceKeyId: string
  mountPath: TreePath
  targetPath: TreePath
}

export interface DeviceMailboxPage<T> {
  cursor?: string
  items: T[]
}

export interface DeviceOperationClaimPage {
  cursor?: string
  operation?: DeviceOperationClaim
  serverNow: Timestamp
}

export interface DeviceOperationRenewResult {
  cancelRequestedAt?: Timestamp
  leaseUntil: Timestamp
  serverNow: Timestamp
}

export interface DeviceMailboxCleanupResult {
  cursor?: string
  deleted: number
  expired: number
  scanned: number
}

export interface DeviceMailboxServiceOptions {
  defaultTtlSeconds?: number
  leaseSeconds?: number
  /** 分别约束入队 arguments 与终态 result/error 的 canonical JSON 明文字节数。 */
  maxPayloadBytes?: number
  maxPendingPerDevice?: number
  maxTtlSeconds?: number
  now?: () => number
  randomBytes?: (length: number) => Uint8Array
  terminalRetentionSeconds?: number
}

interface EncryptedMailboxValue {
  ciphertext: string
  iv: string
  v: 1
}

interface DeviceOperationRecord {
  attempt: number
  callerKeyId: string
  callerOwner: OwnerRef
  cancelRequestedAt?: Timestamp
  commandId: string
  completedLeaseId?: string
  createdAt: Timestamp
  deviceId: string
  deviceKeyId: string
  executionMayHaveOccurred: boolean
  expiresAt: Timestamp
  idempotencyFingerprint?: string
  leaseId?: string
  leaseUntil?: Timestamp
  mountPath: TreePath
  operationId: string
  path: string
  payload: EncryptedMailboxValue
  revision: number
  state: DeviceOperationState
  targetPath: TreePath
  terminalAt?: Timestamp
  terminalData?: EncryptedMailboxValue
  traceId: string
  updatedAt: Timestamp
  v: 1
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60
const DEFAULT_LEASE_SECONDS = 60
const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024
const DEFAULT_MAX_PENDING_PER_DEVICE = 1_000
const DEFAULT_TERMINAL_RETENTION_SECONDS = 7 * 24 * 60 * 60
const MAX_CAS_ATTEMPTS = 8
const LIST_LIMIT_DEFAULT = 50
const LIST_LIMIT_MAX = 200
const HKDF_SALT = new TextEncoder().encode('tool-bridge:device-mailbox:v1')
const HKDF_INFO = new TextEncoder().encode('aes-256-gcm:operation-payload-and-result:v1')

function mailboxUnavailable(message: string): TBError {
  return new TBError('unavailable', message, { retryable: false })
}

function finiteTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function positiveInteger(value: number | undefined, fallback: number, field: string): number {
  const actual = value ?? fallback
  if (!Number.isSafeInteger(actual) || actual < 1) {
    throw new TBError('invalid_argument', `${field} must be a positive integer`)
  }
  return actual
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) return LIST_LIMIT_DEFAULT
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TBError('invalid_argument', 'limit must be a positive integer')
  }
  return Math.min(value, LIST_LIMIT_MAX)
}

function isState(value: unknown): value is DeviceOperationState {
  return typeof value === 'string'
    && (DEVICE_OPERATION_STATES as readonly string[]).includes(value)
}

function isTerminal(state: DeviceOperationState): state is DeviceOperationTerminalState {
  return state !== 'queued' && state !== 'claimed'
}

function parseEncrypted(value: unknown): EncryptedMailboxValue {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
  ) throw new Error('invalid encrypted value')
  const raw = value as Record<string, unknown>
  if (raw.v !== 1 || !nonEmpty(raw.iv) || !nonEmpty(raw.ciphertext)) {
    throw new Error('invalid encrypted value')
  }
  return { v: 1, iv: raw.iv, ciphertext: raw.ciphertext }
}

function parseRecord(value: unknown): DeviceOperationRecord {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error()
    const raw = value as Record<string, unknown>
    if (
      raw.v !== 1
      || !Number.isSafeInteger(raw.revision)
      || (raw.revision as number) < 1
      || !nonEmpty(raw.operationId)
      || raw.commandId !== raw.operationId
      || !nonEmpty(raw.deviceId)
      || !nonEmpty(raw.deviceKeyId)
      || !nonEmpty(raw.mountPath)
      || !nonEmpty(raw.targetPath)
      || !nonEmpty(raw.path)
      || !nonEmpty(raw.callerKeyId)
      || !nonEmpty(raw.callerOwner)
      || !nonEmpty(raw.traceId)
      || !finiteTimestamp(raw.createdAt)
      || !finiteTimestamp(raw.updatedAt)
      || !finiteTimestamp(raw.expiresAt)
      || !isState(raw.state)
      || !Number.isSafeInteger(raw.attempt)
      || (raw.attempt as number) < 0
      || typeof raw.executionMayHaveOccurred !== 'boolean'
    ) throw new Error()
    if ((raw.leaseId === undefined) !== (raw.leaseUntil === undefined)) throw new Error()
    if (raw.leaseId !== undefined && (!nonEmpty(raw.leaseId) || !finiteTimestamp(raw.leaseUntil))) {
      throw new Error()
    }
    if (raw.cancelRequestedAt !== undefined && !finiteTimestamp(raw.cancelRequestedAt)) throw new Error()
    if (raw.terminalAt !== undefined && !finiteTimestamp(raw.terminalAt)) throw new Error()
    if (isTerminal(raw.state) && raw.terminalAt === undefined) throw new Error()
    return {
      v: 1,
      revision: raw.revision as number,
      operationId: raw.operationId,
      commandId: raw.commandId,
      deviceId: raw.deviceId,
      deviceKeyId: raw.deviceKeyId,
      mountPath: raw.mountPath,
      targetPath: raw.targetPath,
      path: raw.path,
      callerKeyId: raw.callerKeyId,
      callerOwner: raw.callerOwner,
      traceId: raw.traceId,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      expiresAt: raw.expiresAt,
      state: raw.state,
      attempt: raw.attempt as number,
      executionMayHaveOccurred: raw.executionMayHaveOccurred,
      payload: parseEncrypted(raw.payload),
      ...(raw.leaseId === undefined
        ? {}
        : { leaseId: raw.leaseId, leaseUntil: raw.leaseUntil as string }),
      ...(raw.cancelRequestedAt === undefined
        ? {}
        : { cancelRequestedAt: raw.cancelRequestedAt as string }),
      ...(raw.completedLeaseId === undefined
        ? {}
        : { completedLeaseId: String(raw.completedLeaseId) }),
      ...(raw.terminalAt === undefined ? {} : { terminalAt: raw.terminalAt as string }),
      ...(raw.terminalData === undefined ? {} : { terminalData: parseEncrypted(raw.terminalData) }),
      ...(raw.idempotencyFingerprint === undefined
        ? {}
        : { idempotencyFingerprint: String(raw.idempotencyFingerprint) }),
    }
  } catch {
    throw new TBError('internal', 'device mailbox record is invalid', { retryable: false })
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TBError('invalid_argument', 'mailbox data must be valid JSON')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value !== 'object') {
    throw new TBError('invalid_argument', 'mailbox data must be valid JSON')
  }
  const object = value as Record<string, unknown>
  const keys = Object.keys(object).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}

function safeError(value: TBErrorBody): TBErrorBody {
  if (
    typeof value !== 'object'
    || value === null
    || typeof value.code !== 'string'
    || typeof value.message !== 'string'
    || typeof value.retryable !== 'boolean'
  ) throw new TBError('invalid_argument', 'completion error is invalid')
  return { code: value.code, message: value.message, retryable: value.retryable } as TBErrorBody
}

function normalizeCompletion(value: DeviceOperationCompletion): DeviceOperationCompletion {
  if (value.outcome === 'succeeded') {
    canonicalJson(value.result)
    return { outcome: 'succeeded', result: value.result }
  }
  if (value.outcome === 'rejected' || value.outcome === 'failed') {
    return { outcome: value.outcome, error: safeError(value.error) }
  }
  return {
    outcome: 'result_unknown',
    ...(value.error === undefined ? {} : { error: safeError(value.error) }),
  }
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function randomId(randomBytes: (length: number) => Uint8Array): string {
  const value = randomBytes(18)
  if (!(value instanceof Uint8Array) || value.length !== 18) {
    throw mailboxUnavailable('device mailbox randomness is unavailable')
  }
  return `dop_${base64urlEncode(value)}`
}

async function digestBytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

async function deterministicOperationId(binding: string): Promise<string> {
  return `dop_${base64urlEncode((await digestBytes(binding)).slice(0, 18))}`
}

async function devicePrefix(deviceId: string): Promise<string> {
  return `${KEY_DEVICE_OPERATION}${await sha256Hex(deviceId)}:`
}

async function stateKey(deviceId: string, operationId: string): Promise<string> {
  if (!/^dop_[A-Za-z0-9_-]{24}$/.test(operationId)) {
    throw new TBError('invalid_argument', 'operationId is invalid')
  }
  return await devicePrefix(deviceId) + operationId
}

class DeviceMailboxCipher {
  private readonly root: Uint8Array
  private keyPromise?: Promise<MailboxCryptoKey>

  constructor(masterKey: string) {
    let decoded: Uint8Array
    try {
      decoded = base64urlDecode(masterKey)
    } catch {
      throw mailboxUnavailable('device mailbox encryption key is invalid')
    }
    if (decoded.length !== 32) {
      throw mailboxUnavailable('device mailbox encryption key is invalid')
    }
    this.root = decoded
  }

  private key(): Promise<MailboxCryptoKey> {
    this.keyPromise ??= (async () => {
      const rootKey = await crypto.subtle.importKey('raw', this.root, 'HKDF', false, ['deriveKey'])
      return await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
        rootKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      )
    })()
    return this.keyPromise
  }

  async encrypt(operationId: string, field: 'payload' | 'terminal', value: unknown): Promise<EncryptedMailboxValue> {
    const plaintext = canonicalJson(value)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const additionalData = new TextEncoder().encode(`tool-bridge:device-mailbox:v1:${operationId}:${field}`)
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData },
      await this.key(),
      new TextEncoder().encode(plaintext),
    )
    return {
      v: 1,
      iv: base64urlEncode(iv),
      ciphertext: base64urlEncode(new Uint8Array(ciphertext)),
    }
  }

  async decrypt<T>(operationId: string, field: 'payload' | 'terminal', value: EncryptedMailboxValue): Promise<T> {
    try {
      const iv = base64urlDecode(value.iv)
      const ciphertext = base64urlDecode(value.ciphertext)
      if (iv.length !== 12) throw new Error('invalid iv')
      const additionalData = new TextEncoder().encode(`tool-bridge:device-mailbox:v1:${operationId}:${field}`)
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData },
        await this.key(),
        ciphertext,
      )
      return JSON.parse(new TextDecoder().decode(plaintext)) as T
    } catch {
      throw new TBError('internal', 'device mailbox data cannot be decrypted', { retryable: false })
    }
  }
}

export class DeviceMailboxService {
  private readonly cas: NonNullable<StateStore['compareAndSwap']>
  private readonly cipher: DeviceMailboxCipher
  private readonly defaultTtlSeconds: number
  private readonly leaseSeconds: number
  private readonly maxPayloadBytes: number
  private readonly maxPendingPerDevice: number
  private readonly maxTtlSeconds: number
  private readonly now: () => number
  private readonly randomBytes: (length: number) => Uint8Array
  private readonly state: StateStore
  private readonly terminalRetentionSeconds: number

  constructor(
    state: StateStore,
    encryptionRoot: string | undefined,
    opts: DeviceMailboxServiceOptions = {},
  ) {
    if (state.compareAndSwap === undefined) {
      throw mailboxUnavailable('device mailbox requires StateStore.compareAndSwap')
    }
    if (encryptionRoot === undefined) {
      throw mailboxUnavailable('device mailbox requires TB_SECRET_ENCRYPTION_KEY')
    }
    this.cas = state.compareAndSwap.bind(state)
    this.state = state
    this.cipher = new DeviceMailboxCipher(encryptionRoot)
    this.defaultTtlSeconds = positiveInteger(
      opts.defaultTtlSeconds,
      DEFAULT_TTL_SECONDS,
      'defaultTtlSeconds',
    )
    this.maxTtlSeconds = positiveInteger(opts.maxTtlSeconds, MAX_TTL_SECONDS, 'maxTtlSeconds')
    if (this.defaultTtlSeconds > this.maxTtlSeconds) {
      throw new TBError('invalid_argument', 'defaultTtlSeconds cannot exceed maxTtlSeconds')
    }
    this.leaseSeconds = positiveInteger(opts.leaseSeconds, DEFAULT_LEASE_SECONDS, 'leaseSeconds')
    this.maxPayloadBytes = positiveInteger(
      opts.maxPayloadBytes,
      DEFAULT_MAX_PAYLOAD_BYTES,
      'maxPayloadBytes',
    )
    this.maxPendingPerDevice = positiveInteger(
      opts.maxPendingPerDevice,
      DEFAULT_MAX_PENDING_PER_DEVICE,
      'maxPendingPerDevice',
    )
    this.terminalRetentionSeconds = positiveInteger(
      opts.terminalRetentionSeconds,
      DEFAULT_TERMINAL_RETENTION_SECONDS,
      'terminalRetentionSeconds',
    )
    this.now = opts.now ?? (() => Date.now())
    this.randomBytes = opts.randomBytes ?? (length => crypto.getRandomValues(new Uint8Array(length)))
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString()
  }

  private async read(deviceId: string, operationId: string): Promise<{ key: string, record: DeviceOperationRecord }> {
    const key = await stateKey(deviceId, operationId)
    const value = await this.state.get(key)
    if (value === null) throw TBError.notFound('device operation not found')
    const record = parseRecord(value)
    if (record.deviceId !== deviceId || record.operationId !== operationId) {
      throw new TBError('internal', 'device mailbox record identity mismatch', { retryable: false })
    }
    return { key, record }
  }

  private summary(record: DeviceOperationRecord): DeviceOperationSummary {
    return {
      operationId: record.operationId,
      commandId: record.commandId,
      deviceId: record.deviceId,
      mountPath: record.mountPath,
      targetPath: record.targetPath,
      caller: { keyId: record.callerKeyId, owner: record.callerOwner },
      traceId: record.traceId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      expiresAt: record.expiresAt,
      state: record.state,
      attempt: record.attempt,
      executionMayHaveOccurred: record.executionMayHaveOccurred,
      ...(record.leaseUntil === undefined ? {} : { leaseUntil: record.leaseUntil }),
      ...(record.cancelRequestedAt === undefined
        ? {}
        : { cancelRequestedAt: record.cancelRequestedAt }),
      ...(record.terminalAt === undefined ? {} : { terminalAt: record.terminalAt }),
    }
  }

  private async detail(record: DeviceOperationRecord): Promise<DeviceOperationDetail> {
    const summary = this.summary(record)
    if (record.terminalData === undefined) return summary
    const terminal = await this.cipher.decrypt<Record<string, unknown>>(
      record.operationId,
      'terminal',
      record.terminalData,
    )
    if (record.state === 'succeeded') return { ...summary, result: terminal.result }
    const error = terminal.error
    if (error === undefined) return summary
    return { ...summary, error: safeError(error as TBErrorBody) }
  }

  private async expireRecord(key: string, record: DeviceOperationRecord): Promise<DeviceOperationRecord> {
    let current = record
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      if (isTerminal(current.state) || Date.parse(current.expiresAt) > this.now()) return current
      const now = this.nowIso()
      const next: DeviceOperationRecord = {
        ...current,
        revision: current.revision + 1,
        state: 'expired',
        updatedAt: now,
        terminalAt: now,
        executionMayHaveOccurred: current.state === 'claimed',
      }
      if (await this.cas(key, current.revision, next)) return next
      const winner = await this.state.get(key)
      if (winner === null) throw TBError.notFound('device operation not found')
      current = parseRecord(winner)
    }
    throw new TBError('unavailable', 'device operation expiry is busy', { retryable: true })
  }

  private async enforcePendingCap(deviceId: string): Promise<void> {
    const prefix = await devicePrefix(deviceId)
    let cursor: string | undefined
    let pending = 0
    do {
      const page = await this.state.list(prefix, {
        limit: LIST_LIMIT_MAX,
        ...(cursor === undefined ? {} : { cursor }),
      })
      for (const item of page.items) {
        let record = parseRecord(item.value)
        if (record.deviceId !== deviceId) continue
        record = await this.expireRecord(item.key, record)
        if (!isTerminal(record.state)) pending++
        if (pending >= this.maxPendingPerDevice) {
          throw new TBError('rate_limited', 'device mailbox pending limit reached', {
            retryable: true,
          })
        }
      }
      cursor = page.cursor
    } while (cursor !== undefined)
  }

  async enqueue(input: DeviceOperationEnqueueInput): Promise<DeviceOperationDetail> {
    const ttlSeconds = input.ttlSeconds ?? this.defaultTtlSeconds
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > this.maxTtlSeconds) {
      throw new TBError('invalid_argument', `ttlSeconds must be between 1 and ${this.maxTtlSeconds}`)
    }
    const payloadText = canonicalJson({ arguments: input.arguments })
    if (bytes(payloadText) > this.maxPayloadBytes) {
      throw new TBError('rate_limited', 'device mailbox payload is too large', { retryable: false })
    }
    if (
      input.idempotencyKey !== undefined
      && (
        input.idempotencyKey.length < 1
        || input.idempotencyKey.length > 255
        || /[\r\n\0]/.test(input.idempotencyKey)
      )
    ) throw new TBError('invalid_argument', 'idempotency key is invalid')

    const binding = input.idempotencyKey === undefined
      ? undefined
      : canonicalJson({
          callerOwner: input.caller.owner,
          deviceId: input.deviceId,
          targetPath: input.targetPath,
          idempotencyKey: input.idempotencyKey,
        })
    const operationId = binding === undefined
      ? randomId(this.randomBytes)
      : await deterministicOperationId(binding)
    const fingerprint = binding === undefined
      ? undefined
      : await sha256Hex(canonicalJson({
          arguments: input.arguments,
          deviceKeyId: input.deviceKeyId,
          path: input.path,
          ttlSeconds,
        }))
    const key = await stateKey(input.deviceId, operationId)

    if (binding !== undefined) {
      const existing = await this.state.get(key)
      if (existing !== null) {
        const record = parseRecord(existing)
        if (
          record.callerOwner !== input.caller.owner
          || record.deviceId !== input.deviceId
          || record.targetPath !== input.targetPath
          || record.idempotencyFingerprint !== fingerprint
        ) throw new TBError('conflict', 'idempotency key is bound to another operation')
        return await this.detail(record)
      }
    }

    await this.enforcePendingCap(input.deviceId)
    const now = this.nowIso()
    const record: DeviceOperationRecord = {
      v: 1,
      revision: 1,
      operationId,
      commandId: operationId,
      deviceId: input.deviceId,
      deviceKeyId: input.deviceKeyId,
      mountPath: input.mountPath,
      targetPath: input.targetPath,
      path: input.path,
      callerKeyId: input.caller.keyId,
      callerOwner: input.caller.owner,
      traceId: input.traceId,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(this.now() + ttlSeconds * 1_000).toISOString(),
      state: 'queued',
      attempt: 0,
      executionMayHaveOccurred: false,
      payload: await this.cipher.encrypt(operationId, 'payload', { arguments: input.arguments }),
      ...(fingerprint === undefined ? {} : { idempotencyFingerprint: fingerprint }),
    }
    if (await this.cas(key, null, record)) return await this.detail(record)
    if (binding === undefined) {
      throw new TBError('conflict', 'device operation id collision', { retryable: true })
    }
    const winner = await this.state.get(key)
    if (winner === null) throw new TBError('conflict', 'device operation enqueue conflicted')
    const existing = parseRecord(winner)
    if (existing.idempotencyFingerprint !== fingerprint) {
      throw new TBError('conflict', 'idempotency key is bound to another operation')
    }
    return await this.detail(existing)
  }

  async get(deviceId: string, operationId: string): Promise<DeviceOperationDetail> {
    const { key, record } = await this.read(deviceId, operationId)
    return await this.detail(await this.expireRecord(key, record))
  }

  async list(input: DeviceOperationListInput): Promise<DeviceMailboxPage<DeviceOperationSummary>> {
    const limit = clampLimit(input.limit)
    const states = input.states === undefined ? undefined : new Set(input.states)
    if (states !== undefined && [...states].some(state => !isState(state))) {
      throw new TBError('invalid_argument', 'states contains an invalid operation state')
    }
    const page = await this.state.list(await devicePrefix(input.deviceId), {
      limit,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    })
    const items: DeviceOperationSummary[] = []
    for (const item of page.items) {
      let record = parseRecord(item.value)
      if (record.deviceId !== input.deviceId) continue
      record = await this.expireRecord(item.key, record)
      if (states !== undefined && !states.has(record.state)) continue
      items.push(this.summary(record))
    }
    return { items, ...(page.cursor === undefined ? {} : { cursor: page.cursor }) }
  }

  async claim(input: DeviceOperationClaimInput): Promise<DeviceOperationClaimPage> {
    const serverNow = this.nowIso()
    const page = await this.state.list(await devicePrefix(input.deviceId), {
      limit: clampLimit(input.limit),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    })
    for (const item of page.items) {
      let record = parseRecord(item.value)
      if (record.deviceId !== input.deviceId || record.deviceKeyId !== input.deviceKeyId) continue
      record = await this.expireRecord(item.key, record)
      const reclaimable = record.state === 'claimed'
        && record.leaseUntil !== undefined
        && Date.parse(record.leaseUntil) <= this.now()
      if (record.state !== 'queued' && !reclaimable) continue
      await input.authorize?.({
        deviceId: record.deviceId,
        deviceKeyId: record.deviceKeyId,
        mountPath: record.mountPath,
        targetPath: record.targetPath,
      })
      const leaseId = randomId(this.randomBytes)
      const leaseUntil = new Date(Math.min(
        this.now() + this.leaseSeconds * 1_000,
        Date.parse(record.expiresAt),
      )).toISOString()
      const next: DeviceOperationRecord = {
        ...record,
        revision: record.revision + 1,
        state: 'claimed',
        attempt: record.attempt + 1,
        leaseId,
        leaseUntil,
        updatedAt: serverNow,
      }
      // A CAS loser must continue through the same page instead of returning empty.
      if (!(await this.cas(item.key, record.revision, next))) continue
      const payload = await this.cipher.decrypt<{ arguments: Record<string, unknown> }>(
        record.operationId,
        'payload',
        record.payload,
      )
      if (
        typeof payload !== 'object'
        || payload === null
        || typeof payload.arguments !== 'object'
        || payload.arguments === null
        || Array.isArray(payload.arguments)
      ) throw new TBError('internal', 'device mailbox payload is invalid', { retryable: false })
      return {
        serverNow,
        ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
        operation: {
          operationId: next.operationId,
          commandId: next.commandId,
          targetPath: next.targetPath,
          path: next.path,
          arguments: payload.arguments,
          caller: { keyId: next.callerKeyId, owner: next.callerOwner },
          traceId: next.traceId,
          createdAt: next.createdAt,
          expiresAt: next.expiresAt,
          attempt: next.attempt,
          leaseId,
          leaseUntil,
          ...(next.cancelRequestedAt === undefined
            ? {}
            : { cancelRequestedAt: next.cancelRequestedAt }),
        },
      }
    }
    return {
      serverNow,
      ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
    }
  }

  private async activeLease(input: DeviceOperationLeaseInput): Promise<{ key: string, record: DeviceOperationRecord }> {
    const current = await this.read(input.deviceId, input.operationId)
    const record = await this.expireRecord(current.key, current.record)
    if (
      record.deviceKeyId !== input.deviceKeyId
      || record.state !== 'claimed'
      || record.leaseId !== input.leaseId
      || record.leaseUntil === undefined
      || Date.parse(record.leaseUntil) <= this.now()
    ) throw new TBError('conflict', 'device operation lease is no longer active')
    await input.authorize?.({
      deviceId: record.deviceId,
      deviceKeyId: record.deviceKeyId,
      mountPath: record.mountPath,
      targetPath: record.targetPath,
    })
    return { key: current.key, record }
  }

  async renew(input: DeviceOperationLeaseInput): Promise<DeviceOperationRenewResult> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const { key, record } = await this.activeLease(input)
      const serverNow = this.nowIso()
      const leaseUntil = new Date(Math.min(
        this.now() + this.leaseSeconds * 1_000,
        Date.parse(record.expiresAt),
      )).toISOString()
      const next: DeviceOperationRecord = {
        ...record,
        revision: record.revision + 1,
        leaseUntil,
        updatedAt: serverNow,
      }
      if (await this.cas(key, record.revision, next)) {
        return {
          serverNow,
          leaseUntil,
          ...(next.cancelRequestedAt === undefined
            ? {}
            : { cancelRequestedAt: next.cancelRequestedAt }),
        }
      }
    }
    throw new TBError('unavailable', 'device operation lease is busy', { retryable: true })
  }

  async complete(
    input: DeviceOperationLeaseInput,
    completionInput: DeviceOperationCompletion,
  ): Promise<DeviceOperationDetail> {
    const completion = normalizeCompletion(completionInput)
    const terminalData = completion.outcome === 'succeeded'
      ? { result: completion.result }
      : completion.error === undefined ? {} : { error: completion.error }
    if (bytes(canonicalJson(terminalData)) > this.maxPayloadBytes) {
      throw new TBError('rate_limited', 'device mailbox terminal payload is too large', {
        retryable: false,
      })
    }
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const current = await this.read(input.deviceId, input.operationId)
      let record = await this.expireRecord(current.key, current.record)
      if (record.deviceKeyId !== input.deviceKeyId) {
        throw new TBError('conflict', 'device operation credential does not match')
      }
      await input.authorize?.({
        deviceId: record.deviceId,
        deviceKeyId: record.deviceKeyId,
        mountPath: record.mountPath,
        targetPath: record.targetPath,
      })
      if (isTerminal(record.state)) {
        if (
          record.completedLeaseId !== input.leaseId
          || record.state !== completion.outcome
          || record.terminalData === undefined
        ) throw new TBError('conflict', 'device operation is already terminal')
        const existing = await this.cipher.decrypt<unknown>(
          record.operationId,
          'terminal',
          record.terminalData,
        )
        const requested = completion.outcome === 'succeeded'
          ? { result: completion.result }
          : completion.error === undefined ? {} : { error: completion.error }
        if (canonicalJson(existing) !== canonicalJson(requested)) {
          throw new TBError('conflict', 'device operation completion differs from terminal result')
        }
        return await this.detail(record)
      }
      const active = await this.activeLease(input)
      record = active.record
      const now = this.nowIso()
      const next: DeviceOperationRecord = {
        ...record,
        revision: record.revision + 1,
        state: completion.outcome,
        terminalAt: now,
        terminalData: await this.cipher.encrypt(record.operationId, 'terminal', terminalData),
        completedLeaseId: input.leaseId,
        updatedAt: now,
      }
      if (await this.cas(active.key, record.revision, next)) return await this.detail(next)
    }
    throw new TBError('unavailable', 'device operation completion is busy', { retryable: true })
  }

  async cancel(deviceId: string, operationId: string): Promise<DeviceOperationDetail> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const current = await this.read(deviceId, operationId)
      const record = await this.expireRecord(current.key, current.record)
      if (isTerminal(record.state) || record.cancelRequestedAt !== undefined) {
        return await this.detail(record)
      }
      const now = this.nowIso()
      const next: DeviceOperationRecord = record.state === 'queued'
        ? {
            ...record,
            revision: record.revision + 1,
            state: 'cancelled',
            cancelRequestedAt: now,
            terminalAt: now,
            updatedAt: now,
          }
        : {
            ...record,
            revision: record.revision + 1,
            cancelRequestedAt: now,
            updatedAt: now,
          }
      if (await this.cas(current.key, record.revision, next)) return await this.detail(next)
    }
    throw new TBError('unavailable', 'device operation cancellation is busy', { retryable: true })
  }

  async cleanup(opts: { cursor?: string, limit?: number } = {}): Promise<DeviceMailboxCleanupResult> {
    const page = await this.state.list(KEY_DEVICE_OPERATION, {
      limit: clampLimit(opts.limit),
      ...(opts.cursor === undefined ? {} : { cursor: opts.cursor }),
    })
    let deleted = 0
    let expired = 0
    for (const item of page.items) {
      let record: DeviceOperationRecord
      try {
        record = parseRecord(item.value)
      } catch {
        continue
      }
      if (!isTerminal(record.state) && Date.parse(record.expiresAt) <= this.now()) {
        const next = await this.expireRecord(item.key, record)
        if (next.state === 'expired') expired++
        record = next
      }
      if (
        isTerminal(record.state)
        && record.terminalAt !== undefined
        && Date.parse(record.terminalAt) + this.terminalRetentionSeconds * 1_000 <= this.now()
        && await this.cas(item.key, record.revision, null)
      ) deleted++
    }
    return {
      scanned: page.items.length,
      expired,
      deleted,
      ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
    }
  }
}
