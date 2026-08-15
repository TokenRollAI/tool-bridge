import { BUILTIN_CATALOG, builtinPluginBindings } from '@tool-bridge/plugins'
import { catalogSetDigest } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { bearer, createTestApp } from './harness'
import { TEST_ADMIN_SK } from './fixtures'

/**
 * `system/catalog` 的 **HTTP 端点层**验证。
 *
 * core 的单测覆盖了 cmd 表与投影逻辑;这一份补的是"经真实端点打进去"那半段:
 * 内容协商、`~help` 的 scope 声明被网关真正用于判定、以及 **read scope 够用**
 * (那是这个模块的设计要点 —— 挂载只要 register,浏览不该更严)。
 *
 * 曾只有一次性 curl 证据;这里把它固化成可重跑回归。
 */

/**
 * 生产装配方式的一个子集:notes 有两个 export、tavily 单 export 带探针、jira 多字段凭证、
 * memos 单值凭证 + 必配的非凭证 baseUrl(验 mountConfigFields 端到端透传)。
 */
const CATALOG = {
  notes: BUILTIN_CATALOG.notes!,
  tavily: BUILTIN_CATALOG.tavily!,
  jira: BUILTIN_CATALOG.jira!,
  memos: BUILTIN_CATALOG.memos!,
}

async function appWithCatalog() {
  return await createTestApp({
    pluginBindings: builtinPluginBindings({}, { include: ['notes'] }),
    pluginCatalog: CATALOG,
  })
}

async function callCatalog(
  tb: Awaited<ReturnType<typeof appWithCatalog>>,
  tool: string,
  args: Record<string, unknown> = {},
  sk: string = TEST_ADMIN_SK,
): Promise<Response> {
  return await tb.request(
    'https://tb.test/system/catalog',
    bearer(sk, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({ tool, arguments: args }),
    }),
  )
}

/** 签发一个只有 read 的窄 SK(不含 admin)。 */
async function mintReadOnlySk(
  tb: Awaited<ReturnType<typeof appWithCatalog>>,
): Promise<string> {
  const res = await tb.request(
    'https://tb.test/system/sk',
    bearer(TEST_ADMIN_SK, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({
        tool: 'write',
        arguments: {
          owner: 'agent:reader',
          scopes: [{ pattern: '**', actions: ['read'] }],
        },
      }),
    }),
  )
  expect(res.status).toBe(200)
  return ((await res.json()) as { secret: string }).secret
}

describe('GET system/catalog/~help', () => {
  it('三个 cmd 都声明 scope=read', async () => {
    const tb = await appWithCatalog()
    const res = await tb.request(
      'https://tb.test/system/catalog/~help',
      bearer(TEST_ADMIN_SK, { headers: { accept: 'application/json' } }),
    )
    expect(res.status).toBe(200)
    const help = (await res.json()) as { cmds: Array<{ name: string, scope: string }> }
    expect(help.cmds.map(c => c.name).sort()).toEqual(['get', 'list', 'search'])
    for (const cmd of help.cmds) expect(cmd.scope, cmd.name).toBe('read')
  })
})

describe('system/catalog 数据面', () => {
  it('list 回目录项(按 id 升序,不含 describe 全文)', async () => {
    const tb = await appWithCatalog()
    const res = await callCatalog(tb, 'list')
    expect(res.status).toBe(200)
    const page = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(page.items.map(i => i.id)).toEqual(['jira', 'memos', 'notes', 'tavily'])
    expect(page.items[0]).not.toHaveProperty('describe')
  })

  it('list 的投影带挂载要用的字段', async () => {
    const tb = await appWithCatalog()
    const page = (await (await callCatalog(tb, 'list')).json()) as {
      items: Array<{
        credentialFields?: Array<{ key: string }>
        exports: string[]
        id: string
        needsOAuth: boolean
        nodeKinds: string[]
      }>
    }
    const jira = page.items.find(i => i.id === 'jira')!
    // 真实产物的形状(不是构造的 fixture):jira 声明两个字段,其中 baseUrl 标了 secret:false
    // —— 它同样进凭证通道,故必须出现在这里。
    expect(jira.credentialFields?.map(f => f.key)).toEqual(['baseUrl', 'personalAccessToken'])
    expect(jira.nodeKinds).toEqual(['tool'])
    expect(jira.needsOAuth).toBe(false)

    // notes 有 tools + context 两个 export。
    const notes = page.items.find(i => i.id === 'notes')!
    expect(notes.exports.length).toBeGreaterThan(1)
    expect(notes.nodeKinds).toEqual(['context', 'tool'])
  })

  /**
   * mountConfigFields 端到端:真实产物 memos 声明了必配 baseUrl,它必须从编译期 catalog
   * 一路透到 HTTP list 响应 —— 这是挂载向导"该配什么"的数据来源。
   */
  it('list 投影出 mountConfigFields(非凭证配置,如 memos 的 baseUrl)', async () => {
    const tb = await appWithCatalog()
    const page = (await (await callCatalog(tb, 'list')).json()) as {
      items: Array<{
        credentialFields?: unknown
        id: string
        mountConfigFields?: Array<{ key: string, required?: boolean }>
      }>
    }
    const memos = page.items.find(i => i.id === 'memos')!
    expect(memos.mountConfigFields?.map(f => f.key)).toContain('baseUrl')
    expect(memos.mountConfigFields?.find(f => f.key === 'baseUrl')?.required).toBe(true)
    // baseUrl 是配置不是密钥:走 mountConfigFields,不占凭证通道。
    expect(memos.credentialFields).toBeUndefined()
    // 不声明的 provider 不带这个键。
    expect(page.items.find(i => i.id === 'tavily')).not.toHaveProperty('mountConfigFields')
  })

  it('get 回 describe 全文与 digest;不存在 → 404', async () => {
    const tb = await appWithCatalog()
    const res = await callCatalog(tb, 'get', { id: 'tavily' })
    expect(res.status).toBe(200)
    const entry = (await res.json()) as {
      describe: { exports: Array<{ id: string }> }
      digest: string
      endpoint: string
    }
    expect(entry.endpoint).toBe('binding:tavily')
    expect(entry.digest).toBe(BUILTIN_CATALOG.tavily!.digest)
    expect(entry.describe.exports.length).toBeGreaterThan(0)

    expect((await callCatalog(tb, 'get', { id: 'nope' })).status).toBe(404)
  })

  it('search 按子串匹配 id 与 description', async () => {
    const tb = await appWithCatalog()
    const hit = (await (await callCatalog(tb, 'search', { q: 'TAV' })).json()) as {
      items: Array<{ id: string }>
    }
    expect(hit.items.map(i => i.id)).toEqual(['tavily'])

    const miss = (await (await callCatalog(tb, 'search', { q: 'zzz-nothing' })).json()) as {
      items: unknown[]
    }
    expect(miss.items).toEqual([])
  })

  it('分页走完全集不重不漏', async () => {
    const tb = await appWithCatalog()
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = (await (
        await callCatalog(tb, 'list', { opts: { limit: 2, ...(cursor ? { cursor } : {}) } })
      ).json()) as { cursor?: string, items: Array<{ id: string }> }
      seen.push(...page.items.map(i => i.id))
      cursor = page.cursor
    } while (cursor !== undefined)
    expect(seen).toEqual(['jira', 'memos', 'notes', 'tavily'])
  })

  it('未知 cmd → 400', async () => {
    const tb = await appWithCatalog()
    expect((await callCatalog(tb, 'write', { id: 'x' })).status).toBe(400)
  })
})

/**
 * **这个模块的设计要点**:浏览目录只要 read。挂载需要 register scope,若浏览反而要 admin,
 * 一个能挂载的用户就看不到有什么可挂 —— 渐进式发现在这条路上断掉。
 */
describe('read scope 够用(非 admin)', () => {
  it('只有 read 的 SK 能 list/get/search', async () => {
    const tb = await appWithCatalog()
    const readSk = await mintReadOnlySk(tb)
    expect((await callCatalog(tb, 'list', {}, readSk)).status).toBe(200)
    expect((await callCatalog(tb, 'get', { id: 'tavily' }, readSk)).status).toBe(200)
    expect((await callCatalog(tb, 'search', { q: 'jira' }, readSk)).status).toBe(200)
  })

  /** 对照组:同一把 SK 打 admin 面的 `system/plugin` 应被拒 —— 证明 read 不是万能钥匙。 */
  it('同一把 read SK 打 system/plugin list 被拒(权限面没被放宽)', async () => {
    const tb = await appWithCatalog()
    const readSk = await mintReadOnlySk(tb)
    const res = await tb.request(
      'https://tb.test/system/plugin',
      bearer(readSk, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify({ tool: 'list', arguments: {} }),
      }),
    )
    expect(res.status).toBe(403)
  })
})

/**
 * `/healthz` 回显 catalog 计数与 digest,**免认证**。
 *
 * 存在的理由:此前"部署形态改变产品能力"(Workers 99 个 provider、官方 Node 镜像 0 个)
 * 之所以拖了那么久,正是因为没有任何机器可读的信号 —— 两个宿主的 `/healthz` 长得一模一样。
 */
describe('GET /healthz 的 catalog 字段', () => {
  it('回显装配数与目录级 digest(免认证)', async () => {
    const tb = await appWithCatalog()
    const res = await tb.request('https://tb.test/healthz')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      catalog?: { count: number, digest: string }
      healthy: boolean
    }
    expect(body.healthy).toBe(true)
    expect(body.catalog?.count).toBe(4)
    expect(body.catalog?.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('digest 与 core 的 catalogSetDigest 一致(对拍口径同一份实现)', async () => {
    const tb = await appWithCatalog()
    const body = (await (await tb.request('https://tb.test/healthz')).json()) as {
      catalog?: { digest: string }
    }
    expect(body.catalog?.digest).toBe(await catalogSetDigest(CATALOG))
  })

  /** 这是它的用途:装了不同子集的两个宿主,digest 必须不同。 */
  it('装配子集不同 → digest 不同(跨宿主漂移可被发现)', async () => {
    const full = await appWithCatalog()
    const subset = await createTestApp({ pluginCatalog: { tavily: BUILTIN_CATALOG.tavily! } })
    const a = (await (await full.request('https://tb.test/healthz')).json()) as {
      catalog?: { digest: string }
    }
    const b = (await (await subset.request('https://tb.test/healthz')).json()) as {
      catalog?: { count: number, digest: string }
    }
    expect(b.catalog?.count).toBe(1)
    expect(b.catalog?.digest).not.toBe(a.catalog?.digest)
  })

  it('未装配 catalog 时整个字段缺席(不是 count:0)', async () => {
    const tb = await createTestApp()
    const body = (await (await tb.request('https://tb.test/healthz')).json()) as
      Record<string, unknown>
    expect(body).not.toHaveProperty('catalog')
    expect(body.healthy).toBe(true)
  })
})

describe('未装配 catalog 的宿主', () => {
  it('list 回空页而不是报错(该节点仍存在)', async () => {
    const tb = await createTestApp()
    const res = await tb.request(
      'https://tb.test/system/catalog',
      bearer(TEST_ADMIN_SK, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify({ tool: 'list', arguments: {} }),
      }),
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { items: unknown[] }).items).toEqual([])
  })
})

/**
 * catalog 与挂载解析读的是**同一份**目录:能在 catalog 里看到的就能挂上,
 * 看不到的挂不上。这条把两个消费面钉在一起 —— 它们分开漂移过一次(A1)。
 */
describe('catalog 与挂载解析同源', () => {
  it('catalog 列出的 provider 可直接挂载(无需注册)', async () => {
    const tb = await appWithCatalog()
    const listed = (await (await callCatalog(tb, 'list')).json()) as {
      items: Array<{ exports: string[], id: string }>
    }
    expect(listed.items.map(i => i.id)).toContain('notes')

    const res = await tb.request(
      'https://tb.test/system/registry',
      bearer(TEST_ADMIN_SK, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify({
          tool: 'write',
          arguments: {
            path: 'from-catalog/notes',
            kind: 'tool',
            description: 'mounted straight from the catalog',
            config: { kind: 'tool', provider: 'notes', export: 'actions' },
          },
        }),
      }),
    )
    expect(res.status).toBe(200)
  })

  it('catalog 里没有的 provider 挂不上(免注册不等于什么都收)', async () => {
    const tb = await appWithCatalog()
    const res = await tb.request(
      'https://tb.test/system/registry',
      bearer(TEST_ADMIN_SK, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify({
          tool: 'write',
          arguments: {
            path: 'from-catalog/nope',
            kind: 'tool',
            description: 'x',
            config: { kind: 'tool', provider: 'not-in-catalog' },
          },
        }),
      }),
    )
    expect(res.status).toBe(400)
  })
})
