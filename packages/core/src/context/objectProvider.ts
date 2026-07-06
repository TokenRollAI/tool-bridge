/**
 * 通用对象存储 ContextProvider(Proto §5.1 四动词 + Search/Delete)。
 *
 * 全部动词语义(幂等 Write / Update not_found / ifVersion conflict / readOnly 拒写 /
 * $ref 阈值判定 / keyword Search)集中在此——r2、s3(Phase 3)与 file(Phase 4/6)
 * 只提供 ObjectStore 适配,不各自复刻语义。version = 对象 etag(Proto §5.2)。
 */

import { TBError } from '../errors'
import { normalizePath } from '../tree/path'
import type { ListOptions, Page, TreePath } from '../types'
import { LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX } from '../types'
import type { ObjectBody, ObjectMeta, ObjectStore } from './objectStore'
import { readStreamBytes, readStreamText } from './objectStore'
import { normalizeEntryPath } from './path'
import type {
  ContextEntry,
  ContextEntryInput,
  ContextEntryMeta,
  ContextPatch,
  ContextProvider,
  SearchOptions,
} from './types'

/** $ref 内联阈值缺省 1 MiB(DOD.md Phase 3;Proto §5.1 只说"大对象")。 */
export const REF_THRESHOLD_BYTES_DEFAULT = 1024 * 1024
/** presign URL 有效期缺省 15 分钟。 */
export const PRESIGN_TTL_SEC_DEFAULT = 900

/** List 目录条目的 contentType(目录无内容,version 恒空串)。 */
export const DIRECTORY_CONTENT_TYPE = 'application/x-directory'

export interface ObjectContextProviderOptions {
  /** namespace 节点树路径,uri 前缀 node://<nsPath>/。 */
  nsPath: TreePath
  /** 对象 key 前缀(多 namespace 共桶隔离);不参与 uri 与 entry 路径。 */
  keyPrefix?: string
  /** readOnly 挂载:Write/Update/Delete → permission_denied(Proto §5.3)。 */
  readOnly?: boolean
  /** 内联上限(字节):超过或非文本 contentType 走 $ref;缺省 1 MiB。 */
  refThresholdBytes?: number
  /** presign URL 有效期(秒);缺省 900。 */
  presignTtlSec?: number
  /** presign 缺失时的中转 URL 工厂;两者都缺则大对象 Get → unavailable。 */
  relayRefUrl?: (key: string) => string
}

/** 本 provider 实现了可选能力 Search 与 Delete(CONTEXT_CAPABILITIES 声明)。 */
export type ObjectContextProvider = ContextProvider & {
  Search: NonNullable<ContextProvider['Search']>
  Delete: NonNullable<ContextProvider['Delete']>
}

/** limit 缺省 50、超上限 200 静默钳制(Proto §0.3);非正整数拒绝。 */
function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return LIST_LIMIT_DEFAULT
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TBError('invalid_argument', `limit 非法:${limit}`)
  }
  return Math.min(limit, LIST_LIMIT_MAX)
}

/** List/Search 未声明任何 filter 键(Proto §0.3:未声明的键 → invalid_argument)。 */
function rejectFilter(opts: ListOptions | undefined): void {
  if (opts?.filter && Object.keys(opts.filter).length > 0) {
    throw new TBError('invalid_argument', 'List/Search 未声明任何 filter 键(Proto §0.3)')
  }
}

/** contentType 的 mime 主体(去参数、小写)。 */
function mimeOf(contentType: string | undefined): string {
  const ct = contentType ?? ''
  const idx = ct.indexOf(';')
  return (idx >= 0 ? ct.slice(0, idx) : ct).trim().toLowerCase()
}

/** Write 入参 → 落盘 body 与 contentType(非 string content 序列化为 JSON)。 */
function serializeInput(entry: ContextEntryInput): { body: string; contentType: string } {
  if (entry.content === undefined) {
    throw new TBError('invalid_argument', "entry 缺少 'content'")
  }
  if (typeof entry.content === 'string') {
    if (!entry.contentType) {
      throw new TBError('invalid_argument', "字符串 content 必须携带 'contentType'")
    }
    return { body: entry.content, contentType: entry.contentType }
  }
  return {
    body: JSON.stringify(entry.content),
    contentType: entry.contentType || 'application/json',
  }
}

export function createObjectContextProvider(
  store: ObjectStore,
  opts: ObjectContextProviderOptions,
): ObjectContextProvider {
  const nsPath = normalizePath(opts.nsPath)
  const keyPrefixBare = opts.keyPrefix?.replace(/^\/+|\/+$/g, '') ?? ''
  const keyPrefix = keyPrefixBare === '' ? '' : `${keyPrefixBare}/`
  const readOnly = opts.readOnly ?? false
  const refThreshold = opts.refThresholdBytes ?? REF_THRESHOLD_BYTES_DEFAULT
  const presignTtlSec = opts.presignTtlSec ?? PRESIGN_TTL_SEC_DEFAULT

  const keyFor = (path: string): string => keyPrefix + normalizeEntryPath(path)
  const entryPathOf = (key: string): string => key.slice(keyPrefix.length)
  const uriFor = (entryPath: string): string => `node://${nsPath}/${entryPath}`

  const toMeta = (m: ObjectMeta): ContextEntryMeta => ({
    uri: uriFor(entryPathOf(m.key)),
    contentType: m.contentType ?? 'application/octet-stream',
    size: m.size,
    version: m.etag,
    updatedAt: m.updatedAt,
    metadata: m.metadata,
  })

  const assertWritable = (verb: string): void => {
    if (readOnly) {
      throw new TBError('permission_denied', `readOnly 挂载拒绝 ${verb}(Proto §5.3)`)
    }
  }

  const isInlineable = (m: ObjectMeta): boolean => {
    const mime = mimeOf(m.contentType)
    return (mime.startsWith('text/') || mime === 'application/json') && m.size <= refThreshold
  }

  const refUrlFor = async (key: string): Promise<string> => {
    if (store.presign) return store.presign(key, presignTtlSec)
    if (opts.relayRefUrl) return opts.relayRefUrl(key)
    throw new TBError('unavailable', '大对象需要 presign 凭证或中转下载路由,均未配置')
  }

  const notFound = (path: string): TBError => TBError.notFound(`context entry 不存在:'${path}'`)

  return {
    async List(path: string, listOpts?: ListOptions): Promise<Page<ContextEntryMeta>> {
      rejectFilter(listOpts)
      const limit = clampLimit(listOpts?.limit)
      const rel = path === '' ? '' : `${normalizeEntryPath(path)}/`
      const full = keyPrefix + rel
      const res = await store.list(full, { delimiter: '/', cursor: listOpts?.cursor, limit })
      const items: ContextEntryMeta[] = []
      for (const item of res.items) {
        if ('prefix' in item) {
          items.push({
            uri: uriFor(entryPathOf(item.prefix)),
            contentType: DIRECTORY_CONTENT_TYPE,
            version: '',
            updatedAt: '',
            metadata: {},
          })
        } else if (item.key !== full) {
          // 跳过与 prefix 完全相等的目录占位对象
          items.push(toMeta(item))
        }
      }
      return res.cursor !== undefined ? { items, cursor: res.cursor } : { items }
    },

    async Get(path: string): Promise<ContextEntry> {
      const key = keyFor(path)
      const head = await store.head(key)
      if (!head) throw notFound(path)
      const meta = toMeta(head)
      if (!isInlineable(head)) {
        return { ...meta, content: { $ref: await refUrlFor(key) } }
      }
      const got = await store.get(key)
      if (!got) throw notFound(path)
      const text = await readStreamText(got.body)
      if (mimeOf(head.contentType) === 'application/json') {
        try {
          return { ...meta, content: JSON.parse(text) }
        } catch {
          // 存量非法 JSON 按原文本返回,不让读路径 500
        }
      }
      return { ...meta, content: text }
    },

    async Write(path: string, entry: ContextEntryInput): Promise<ContextEntryMeta> {
      assertWritable('Write')
      const key = keyFor(path)
      const { body, contentType } = serializeInput(entry)
      const meta = await store.put(key, body, {
        contentType,
        metadata: entry.metadata ?? {},
        ifMatchEtag: entry.ifVersion,
      })
      return toMeta(meta)
    },

    async Update(path: string, patch: ContextPatch): Promise<ContextEntryMeta> {
      assertWritable('Update')
      const key = keyFor(path)
      if (patch.content === undefined && patch.metadata === undefined) {
        throw new TBError('invalid_argument', 'patch 至少提供 content 或 metadata 之一')
      }
      const head = await store.head(key)
      if (!head) throw notFound(path)
      if (patch.ifVersion !== undefined && patch.ifVersion !== head.etag) {
        throw new TBError('conflict', `ifVersion 不匹配:期望 ${patch.ifVersion},当前 ${head.etag}`)
      }
      let body: ObjectBody
      if (patch.content === undefined) {
        const got = await store.get(key)
        if (!got) throw notFound(path)
        body = await readStreamBytes(got.body) // 二进制安全地原样回写
      } else {
        body = typeof patch.content === 'string' ? patch.content : JSON.stringify(patch.content)
      }
      const meta = await store.put(key, body, {
        contentType: head.contentType, // ContextPatch 无 contentType 字段:保持不变
        metadata: { ...head.metadata, ...patch.metadata },
        ifMatchEtag: head.etag, // read-merge-write 防竞态
      })
      return toMeta(meta)
    },

    async Delete(path: string): Promise<void> {
      assertWritable('Delete')
      await store.delete(keyFor(path))
    },

    async Search(query: string, searchOpts?: SearchOptions): Promise<Page<ContextEntryMeta>> {
      const mode = searchOpts?.mode ?? 'keyword'
      if (mode === 'semantic') {
        throw new TBError(
          'invalid_argument',
          "semantic 检索未声明('search:semantic' capability,Proto §5.1)",
        )
      }
      if (mode !== 'keyword') {
        throw new TBError('invalid_argument', `未知 search mode:'${mode}'`)
      }
      if (typeof query !== 'string' || query === '') {
        throw new TBError('invalid_argument', 'query 不能为空')
      }
      rejectFilter(searchOpts)
      const limit = clampLimit(searchOpts?.limit)
      const q = query.toLowerCase()
      const after = searchOpts?.cursor
      const items: ContextEntryMeta[] = []
      let lastKey: string | undefined
      let hasMore = false
      let storeCursor: string | undefined
      // 深层遍历(不带 delimiter),只看 key 与 metadata,不拉 body;
      // cursor = 最后返回条目的完整 key(对象存储按字典序列举,可续接)。
      do {
        const page = await store.list(keyPrefix, { cursor: storeCursor, limit: LIST_LIMIT_MAX })
        for (const item of page.items) {
          if ('prefix' in item) continue // 无 delimiter 不应出现,防御
          if (after !== undefined && item.key <= after) continue
          const entryPath = entryPathOf(item.key)
          const matched =
            entryPath.toLowerCase().includes(q) ||
            Object.values(item.metadata).some((v) => v.toLowerCase().includes(q))
          if (!matched) continue
          if (items.length < limit) {
            items.push(toMeta(item))
            lastKey = item.key
          } else {
            hasMore = true
            break
          }
        }
        if (hasMore) break
        storeCursor = page.cursor
      } while (storeCursor !== undefined)
      return hasMore && lastKey !== undefined ? { items, cursor: lastKey } : { items }
    },
  }
}
