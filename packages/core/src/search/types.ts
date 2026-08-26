import type { ToolSpec } from '../tool/types'
import {
  LIST_LIMIT_MAX,
  type Page,
  type TreePath,
} from '../types'
import { base64urlDecode, base64urlEncode } from '../encoding/base64url'
import { canonicalizePath, validatePath } from '../tree/path'
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

export type SearchCapability = 'search' | 'search:federated' | 'search:semantic'

/** 单次 adapter 轻量候选查询上限；gateway 可在一个请求内分批扫描。 */
export const TOOL_SEARCH_BATCH_LIMIT = 100
/** 单个协议请求允许扫描的 raw candidate 累计上限。 */
export const TOOL_SEARCH_WORK_LIMIT = 400
/** 每次 canonical audit 最多读取的 registry 节点数；与 ~tree 的全树预算对齐。 */
export const TOOL_SEARCH_AUDIT_NODE_LIMIT = 500
/** 单节点可索引 JSON1 快照上限；超额节点不影响 canonical 工具调用，只从派生索引排除。 */
export const TOOL_SEARCH_NODE_JSON_BYTES_MAX = 20_000
/** 单个工具进入全文索引的 description 上限；完整 ToolSpec 仍由 canonical state 返回。 */
export const TOOL_SEARCH_DESCRIPTION_BYTES_MAX = 1_024
/** 单页 canonical ToolSpec JSON 上限，避免大 schema 放大 Worker 内存。 */
export const TOOL_SEARCH_PAGE_BYTES = 4 * 1024 * 1024
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
/** 搜索查询最多接受的 whitespace terms。 */
export const TOOL_SEARCH_TERM_LIMIT = 32
/** D1 单查询 100 个绑定扣除 limit / offset 后可用的搜索单元数。 */
export const TOOL_SEARCH_UNIT_LIMIT = 98
/** 搜索专属默认页大小；宽泛 discovery 不继承 tree/list 的 50 条默认值。 */
export const TOOL_SEARCH_LIMIT_DEFAULT = 10
/** D1 允许的单个 LIKE pattern UTF-8 字节上限。 */
export const TOOL_SEARCH_LIKE_PATTERN_BYTES_MAX = 50
/** 同时约束搜索工作量与 query-bound cursor 长度。 */
export const TOOL_SEARCH_QUERY_MAX = 1024
/** keyword 排序 epoch；排序语义变化必须升级，使旧 offset cursor fail closed。 */
export const TOOL_SEARCH_RANKING_VERSION = 'keyword-v2'
/** offset cursor 的防御性工作量上限；cursor 不是授权边界。 */
export const TOOL_SEARCH_CURSOR_OFFSET_MAX = 1_000_000

/** 全局工具搜索的完整结果；只在权限和可见性候选筛选后 hydrate。 */
export interface ToolSearchHit {
  path: TreePath
  tool: ToolSpec
}

/** adapter 返回的轻量候选；resumeOffset 仅在当前请求内传递，不暴露给协议调用方。 */
export interface ToolSearchCandidate {
  /** 命中的原始 logical terms / 全部原始 logical terms；不按派生 unit 重复计数。 */
  coverage: number
  matchedTermCount: number
  name: string
  path: TreePath
  ref: string
  resumeOffset: number
  revision: number
  /** 仅供宿主在 canonical hydration 提前截页时续签同一搜索约束，不进入 wire。 */
  searchOptionsFingerprint?: string
  totalTermCount: number
}

export type ToolSearchEffect = 'destructive' | 'read' | 'unknown' | 'write'
export type ToolSearchMatching = 'all' | 'best'
/** effect 规范化与 cursor fingerprint 共用的固定顺序。 */
export const TOOL_SEARCH_EFFECTS: readonly ToolSearchEffect[] = [
  'read',
  'write',
  'destructive',
  'unknown',
]

export interface ToolSearchOptions {
  cursor?: string
  effects?: ToolSearchEffect[]
  limit?: number
  matching?: ToolSearchMatching
  minCoverage?: number
  mode?: 'keyword' | 'semantic'
  pathPrefix?: TreePath
}

/** 会改变候选集合或分页档位的规范化约束；cursor 必须绑定其完整指纹。 */
export interface NormalizedToolSearchOptions {
  effects?: ToolSearchEffect[]
  matching: ToolSearchMatching
  minCoverage?: number
  pathPrefix?: TreePath
}

/** 宿主提供的全局工具索引；权限和虚拟化仍由 gateway 处理。 */
export interface SearchIndex {
  readonly capabilities: readonly SearchCapability[]
  cursorFor(
    query: string,
    candidate: ToolSearchCandidate,
    mode?: 'keyword' | 'semantic',
  ): Promise<string>
  /** 联邦 continuation 的 topology binding；不实现的自定义 adapter 只能提供 local search。 */
  revision?(): Promise<number | string>
  search(query: string, opts?: ToolSearchOptions): Promise<Page<ToolSearchCandidate>>
}

/** 仅声明 keyword capability 的 adapter 在 JS runtime 也须拒绝 semantic/未知 mode。 */
export function assertKeywordToolSearchMode(opts?: ToolSearchOptions): void {
  if (opts?.mode !== undefined && opts.mode !== 'keyword') {
    throw new TBError('invalid_argument', `SearchIndex 不支持 mode '${String(opts.mode)}'`)
  }
}

/** Search 使用 default 10 / max 200；非数字 fail closed，超上限静默钳制。 */
export function normalizeToolSearchLimit(limit: unknown): number {
  if (limit === undefined) return TOOL_SEARCH_LIMIT_DEFAULT
  if (typeof limit !== 'number' || !Number.isFinite(limit) || !Number.isInteger(limit)) {
    throw new TBError('invalid_argument', 'opts.limit 必须是整数')
  }
  if (limit < 1) return TOOL_SEARCH_LIMIT_DEFAULT
  return Math.min(limit, LIST_LIMIT_MAX)
}

/** 索引持久层使用的轻量记录；完整 ToolSpec 只保留摘要，不进入派生数据库。 */
export interface SerializedToolSearchRecord {
  description: string
  effect: ToolSearchEffect
  feedback: string
  name: string
  path: TreePath
  toolDigest: string
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

export interface SearchUnit {
  /** 原始 whitespace term 的稳定位置；其派生 whole/run/bigram/codepoint 共用同一 id。 */
  logicalTermId: number
  pattern: string
  tier: number
}

/**
 * 1–2 字符的 ASCII 字母数字 term 不从 path substring 获得 coverage。
 *
 * `on` 命中 `contract/...`、`to` 命中 `tools/...` 这类 mount/path 偶然子串会把
 * 无关工具抬到 full-coverage 桶；name/description/feedback 仍可表达这些短意图词，
 * 显式限定 namespace 则应使用 pathPrefix。pattern 只由本模块的 likePattern 产生，
 * 因此这个判定同时适用于 SQLite、PG 与内存契约实现。
 */
export function searchUnitAllowsPath(unit: SearchUnit): boolean {
  return !/^%[A-Za-z0-9]{1,2}%$/u.test(unit.pattern)
}

export interface PreparedToolSearchQuery {
  /** 原始 whitespace terms 数；不能从截断后的 units 反推。 */
  totalTermCount: number
  units: SearchUnit[]
}

function stableDigest(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let hash = 0xcbf29ce484222325n
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  if (encoder.encode(value).length <= maxBytes) return value
  let result = ''
  let bytes = 0
  for (const char of value) {
    const size = encoder.encode(char).length
    if (bytes + size > maxBytes) break
    result += char
    bytes += size
  }
  return result
}

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
  const record = {
    description: truncateUtf8(tool.description ?? '', TOOL_SEARCH_DESCRIPTION_BYTES_MAX),
    effect: TOOL_SEARCH_EFFECTS.includes(tool.effect as ToolSearchEffect)
      ? tool.effect as ToolSearchEffect
      : 'unknown',
    feedback,
    name: tool.name,
    path,
    toolDigest: stableDigest(toolJson),
  }
  return record
}

function jsonPayload(record: SerializedToolSearchRecord): Record<string, unknown> {
  return {
    description: record.description,
    effect: record.effect,
    feedback: record.feedback,
    name: record.name,
    path: record.path,
  }
}

/** 把索引路径规范化为 registry 使用的无首尾斜杠形态。 */
export function normalizeToolSearchPath(path: TreePath): TreePath {
  const canonical = canonicalizePath(path)
  const pathError = validatePath(canonical)
  if (pathError !== null) throw pathError
  return canonical
}

/**
 * 规范化会改变候选集合/档位的搜索选项。`all` 是 coverage floor=1 的便捷写法，
 * 因此只接受省略 minCoverage 或显式 1，避免一个请求表达互相冲突的约束。
 */
export function normalizeToolSearchOptions(
  opts?: ToolSearchOptions,
): NormalizedToolSearchOptions {
  let effects: ToolSearchEffect[] | undefined
  if (opts?.effects !== undefined) {
    if (!Array.isArray(opts.effects) || opts.effects.length === 0) {
      throw new TBError('invalid_argument', 'opts.effects 必须是非空数组')
    }
    const selected = new Set<ToolSearchEffect>()
    for (const effect of opts.effects) {
      if (!TOOL_SEARCH_EFFECTS.includes(effect)) {
        throw new TBError('invalid_argument', `opts.effects 含非法 effect '${String(effect)}'`)
      }
      selected.add(effect)
    }
    effects = TOOL_SEARCH_EFFECTS.filter(effect => selected.has(effect))
  }
  const matching = opts?.matching ?? 'best'
  if (matching !== 'best' && matching !== 'all') {
    throw new TBError('invalid_argument', `opts.matching '${String(matching)}' 非法`)
  }

  let minCoverage = opts?.minCoverage
  if (
    minCoverage !== undefined
    && (
      typeof minCoverage !== 'number'
      || !Number.isFinite(minCoverage)
      || minCoverage <= 0
      || minCoverage > 1
    )
  ) {
    throw new TBError('invalid_argument', 'opts.minCoverage 必须大于 0 且不超过 1')
  }
  if (matching === 'all') {
    if (minCoverage !== undefined && minCoverage !== 1) {
      throw new TBError('invalid_argument', 'opts.matching=\'all\' 只允许 minCoverage=1')
    }
    minCoverage = 1
  }

  let pathPrefix: TreePath | undefined
  if (opts?.pathPrefix !== undefined) {
    if (typeof opts.pathPrefix !== 'string') {
      throw new TBError('invalid_argument', 'opts.pathPrefix 必须是路径字符串')
    }
    pathPrefix = normalizeToolSearchPath(opts.pathPrefix)
  }
  return {
    ...(effects === undefined ? {} : { effects }),
    matching,
    ...(minCoverage === undefined ? {} : { minCoverage }),
    ...(pathPrefix === undefined ? {} : { pathPrefix }),
  }
}

/** cursor 只绑定改变结果集合/档位的选项；limit 是可安全跨页调整的窗口大小。 */
export function toolSearchOptionsFingerprint(opts?: ToolSearchOptions): string {
  const normalized = normalizeToolSearchOptions(opts)
  return stableDigest([
    normalized.effects ?? null,
    normalized.matching,
    normalized.minCoverage ?? null,
    normalized.pathPrefix ?? null,
  ])
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

/** 节点快照摘要；用于 material-change 判定，避免相同快照无谓失效全部 cursor。 */
export function toolSearchSnapshotDigest(
  records: readonly SerializedToolSearchRecord[],
): string {
  return stableDigest([...records]
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .map(record => [
      record.path,
      record.name,
      record.description,
      record.effect,
      record.feedback,
      record.toolDigest,
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

function likePattern(term: string): string {
  const escaped = term
    .replaceAll('!', '!!')
    .replaceAll('%', '!%')
    .replaceAll('_', '!_')
  return `%${escaped}%`
}

function likePatternBytes(term: string): number {
  return new TextEncoder().encode(likePattern(term)).length
}

function isCjkCodePoint(value: string): boolean {
  return /^(?:\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul})$/u
    .test(value)
}

interface ScriptRun {
  cjk: boolean
  codePoints: string[]
}

function scriptRuns(term: string): ScriptRun[] {
  const runs: ScriptRun[] = []
  for (const codePoint of term) {
    const cjk = isCjkCodePoint(codePoint)
    const current = runs.at(-1)
    if (current?.cjk === cjk) current.codePoints.push(codePoint)
    else runs.push({ cjk, codePoints: [codePoint] })
  }
  return runs
}

function addSearchUnit(
  units: Map<string, SearchUnit>,
  value: string,
  tier: number,
  logicalTermId: number,
): boolean {
  const pattern = likePattern(value)
  if (new TextEncoder().encode(pattern).length > TOOL_SEARCH_LIKE_PATTERN_BYTES_MAX) return false
  // 只在同一个 logical term 内去重。不同原始 term 即使产生相同 pattern，也必须
  // 保留各自身份，coverage 才能按原始 query term 计算。
  const key = `${logicalTermId}\0${pattern}`
  const existing = units.get(key)
  if (existing === undefined || tier > existing.tier) {
    units.set(key, { logicalTermId, pattern, tier })
  }
  return true
}

/** 按 code point 贪心生成不超过 LIKE 字节上限的最大连续块。 */
function addChunkedSearchUnits(
  units: Map<string, SearchUnit>,
  value: string,
  tier: number,
  logicalTermId: number,
): void {
  let chunk = ''
  for (const codePoint of value) {
    if (likePatternBytes(chunk + codePoint) <= TOOL_SEARCH_LIKE_PATTERN_BYTES_MAX) {
      chunk += codePoint
      continue
    }
    if (chunk.length > 0) addSearchUnit(units, chunk, tier, logicalTermId)
    chunk = codePoint
  }
  if (chunk.length > 0) addSearchUnit(units, chunk, tier, logicalTermId)
}

/**
 * 把 query 展开为 escaped LIKE 单元：整词优先，CJK bigram 次之，单字兜底。
 * 每个派生单元保留其原始 whitespace term id；同一 term 内跨 tier 重复 pattern
 * 只保留最高权重，跨 term 不合并。超限时至少保留每个 term 的最高 tier 单元，
 * 其余槽位再按 tier 从高到低填充，避免合法 logical term 从 coverage 分母中失联。
 */
export function prepareToolSearchQuery(
  query: string,
  unitLimit = TOOL_SEARCH_UNIT_LIMIT,
): PreparedToolSearchQuery {
  if (
    !Number.isInteger(unitLimit)
    || unitLimit < 1
    || unitLimit > TOOL_SEARCH_UNIT_LIMIT
  ) {
    throw new TBError('invalid_argument', '工具搜索 unit limit 非法')
  }
  const rawTerms = normalizeToolSearchQuery(query).split(/\s+/u)
  if (rawTerms.length > TOOL_SEARCH_TERM_LIMIT) {
    throw new TBError('invalid_argument', `搜索 query 最多 ${TOOL_SEARCH_TERM_LIMIT} 个 terms`)
  }
  // SQLite LIKE 与 PG ILIKE 的共同 case-fold 下界是 ASCII。按该下界去重并保留
  // 第一次出现的原词作为 pattern；重复/大小写变体不能伪造额外 coverage，同时
  // 不把 PG 更宽的 Unicode case-fold 强加给 SQLite。
  const seenTerms = new Set<string>()
  const terms = rawTerms.filter((term) => {
    const key = term.replace(/[A-Z]/g, char => char.toLowerCase())
    if (seenTerms.has(key)) return false
    seenTerms.add(key)
    return true
  })
  if (terms.length > unitLimit) {
    throw new TBError('invalid_argument', '工具搜索 unit limit 无法覆盖全部 logical terms')
  }

  const units = new Map<string, SearchUnit>()
  for (const [logicalTermId, term] of terms.entries()) {
    const wholeAdded = addSearchUnit(units, term, 4, logicalTermId)

    const runs = scriptRuns(term)
    if (runs.length > 1) {
      for (const run of runs) {
        const value = run.codePoints.join('')
        if (run.cjk) addSearchUnit(units, value, 2, logicalTermId)
        else addChunkedSearchUnits(units, value, 2, logicalTermId)
      }
    } else if (!wholeAdded && runs[0]?.cjk === false) {
      addChunkedSearchUnits(units, term, 2, logicalTermId)
    }
    for (const run of runs) {
      if (!run.cjk) continue
      for (let index = 0; index < run.codePoints.length - 1; index += 1) {
        addSearchUnit(
          units,
          run.codePoints.slice(index, index + 2).join(''),
          2,
          logicalTermId,
        )
      }
      for (const codePoint of run.codePoints) {
        addSearchUnit(units, codePoint, 1, logicalTermId)
      }
    }
  }

  const ordered = [...units.values()].sort((left, right) => right.tier - left.tier)
  if (ordered.length <= unitLimit) {
    return { totalTermCount: terms.length, units: ordered }
  }

  // term 数最多 32，小于 98-unit 下界：先占住每个 term 的最佳 unit，再用全局
  // tier 顺序填剩余预算。最后按原顺序投影，保持 SQL/binding 的确定性。
  const selected = new Set<SearchUnit>()
  const represented = new Set<number>()
  for (const unit of ordered) {
    if (represented.has(unit.logicalTermId)) continue
    represented.add(unit.logicalTermId)
    selected.add(unit)
  }
  for (const unit of ordered) {
    if (selected.size >= unitLimit) break
    selected.add(unit)
  }
  return {
    totalTermCount: terms.length,
    units: ordered.filter(unit => selected.has(unit)),
  }
}

/** 兼容只消费派生 units 的调用点；候选查询应使用 prepareToolSearchQuery 保留分母。 */
export function prepareToolSearchUnits(query: string): SearchUnit[] {
  return prepareToolSearchQuery(query).units
}

interface CursorPayload {
  f: string
  h: string
  k: typeof TOOL_SEARCH_RANKING_VERSION
  m: 'keyword' | 'semantic'
  o: number
  r: number
  v: 2
}

// base64url 编解码用 encoding/base64url 统一实现;这里只保留 cursor 语义级校验
// (空串/长度上限),解码失败一律归一为 invalid_argument。

function cursorBase64UrlDecode(value: string): Uint8Array {
  if (value.length === 0 || value.length > 4096) {
    throw new TBError('invalid_argument', '搜索 cursor 格式非法')
  }
  try {
    return base64urlDecode(value)
  } catch {
    throw new TBError('invalid_argument', '搜索 cursor 格式非法')
  }
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

async function sealToolSearchCursor(
  query: string,
  mode: 'keyword' | 'semantic',
  revision: number,
  offset: number,
  secret: string,
  optionsFingerprint: string,
): Promise<string> {
  const payload: CursorPayload = {
    f: optionsFingerprint,
    h: stableDigest(normalizeToolSearchQuery(query)),
    k: TOOL_SEARCH_RANKING_VERSION,
    m: mode,
    o: offset,
    r: revision,
    v: 2,
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
  return base64urlEncode(sealed)
}

export async function encodeToolSearchCursor(
  query: string,
  mode: 'keyword' | 'semantic',
  revision: number,
  offset: number,
  secret: string,
  opts?: ToolSearchOptions,
): Promise<string> {
  return await sealToolSearchCursor(
    query,
    mode,
    revision,
    offset,
    secret,
    toolSearchOptionsFingerprint(opts),
  )
}

/** 解析并校验 cursor 与本次 query/mode/index revision 的绑定，返回 raw offset。 */
export async function decodeToolSearchCursor(
  cursor: string | undefined,
  query: string,
  mode: 'keyword' | 'semantic',
  revision: number,
  secret: string,
  opts?: ToolSearchOptions,
): Promise<number> {
  if (cursor === undefined) return 0
  let value: unknown
  try {
    const sealed = cursorBase64UrlDecode(cursor)
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
    keys !== 'f,h,k,m,o,r,v'
    || payload.v !== 2
    || payload.k !== TOOL_SEARCH_RANKING_VERSION
    || payload.f !== toolSearchOptionsFingerprint(opts)
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

/** 宿主 canonical hydration 截页时，用候选携带的原搜索指纹续签相同约束。 */
export async function encodeToolSearchCursorForCandidate(
  query: string,
  mode: 'keyword' | 'semantic',
  candidate: ToolSearchCandidate,
  secret: string,
): Promise<string> {
  const fingerprint = candidate.searchOptionsFingerprint ?? toolSearchOptionsFingerprint()
  if (!/^[a-f0-9]{16}$/.test(fingerprint)) {
    throw new TBError('invalid_argument', '工具搜索候选的 options fingerprint 非法')
  }
  return await sealToolSearchCursor(
    query,
    mode,
    candidate.revision,
    candidate.resumeOffset,
    secret,
    fingerprint,
  )
}
