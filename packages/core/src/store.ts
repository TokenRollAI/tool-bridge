/**
 * StateStore:宿主注入的状态存储接口。
 *
 * CF = D1 / Docker = SQLite 或 PG / SDK 内嵌 = 内存。core 只依赖此接口;
 * 一切树配置、SK 哈希表、加密 secret 都经它读写。异步签名以兼容远端后端。
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
   * 当前三宿主(D1/SQLite/PG)均原子实现;无 CAS 能力的自定义后端可不实现——
   * 调用方必须容忍回退到非原子的 get-miss→put,并保证重复写幂等或后果可接受。
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

/** Unicode 最大 scalar;等于它的码点无法再加一,需继续向左借位。 */
const MAX_CODE_POINT = 0x10ffff
/** 代理区间 [D800, DFFF] 不是合法 scalar,加一时必须跳过。 */
const SURROGATE_START = 0xd800
const SURROGATE_END = 0xdfff

/**
 * prefix 在 UTF-8 字节序下的字典序后继(SQL 后端范围扫描上界);无上界时返回 undefined。
 *
 * SQLite / PG(COLLATE "C")/ D1 的 StateStore 实现共用:`key >= prefix AND key < 后继`。
 * 必须按 **code point** 而非 UTF-16 code unit 递增。按 code unit 加一会拆开代理对:
 * 以 `🏿`(U+1F3FF = D83C DFFF)结尾时,给低代理 DFFF 加一得到孤立高代理 `D83C E000`,
 * 编码成 UTF-8 时 D83C 变 U+FFFD(ef bf bd),upper bound 的字节序反而**小于** prefix
 * (ef… < f0…),范围查询恒空——补充平面 key 的子树静默消失,不报错。
 * 跳过代理区间同理:U+D7FF 的后继是 U+E000,不是 U+D800。
 */
export function prefixUpperBound(prefix: string): string | undefined {
  const points = [...prefix]
  for (let i = points.length - 1; i >= 0; i--) {
    const code = points[i]?.codePointAt(0)
    if (code === undefined || code >= MAX_CODE_POINT) continue
    let next = code + 1
    if (next >= SURROGATE_START && next <= SURROGATE_END) next = SURROGATE_END + 1
    return points.slice(0, i).join('') + String.fromCodePoint(next)
  }
  return undefined
}

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
