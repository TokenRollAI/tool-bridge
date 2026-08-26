/**
 * Federated search continuation sessions.
 *
 * A client handle names exactly one immutable generation record. The handle is
 * fixed-size and opaque; StateStore keys contain only its SHA-256 digest. A
 * coordinator may pre-issue the next handle, compute that generation, then use
 * create-only CAS. Concurrent retries converge on the first committed page.
 */
import {
  base64urlEncode,
  sha256Hex,
  type StateStore,
  TBError,
} from '@tool-bridge/core'

export const FEDERATED_SEARCH_HANDLE_PREFIX = 'fsc1_'
export const FEDERATED_SEARCH_HANDLE_RANDOM_BYTES = 24
export const FEDERATED_SEARCH_HANDLE_LENGTH = 37
export const FEDERATED_SEARCH_SESSION_KEY_PREFIX = 'fsearch:session:v1:'
export const FEDERATED_SEARCH_QUOTA_KEY = 'fsearch:quota:v1'

const HANDLE_PATTERN = /^fsc1_[A-Za-z0-9_-]{32}$/
const MAX_SAFE_JSON_DEPTH = 64
const MAX_SAFE_JSON_NODES = 10_000
const DEFAULT_MAX_RECORD_BYTES = 1024 * 1024
const DEFAULT_MAX_BYTES_GLOBAL = 128 * 1024 * 1024
const DEFAULT_MAX_BYTES_PER_ACTOR = 32 * 1024 * 1024
const DEFAULT_MAX_BYTES_PER_SESSION = 8 * 1024 * 1024
const DEFAULT_MAX_GENERATIONS_PER_SESSION = 1024
const DEFAULT_MAX_SESSIONS_GLOBAL = 256
const DEFAULT_MAX_SESSIONS_PER_ACTOR = 64
const QUOTA_CAS_ATTEMPTS = 32
const FORBIDDEN_STATE_KEYS = new Set([
  '$schema',
  'authorization',
  'baseurl',
  'credential',
  'inputschema',
  'outputschema',
  'schema',
  'secret',
  'sk',
  'token',
])

export interface FederatedSearchSessionBinding {
  actorKeyId: string
  requestDigest: string
}

export interface FederatedSearchSessionRecord<
  TPage = unknown,
  TSourceContinuations = unknown,
  TExcludedStatuses = unknown,
  TFederationPolicy = unknown,
> extends FederatedSearchSessionBinding {
  excludedStatuses: TExcludedStatuses
  expiresAt: string
  federationPolicy: TFederationPolicy
  generation: number
  nextHandle: string | null
  page: TPage
  rankingVersion: string
  readonly revision: 0
  sessionId: string
  sourceContinuations: TSourceContinuations
  topologyDigest: string
}

export interface FederatedSearchSessionCreate<
  TPage = unknown,
  TSourceContinuations = unknown,
  TExcludedStatuses = unknown,
  TFederationPolicy = unknown,
> extends FederatedSearchSessionBinding {
  excludedStatuses: TExcludedStatuses
  expiresAt: string
  federationPolicy: TFederationPolicy
  generation: number
  nextHandle: string | null
  page: TPage
  rankingVersion: string
  /** Stable chain identity; the first generation defaults it to its handle. */
  sessionId?: string
  sourceContinuations: TSourceContinuations
  topologyDigest: string
}

export interface FederatedSearchSessionStoreOptions {
  maxBytesGlobal?: number
  maxBytesPerActor?: number
  maxBytesPerSession?: number
  maxGenerationsPerSession?: number
  maxRecordBytes?: number
  maxSessionsGlobal?: number
  maxSessionsPerActor?: number
  now?: () => number
  randomBytes?: (length: number) => Uint8Array
}

type AnySessionRecord = FederatedSearchSessionRecord<unknown, unknown, unknown, unknown>

interface QuotaEntry {
  actorKeyId: string
  bytes: number
  expiresAt: string
  generation: number
  generationBytes: number
  generationId: string
  /** SHA-256(sessionId); never persist the opaque client handle itself. */
  id: string
}

interface QuotaRecord {
  revision: number
  sessions: QuotaEntry[]
}

function sessionUnavailable(message: string): TBError {
  return new TBError('unavailable', message, { retryable: false })
}

function invalidSession(): TBError {
  return new TBError('invalid_argument', 'federated search session is invalid or expired', {
    retryable: false,
  })
}

function corruptSession(): TBError {
  return new TBError('internal', 'federated search session state is corrupt', {
    retryable: false,
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index])
}

function validOpaque(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && !/[\0\r\n]/u.test(value)
}

function validExpiry(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function normalizedStateKey(key: string): string {
  return key.replaceAll('-', '').replaceAll('_', '').toLowerCase()
}

/** Clone and freeze JSON-like cached state while rejecting credential/schema material. */
function safeStateValue(
  value: unknown,
  state: { nodes: number },
  depth = 0,
): unknown {
  state.nodes++
  if (state.nodes > MAX_SAFE_JSON_NODES || depth > MAX_SAFE_JSON_DEPTH) {
    throw new Error('federated search session value exceeds structural limits')
  }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number')
    return value
  }
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return Object.freeze(value.map(item => safeStateValue(item, state, depth + 1)))
  }
  if (!isPlainObject(value)) throw new Error('non-JSON value')

  const clone: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_STATE_KEYS.has(normalizedStateKey(key))) {
      throw new Error(`forbidden state field '${key}'`)
    }
    clone[key] = safeStateValue(item, state, depth + 1)
  }
  return Object.freeze(clone)
}

function parseRecord(value: unknown): AnySessionRecord {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    'actorKeyId',
    'excludedStatuses',
    'expiresAt',
    'federationPolicy',
    'generation',
    'nextHandle',
    'page',
    'rankingVersion',
    'requestDigest',
    'revision',
    'sessionId',
    'sourceContinuations',
    'topologyDigest',
  ])) {
    throw corruptSession()
  }
  if (
    value.revision !== 0
    || !validOpaque(value.sessionId)
    || !validOpaque(value.actorKeyId)
    || !validOpaque(value.requestDigest)
    || !validOpaque(value.rankingVersion)
    || !validOpaque(value.topologyDigest)
    || !validExpiry(value.expiresAt)
    || !Number.isSafeInteger(value.generation)
    || (value.generation as number) < 0
    || (
      value.nextHandle !== null
      && (typeof value.nextHandle !== 'string' || !HANDLE_PATTERN.test(value.nextHandle))
    )
  ) {
    throw corruptSession()
  }

  try {
    const state = { nodes: 0 }
    return Object.freeze({
      actorKeyId: value.actorKeyId,
      excludedStatuses: safeStateValue(value.excludedStatuses, state),
      expiresAt: value.expiresAt,
      federationPolicy: safeStateValue(value.federationPolicy, state),
      generation: value.generation,
      nextHandle: value.nextHandle,
      page: safeStateValue(value.page, state),
      rankingVersion: value.rankingVersion,
      requestDigest: value.requestDigest,
      revision: 0,
      sessionId: value.sessionId,
      sourceContinuations: safeStateValue(value.sourceContinuations, state),
      topologyDigest: value.topologyDigest,
    }) as AnySessionRecord
  } catch (error) {
    if (error instanceof TBError) throw error
    throw corruptSession()
  }
}

function parseCreate(
  handle: string,
  input: FederatedSearchSessionCreate<unknown, unknown, unknown, unknown>,
): AnySessionRecord {
  try {
    return parseRecord({
      ...input,
      revision: 0,
      sessionId: input.sessionId ?? handle,
    })
  } catch {
    throw new TBError('invalid_argument', 'federated search session input is invalid', {
      retryable: false,
    })
  }
}

function parseQuotaRecord(value: unknown): QuotaRecord {
  if (!isPlainObject(value) || !hasExactKeys(value, ['revision', 'sessions'])) {
    throw corruptSession()
  }
  if (
    !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 0
    || !Array.isArray(value.sessions)
  ) {
    throw corruptSession()
  }
  const sessions = value.sessions.map((item): QuotaEntry => {
    if (
      !isPlainObject(item)
      || !hasExactKeys(item, [
        'actorKeyId',
        'bytes',
        'expiresAt',
        'generation',
        'generationBytes',
        'generationId',
        'id',
      ])
      || !validOpaque(item.actorKeyId)
      || !validExpiry(item.expiresAt)
      || !Number.isSafeInteger(item.bytes)
      || (item.bytes as number) < 1
      || !Number.isSafeInteger(item.generation)
      || (item.generation as number) < 0
      || !Number.isSafeInteger(item.generationBytes)
      || (item.generationBytes as number) < 1
      || typeof item.generationId !== 'string'
      || !/^[0-9a-f]{64}$/u.test(item.generationId)
      || typeof item.id !== 'string'
      || !/^[0-9a-f]{64}$/u.test(item.id)
    ) {
      throw corruptSession()
    }
    return {
      actorKeyId: item.actorKeyId,
      bytes: item.bytes as number,
      expiresAt: item.expiresAt,
      generation: item.generation as number,
      generationBytes: item.generationBytes as number,
      generationId: item.generationId,
      id: item.id,
    }
  })
  return { revision: value.revision as number, sessions }
}

export function isFederatedSearchSessionHandle(value: unknown): value is string {
  return typeof value === 'string'
    && value.length === FEDERATED_SEARCH_HANDLE_LENGTH
    && HANDLE_PATTERN.test(value)
}

export async function federatedSearchSessionStateKey(handle: string): Promise<string> {
  if (!isFederatedSearchSessionHandle(handle)) throw invalidSession()
  return FEDERATED_SEARCH_SESSION_KEY_PREFIX + await sha256Hex(handle)
}

export class FederatedSearchSessionStore {
  private readonly cas: NonNullable<StateStore['compareAndSwap']>
  private readonly now: () => number
  private readonly randomBytes: (length: number) => Uint8Array
  private readonly maxBytesGlobal: number
  private readonly maxBytesPerActor: number
  private readonly maxBytesPerSession: number
  private readonly maxGenerationsPerSession: number
  private readonly maxRecordBytes: number
  private readonly maxSessionsGlobal: number
  private readonly maxSessionsPerActor: number

  constructor(
    private readonly state: StateStore,
    opts: FederatedSearchSessionStoreOptions = {},
  ) {
    if (state.compareAndSwap === undefined) {
      throw sessionUnavailable('federated search sessions require StateStore.compareAndSwap')
    }
    this.cas = state.compareAndSwap.bind(state)
    this.maxBytesGlobal = opts.maxBytesGlobal ?? DEFAULT_MAX_BYTES_GLOBAL
    this.maxBytesPerActor = opts.maxBytesPerActor ?? DEFAULT_MAX_BYTES_PER_ACTOR
    this.maxBytesPerSession = opts.maxBytesPerSession ?? DEFAULT_MAX_BYTES_PER_SESSION
    this.maxGenerationsPerSession = opts.maxGenerationsPerSession
      ?? DEFAULT_MAX_GENERATIONS_PER_SESSION
    this.maxRecordBytes = opts.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES
    this.maxSessionsGlobal = opts.maxSessionsGlobal ?? DEFAULT_MAX_SESSIONS_GLOBAL
    this.maxSessionsPerActor = opts.maxSessionsPerActor ?? DEFAULT_MAX_SESSIONS_PER_ACTOR
    this.now = opts.now ?? (() => Date.now())
    this.randomBytes = opts.randomBytes
      ?? (length => crypto.getRandomValues(new Uint8Array(length)))
  }

  private async cleanupExpiredSessionRows(): Promise<void> {
    // 新链热路径只做固定上限的惰性回收；不能让一个请求扫描全部 generation 历史。
    const page = await this.state.list(FEDERATED_SEARCH_SESSION_KEY_PREFIX, { limit: 32 })
    for (const item of page.items) {
      let record: AnySessionRecord
      try {
        record = parseRecord(item.value)
      } catch {
        continue
      }
      if (Date.parse(record.expiresAt) <= this.now()) {
        await this.state.delete(item.key).catch(() => {})
      }
    }
  }

  private async reserveQuota(
    handle: string,
    record: AnySessionRecord,
    recordBytes: number,
  ): Promise<void> {
    const id = await sha256Hex(record.sessionId)
    const generationId = await sha256Hex(handle)
    for (let attempt = 0; attempt < QUOTA_CAS_ATTEMPTS; attempt++) {
      const raw = await this.state.get(FEDERATED_SEARCH_QUOTA_KEY)
      const current = raw === null
        ? { revision: 0, sessions: [] } satisfies QuotaRecord
        : parseQuotaRecord(raw)
      const active = current.sessions.filter(entry => Date.parse(entry.expiresAt) > this.now())
      const existing = active.find(entry => entry.id === id)
      let nextEntry: QuotaEntry
      if (existing !== undefined) {
        if (
          existing.actorKeyId !== record.actorKeyId
          || existing.expiresAt !== record.expiresAt
        ) throw invalidSession()
        if (record.generation === existing.generation) {
          if (
            existing.generationId !== generationId
            || existing.generationBytes !== recordBytes
          ) throw invalidSession()
          return
        }
        if (
          record.generation !== existing.generation + 1
          || generationId === existing.generationId
        ) throw invalidSession()
        nextEntry = {
          ...existing,
          bytes: existing.bytes + recordBytes,
          generation: record.generation,
          generationBytes: recordBytes,
          generationId,
        }
      } else {
        if (record.generation !== 0) throw invalidSession()
        nextEntry = {
          actorKeyId: record.actorKeyId,
          bytes: recordBytes,
          expiresAt: record.expiresAt,
          generation: 0,
          generationBytes: recordBytes,
          generationId,
          id,
        }
      }
      const actorCount = active.filter(entry => entry.actorKeyId === record.actorKeyId).length
      const globalBytes = active.reduce((total, entry) => total + entry.bytes, 0)
      const actorBytes = active
        .filter(entry => entry.actorKeyId === record.actorKeyId)
        .reduce((total, entry) => total + entry.bytes, 0)
      const priorBytes = existing?.bytes ?? 0
      if (
        record.generation >= this.maxGenerationsPerSession
        || nextEntry.bytes > this.maxBytesPerSession
      ) {
        throw new TBError('rate_limited', 'federated search session chain quota exceeded', {
          retryable: false,
        })
      }
      if (
        (existing === undefined && active.length >= this.maxSessionsGlobal)
        || (existing === undefined && actorCount >= this.maxSessionsPerActor)
        || globalBytes - priorBytes + nextEntry.bytes > this.maxBytesGlobal
        || actorBytes - priorBytes + nextEntry.bytes > this.maxBytesPerActor
      ) {
        throw new TBError('rate_limited', 'federated search session quota exceeded', {
          retryable: true,
        })
      }
      const next: QuotaRecord = {
        revision: raw === null ? 0 : current.revision + 1,
        sessions: [
          ...active.filter(entry => entry.id !== id),
          nextEntry,
        ],
      }
      if (await this.cas(
        FEDERATED_SEARCH_QUOTA_KEY,
        raw === null ? null : current.revision,
        next,
      )) return
    }
    throw new TBError('unavailable', 'federated search session quota is busy', {
      retryable: true,
    })
  }

  issueHandle(): string {
    const bytes = this.randomBytes(FEDERATED_SEARCH_HANDLE_RANDOM_BYTES)
    if (!(bytes instanceof Uint8Array) || bytes.length !== FEDERATED_SEARCH_HANDLE_RANDOM_BYTES) {
      throw sessionUnavailable('federated search session randomness is unavailable')
    }
    const handle = FEDERATED_SEARCH_HANDLE_PREFIX + base64urlEncode(bytes)
    if (!isFederatedSearchSessionHandle(handle)) {
      throw sessionUnavailable('federated search session randomness is invalid')
    }
    return handle
  }

  async create<
    TPage = unknown,
    TSourceContinuations = unknown,
    TExcludedStatuses = unknown,
    TFederationPolicy = unknown,
  >(
    handle: string,
    input: FederatedSearchSessionCreate<
      TPage,
      TSourceContinuations,
      TExcludedStatuses,
      TFederationPolicy
    >,
  ): Promise<FederatedSearchSessionRecord<
    TPage,
    TSourceContinuations,
    TExcludedStatuses,
    TFederationPolicy
  >> {
    const key = await federatedSearchSessionStateKey(handle)
    const record = parseCreate(handle, input)
    if (Date.parse(record.expiresAt) <= this.now()) throw invalidSession()
    const recordBytes = new TextEncoder().encode(JSON.stringify(record)).length
    if (recordBytes > this.maxRecordBytes) {
      throw new TBError('rate_limited', 'federated search session record is too large', {
        retryable: false,
      })
    }
    // Fast path for an idempotent retry must not be rejected merely because other sessions
    // filled the quota after this immutable generation was committed.
    if (await this.state.get(key) !== null) return await this.read(handle, input)
    if (record.generation === 0) await this.cleanupExpiredSessionRows()
    await this.reserveQuota(handle, record, recordBytes)
    if (await this.cas(key, null, record)) {
      return record as FederatedSearchSessionRecord<
        TPage,
        TSourceContinuations,
        TExcludedStatuses,
        TFederationPolicy
      >
    }
    // A concurrent retry already committed this generation. Never overwrite it;
    // return the immutable winner after applying the same actor/request checks.
    return await this.read(handle, input)
  }

  async createNew<
    TPage = unknown,
    TSourceContinuations = unknown,
    TExcludedStatuses = unknown,
    TFederationPolicy = unknown,
  >(
    input: FederatedSearchSessionCreate<
      TPage,
      TSourceContinuations,
      TExcludedStatuses,
      TFederationPolicy
    >,
  ): Promise<{
    handle: string
    record: FederatedSearchSessionRecord<
      TPage,
      TSourceContinuations,
      TExcludedStatuses,
      TFederationPolicy
    >
  }> {
    const handle = this.issueHandle()
    return { handle, record: await this.create(handle, input) }
  }

  async read<
    TPage = unknown,
    TSourceContinuations = unknown,
    TExcludedStatuses = unknown,
    TFederationPolicy = unknown,
  >(
    handle: string,
    binding: FederatedSearchSessionBinding,
  ): Promise<FederatedSearchSessionRecord<
    TPage,
    TSourceContinuations,
    TExcludedStatuses,
    TFederationPolicy
  >> {
    if (!validOpaque(binding.actorKeyId) || !validOpaque(binding.requestDigest)) {
      throw invalidSession()
    }
    const raw = await this.state.get(await federatedSearchSessionStateKey(handle))
    if (raw === null) throw invalidSession()
    const record = parseRecord(raw)
    if (Date.parse(record.expiresAt) <= this.now()) {
      await this.state.delete(await federatedSearchSessionStateKey(handle)).catch(() => {})
      throw invalidSession()
    }
    if (
      record.actorKeyId !== binding.actorKeyId
      || record.requestDigest !== binding.requestDigest
    ) {
      throw invalidSession()
    }
    return record as FederatedSearchSessionRecord<
      TPage,
      TSourceContinuations,
      TExcludedStatuses,
      TFederationPolicy
    >
  }
}
