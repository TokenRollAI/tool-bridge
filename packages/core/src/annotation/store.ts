/**
 * AnnotationStore:管理员对树路径的补充说明(纯逻辑,经注入 StateStore 读写)。
 *
 * 每 path 一条,key = `annotation:<path>`(根路径为 `annotation:`);set 即覆盖,无历史。
 * 独立于 TreeNode 存储:补充说明可挂在非注册路径(mcp/http 的工具子路径,如
 * `feishu/create-doc`)上,与 registry 写路径零耦合;节点删除后遗留条目无害
 * (`~help` 404 到不了注入点),list 可见供管理面清理。
 */

import type { Timestamp, TreePath } from '../types'
import { isPrefixOf, normalizePath, validatePath } from '../tree/path'
import { KEY_ANNOTATION, type StateStore } from '../store'
import { TBError } from '../errors'

/** 一条补充说明:path + 全文 + 审计字段。 */
export interface Annotation {
  path: TreePath
  text: string
  updatedAt: Timestamp
  /** 写入者 keyId(审计)。 */
  updatedBy: string
}

/** text trim 后的长度上限(展示在 ~help,须克制)。 */
export const ANNOTATION_TEXT_MAX = 2000

/** 规范化并校验 annotation 目标路径(允许根 = 全树公告)。 */
export function normalizeAnnotationPath(path: string): TreePath {
  const norm = normalizePath(path)
  const invalid = validatePath(norm, { allowRoot: true })
  if (invalid) throw invalid
  return norm
}

export class AnnotationStore {
  constructor(private readonly store: StateStore) {}

  private keyOf(path: TreePath): string {
    return KEY_ANNOTATION + path
  }

  /** 取单条;不存在 → null(not_found 语义由调用方决定)。 */
  async get(path: TreePath): Promise<Annotation | null> {
    const norm = normalizeAnnotationPath(path)
    const raw = await this.store.get(this.keyOf(norm))
    if (raw === null || typeof raw !== 'object') return null
    const a = raw as Annotation
    if (typeof a.text !== 'string') return null
    return {
      path: norm,
      text: a.text,
      updatedAt: typeof a.updatedAt === 'string' ? a.updatedAt : '',
      updatedBy: typeof a.updatedBy === 'string' ? a.updatedBy : '',
    }
  }

  /** 覆盖写入(trim 后 1..ANNOTATION_TEXT_MAX 字符)。 */
  async set(path: TreePath, text: string, updatedBy: string, now: Timestamp): Promise<Annotation> {
    const norm = normalizeAnnotationPath(path)
    const trimmed = text.trim()
    if (trimmed === '') {
      throw new TBError('invalid_argument', 'text 不能为空')
    }
    if (trimmed.length > ANNOTATION_TEXT_MAX) {
      throw new TBError(
        'invalid_argument',
        `text 过长(${trimmed.length} > ${ANNOTATION_TEXT_MAX} 字符)`,
      )
    }
    const entry: Annotation = { path: norm, text: trimmed, updatedAt: now, updatedBy }
    await this.store.put(this.keyOf(norm), entry)
    return entry
  }

  /** 删除;不存在 → not_found。 */
  async remove(path: TreePath): Promise<void> {
    const norm = normalizeAnnotationPath(path)
    if ((await this.get(norm)) === null) {
      throw TBError.notFound(`路径无补充说明:'${norm === '' ? '/' : norm}'`)
    }
    await this.store.delete(this.keyOf(norm))
  }

  /** 枚举 prefix 之下(按段前缀,含 prefix 自身;缺省全量)的条目,按 path 升序。 */
  async list(prefix?: TreePath): Promise<Annotation[]> {
    const normPrefix = prefix === undefined ? '' : normalizeAnnotationPath(prefix)
    const out: Annotation[] = []
    let cursor: string | undefined
    do {
      const page = await this.store.list(KEY_ANNOTATION, {
        ...(cursor !== undefined ? { cursor } : {}),
      })
      for (const { key, value } of page.items) {
        const path = key.slice(KEY_ANNOTATION.length)
        if (!isPrefixOf(normPrefix, path)) continue
        if (value === null || typeof value !== 'object') continue
        const a = value as Annotation
        if (typeof a.text !== 'string') continue
        out.push({
          path,
          text: a.text,
          updatedAt: typeof a.updatedAt === 'string' ? a.updatedAt : '',
          updatedBy: typeof a.updatedBy === 'string' ? a.updatedBy : '',
        })
      }
      cursor = page.cursor
    } while (cursor)
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }
}
