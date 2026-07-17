import type { StateStore } from '@tool-bridge/core'

/**
 * StateStore 的 Cloudflare KV 实现(绑定 TB_KV;store.ts key 布局)。
 *
 * 值以 JSON 存取。`list` 用 KV 原生 `list({prefix,cursor,limit})` 枚举键名,再逐 key `get`
 * 取值——KV 的 list 不带值(官方限制)。树规模小(节点/SK 数量有限),逐 key get
 * 可接受;规模变大后可换 KV metadata 或改 SQLite 宿主。KV 最终一致(吊销 60s 窗口)。
 *
 * **Workers 子请求上限约束**:`list` 每翻页每个键各发一次 `kv.get`,每次 get 计一个 Workers
 * 子请求(免费套餐 ~50 / 付费 ~1000 每请求)。因此单次 `list` 触碰的键数受此上限约束——
 * NodeRegistryStore.children/subtree 已改为按子树前缀扫描(不再扫全树),把每次调用的键数
 * 收敛到子树规模;当前规模上限估算:一次 `~tree` 建树读入的子树节点数应 ≤ 数百(节点
 * 上限 500 亦是同量级),留足与 1000 子请求上限的余量。规模再增须改 KV metadata 承载值
 * (list 不再逐 get)或换 SQLite 宿主。
 */
export class KvStateStore implements StateStore {
  constructor(private readonly kv: KVNamespace) {}

  async get(key: string): Promise<unknown | null> {
    return await this.kv.get(key, 'json')
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.kv.put(key, JSON.stringify(value))
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key)
  }

  async list(
    prefix: string,
    opts?: { cursor?: string, limit?: number },
  ): Promise<{ cursor?: string, items: Array<{ key: string, value: unknown }> }> {
    const listOpts: KVNamespaceListOptions = { prefix }
    if (opts?.cursor !== undefined) listOpts.cursor = opts.cursor
    if (opts?.limit !== undefined) listOpts.limit = opts.limit
    const result = await this.kv.list(listOpts)
    const items: Array<{ key: string, value: unknown }> = []
    for (const entry of result.keys) {
      const value = await this.kv.get(entry.name, 'json')
      // KV 最终一致:刚删除的 key 可能仍出现在 list 里而 get 已是 null——跳过,
      // 否则 null 流入 TreeNode 等消费方(读 .path)抛 internal。
      if (value !== null) items.push({ key: entry.name, value })
    }
    return result.list_complete ? { items } : { items, cursor: result.cursor }
  }
}
