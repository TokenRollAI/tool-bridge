import { BUILTIN_CATALOG_DIGEST } from '@tool-bridge/plugins'
import { catalogDigest } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { SELF } from 'cloudflare:test'
import { TEST_ADMIN_SK } from './fixtures'

/**
 * **生产装配入口的验证**。
 *
 * `wrangler.jsonc` 的 `main` 指 `src/deployEntry.ts`,而 vitest-pool-workers 从同一份
 * wrangler 配置起 miniflare —— 所以 `SELF.fetch` 打进去的就是**生产那份装配**
 * (全量 bindings + 全量 catalog),不是测试自己拼的 deps。
 *
 * 为什么需要这一份:`deployEntry.ts` 此前零测试触及。它只在构建期被编译,而它做的事
 * (把 bindings 与 catalog 配成一对递给 `createApp`)恰恰是"配错了在构建期看不出来"的那类
 * —— 只给 bindings 不给 catalog,类型完全合法,表现是运行时挂载报"未知 provider"。
 * app 层已钉住那个失配的**行为**,这里钉住**生产入口真的两者都传了**。
 */

async function post(
  path: string,
  body: unknown,
  sk: string = TEST_ADMIN_SK,
): Promise<Response> {
  return await SELF.fetch(`https://tb.test/${path}`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${sk}`,
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

describe('生产部署入口(deployEntry)的内置目录装配', () => {
  it('system/catalog 列出全量内置集成(catalog 真的接线了)', async () => {
    const res = await post('system/catalog/list', { opts: { limit: 200 } })
    expect(res.status).toBe(200)
    expect(res.headers.get('server-timing')).toMatch(/tb-d1;dur=.*tb-worker;dur=/)
    const page = (await res.json()) as { items: Array<{ digest: string, id: string }> }
    // 与 codegen 产物同源:数量对得上说明装的是那份编译期常量,不是某个子集。
    expect(page.items.length).toBeGreaterThan(90)
    // `endpoint` 刻意不在列表投影里(只有 `get` 回它);列表项该有 id 与 digest。
    for (const item of page.items.slice(0, 5)) {
      expect(item.id, JSON.stringify(item)).toBeTruthy()
      expect(item.digest).toMatch(/^[0-9a-f]{64}$/)
    }

    // endpoint 经 get 核验(生产装配的 endpoint 必须是 binding:,不是 https)。
    const one = page.items[0]!
    const got = await post('system/catalog/get', { id: one.id })
    expect(((await got.json()) as { endpoint: string }).endpoint).toBe(`binding:${one.id}`)
  })

  it('bindings 与 catalog 是一对:目录里的 provider 能挂载且能列工具', async () => {
    // 挑一个明确 auth:none 的真实内置 export,走完整挂载 → ~help 链路。
    const mount = await post('system/registry/write', {
      path: 'prod-entry/notes',
      kind: 'tool',
      description: 'assembled by deployEntry',
      config: { kind: 'tool', provider: 'notes', export: 'actions' },
    })
    expect(mount.status).toBe(200)

    // 工具可列 = binding 真的能被调用(catalog 只解决"声明",这一步验的是"代码在哪")。
    const help = await SELF.fetch('https://tb.test/prod-entry/notes/~help', {
      headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, accept: 'application/json' },
    })
    expect(help.status).toBe(200)
    const model = (await help.json()) as { cmds: unknown[] }
    expect(model.cmds.length).toBeGreaterThan(0)

    // 清理:同一文件内多用例共享一份 KV。
    await post('system/registry/delete', { path: 'prod-entry/notes' })
  })

  it('内置集成零写库:挂载后 plugin list 仍为空', async () => {
    const mount = await post('system/registry/write', {
      path: 'prod-entry/notes-zero-write',
      kind: 'tool',
      description: 'x',
      config: { kind: 'tool', provider: 'notes', export: 'actions' },
    })
    expect(mount.status).toBe(200)

    const listed = await post('system/plugin/list', {})
    expect(((await listed.json()) as { items: unknown[] }).items).toEqual([])

    await post('system/registry/delete', { path: 'prod-entry/notes-zero-write' })
  })

  /**
   * 三宿主装配同一份目录的机器保证。gateway 与 plugins 各自 bundle,若某天 gateway
   * 装了一个裁剪过的子集(`opts.include`)而没同步 catalog,这条会红。
   */
  it('装配的目录与 codegen 产物 digest 一致', async () => {
    const res = await post('system/catalog/list', { opts: { limit: 200 } })
    const page = (await res.json()) as { items: Array<{ digest: string, id: string }> }
    // **用 core 的 catalogDigest,不手写 sha256**:digest 的定义包含 canonical 键序,
    // 手抄一遍就会因键序不同算出另一个值(第一次写这条时正是这么错的)。
    const pairs = page.items
      .map(i => ({ id: i.id, digest: i.digest }))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
    expect(await catalogDigest(pairs)).toBe(BUILTIN_CATALOG_DIGEST)
  })
})
