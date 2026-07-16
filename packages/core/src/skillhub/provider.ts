/**
 * Skillhub Provider:把对象存储当作 "Agent Skill 仓库" 用。
 *
 * 每个 skill = 一个目录 `<id>/`,内含 `SKILL.md`(带 Claude 约定的 frontmatter
 * name/description)+ 若干文本文件(脚本/参考)。存储引擎完全复用 context 的
 * ObjectStore/ObjectContextProvider(etag 版本、$ref 大对象、按 keyPrefix 隔离);
 * 本模块只叠加 "以 skill 为单位" 的分组与 frontmatter 解析这层净新语义。
 *
 * 动词:List/Get/Search(read)+ Publish/Remove(write)。readOnly 挂载拒写。
 */

import {
  type ObjectContextProviderOptions,
  PRESIGN_TTL_SEC_DEFAULT,
  REF_THRESHOLD_BYTES_DEFAULT,
} from '../context/objectProvider'
import type { ObjectMeta, ObjectStore } from '../context/objectStore'
import { readStreamText } from '../context/objectStore'
import { normalizeEntryPath } from '../context/path'
import { TBError } from '../errors'
import { normalizePath } from '../tree/path'
import type { ListOptions, Page, TreePath } from '../types'
import { LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX } from '../types'
import { parseFrontmatter } from './frontmatter'

/** skill 的 frontmatter 中 Claude 约定的必填字段。 */
export const SKILL_DOC = 'SKILL.md'
/** Search 扫描 skill 目录数上限(读 SKILL.md 有子请求预算,取 200 留余量)。 */
export const SKILL_SCAN_MAX = 200

/** List/Search 返回的目录条目(渐进式发现:先看 name/description,再取正文)。 */
export interface SkillSummary {
  id: string
  name: string
  description: string
  version?: string
  updatedAt: string
}

/** 单个文件的元信息(path 相对 skill 根,含 SKILL.md)。 */
export interface SkillFileMeta {
  path: string
  contentType: string
  size?: number
  version: string
}

/** Get(id):SKILL.md 正文(内联)+ 文件清单。 */
export interface SkillDetail extends SkillSummary {
  /** SKILL.md 原文。 */
  content: string
  files: SkillFileMeta[]
}

/** Get(id, file):单个文件正文(大/二进制文件为 { $ref })。 */
export interface SkillFile extends SkillFileMeta {
  content: string | unknown
}

export interface SkillPublishFile {
  /** 相对 skill 根的路径,如 "SKILL.md"、"scripts/run.sh"。 */
  path: string
  content: string
  contentType?: string
}

export interface SkillPublishInput {
  /** 缺省从 SKILL.md 的 frontmatter name 派生 slug。 */
  id?: string
  files: SkillPublishFile[]
}

export interface SkillPublishResult {
  id: string
  name: string
  description: string
  fileCount: number
}

export interface SkillhubProvider {
  List(opts?: ListOptions): Promise<Page<SkillSummary>>
  Get(id: string): Promise<SkillDetail>
  GetFile(id: string, file: string): Promise<SkillFile>
  Search(query: string, opts?: ListOptions): Promise<Page<SkillSummary>>
  Publish(input: SkillPublishInput): Promise<SkillPublishResult>
  Remove(id: string): Promise<void>
}

/** provider 选项与 ObjectContextProvider 同形(直接透传底层存储能力)。 */
export type SkillhubProviderOptions = ObjectContextProviderOptions

/** 扩展名 → contentType(仅文本;未知按 text/plain)。provided contentType 优先。 */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  toml: 'text/plain',
  py: 'text/x-python',
  js: 'text/javascript',
  ts: 'text/plain',
  sh: 'text/x-shellscript',
  html: 'text/html',
  css: 'text/css',
}

function guessContentType(path: string): string {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return 'text/plain'
  return CONTENT_TYPE_BY_EXT[path.slice(dot + 1).toLowerCase()] ?? 'text/plain'
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return LIST_LIMIT_DEFAULT
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TBError('invalid_argument', `limit 非法:${limit}`)
  }
  return Math.min(limit, LIST_LIMIT_MAX)
}

/** skill id 必须是单段、无穿越的干净 slug。 */
function assertSkillId(id: string): string {
  if (typeof id !== 'string' || id === '') {
    throw new TBError('invalid_argument', 'skill id 不能为空')
  }
  const norm = normalizeEntryPath(id)
  if (norm !== id || norm.includes('/')) {
    throw new TBError('invalid_argument', `非法 skill id '${id}':必须是单段 slug(无 '/' 或 '.' 段)`)
  }
  return norm
}

/** frontmatter name → slug(小写、非字母数字折叠为 '-')。 */
function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s
}

export function createSkillhubProvider(
  store: ObjectStore,
  opts: SkillhubProviderOptions,
): SkillhubProvider {
  const keyPrefixBare = opts.keyPrefix?.replace(/^\/+|\/+$/g, '') ?? ''
  const keyPrefix = keyPrefixBare === '' ? '' : `${keyPrefixBare}/`
  const readOnly = opts.readOnly ?? false
  const refThreshold = opts.refThresholdBytes ?? REF_THRESHOLD_BYTES_DEFAULT
  const presignTtlSec = opts.presignTtlSec ?? PRESIGN_TTL_SEC_DEFAULT

  const skillPrefix = (id: string): string => `${keyPrefix}${id}/`
  const docKey = (id: string): string => `${skillPrefix(id)}${SKILL_DOC}`

  const assertWritable = (verb: string): void => {
    if (readOnly) throw new TBError('permission_denied', `readOnly 挂载拒绝 ${verb}`)
  }

  /** 大文件下载 URL:presign 优先,否则中转;两者皆缺 → unavailable。 */
  const refUrlFor = async (key: string): Promise<string> => {
    if (store.presign) return store.presign(key, presignTtlSec)
    if (opts.relayRefUrl) return opts.relayRefUrl(key)
    throw new TBError('unavailable', '大对象需要 presign 凭证或中转下载路由,均未配置')
  }

  /** 读 SKILL.md 原文;不存在 → not_found。 */
  const readDoc = async (id: string): Promise<{ text: string; meta: ObjectMeta }> => {
    const key = docKey(id)
    const got = await store.get(key)
    if (!got) throw TBError.notFound(`skill 不存在:'${id}'`)
    return { text: await readStreamText(got.body), meta: got.meta }
  }

  /** 从 SKILL.md 原文 + 对象 meta 组装目录条目。 */
  const summaryOf = (id: string, text: string, meta: ObjectMeta): SkillSummary => {
    const fm = parseFrontmatter(text).meta
    return {
      id,
      name: fm.name ?? id,
      description: fm.description ?? '',
      ...(fm.version ? { version: fm.version } : {}),
      updatedAt: meta.updatedAt,
    }
  }

  return {
    async List(listOpts?: ListOptions): Promise<Page<SkillSummary>> {
      const limit = clampLimit(listOpts?.limit)
      // 顶层 skill 目录 = keyPrefix 下的折叠前缀。
      const res = await store.list(keyPrefix, {
        delimiter: '/',
        cursor: listOpts?.cursor,
        limit,
      })
      const items: SkillSummary[] = []
      for (const item of res.items) {
        if (!('prefix' in item)) continue // 顶层裸文件(非 skill 目录)忽略
        const id = item.prefix.slice(keyPrefix.length).replace(/\/$/, '')
        if (id === '') continue
        try {
          const { text, meta } = await readDoc(id)
          items.push(summaryOf(id, text, meta))
        } catch {
          // 缺 SKILL.md 的游离目录不计入目录(不让 List 500)
        }
      }
      return res.cursor !== undefined ? { items, cursor: res.cursor } : { items }
    },

    async Get(idRaw: string): Promise<SkillDetail> {
      const id = assertSkillId(idRaw)
      const { text, meta } = await readDoc(id)
      const summary = summaryOf(id, text, meta)
      // 深列举 skill 内全部文件(相对路径)。
      const files: SkillFileMeta[] = []
      const prefix = skillPrefix(id)
      let cursor: string | undefined
      do {
        const page = await store.list(prefix, { cursor, limit: LIST_LIMIT_MAX })
        for (const it of page.items) {
          if ('prefix' in it) continue // 深列举无 delimiter,不应出现
          files.push({
            path: it.key.slice(prefix.length),
            contentType: it.contentType ?? guessContentType(it.key),
            size: it.size,
            version: it.etag,
          })
        }
        cursor = page.cursor
      } while (cursor !== undefined)
      return { ...summary, content: text, files }
    },

    async GetFile(idRaw: string, file: string): Promise<SkillFile> {
      const id = assertSkillId(idRaw)
      const rel = normalizeEntryPath(file)
      const key = `${skillPrefix(id)}${rel}`
      const head = await store.head(key)
      if (!head) throw TBError.notFound(`skill 文件不存在:'${id}/${rel}'`)
      const contentType = head.contentType ?? guessContentType(rel)
      const base: SkillFileMeta = { path: rel, contentType, size: head.size, version: head.etag }
      // skill 文件按约定为 UTF-8 文本(Publish 强制字符串);仅超阈值才走 $ref,
      // 不依赖后端推断的 contentType(FS 宿主按扩展名推断会把 .py 当 octet-stream)。
      if (head.size > refThreshold) {
        return { ...base, content: { $ref: await refUrlFor(key) } }
      }
      const got = await store.get(key)
      if (!got) throw TBError.notFound(`skill 文件不存在:'${id}/${rel}'`)
      return { ...base, content: await readStreamText(got.body) }
    },

    async Search(query: string, searchOpts?: ListOptions): Promise<Page<SkillSummary>> {
      if (typeof query !== 'string' || query === '') {
        throw new TBError('invalid_argument', 'query 不能为空')
      }
      const limit = clampLimit(searchOpts?.limit)
      const q = query.toLowerCase()
      const after = searchOpts?.cursor
      const items: SkillSummary[] = []
      let scanned = 0
      let storeCursor: string | undefined
      let lastPrefix: string | undefined
      let hasMore = false
      do {
        const page = await store.list(keyPrefix, {
          delimiter: '/',
          cursor: storeCursor,
          limit: LIST_LIMIT_MAX,
        })
        for (const it of page.items) {
          if (!('prefix' in it)) continue
          if (after !== undefined && it.prefix <= after) continue
          if (scanned >= SKILL_SCAN_MAX) {
            hasMore = true
            break
          }
          scanned++
          const id = it.prefix.slice(keyPrefix.length).replace(/\/$/, '')
          if (id === '') continue
          let summary: SkillSummary
          try {
            const { text, meta } = await readDoc(id)
            summary = summaryOf(id, text, meta)
          } catch {
            continue
          }
          const hay = `${summary.id}\n${summary.name}\n${summary.description}`.toLowerCase()
          if (!hay.includes(q)) continue
          if (items.length < limit) {
            items.push(summary)
            lastPrefix = it.prefix
          } else {
            hasMore = true
            break
          }
        }
        if (hasMore) break
        storeCursor = page.cursor
      } while (storeCursor !== undefined)
      return hasMore && lastPrefix !== undefined ? { items, cursor: lastPrefix } : { items }
    },

    async Publish(input: SkillPublishInput): Promise<SkillPublishResult> {
      assertWritable('Publish')
      if (!Array.isArray(input.files) || input.files.length === 0) {
        throw new TBError('invalid_argument', 'files 不能为空')
      }
      // 归一相对路径 + 定位 SKILL.md。
      const files = input.files.map((f) => {
        if (typeof f?.content !== 'string') {
          throw new TBError(
            'invalid_argument',
            `文件 '${f?.path}' 的 content 必须是字符串(仅支持文本)`,
          )
        }
        return { rel: normalizeEntryPath(f.path), content: f.content, contentType: f.contentType }
      })
      const doc = files.find((f) => f.rel === SKILL_DOC)
      if (!doc) {
        throw new TBError('invalid_argument', `skill 必须包含 '${SKILL_DOC}'`)
      }
      const fm = parseFrontmatter(doc.content).meta
      if (!fm.name || !fm.description) {
        throw new TBError(
          'invalid_argument',
          `${SKILL_DOC} 的 frontmatter 必须含 name 与 description`,
        )
      }
      const id = assertSkillId(input.id ?? slugify(fm.name))

      // 整体替换语义:删除该 skill 下不在本次提交中的旧文件。
      const prefix = skillPrefix(id)
      const keep = new Set(files.map((f) => `${prefix}${f.rel}`))
      let cursor: string | undefined
      do {
        const page = await store.list(prefix, { cursor, limit: LIST_LIMIT_MAX })
        for (const it of page.items) {
          if ('prefix' in it) continue
          if (!keep.has(it.key)) await store.delete(it.key)
        }
        cursor = page.cursor
      } while (cursor !== undefined)

      for (const f of files) {
        await store.put(`${prefix}${f.rel}`, f.content, {
          contentType: f.contentType || guessContentType(f.rel),
        })
      }
      return { id, name: fm.name, description: fm.description, fileCount: files.length }
    },

    async Remove(idRaw: string): Promise<void> {
      assertWritable('Remove')
      const id = assertSkillId(idRaw)
      const prefix = skillPrefix(id)
      let cursor: string | undefined
      let removed = 0
      do {
        const page = await store.list(prefix, { cursor, limit: LIST_LIMIT_MAX })
        for (const it of page.items) {
          if ('prefix' in it) continue
          await store.delete(it.key)
          removed++
        }
        cursor = page.cursor
      } while (cursor !== undefined)
      if (removed === 0) throw TBError.notFound(`skill 不存在:'${id}'`)
    },
  }
}

/** uri 前缀,供网关/文档引用(与 context 同构)。 */
export function skillhubUriPrefix(nsPath: TreePath): string {
  return `node://${normalizePath(nsPath)}/`
}
