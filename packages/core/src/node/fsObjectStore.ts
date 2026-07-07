/**
 * FsObjectStore:node:fs/promises 实现的 ObjectStore(fs 契约 / file provider)。
 *
 * 多根语义:roots 数组,entry key 首段 = 各 root 的 basename(basename 冲突由调用方
 * hello 校验拒,本模块构造时防御性抛 invalid_argument)。路径安全两层:
 * normalizeEntryPath(字面穿越)+ realpath-in-root(symlink 逃逸,path.ts 只做字面判定)。
 *
 * etag = mtimeMs+size 派生(36 进制拼接):put 后 stat 即稳定,head/list 无需读内容;
 * 同毫秒同尺寸覆写存在碰撞窗口,但 etag 只支撑乐观并发(ifMatchEtag),可接受。
 * FS 无用户 metadata:meta.metadata 恒 {},put 的 metadata 不持久化。contentType 不落盘,
 * 由扩展名推断(objectProvider.isInlineable 只内联 text/* 与 application/json,文本扩展名
 * 必须产出 text/* mime,否则设备 fs 的 Get 一律走 $ref → 无 presign/relay 时 503);
 * put 传入的 contentType 同样不持久化,读回以扩展名推断为准(与 r2/s3 的差异见文件语义)。
 */

import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import {
  bytesToObjectStream,
  type ObjectBody,
  type ObjectBodyStream,
  type ObjectListOptions,
  type ObjectListResult,
  type ObjectMeta,
  type ObjectPutOptions,
  type ObjectStore,
  objectBodyToBytes,
} from '../context/objectStore'
import { normalizeEntryPath } from '../context/path'
import { TBError } from '../errors'

function isErrnoCode(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === code
}

function escapeError(key: string): TBError {
  return new TBError('invalid_argument', `非法 entry 路径 '${key}':symlink 逃逸根目录`)
}

/** 扩展名 → contentType;文本类必须映射为 text/*(或 application/json)才能被内联。 */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.jsx': 'text/javascript',
  '.ts': 'text/x-typescript',
  '.tsx': 'text/x-typescript',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.xml': 'text/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/plain',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.wasm': 'application/wasm',
}

/** key 扩展名(大小写不敏感)→ contentType;未知/无扩展名/dotfile → octet-stream。 */
export function fsContentTypeOf(key: string): string {
  const base = key.slice(key.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return 'application/octet-stream'
  return CONTENT_TYPE_BY_EXT[base.slice(dot).toLowerCase()] ?? 'application/octet-stream'
}

interface ResolvedKey {
  /** 根的绝对路径。 */
  root: string
  /** 根内相对路径(不含 basename 首段)。 */
  rel: string
  /** 磁盘绝对路径。 */
  full: string
  /** 规范化后的完整 key(<rootBasename>/<rel>)。 */
  key: string
}

export class FsObjectStore implements ObjectStore {
  /** root basename → root 绝对路径。 */
  private readonly rootsByBase = new Map<string, string>()

  constructor(roots: string[]) {
    if (roots.length === 0) {
      throw new TBError('invalid_argument', 'FsObjectStore: roots 不能为空')
    }
    for (const root of roots) {
      const abs = resolve(root)
      const base = basename(abs)
      if (base === '' || base === sep) {
        throw new TBError('invalid_argument', `FsObjectStore: 非法根路径 '${root}'`)
      }
      if (this.rootsByBase.has(base)) {
        throw new TBError('invalid_argument', `FsObjectStore: 根 basename 冲突 '${base}'`)
      }
      this.rootsByBase.set(base, abs)
    }
  }

  async head(key: string): Promise<ObjectMeta | null> {
    const r = this.resolveKey(key)
    if (r === null) return null
    await this.assertInRoot(r.root, r.full, key)
    try {
      const st = await stat(r.full)
      if (!st.isFile()) return null
      return this.metaOf(r.key, st)
    } catch (e) {
      if (isErrnoCode(e, 'ENOENT')) return null
      throw e
    }
  }

  async get(key: string): Promise<{ meta: ObjectMeta; body: ObjectBodyStream } | null> {
    const r = this.resolveKey(key)
    if (r === null) return null
    await this.assertInRoot(r.root, r.full, key)
    try {
      const st = await stat(r.full)
      if (!st.isFile()) return null
      const bytes = new Uint8Array(await readFile(r.full))
      return { meta: this.metaOf(r.key, st), body: bytesToObjectStream(bytes) }
    } catch (e) {
      if (isErrnoCode(e, 'ENOENT')) return null
      throw e
    }
  }

  async put(key: string, body: ObjectBody, opts?: ObjectPutOptions): Promise<ObjectMeta> {
    const r = this.resolveKey(key)
    if (r === null) {
      throw new TBError('invalid_argument', `非法 entry 路径 '${key}':未知根或缺相对路径`)
    }
    await this.assertInRoot(r.root, r.full, key)
    if (opts?.ifMatchEtag !== undefined) {
      const existing = await this.head(key)
      if (opts.ifMatchEtag !== existing?.etag) {
        throw new TBError('conflict', `etag 不匹配:'${key}'`)
      }
    }
    const bytes = await objectBodyToBytes(body)
    await mkdir(dirname(r.full), { recursive: true })
    await writeFile(r.full, bytes)
    const st = await stat(r.full)
    return this.metaOf(r.key, st)
  }

  async delete(key: string): Promise<void> {
    const r = this.resolveKey(key)
    if (r === null) return // 幂等:未知根视同不存在
    await this.assertInRoot(r.root, r.full, key)
    try {
      const st = await stat(r.full)
      if (!st.isFile()) return // 目录不是对象:no-op
      await rm(r.full)
    } catch (e) {
      if (isErrnoCode(e, 'ENOENT')) return
      throw e
    }
  }

  async list(prefix: string, opts?: ObjectListOptions): Promise<ObjectListResult> {
    const delimiter = opts?.delimiter
    const limit = opts?.limit ?? 1000
    // 枚举全部根下文件的 (key, meta),按 key 字典序;逃逸/悬空 symlink 静默跳过。
    const files: Array<{ key: string; meta: ObjectMeta }> = []
    for (const [base, root] of this.rootsByBase) {
      // 剪枝:该根的所有 key 均以 `${base}/` 开头,与 prefix 无交集则跳过
      const rootPrefix = `${base}/`
      if (!rootPrefix.startsWith(prefix) && !prefix.startsWith(rootPrefix)) continue
      let names: string[]
      try {
        names = (await readdir(root, { recursive: true })) as string[]
      } catch (e) {
        if (isErrnoCode(e, 'ENOENT')) continue // 根不存在:视同空
        throw e
      }
      for (const name of names) {
        const rel = name.split(sep).join('/')
        const key = `${base}/${rel}`
        if (!key.startsWith(prefix)) continue
        const full = join(root, name)
        try {
          await this.assertInRoot(root, full, key)
          const st = await stat(full)
          if (!st.isFile()) continue
          files.push({ key, meta: this.metaOf(key, st) })
        } catch (e) {
          if (e instanceof TBError || isErrnoCode(e, 'ENOENT')) continue
          throw e
        }
      }
    }
    files.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    // delimiter 折叠 + cursor 分页:与 MemoryObjectStore 同一套语义(sortKey 字典序)
    const entries: Array<{ sortKey: string; item: ObjectMeta | { prefix: string } }> = []
    const seenPrefixes = new Set<string>()
    for (const file of files) {
      if (delimiter !== undefined) {
        const rest = file.key.slice(prefix.length)
        const idx = rest.indexOf(delimiter)
        if (idx >= 0) {
          const sub = prefix + rest.slice(0, idx + delimiter.length)
          if (!seenPrefixes.has(sub)) {
            seenPrefixes.add(sub)
            entries.push({ sortKey: sub, item: { prefix: sub } })
          }
          continue
        }
      }
      entries.push({ sortKey: file.key, item: file.meta })
    }
    entries.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    let start = 0
    if (opts?.cursor !== undefined) {
      const cursor = opts.cursor
      start = entries.findIndex((e) => e.sortKey > cursor)
      if (start < 0) return { items: [] }
    }
    const page = entries.slice(start, start + limit)
    const hasMore = start + limit < entries.length
    const last = page[page.length - 1]
    return hasMore && last
      ? { items: page.map((e) => e.item), cursor: last.sortKey }
      : { items: page.map((e) => e.item) }
  }

  /** key → 磁盘路径;穿越 → 抛 invalid_argument(normalizeEntryPath),未知根/根本身 → null。 */
  private resolveKey(key: string): ResolvedKey | null {
    const normalized = normalizeEntryPath(key)
    const slash = normalized.indexOf('/')
    if (slash < 0) return null // 只有根段,没有对象相对路径
    const base = normalized.slice(0, slash)
    const rel = normalized.slice(slash + 1)
    const root = this.rootsByBase.get(base)
    if (root === undefined) return null
    return { root, rel, full: join(root, ...rel.split('/')), key: normalized }
  }

  /**
   * realpath-in-root:full 的最近存在祖先(含自身)realpath 必须仍在 root 的 realpath 内。
   * 字面判定挡不住 symlink——root 内的链接可指向根外,必须按解析后的真实路径判。
   */
  private async assertInRoot(root: string, full: string, key: string): Promise<void> {
    let rootReal: string
    try {
      rootReal = await realpath(root)
    } catch (e) {
      if (isErrnoCode(e, 'ENOENT')) {
        throw new TBError('unavailable', `fs root 不存在:'${root}'`)
      }
      throw e
    }
    let probe = full
    for (;;) {
      try {
        const real = await realpath(probe)
        if (real !== rootReal && !real.startsWith(rootReal + sep)) throw escapeError(key)
        return
      } catch (e) {
        if (e instanceof TBError) throw e
        if (!isErrnoCode(e, 'ENOENT')) throw e
        const parent = dirname(probe)
        if (parent === probe) throw escapeError(key) // 走到文件系统根仍不存在:异常兜底
        probe = parent
      }
    }
  }

  private metaOf(key: string, st: { mtimeMs: number; size: number; mtime: Date }): ObjectMeta {
    return {
      key,
      etag: `${st.mtimeMs.toString(36)}-${st.size.toString(36)}`,
      size: st.size,
      contentType: fsContentTypeOf(key),
      updatedAt: st.mtime.toISOString(),
      metadata: {},
    }
  }
}
