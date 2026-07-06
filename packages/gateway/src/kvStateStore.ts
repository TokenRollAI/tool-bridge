import type { StateStore } from '@tool-bridge/core'

/**
 * StateStore 的 Cloudflare KV 实现(绑定 TB_KV,Proto §7 / store.ts key 布局)。
 *
 * 值以 JSON 存取。`list` 用 KV 原生 `list({prefix,cursor,limit})` 枚举键名,再逐 key `get`
 * 取值——KV 的 list 不带值(官方限制)。Phase 1 树规模小(节点/SK 数量有限),逐 key get
 * 可接受;规模变大后可换 KV metadata 或改 SQLite 宿主。KV 最终一致(吊销 60s 窗口,§2.3)。
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
    opts?: { cursor?: string; limit?: number },
  ): Promise<{ items: Array<{ key: string; value: unknown }>; cursor?: string }> {
    const listOpts: KVNamespaceListOptions = { prefix }
    if (opts?.cursor !== undefined) listOpts.cursor = opts.cursor
    if (opts?.limit !== undefined) listOpts.limit = opts.limit
    const result = await this.kv.list(listOpts)
    const items: Array<{ key: string; value: unknown }> = []
    for (const entry of result.keys) {
      items.push({ key: entry.name, value: await this.kv.get(entry.name, 'json') })
    }
    return result.list_complete ? { items } : { items, cursor: result.cursor }
  }
}
