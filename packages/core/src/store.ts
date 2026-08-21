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
 *   annotation:<path> → { text, updatedAt, updatedBy }(管理员 Path 补充说明)
 *   feedback:<path>   → FeedbackEntry[](Agent 使用反馈,单 key 整存)
 */

export interface StateStore {
  delete(key: string): Promise<void>
  get(key: string): Promise<unknown | null>
  /** 批量读取，返回值只包含当前存在的 key；单次最多 100 keys。 */
  getMany(keys: readonly string[]): Promise<Map<string, unknown>>
  list(
    prefix: string,
    opts?: { cursor?: string, limit?: number },
  ): Promise<{ cursor?: string, items: Array<{ key: string, value: unknown }> }>
  put(key: string, value: unknown): Promise<void>
  /**
   * 可选原子原语:key 不存在则写入并返回 true;已存在则不覆盖并返回 false。
   * 用途是多副本/多 isolate 并发引导的 winner-takes-all 去重(如 Admin SK 铸造)。
   * SQL 后端原子实现;Workers KV 最终一致且无 CAS,**不实现**此方法——调用方必须
   * 容忍回退到非原子的 get-miss→put,并保证重复写幂等或后果可接受。
   * 可选而非必选:必选会破坏 SDK 消费者已实现的自定义 StateStore。
   */
  putIfAbsent?(key: string, value: unknown): Promise<boolean>
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
/** remote 联邦 host 白名单的运行时条目(单 key 存 AllowlistEntry[];与 env 基线取并集)。 */
export const KEY_REMOTE_ALLOWLIST = 'sys:remoteallowlist'
/** 管理员对任意树路径(含工具子路径)的补充说明:{ text, updatedAt, updatedBy }。 */
export const KEY_ANNOTATION = 'annotation:'
/** 每 path 一份 FeedbackEntry[](单 key 整存整取,allowlist 先例)。 */
export const KEY_FEEDBACK = 'feedback:'

/** 进程内存实现:单测与 SDK 内嵌宿主用。 */
export class MemoryStateStore implements StateStore {
  private m = new Map<string, unknown>()

  async get(key: string): Promise<unknown | null> {
    return this.m.has(key) ? (this.m.get(key) as unknown) : null
  }

  async getMany(keys: readonly string[]): Promise<Map<string, unknown>> {
    const out = new Map<string, unknown>()
    for (const key of keys) {
      if (this.m.has(key)) out.set(key, this.m.get(key) as unknown)
    }
    return out
  }

  async put(key: string, value: unknown): Promise<void> {
    this.m.set(key, value)
  }

  async putIfAbsent(key: string, value: unknown): Promise<boolean> {
    if (this.m.has(key)) return false
    this.m.set(key, value)
    return true
  }

  async delete(key: string): Promise<void> {
    this.m.delete(key)
  }

  async list(
    prefix: string,
    opts?: { cursor?: string, limit?: number },
  ): Promise<{ cursor?: string, items: Array<{ key: string, value: unknown }> }> {
    const keys = [...this.m.keys()].filter(k => k.startsWith(prefix)).sort()
    const start = opts?.cursor ? keys.indexOf(opts.cursor) + 1 : 0
    const limit = opts?.limit ?? 1000
    const page = keys.slice(start, start + limit)
    const hasMore = start + limit < keys.length
    return {
      items: page.map(key => ({ key, value: this.m.get(key) as unknown })),
      cursor: hasMore ? page[page.length - 1] : undefined,
    }
  }
}
