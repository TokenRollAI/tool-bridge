/**
 * SecretKey 签发 / 认证 / SKRegistry。
 *
 * 纯逻辑内核:不 import 任何 Workers / Node 专属 API。WebCrypto 全局(`crypto`、
 * `TextEncoder`)在 Workers 与 Node18+ 均可用;core 不引入 @cloudflare/workers-types
 * 或 @types/node,故在此声明所需最小子集(仅类型,运行时用真实全局)。
 */

import { z } from 'zod'
import {
  type CallContext,
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  type ListOptions,
  type Page,
  type SecretKey,
  type SecretKeyInput,
  type Timestamp,
} from '../types'
import { KEY_SK_HASH, KEY_SK_ID, type StateStore } from '../store'
import { TBError } from '../errors'
import { omit } from '../omit'

declare const crypto: {
  getRandomValues(array: Uint8Array): Uint8Array
  randomUUID(): string
  subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> }
}
declare class TextEncoder {
  encode(input?: string): Uint8Array
}

const SECRET_PREFIX = 'tbk_'
const BEARER_PREFIX = 'Bearer '
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const ISO_TIMESTAMP = z.string().datetime({ offset: true })

/** base64url(无填充)编码——自实现,避免依赖 btoa/Buffer(纯逻辑)。 */
function base64url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number
    const b1 = i + 1 < bytes.length ? (bytes[i + 1] as number) : -1
    const b2 = i + 2 < bytes.length ? (bytes[i + 2] as number) : -1
    out += B64URL[b0 >> 2]
    out += B64URL[((b0 & 0x03) << 4) | (b1 < 0 ? 0 : b1 >> 4)]
    if (b1 < 0) break
    out += B64URL[((b1 & 0x0f) << 2) | (b2 < 0 ? 0 : b2 >> 6)]
    if (b2 < 0) break
    out += B64URL[b2 & 0x3f]
  }
  return out
}

/** sha256 十六进制摘要(WebCrypto)。 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

/** 生成明文 secret:`tbk_` 前缀 + 128 位熵 base64url。 */
export function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return `${SECRET_PREFIX}${base64url(bytes)}`
}

/** 校验并规范化 SK 过期时间；只接受带时区的 ISO 8601 timestamp。 */
export function normalizeExpiresAt(value: unknown): Timestamp {
  const parsed = ISO_TIMESTAMP.safeParse(value)
  if (!parsed.success) {
    throw new TBError(
      'invalid_argument',
      'field \'expiresAt\' must be a valid ISO 8601 timestamp with timezone',
    )
  }
  const timestamp = Date.parse(parsed.data)
  if (!Number.isFinite(timestamp)) {
    throw new TBError(
      'invalid_argument',
      'field \'expiresAt\' must be a valid ISO 8601 timestamp with timezone',
    )
  }
  return new Date(timestamp).toISOString()
}

/** 签发一把 SK:hash = sha256(明文);明文 secret 随返回,仅此一次。 */
export async function mintKey(
  input: SecretKeyInput,
  now: Timestamp,
): Promise<{ key: SecretKey, secret: string }> {
  const secret = generateSecret()
  const key: SecretKey = {
    id: crypto.randomUUID(),
    hash: await sha256Hex(secret),
    owner: input.owner,
    scopes: input.scopes,
    createdAt: now,
    ...(input.description !== undefined && { description: input.description }),
    ...(input.registerPaths !== undefined && { registerPaths: input.registerPaths }),
    ...(input.expiresAt !== undefined && { expiresAt: normalizeExpiresAt(input.expiresAt) }),
  }
  return { key, secret }
}

/** 投影:剥离 hash(hash 永不出网关)。 */
export function projectKey(key: SecretKey): Omit<SecretKey, 'hash'> {
  return omit(key, 'hash')
}

/** Admin SK 引导输入(Case 1):owner user:admin,全动作 ** scope。 */
export function adminBootstrapInput(): SecretKeyInput {
  return {
    owner: 'user:admin',
    scopes: [{ pattern: '**', actions: ['read', 'write', 'call', 'register', 'admin'] }],
  }
}

/** 认证层有效性:disabled 或 expiresAt 已过 → 视同禁用。 */
export function isKeyActive(key: SecretKey, now: Timestamp): boolean {
  if (key.disabled) return false
  const nowTimestamp = Date.parse(now)
  if (!Number.isFinite(nowTimestamp)) return false
  if (key.expiresAt !== undefined) {
    const expiresTimestamp = Date.parse(key.expiresAt)
    if (!Number.isFinite(expiresTimestamp) || expiresTimestamp <= nowTimestamp) return false
  }
  return true
}

function clampLimit(limit?: number): number {
  if (limit === undefined) return LIST_LIMIT_DEFAULT
  return Math.min(Math.max(1, limit), LIST_LIMIT_MAX)
}

/** SKRegistry 更新补丁:SecretKeyInput 的部分字段 + 认证层 disabled。 */
export type SKUpdatePatch = Partial<SecretKeyInput> & { disabled?: boolean }

/**
 * SKRegistry 存储实现(挂载为 builtin 节点 system/sk,需 admin 动作)。
 * KV 布局(store.ts):sk:h:<sha256hex> → SecretKey(认证热路径);
 * sk:i:<id> → sha256hex(管理面二级索引)。
 */
export class SKRegistryStore {
  constructor(private readonly store: StateStore) {}

  private async recordById(id: string): Promise<SecretKey | null> {
    const hash = await this.store.get(KEY_SK_ID + id)
    if (typeof hash !== 'string') return null
    const rec = await this.store.get(KEY_SK_HASH + hash)
    return rec ? (rec as SecretKey) : null
  }

  async list(opts?: ListOptions): Promise<Page<Omit<SecretKey, 'hash'>>> {
    const listOpts: { cursor?: string, limit: number } = { limit: clampLimit(opts?.limit) }
    if (opts?.cursor !== undefined) listOpts.cursor = opts.cursor
    const page = await this.store.list(KEY_SK_ID, listOpts)
    const items: Array<Omit<SecretKey, 'hash'>> = []
    for (const { value } of page.items) {
      if (typeof value !== 'string') continue
      const rec = await this.store.get(KEY_SK_HASH + value)
      if (rec) items.push(projectKey(rec as SecretKey))
    }
    return page.cursor !== undefined ? { items, cursor: page.cursor } : { items }
  }

  async get(id: string): Promise<Omit<SecretKey, 'hash'>> {
    const rec = await this.recordById(id)
    if (!rec) throw TBError.notFound(`secret key '${id}' not found`)
    return projectKey(rec)
  }

  /** 签发:写入 sk:h 与 sk:i 两条,返回无 hash 的 key + 一次性明文 secret。 */
  async write(
    input: SecretKeyInput,
    now: Timestamp,
  ): Promise<{ key: Omit<SecretKey, 'hash'>, secret: string }> {
    const { key, secret } = await mintKey(input, now)
    await this.store.put(KEY_SK_HASH + key.hash, key)
    await this.store.put(KEY_SK_ID + key.id, key.hash)
    return { key: projectKey(key), secret }
  }

  /** 部分更新(patch);hash / id / createdAt 不可变。不存在 → not_found。 */
  async update(id: string, patch: SKUpdatePatch): Promise<Omit<SecretKey, 'hash'>> {
    const rec = await this.recordById(id)
    if (!rec) throw TBError.notFound(`secret key '${id}' not found`)
    const updated: SecretKey = { ...rec }
    if (patch.owner !== undefined) updated.owner = patch.owner
    if (patch.description !== undefined) updated.description = patch.description
    if (patch.scopes !== undefined) updated.scopes = patch.scopes
    if (patch.registerPaths !== undefined) updated.registerPaths = patch.registerPaths
    if (patch.expiresAt !== undefined) updated.expiresAt = normalizeExpiresAt(patch.expiresAt)
    if (patch.disabled !== undefined) updated.disabled = patch.disabled
    await this.store.put(KEY_SK_HASH + rec.hash, updated)
    return projectKey(updated)
  }

  /** 吊销:删除 sk:h 与 sk:i 两条(不存在则幂等静默)。 */
  async delete(id: string): Promise<void> {
    const hash = await this.store.get(KEY_SK_ID + id)
    if (typeof hash === 'string') await this.store.delete(KEY_SK_HASH + hash)
    await this.store.delete(KEY_SK_ID + id)
  }
}

/**
 * 认证:Bearer 明文 → sha256 → 查 SK → 构造 CallContext。
 * 缺失 / 查无 / disabled / 过期一律返回 null(网关据此回 401)。
 */
export async function identify(
  store: StateStore,
  bearer: string | undefined,
  now: Timestamp,
): Promise<CallContext | null> {
  const raw = bearer?.trim()
  if (!raw) return null
  const token = raw.startsWith(BEARER_PREFIX) ? raw.slice(BEARER_PREFIX.length).trim() : raw
  if (!token) return null
  const rec = await store.get(KEY_SK_HASH + (await sha256Hex(token)))
  if (!rec) return null
  const key = rec as SecretKey
  if (!isKeyActive(key, now)) return null
  return {
    keyId: key.id,
    owner: key.owner,
    scopes: key.scopes,
    ...(key.registerPaths !== undefined ? { registerPaths: key.registerPaths } : {}),
    traceId: crypto.randomUUID(),
  }
}
