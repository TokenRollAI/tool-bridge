/**
 * StateStore:宿主注入的状态存储接口。
 *
 * CF = KV / Docker = SQLite / SDK 内嵌 = 内存。core 只依赖此接口;
 * 一切树配置、SK 哈希表、加密 secret 都经它读写。异步签名以兼容 KV。
 *
 * key 布局:
 *   sk:h:<sha256hex>  → SecretKey(认证热路径)
 *   sk:i:<id>         → sha256hex(管理面二级索引,指向 sk:h:*)
 *   node:<path>       → TreeNode
 *   secret:<name>     → { iv, ciphertext, updatedAt }
 *   plugin:<id>       → PluginManifest
 *   sys:bootstrapped  → true(Admin SK 引导幂等标志)
 */

export interface StateStore {
  get(key: string): Promise<unknown | null>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  list(
    prefix: string,
    opts?: { cursor?: string; limit?: number },
  ): Promise<{ items: Array<{ key: string; value: unknown }>; cursor?: string }>
}

export const KEY_SK_HASH = 'sk:h:'
export const KEY_SK_ID = 'sk:i:'
export const KEY_NODE = 'node:'
export const KEY_SECRET = 'secret:'
export const KEY_PLUGIN = 'plugin:'
/** 按需探活的健康态:{ healthy, checkedAt, consecutiveFailures }。 */
export const KEY_PLUGIN_HEALTH = 'pluginhealth:'
/** 注册时抓取的 ~describe 缓存:挂载节点 ~describe/~help 的能力来源。 */
export const KEY_PLUGIN_META = 'pluginmeta:'
export const KEY_BOOTSTRAPPED = 'sys:bootstrapped'

/** 进程内存实现:单测与 SDK 内嵌宿主用。 */
export class MemoryStateStore implements StateStore {
  private m = new Map<string, unknown>()

  async get(key: string): Promise<unknown | null> {
    return this.m.has(key) ? (this.m.get(key) as unknown) : null
  }

  async put(key: string, value: unknown): Promise<void> {
    this.m.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.m.delete(key)
  }

  async list(
    prefix: string,
    opts?: { cursor?: string; limit?: number },
  ): Promise<{ items: Array<{ key: string; value: unknown }>; cursor?: string }> {
    const keys = [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort()
    const start = opts?.cursor ? keys.indexOf(opts.cursor) + 1 : 0
    const limit = opts?.limit ?? 1000
    const page = keys.slice(start, start + limit)
    const hasMore = start + limit < keys.length
    return {
      items: page.map((key) => ({ key, value: this.m.get(key) as unknown })),
      cursor: hasMore ? page[page.length - 1] : undefined,
    }
  }
}
