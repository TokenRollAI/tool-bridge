import type { ToolSpec } from '../tool/types'
import {
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  type Page,
  type TreePath,
} from '../types'
import { normalizePath, validatePath } from '../tree/path'
import { TBError } from '../errors'

declare const TextEncoder: { new (): { encode(input: string): Uint8Array } }
declare const TextDecoder: {
  new (label?: string, options?: { fatal?: boolean }): { decode(input: Uint8Array): string }
}
interface ToolSearchCryptoKey { readonly type: string }
declare const crypto: {
  getRandomValues(array: Uint8Array): Uint8Array
  subtle: {
    decrypt(
      algorithm: { iv: Uint8Array, name: 'AES-GCM' },
      key: ToolSearchCryptoKey,
      data: Uint8Array,
    ): Promise<ArrayBuffer>
    encrypt(
      algorithm: { iv: Uint8Array, name: 'AES-GCM' },
      key: ToolSearchCryptoKey,
      data: Uint8Array,
    ): Promise<ArrayBuffer>
    importKey(
      format: 'raw',
      keyData: Uint8Array,
      algorithm: { name: 'AES-GCM' },
      extractable: false,
      keyUsages: Array<'decrypt' | 'encrypt'>,
    ): Promise<ToolSearchCryptoKey>
  }
}

export type SearchCapability = 'search' | 'search:semantic'

/** 单次 adapter 轻量候选查询上限；gateway 可在一个请求内分批扫描。 */
export const TOOL_SEARCH_BATCH_LIMIT = 100
/** 单个协议请求允许扫描的 raw candidate 累计上限。 */
export const TOOL_SEARCH_WORK_LIMIT = 400
/** 每次 canonical audit 最多读取的 registry 节点数；与 ~tree 的全树预算对齐。 */
export const TOOL_SEARCH_AUDIT_NODE_LIMIT = 500
/** 单节点可索引 JSON1 快照上限；超额节点不影响 canonical 工具调用，只从派生索引排除。 */
export const TOOL_SEARCH_NODE_JSON_BYTES_MAX = 20_000
/** 单页 hydrate 的 raw ToolSpec JSON 上限，避免大 schema 放大 Worker 内存。 */
export const TOOL_SEARCH_PAGE_BYTES = 4 * 1024 * 1024
/** 所有 source columns 的 UTF-8 总量上限；同时适配 D1 JSON1 绑定与 2 MiB row 上限。 */
export const TOOL_SEARCH_ROW_BYTES_MAX = 1_300_000
/** D1 adapter 的单参数 JSON1 array 上限；core 统一校验以保持 SQLite 对等。 */
export const TOOL_SEARCH_RECORD_JSON_BYTES_MAX = 1_800_000
/** 500 节点最坏 source + path/digest snapshot 所需 JSON1 块数上界。 */
const TOOL_SEARCH_SNAPSHOT_RECORD_BYTES_MAX
  = TOOL_SEARCH_NODE_JSON_BYTES_MAX + 256
const TOOL_SEARCH_SOURCE_CHUNKS_MAX = Math.ceil(
  TOOL_SEARCH_AUDIT_NODE_LIMIT * TOOL_SEARCH_NODE_JSON_BYTES_MAX
  / (TOOL_SEARCH_RECORD_JSON_BYTES_MAX - TOOL_SEARCH_NODE_JSON_BYTES_MAX),
)
const TOOL_SEARCH_SNAPSHOT_CHUNKS_MAX = Math.ceil(
  TOOL_SEARCH_AUDIT_NODE_LIMIT * TOOL_SEARCH_SNAPSHOT_RECORD_BYTES_MAX
  / (TOOL_SEARCH_RECORD_JSON_BYTES_MAX - TOOL_SEARCH_SNAPSHOT_RECORD_BYTES_MAX),
)
export const TOOL_SEARCH_REBUILD_CHUNKS_MAX
  = TOOL_SEARCH_SOURCE_CHUNKS_MAX + TOOL_SEARCH_SNAPSHOT_CHUNKS_MAX
/** FTS/LIKE 查询最多接受的 whitespace terms。 */
export const TOOL_SEARCH_TERM_LIMIT = 32
/** 同时约束 FTS 工作量与 query-bound cursor 长度。 */
export const TOOL_SEARCH_QUERY_MAX = 1024
/** offset cursor 的防御性工作量上限；cursor 不是授权边界。 */
export const TOOL_SEARCH_CURSOR_OFFSET_MAX = 1_000_000

/** 全局工具搜索的完整结果；只在权限和可见性候选筛选后 hydrate。 */
export interface ToolSearchHit {
  path: TreePath
  tool: ToolSpec
}

/** adapter 返回的轻量候选；resumeOffset 仅在当前请求内传递，不暴露给协议调用方。 */
export interface ToolSearchCandidate {
  name: string
  path: TreePath
  ref: string
  resumeOffset: number
  revision: number
}

export interface ToolSearchHydration {
  /** 因页面字节上限可能只消费输入候选的前缀。 */
  consumed: number
  /** 与输入候选同序的完整 raw ToolSpec。 */
  hits: ToolSearchHit[]
}

export interface ToolSearchOptions {
  cursor?: string
  limit?: number
  mode?: 'keyword' | 'semantic'
}

/** 宿主提供的全局工具索引；权限和虚拟化仍由 gateway 处理。 */
export interface SearchIndex {
  readonly capabilities: readonly SearchCapability[]
  cursorFor(
    query: string,
    candidate: ToolSearchCandidate,
    mode?: 'keyword' | 'semantic',
  ): Promise<string>
  hydrate(candidates: readonly ToolSearchCandidate[]): Promise<ToolSearchHydration>
  search(query: string, opts?: ToolSearchOptions): Promise<Page<ToolSearchCandidate>>
}

/** 仅声明 keyword capability 的 adapter 在 JS runtime 也须拒绝 semantic/未知 mode。 */
export function assertKeywordToolSearchMode(opts?: ToolSearchOptions): void {
  if (opts?.mode !== undefined && opts.mode !== 'keyword') {
    throw new TBError('invalid_argument', `SearchIndex 不支持 mode '${String(opts.mode)}'`)
  }
}

/** Search/List 共用的 default 50 / max 200；非数字 fail closed，超上限静默钳制。 */
export function normalizeToolSearchLimit(limit: unknown): number {
  if (limit === undefined) return LIST_LIMIT_DEFAULT
  if (typeof limit !== 'number' || !Number.isFinite(limit) || !Number.isInteger(limit)) {
    throw new TBError('invalid_argument', 'opts.limit 必须是整数')
  }
  if (limit < 1) return LIST_LIMIT_DEFAULT
  return Math.min(limit, LIST_LIMIT_MAX)
}

/** 索引持久层使用的规范化工具记录；JSON 是 raw ToolSpec 的完整存储形态。 */
export interface SerializedToolSearchRecord {
  description: string
  feedback: string
  name: string
  path: TreePath
  toolJson: string
}

/** rebuild 使用的物化文档；feedback 只来自 owning node 的可见反馈投影。 */
export interface ToolSearchDocument extends ToolSearchHit {
  feedback?: string
}

/**
 * 可变索引的宿主契约。写入单位是节点快照，避免逐条 upsert 遗留已删除工具；
 * rebuild 用于首次 seed 与运维修复，removePrefix 用于设备子树回收。
 */
export interface MutableSearchIndex extends SearchIndex {
  initialized(): Promise<boolean>
  rebuild(documents: readonly ToolSearchDocument[]): Promise<void>
  remove(path: TreePath): Promise<void>
  removePrefix(path: TreePath): Promise<void>
  replace(
    path: TreePath,
    tools: readonly ToolSpec[],
    opts?: { feedback?: string },
  ): Promise<void>
}

export type PreparedToolSearchQuery
  = | { expression: string, kind: 'fts' }
    | { kind: 'like', patterns: string[] }
    | { expression: string, kind: 'hybrid', patterns: string[] }

function serializedRecord(
  path: TreePath,
  tool: ToolSpec,
  feedback: string,
): SerializedToolSearchRecord {
  if (typeof tool.name !== 'string' || tool.name.length === 0) {
    throw new TBError('invalid_argument', '工具索引条目的 name 必须是非空字符串')
  }
  if (tool.description !== undefined && typeof tool.description !== 'string') {
    throw new TBError('invalid_argument', `工具 '${tool.name}' 的 description 必须是字符串`)
  }
  if (typeof feedback !== 'string') {
    throw new TBError('invalid_argument', `工具 '${tool.name}' 的 feedback 必须是字符串`)
  }
  let toolJson: string | undefined
  try {
    toolJson = JSON.stringify(tool)
  } catch {
    throw new TBError('invalid_argument', `工具 '${tool.name}' 不能序列化为 JSON`)
  }
  if (toolJson === undefined) {
    throw new TBError('invalid_argument', `工具 '${tool.name}' 不能序列化为 JSON`)
  }
  const values = [path, tool.name, tool.description ?? '', feedback, toolJson]
  const rowBytes = values.reduce(
    (total, value) => total + new TextEncoder().encode(value).length,
    0,
  )
  if (rowBytes > TOOL_SEARCH_ROW_BYTES_MAX) {
    throw new TBError(
      'invalid_argument',
      `工具 '${tool.name}' 的索引记录过大(${rowBytes} > ${TOOL_SEARCH_ROW_BYTES_MAX} bytes)`,
    )
  }
  const record = {
    description: tool.description ?? '',
    feedback,
    name: tool.name,
    path,
    toolJson,
  }
  // D1 通过 json_each(?) 接收数组；即使只有一条，也必须计入外层 `[]`。
  const envelope = JSON.stringify([{
    description: record.description,
    feedback: record.feedback,
    name: record.name,
    path: record.path,
    tool: JSON.parse(record.toolJson) as unknown,
  }])
  const envelopeBytes = new TextEncoder().encode(envelope).length
  if (envelopeBytes > TOOL_SEARCH_RECORD_JSON_BYTES_MAX) {
    throw new TBError(
      'invalid_argument',
      `工具 '${tool.name}' 的索引传输记录过大(${envelopeBytes} > ${TOOL_SEARCH_RECORD_JSON_BYTES_MAX} bytes)`,
    )
  }
  return record
}

function jsonPayload(record: SerializedToolSearchRecord): Record<string, unknown> {
  return {
    description: record.description,
    feedback: record.feedback,
    name: record.name,
    path: record.path,
    tool: JSON.parse(record.toolJson) as unknown,
  }
}

/** 把索引路径规范化为 registry 使用的无首尾斜杠形态。 */
export function normalizeToolSearchPath(path: TreePath): TreePath {
  const canonical = normalizePath(path)
  const pathError = validatePath(canonical)
  if (pathError !== null) throw pathError
  return canonical
}

/** 校验并序列化一个节点的完整 raw ToolSpec 快照；重复工具名 fail closed。 */
export function serializeToolSearchSnapshot(
  path: TreePath,
  tools: readonly ToolSpec[],
  feedback = '',
): SerializedToolSearchRecord[] {
  const canonical = normalizeToolSearchPath(path)
  const names = new Set<string>()
  const records = tools.map((tool) => {
    const record = serializedRecord(canonical, tool, feedback)
    if (names.has(record.name)) {
      throw new TBError(
        'invalid_argument',
        `工具索引快照 '${canonical}' 含重复工具名 '${record.name}'`,
      )
    }
    names.add(record.name)
    return record
  })
  const snapshotBytes = new TextEncoder().encode(
    JSON.stringify(records.map(jsonPayload)),
  ).length
  if (snapshotBytes > TOOL_SEARCH_NODE_JSON_BYTES_MAX) {
    throw new TBError(
      'rate_limited',
      `工具索引节点 '${canonical}' 的 JSON1 快照过大(${snapshotBytes} > ${TOOL_SEARCH_NODE_JSON_BYTES_MAX} bytes)`,
    )
  }
  return records
}

/** 校验并序列化全量 rebuild 输入；规范化后相同 path/name 视为冲突。 */
export function serializeToolSearchDocuments(
  documents: readonly ToolSearchDocument[],
): SerializedToolSearchRecord[] {
  const groups = new Map<TreePath, { feedback: string, tools: ToolSpec[] }>()
  for (const { feedback = '', path, tool } of documents) {
    const canonical = normalizeToolSearchPath(path)
    const group = groups.get(canonical)
    if (group === undefined) {
      groups.set(canonical, { feedback, tools: [tool] })
      continue
    }
    if (group.feedback !== feedback) {
      throw new TBError(
        'invalid_argument',
        `工具索引节点 '${canonical}' 的 feedback 投影不一致`,
      )
    }
    group.tools.push(tool)
  }
  if (groups.size > TOOL_SEARCH_AUDIT_NODE_LIMIT) {
    throw new TBError(
      'rate_limited',
      `工具索引最多物化 ${TOOL_SEARCH_AUDIT_NODE_LIMIT} 个节点`,
    )
  }
  return [...groups].flatMap(([path, group]) =>
    serializeToolSearchSnapshot(path, group.tools, group.feedback))
}

/** 兼容旧调用名；新代码应使用 serializeToolSearchDocuments。 */
export const serializeToolSearchHits = serializeToolSearchDocuments

/** 节点快照摘要；用于 material-change 判定，避免相同快照无谓失效全部 cursor。 */
function stableDigest(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let hash = 0xcbf29ce484222325n
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

export function toolSearchSnapshotDigest(
  records: readonly SerializedToolSearchRecord[],
): string {
  return stableDigest([...records]
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .map(record => [
      record.path,
      record.name,
      record.description,
      record.feedback,
      record.toolJson,
    ]))
}

/** rebuild 按 owning path 生成快照摘要。 */
export function toolSearchSnapshotDigests(
  records: readonly SerializedToolSearchRecord[],
): Map<TreePath, string> {
  const grouped = new Map<TreePath, SerializedToolSearchRecord[]>()
  for (const record of records) {
    const group = grouped.get(record.path)
    if (group === undefined) grouped.set(record.path, [record])
    else group.push(record)
  }
  return new Map([...grouped].map(([path, group]) => [path, toolSearchSnapshotDigest(group)]))
}

export function toolSearchSnapshotDigestsEqual(
  left: ReadonlyMap<TreePath, string>,
  right: ReadonlyMap<TreePath, string>,
): boolean {
  return left.size === right.size
    && [...left].every(([path, digest]) => right.get(path) === digest)
}

export function normalizeToolSearchQuery(query: string): string {
  if (query.includes('\0')) {
    throw new TBError('invalid_argument', '搜索 query 不得包含 NUL 字符')
  }
  const normalized = query.trim()
  if (normalized.length === 0) {
    throw new TBError('invalid_argument', '搜索 query 不能为空')
  }
  if (normalized.length > TOOL_SEARCH_QUERY_MAX) {
    throw new TBError('invalid_argument', `搜索 query 最多 ${TOOL_SEARCH_QUERY_MAX} 个字符`)
  }
  return normalized
}

/** 把用户输入变成只含 literal phrase 的 FTS5 MATCH 表达式，不开放查询语法。 */
export function literalToolSearchQuery(query: string): string {
  const terms = normalizeToolSearchQuery(query).split(/\s+/u)
  return terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' ')
}

function likePattern(term: string): string {
  const escaped = term
    .replaceAll('!', '!!')
    .replaceAll('%', '!%')
    .replaceAll('_', '!_')
  return `%${escaped}%`
}

/**
 * 长词继续由 trigram FTS 匹配，短词分别用 escaped LIKE；hybrid 同时 AND 两侧。
 * 因 LIKE pattern 只来自 `<3` code points 的 term，始终低于 D1 的 50-byte 限制。
 */
export function prepareToolSearchQuery(query: string): PreparedToolSearchQuery {
  const normalized = normalizeToolSearchQuery(query)
  const terms = normalized.split(/\s+/u)
  if (terms.length > TOOL_SEARCH_TERM_LIMIT) {
    throw new TBError('invalid_argument', `搜索 query 最多 ${TOOL_SEARCH_TERM_LIMIT} 个 terms`)
  }
  const short = terms.filter(term => Array.from(term).length < 3)
  const long = terms.filter(term => Array.from(term).length >= 3)
  const patterns = short.map(likePattern)
  if (long.length === 0) return { kind: 'like', patterns }
  const expression = long.map(term => `"${term.replaceAll('"', '""')}"`).join(' ')
  return patterns.length === 0
    ? { kind: 'fts', expression }
    : { kind: 'hybrid', expression, patterns }
}

interface CursorPayload {
  h: string
  m: 'keyword' | 'semantic'
  o: number
  r: number
  v: 1
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function base64UrlEncode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += BASE64_ALPHABET[(n >>> 18) & 63]
    out += BASE64_ALPHABET[(n >>> 12) & 63]
    if (i + 1 < bytes.length) out += BASE64_ALPHABET[(n >>> 6) & 63]
    if (i + 2 < bytes.length) out += BASE64_ALPHABET[n & 63]
  }
  return out
}

function base64UrlDecode(value: string): Uint8Array {
  if (
    value.length === 0
    || value.length > 4096
    || value.length % 4 === 1
    || !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new TBError('invalid_argument', '搜索 cursor 格式非法')
  }
  const bytes: number[] = []
  for (let i = 0; i < value.length; i += 4) {
    const chars = value.slice(i, i + 4)
    const values = [...chars].map(char => BASE64_ALPHABET.indexOf(char))
    if (values.some(n => n < 0)) throw new TBError('invalid_argument', '搜索 cursor 格式非法')
    const a = values[0] ?? 0
    const b = values[1] ?? 0
    const c = values[2] ?? 0
    const d = values[3] ?? 0
    const n = (a << 18) | (b << 12) | (c << 6) | d
    bytes.push((n >>> 16) & 255)
    if (chars.length >= 3) bytes.push((n >>> 8) & 255)
    if (chars.length >= 4) bytes.push(n & 255)
  }
  return new Uint8Array(bytes)
}

function cursorSecretBytes(secret: string): Uint8Array {
  if (!/^[a-f0-9]{64}$/.test(secret)) {
    throw new TBError('internal', '工具搜索 cursor secret 格式非法')
  }
  return new Uint8Array(secret.match(/.{2}/g)?.map(value => Number.parseInt(value, 16)) ?? [])
}

async function cursorCryptoKey(secret: string): Promise<ToolSearchCryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    cursorSecretBytes(secret),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encodeToolSearchCursor(
  query: string,
  mode: 'keyword' | 'semantic',
  revision: number,
  offset: number,
  secret: string,
): Promise<string> {
  const payload: CursorPayload = {
    h: stableDigest(normalizeToolSearchQuery(query)),
    m: mode,
    o: offset,
    r: revision,
    v: 1,
  }
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { iv, name: 'AES-GCM' },
    await cursorCryptoKey(secret),
    new TextEncoder().encode(JSON.stringify(payload)),
  ))
  const sealed = new Uint8Array(iv.length + ciphertext.length)
  sealed.set(iv)
  sealed.set(ciphertext, iv.length)
  return base64UrlEncode(sealed)
}

/** 解析并校验 cursor 与本次 query/mode/index revision 的绑定，返回 raw offset。 */
export async function decodeToolSearchCursor(
  cursor: string | undefined,
  query: string,
  mode: 'keyword' | 'semantic',
  revision: number,
  secret: string,
): Promise<number> {
  if (cursor === undefined) return 0
  let value: unknown
  try {
    const sealed = base64UrlDecode(cursor)
    if (sealed.length <= 12) throw new Error('truncated cursor')
    const plaintext = await crypto.subtle.decrypt(
      { iv: sealed.slice(0, 12), name: 'AES-GCM' },
      await cursorCryptoKey(secret),
      sealed.slice(12),
    )
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(plaintext)))
  } catch (error) {
    if (error instanceof TBError) throw error
    throw new TBError('invalid_argument', '搜索 cursor 格式非法')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TBError('invalid_argument', '搜索 cursor 格式非法')
  }
  const payload = value as Partial<CursorPayload>
  const keys = Object.keys(payload).sort().join(',')
  if (
    keys !== 'h,m,o,r,v'
    || payload.v !== 1
    || payload.h !== stableDigest(normalizeToolSearchQuery(query))
    || payload.m !== mode
    || payload.r !== revision
    || !Number.isSafeInteger(payload.o)
    || (payload.o ?? -1) < 0
    || (payload.o ?? 0) > TOOL_SEARCH_CURSOR_OFFSET_MAX
  ) {
    throw new TBError('invalid_argument', '搜索 cursor 已失效或与当前查询不匹配')
  }
  return payload.o ?? 0
}
