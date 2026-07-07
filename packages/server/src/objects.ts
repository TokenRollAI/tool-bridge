/**
 * createDataObjectStore:平台对象存储('r2' provider 落点)的 Node 实现。
 *
 * core FsObjectStore 是多根语义(key 首段必须等于某 root 的 basename),而平台
 * 对象存储的 key 是平坦任意前缀(默认 ctx/<nodePath>/...)——本模块做薄前缀适配:
 * 出入口统一加/剥内部根段 'objects/',穿越防护复用 FsObjectStore 的两层防护
 * (normalizeEntryPath + realpath-in-root),不重写。cursor 是内部形态原样透传
 * (消费方视 cursor 为不透明串)。无 presign → $ref 走 /~ref 网关中转(现有降级)。
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ObjectBody,
  ObjectListOptions,
  ObjectListResult,
  ObjectMeta,
  ObjectPutOptions,
  ObjectStore,
} from '@tool-bridge/core'
import { FsObjectStore } from '@tool-bridge/core/node'

const INTERNAL_ROOT = 'objects'

function toInternal(key: string): string {
  return `${INTERNAL_ROOT}/${key}`
}

function toExternal(key: string): string {
  return key.startsWith(`${INTERNAL_ROOT}/`) ? key.slice(INTERNAL_ROOT.length + 1) : key
}

function externalMeta(meta: ObjectMeta): ObjectMeta {
  return { ...meta, key: toExternal(meta.key) }
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
      const got = await fs.get(toInternal(key))
      return got === null ? null : { meta: externalMeta(got.meta), body: got.body }
    },
    async put(key: string, body: ObjectBody, opts?: ObjectPutOptions): Promise<ObjectMeta> {
      return externalMeta(await fs.put(toInternal(key), body, opts))
    },
    async delete(key: string): Promise<void> {
      await fs.delete(toInternal(key))
    },
    async list(prefix: string, opts?: ObjectListOptions): Promise<ObjectListResult> {
      const result = await fs.list(toInternal(prefix), opts)
      return {
        items: result.items.map((item) =>
          'prefix' in item ? { prefix: toExternal(item.prefix) } : externalMeta(item),
        ),
        ...(result.cursor !== undefined ? { cursor: result.cursor } : {}),
      }
    },
  }
}
