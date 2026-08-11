import type { StateStore } from '@tool-bridge/core'

/**
 * StateStore 的 Cloudflare KV 实现(绑定 TB_KV;store.ts key 布局)。
 *
 * 值以 JSON 存取。`list` 用 KV 原生 `list({prefix,cursor,limit})` 枚举键名，再用
 * `get(keys, 'json')` 批量取值；KV 最终一致(其它边缘通常约 60s 内看见吊销，
 * 但 Cloudflare 明确说明可能更久)。
 *
 * KV bulk get 每次最多 100 keys；`StateStore.getMany` 与 `list` 都按这一硬限制分块。
 */
export class KvStateStore implements StateStore {
  constructor(private readonly kv: KVNamespace) {}

  async get(key: string): Promise<unknown | null> {
    return await this.kv.get(key, 'json')
  }

  async getMany(keys: readonly string[]): Promise<Map<string, unknown>> {
    const out = new Map<string, unknown>()
    for (let offset = 0; offset < keys.length; offset += 100) {
      const chunk = [...new Set(keys.slice(offset, offset + 100))]
      if (chunk.length === 0) continue
      const values = await this.kv.get(chunk, 'json') as Map<string, unknown>
      for (const [key, value] of values) {
        if (value !== null) out.set(key, value)
      }
    }
    return out
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
    const values = await this.getMany(result.keys.map(entry => entry.name))
    for (const entry of result.keys) {
      const value = values.get(entry.name)
      // KV 最终一致:刚删除的 key 可能仍出现在 list 里而 get 已是 null——跳过,
      // 否则 null 流入 TreeNode 等消费方(读 .path)抛 internal。
      if (value !== undefined) items.push({ key: entry.name, value })
    }
    return result.list_complete ? { items } : { items, cursor: result.cursor }
  }
}
