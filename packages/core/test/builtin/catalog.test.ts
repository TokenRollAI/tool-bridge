import { describe, expect, it } from 'vitest'
import type { BuiltinCatalog, PluginDescribe } from '../../src/index'
import { type CatalogListItem, createCatalogModule } from '../../src/builtin/catalog'
import { isTBError } from '../../src/errors'

/**
 * `system/catalog`:内置目录的**只读**浏览面。
 *
 * 与 `system/plugin` 的分工是这套设计的要点:那个是 external plugin 的注册面(admin,
 * 有副作用),这个是平台自带能力的目录(read,纯读)。
 */

function entry(id: string, describe: PluginDescribe, digest = `d-${id}`) {
  return { id, kind: 'builtin' as const, endpoint: `binding:${id}`, digest, describe }
}

const TOOLS: PluginDescribe = {
  protocolVersion: 'plugin/v2',
  exports: [{ auth: { kind: 'single', required: false }, id: 'actions', profile: 'tools/v1', description: 'Tavily' }],
}

const WITH_FIELDS: PluginDescribe = {
  protocolVersion: 'plugin/v2',
  exports: [{
    id: 'actions',
    profile: 'tools/v1',
    description: 'Jira',
    credentialProbe: 'list_projects',
    credentialFields: [
      { key: 'baseUrl', label: 'Instance URL', required: true, secret: false },
      { key: 'personalAccessToken', label: 'PAT', required: true, secret: true },
    ],
  }],
}

const WITH_OAUTH: PluginDescribe = {
  protocolVersion: 'plugin/v2',
  exports: [{
    id: 'actions',
    profile: 'tools/v1',
    description: 'Sentry',
    oauth: {
      authorizationUrl: 'https://sentry.io/oauth/authorize/',
      tokenUrl: 'https://sentry.io/oauth/token/',
      scopes: ['project:read'],
    },
  }],
}

const BOTH_KINDS: PluginDescribe = {
  protocolVersion: 'plugin/v2',
  exports: [
    {
      auth: { kind: 'none' },
      id: 'actions',
      profile: 'tools/v1',
      mountConfigFields: [{ key: 'workspace' }],
    },
    {
      auth: { kind: 'single', label: 'Reader key', required: true },
      id: 'documents',
      profile: 'context/v1',
      methods: ['get', 'list'],
      mountConfigFields: [{ key: 'tenant', required: true }],
    },
  ],
}

/** 自建实例型:单值凭证 + 一个必配的非凭证 baseUrl(如 memos)。 */
const WITH_MOUNT_CONFIG: PluginDescribe = {
  protocolVersion: 'plugin/v2',
  exports: [{
    id: 'actions',
    profile: 'tools/v1',
    description: 'Memos',
    auth: { kind: 'single', required: false },
    credentialProbe: 'get_current_user',
    mountConfigFields: [
      { key: 'baseUrl', label: '实例地址', description: 'https://memos.example.com', required: true },
    ],
  }],
}

const CATALOG: BuiltinCatalog = {
  tavily: entry('tavily', TOOLS),
  jira: entry('jira', WITH_FIELDS),
  sentry: entry('sentry', WITH_OAUTH),
  notes: entry('notes', BOTH_KINDS),
  memos: entry('memos', WITH_MOUNT_CONFIG),
}

const mod = createCatalogModule({ catalog: () => CATALOG })
const ctx = { keyId: 'k', owner: 'user:x', scopes: [], traceId: 't' }

async function list(args: Record<string, unknown> = {}) {
  return await mod.dispatch('list', args, ctx) as {
    cursor?: string
    items: CatalogListItem[]
  }
}

describe('system/catalog help', () => {
  it('三个 cmd 全部 read scope(浏览不该比挂载更严)', () => {
    const help = mod.help('system/catalog')
    expect(help.cmds.map(c => c.name).sort()).toEqual(['get', 'list', 'search'])
    for (const cmd of help.cmds) expect(cmd.scope, cmd.name).toBe('read')
  })
})

describe('list', () => {
  it('按 id 排序,投影出挂载要知道的东西', async () => {
    const { items } = await list()
    expect(items.map(i => i.id)).toEqual(['jira', 'memos', 'notes', 'sentry', 'tavily'])
    const jira = items.find(i => i.id === 'jira')!
    expect(jira.exports).toEqual(['actions'])
    expect(jira.nodeKinds).toEqual(['tool'])
    expect(jira.exportDetails.actions?.auth).toMatchObject({ kind: 'fields' })
  })

  it('投影 mountConfigFields —— 挂载向导据此渲染非凭证配置输入', async () => {
    const { items } = await list()
    const memos = items.find(i => i.id === 'memos')!
    expect(memos.exportDetails.actions?.mountConfigFields).toEqual([
      { key: 'baseUrl', label: '实例地址', description: 'https://memos.example.com', required: true },
    ])
    // 单值凭证 + 有 mountConfig,不该混进 credentialFields。
    expect(items.find(i => i.id === 'tavily')?.exportDetails.actions)
      .not.toHaveProperty('mountConfigFields')
  })

  it('oauth 型标出来 —— 挂载后还要授权一步', async () => {
    const { items } = await list()
    expect(items.find(i => i.id === 'sentry')?.exportDetails.actions?.auth)
      .toEqual({ kind: 'oauth' })
    expect(items.find(i => i.id === 'tavily')?.exportDetails.actions?.auth)
      .toEqual({ kind: 'single', required: false })
  })

  it('多 profile 的 export 映射出两种 nodeKind', async () => {
    const { items } = await list()
    expect(items.find(i => i.id === 'notes')?.nodeKinds).toEqual(['context', 'tool'])
  })

  it('exportDetails 保留 export→kind 映射(选定 export 后 kind 是确定的)', async () => {
    const { items } = await list()
    // notes 跨 kind:actions 是 tool、documents 是 context。挂载按选中的 export 取 kind,
    // 而不是从 nodeKinds 数组猜 —— 否则挂 context export 会落到默认值挂错。
    expect(items.find(i => i.id === 'notes')?.exportDetails.actions?.kind).toBe('tool')
    expect(items.find(i => i.id === 'notes')?.exportDetails.documents?.kind).toBe('context')
    expect(items.find(i => i.id === 'tavily')?.exportDetails.actions?.kind).toBe('tool')
  })

  it('exportDetails 保留逐 export 的 auth/config,不再把第一份声明套给全部 export', async () => {
    const notes = (await list()).items.find(i => i.id === 'notes')!
    expect(notes.exportDetails.actions).toEqual({
      auth: { kind: 'none' },
      id: 'actions',
      kind: 'tool',
      mountConfigFields: [{ key: 'workspace' }],
    })
    expect(notes.exportDetails.documents).toEqual({
      auth: { kind: 'single', label: 'Reader key', required: true },
      id: 'documents',
      kind: 'context',
      mountConfigFields: [{ key: 'tenant', required: true }],
    })
    expect(notes.exportDetails.actions?.mountConfigFields)
      .not.toEqual(notes.exportDetails.documents?.mountConfigFields)
  })

  it('不回 describe 全文(那是 get 的事)', async () => {
    const { items } = await list()
    expect(items[0]).not.toHaveProperty('describe')
  })

  it('分页:limit + cursor 走完全集不重不漏', async () => {
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = await list({ opts: { limit: 2, ...(cursor ? { cursor } : {}) } })
      expect(page.items.length).toBeLessThanOrEqual(2)
      seen.push(...page.items.map(i => i.id))
      cursor = page.cursor
    } while (cursor !== undefined)
    expect(seen).toEqual(['jira', 'memos', 'notes', 'sentry', 'tavily'])
  })

  it('limit 超上限被夹到 200', async () => {
    const { items } = await list({ opts: { limit: 9999 } })
    expect(items.length).toBe(5)
  })

  /** 目录是派生视图:失效 cursor 不该变成不可恢复的错误。 */
  it('失效 cursor 从头开始而不是报错', async () => {
    const { items } = await list({ opts: { cursor: 'gone-after-reassembly' } })
    expect(items.map(i => i.id)).toEqual(['jira', 'memos', 'notes', 'sentry', 'tavily'])
  })

  it('空目录回空页(未装内置插件的宿主)', async () => {
    const empty = createCatalogModule({ catalog: () => ({}) })
    const page = await empty.dispatch('list', {}, ctx) as { cursor?: string, items: unknown[] }
    expect(page.items).toEqual([])
    expect(page.cursor).toBeUndefined()
  })
})

describe('get', () => {
  it('回完整 descriptor 与 digest', async () => {
    const got = await mod.dispatch('get', { id: 'tavily' }, ctx) as {
      describe: PluginDescribe
      digest: string
      endpoint: string
    }
    expect(got.endpoint).toBe('binding:tavily')
    expect(got.digest).toBe('d-tavily')
    expect(got.describe.exports[0]?.id).toBe('actions')
  })

  it('不存在 → not_found', async () => {
    await expect(mod.dispatch('get', { id: 'nope' }, ctx)).rejects.toSatisfy(
      err => isTBError(err) && err.code === 'not_found',
    )
  })

  it('缺 id → invalid_argument', async () => {
    await expect(mod.dispatch('get', {}, ctx)).rejects.toSatisfy(
      err => isTBError(err) && err.code === 'invalid_argument',
    )
  })
})

describe('search', () => {
  it('按 id 子串匹配,大小写不敏感', async () => {
    const page = await mod.dispatch('search', { q: 'TAV' }, ctx) as { items: CatalogListItem[] }
    expect(page.items.map(i => i.id)).toEqual(['tavily'])
  })

  it('也匹配 description', async () => {
    const page = await mod.dispatch('search', { q: 'jira' }, ctx) as { items: CatalogListItem[] }
    expect(page.items.map(i => i.id)).toEqual(['jira'])
  })

  it('无命中回空页,不报错', async () => {
    const page = await mod.dispatch('search', { q: 'zzz' }, ctx) as { items: CatalogListItem[] }
    expect(page.items).toEqual([])
  })

  it('搜索结果同样分页', async () => {
    const page = await mod.dispatch('search', { q: 'a', opts: { limit: 1 } }, ctx) as {
      cursor?: string
      items: CatalogListItem[]
    }
    expect(page.items.length).toBe(1)
    expect(page.cursor).toBeDefined()
  })
})

describe('未知 cmd', () => {
  it('→ invalid_argument(不静默)', async () => {
    await expect(mod.dispatch('write', {}, ctx)).rejects.toSatisfy(
      err => isTBError(err) && err.code === 'invalid_argument',
    )
  })

  it('已知 cmd 的未知 arguments 字段也拒绝', async () => {
    await expect(mod.dispatch('search', { q: 'tavily', extra: true }, ctx))
      .rejects.toSatisfy(err => isTBError(err) && err.code === 'invalid_argument')
  })
})
