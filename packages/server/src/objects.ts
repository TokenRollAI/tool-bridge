/**
 * createDataObjectStore:平台对象存储('r2' provider 落点)的 Node 实现。
 *
 * core FsObjectStore 是多根语义(key 首段必须等于某 root 的 basename),而平台
 * 对象存储的 key 是平坦任意前缀(默认 ctx/<nodePath>/...)——本模块做薄前缀适配:
 * 出入口统一加/剥内部根段 'objects/',穿越防护复用 FsObjectStore 的两层防护
 * (normalizeEntryPath + realpath-in-root),不重写。cursor 是内部形态原样透传
 * (消费方视 cursor 为不透明串)。无 presign → $ref 走 /~ref 网关中转(现有降级)。
 */

import {
  DEFAULT_STORE_DRIVER_KEY_ROOT,
  normalizeEntryPath,
  type ObjectBody,
  type ObjectBodyStream,
  type ObjectListOptions,
  type ObjectListResult,
  type ObjectMeta,
  type ObjectPutOptions,
  type ObjectStore,
  TBError,
} from '@tool-bridge/core'
import {
  type FileHandle,
  link,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import { constants, type Dirent, mkdirSync } from 'node:fs'
import { FsObjectStore } from '@tool-bridge/core/node'
import { dirname, join, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'

const INTERNAL_ROOT = 'objects'
const TEMP_PREFIX = '.tb-object-upload-'
const STORE_KEY_PREFIX = `${DEFAULT_STORE_DRIVER_KEY_ROOT}/`
const STORE_STAGING_DIR = '.tb-store-staging-v1'
const UPLOAD_TEMP_NAME_RE
  = /^\.tb-object-upload-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i

function toInternal(key: string): string {
  return `${INTERNAL_ROOT}/${key}`
}

function toExternal(key: string): string {
  return key.startsWith(`${INTERNAL_ROOT}/`) ? key.slice(INTERNAL_ROOT.length + 1) : key
}

function externalMeta(meta: ObjectMeta): ObjectMeta {
  return { ...meta, key: toExternal(meta.key) }
}

function isErrnoCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: unknown }).code === code
}

function isUploadTempKey(key: string): boolean {
  return key.split('/').some(segment => segment.startsWith(TEMP_PREFIX))
}

async function writeChunk(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset, null)
    if (bytesWritten === 0) throw new Error('对象临时文件写入未取得进展')
    offset += bytesWritten
  }
}

async function writeStream(handle: FileHandle, stream: ObjectBodyStream): Promise<void> {
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value !== undefined && value.byteLength > 0) await writeChunk(handle, value)
    }
  } catch (error) {
    try {
      await reader.cancel?.(error)
    } catch {
      // 保留原始读/写错误；cancel 只是尽力通知生产方停止。
    }
    throw error
  } finally {
    reader.releaseLock()
  }
}

async function writeBody(handle: FileHandle, body: ObjectBody): Promise<void> {
  if (typeof body === 'string') {
    await writeChunk(handle, Buffer.from(body))
    return
  }
  if (body instanceof Uint8Array) {
    await writeChunk(handle, body)
    return
  }
  if (body instanceof ArrayBuffer) {
    await writeChunk(handle, new Uint8Array(body))
    return
  }
  await writeStream(handle, body)
}

async function assertParentInRoot(root: string, full: string, key: string): Promise<void> {
  const rootReal = await realpath(root)
  const parentReal = await realpath(dirname(full))
  if (parentReal !== rootReal && !parentReal.startsWith(rootReal + sep)) {
    throw new TBError('invalid_argument', `非法 entry 路径 '${key}':symlink 逃逸根目录`)
  }
}

/** mkdir 前检查最近存在祖先，避免递归建目录先沿 symlink 在根外产生副作用。 */
async function assertAncestorInRoot(root: string, full: string, key: string): Promise<void> {
  const rootReal = await realpath(root)
  let probe = dirname(full)
  for (;;) {
    try {
      const ancestorReal = await realpath(probe)
      if (ancestorReal !== rootReal && !ancestorReal.startsWith(rootReal + sep)) {
        throw new TBError('invalid_argument', `非法 entry 路径 '${key}':symlink 逃逸根目录`)
      }
      return
    } catch (error) {
      if (error instanceof TBError) throw error
      if (!isErrnoCode(error, 'ENOENT')) throw error
      const parent = dirname(probe)
      if (parent === probe) {
        throw new TBError('invalid_argument', `非法 entry 路径 '${key}':symlink 逃逸根目录`)
      }
      probe = parent
    }
  }
}

async function cleanupStagingTree(dir: string, cutoffMs: number): Promise<number> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) return 0
    throw error
  }
  let deleted = 0
  for (const entry of entries) {
    const path = join(dir, entry.name)
    // Dirent symlink 不递归、不删除；Store staging 永远是普通文件。
    if (entry.isDirectory()) {
      deleted += await cleanupStagingTree(path, cutoffMs)
      continue
    }
    if (!entry.isFile() || !UPLOAD_TEMP_NAME_RE.test(entry.name)) continue
    try {
      const info = await stat(path)
      if (info.mtimeMs > cutoffMs) continue
      await rm(path)
      deleted++
    } catch (error) {
      if (!isErrnoCode(error, 'ENOENT')) throw error
    }
  }
  return deleted
}

export function createDataObjectStore(dataDir: string): ObjectStore {
  const root = join(dataDir, INTERNAL_ROOT)
  mkdirSync(root, { recursive: true })
  const fs = new FsObjectStore([root])
  return {
    async head(key: string): Promise<ObjectMeta | null> {
      const meta = await fs.head(toInternal(key))
      return meta === null ? null : externalMeta(meta)
    },
    async get(key: string) {
      const normalizedKey = normalizeEntryPath(key)
      const meta = await fs.head(toInternal(normalizedKey))
      if (meta === null) return null
      const finalPath = join(root, ...normalizedKey.split('/'))
      let handle: FileHandle
      try {
        // 不走 FsObjectStore.get(readFile)：Store 视频下载必须保持逐块背压；O_NOFOLLOW
        // 同时拒绝最终文件本身是 symlink，避免在检查与打开之间跟随到根外。
        handle = await open(finalPath, constants.O_RDONLY | constants.O_NOFOLLOW)
      } catch (error) {
        if (isErrnoCode(error, 'ENOENT')) return null
        if (isErrnoCode(error, 'ELOOP')) {
          throw new TBError('invalid_argument', `非法 entry 路径 '${key}':symlink 逃逸根目录`)
        }
        throw error
      }
      const body = Readable.toWeb(handle.createReadStream()) as unknown as ObjectBodyStream
      return { meta: externalMeta(meta), body }
    },
    async put(key: string, body: ObjectBody, opts?: ObjectPutOptions): Promise<ObjectMeta> {
      const normalizedKey = normalizeEntryPath(key)
      const internalKey = toInternal(normalizedKey)
      const finalPath = join(root, ...normalizedKey.split('/'))

      // 复用 FsObjectStore 的现存对象/symlink 校验与 etag 语义。
      const existing = await fs.head(internalKey)
      if (opts?.ifMatchEtag !== undefined && opts.ifNoneMatch !== undefined) {
        throw new TBError('invalid_argument', 'ifMatchEtag 与 ifNoneMatch 不能同时使用')
      }
      if (opts?.ifMatchEtag !== undefined) {
        if (opts.ifMatchEtag !== existing?.etag) {
          throw new TBError('conflict', `etag 不匹配:'${key}'`)
        }
      }

      await assertAncestorInRoot(root, finalPath, key)
      await mkdir(dirname(finalPath), { recursive: true })
      await assertParentInRoot(root, finalPath, key)

      // Store 的临时文件集中在独立目录：cleanup 只扫未完成上传，不再
      // 递归遍历整个对象树。目录仍与最终文件在同一 filesystem，link/rename
      // 的原子性不变。Context 写入保留旧的同目录临时文件语义。
      const tempDir = normalizedKey.startsWith(STORE_KEY_PREFIX)
        ? join(root, STORE_STAGING_DIR)
        : dirname(finalPath)
      await assertAncestorInRoot(root, join(tempDir, 'staging-probe'), key)
      await mkdir(tempDir, { recursive: true })
      const tempPath = join(tempDir, `${TEMP_PREFIX}${randomUUID()}.tmp`)
      await assertParentInRoot(root, tempPath, key)
      let handle: FileHandle | undefined
      try {
        handle = await open(tempPath, 'wx')
        await writeBody(handle, body)
        await handle.sync()
        await handle.close()
        handle = undefined

        if (opts?.ifNoneMatch === '*') {
          // link 是原子的 no-replace：并发 create-only 只有一个能创建最终目录项。
          try {
            await link(tempPath, finalPath)
          } catch (error) {
            if (isErrnoCode(error, 'EEXIST')) {
              throw new TBError('conflict', `对象已存在:'${key}'`)
            }
            throw error
          }
          await rm(tempPath)
        } else {
          // overwrite/upsert 在完整临时文件关闭后一次 rename，读取方不会看到半文件。
          await rename(tempPath, finalPath)
        }
      } catch (error) {
        if (handle !== undefined) {
          try {
            await handle.close()
          } catch {
            // 清理路径继续尝试删除临时文件。
          }
        }
        await rm(tempPath, { force: true })
        throw error
      }

      const meta = await fs.head(internalKey)
      if (meta === null) throw new TBError('unavailable', `对象提交后不可见:'${key}'`)
      return externalMeta(meta)
    },
    async delete(key: string): Promise<void> {
      await fs.delete(toInternal(key))
    },
    async list(prefix: string, opts?: ObjectListOptions): Promise<ObjectListResult> {
      const result = await fs.list(toInternal(prefix), opts)
      return {
        items: result.items.map(item =>
          'prefix' in item ? { prefix: toExternal(item.prefix) } : externalMeta(item),
        ).filter(item => !isUploadTempKey('prefix' in item ? item.prefix : item.key)),
        ...(result.cursor !== undefined ? { cursor: result.cursor } : {}),
      }
    },
    async cleanupStaging(prefix: string, olderThan: string): Promise<number> {
      const cutoffMs = Date.parse(olderThan)
      if (!Number.isFinite(cutoffMs)) {
        throw new TBError('invalid_argument', 'cleanupStaging olderThan 必须是 ISO timestamp')
      }
      const normalizedPrefix = normalizeEntryPath(prefix.replace(/\/+$/, ''))
      const isDefaultStore = normalizedPrefix === STORE_KEY_PREFIX.slice(0, -1)
      const prefixDir = isDefaultStore
        ? join(root, STORE_STAGING_DIR)
        : join(root, ...normalizedPrefix.split('/'))
      await assertAncestorInRoot(root, join(prefixDir, 'staging-probe'), prefix)
      if (isDefaultStore) {
        await mkdir(prefixDir, { recursive: true })
        await assertParentInRoot(root, join(prefixDir, 'staging-probe'), prefix)
      }
      return await cleanupStagingTree(prefixDir, cutoffMs)
    },
  }
}
