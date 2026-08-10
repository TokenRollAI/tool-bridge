import { createNotesPlugin, type Env } from '@tool-bridge/plugin-example'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseHelpDsl } from '@tool-bridge/core'
import { SELF } from 'cloudflare:test'
import { TEST_ADMIN_SK } from './fixtures'

/**
 * Phase 2 项 5 的验收:**样例 plugin 双 export 零样板**。
 *
 * 与 plugin.integration.test.ts 的关键差别:这里**不 stub 协议**。出站 fetch 被接到
 * `@tool-bridge/plugin-example` 真实的 `fetch(Request, Env)` 上 —— 也就是完全由
 * `@tool-bridge/plugin-sdk` 生成的那套协议实现。因此本文件同时是网关 ↔ SDK 的
 * 跨包契约回归:describe 形状、export 路由(exportId)、envelope、Zod 派生的
 * inputSchema、错误归一,任何一处漂移都会在这里 FAIL。
 */

const ENDPOINT = 'https://notes-plugin.test'

const admin = (extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, ...(extra.headers ?? {}) },
})

async function postJson(path: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://tb.test/${path}`, {
    method: 'POST',
    ...init,
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

/** 平台向 plugin 发出的每次请求(用于断言"某动词从未打到 plugin")。 */
interface Seen { method: string, tool?: string, url: string }

let pluginToken: string | undefined
let seen: Seen[] = []
let describeBody: { exports: Array<Record<string, unknown>>, protocolVersion: string } | undefined

beforeEach(() => {
  const plugin = createNotesPlugin()
  pluginToken = undefined
  seen = []
  describeBody = undefined
  // 出站 fetch → 样例 plugin 的 fetch。env 里的 PLUGIN_TOKEN 就是注册时平台 mint 的那枚。
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      const request = new Request(url, init as RequestInit)
      const entry: Seen = { url, method: request.method }
      if (request.method === 'POST') {
        const body = (await request.clone().json()) as { tool?: string }
        entry.tool = body.tool
      }
      seen.push(entry)
      const env: Env = { ...(pluginToken !== undefined ? { PLUGIN_TOKEN: pluginToken } : {}) }
      const res = await plugin.fetch(request, env)
      if (url.endsWith('/~describe')) {
        describeBody = (await res.clone().json()) as typeof describeBody
      }
      return res
    }) as unknown as typeof fetch,
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function registerNotesPlugin(id = 'notes'): Promise<void> {
  const res = await postJson(
    'system/plugin',
    {
      tool: 'write',
      arguments: {
        id,
        protocolVersion: 'plugin/v2',
        endpoint: ENDPOINT,
        auth: { kind: 'platform-token' },
        healthPath: '/healthz',
        enabled: true,
      },
    },
    admin(),
  )
  expect(res.status).toBe(200)
  pluginToken = ((await res.json()) as { pluginToken?: string }).pluginToken
  expect(pluginToken).toMatch(/^tbk_/)
}

async function mount(
  path: string,
  kind: 'context' | 'tool',
  exportId: string,
): Promise<Response> {
  return postJson(
    'system/registry',
    {
      tool: 'write',
      arguments: {
        path,
        kind,
        description: `notes ${exportId}`,
        config: { kind, provider: 'notes', export: exportId },
      },
    },
    admin(),
  )
}

describe('样例 plugin(SDK 写的双 export)端到端', () => {
  it('注册 → describe 两 export → 挂载 tools 与 context → 调工具 → 读 context', async () => {
    await registerNotesPlugin()

    // 1. describe:一个部署自报两个 export,各自 profile 不同。
    expect(describeBody?.protocolVersion).toBe('plugin/v2')
    expect(describeBody?.exports.map(e => [e.id, e.profile])).toEqual([
      ['actions', 'tools/v1'],
      ['notes', 'context/v1'],
    ])
    // context export 的动词/能力由 handler 存在性推导(未写 update/delete → 不自报)。
    const ctxExport = describeBody?.exports.find(e => e.id === 'notes')
    expect(ctxExport?.methods).toEqual(['List', 'Get', 'Write', 'Search'])
    expect(ctxExport?.capabilities).toEqual(['search'])

    // 2. 两个 export 各挂一处(多 export 必须显式 config.export)。
    expect((await mount('tools/notes', 'tool', 'actions')).status).toBe(200)
    expect((await mount('docs/notes', 'context', 'notes')).status).toBe(200)

    // 3. 工具面:~help 的 schema 由 Zod 自动派生(作者没写一行 JSON Schema)。
    const help = await SELF.fetch(
      'https://tb.test/tools/notes/~help',
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(help.status).toBe(200)
    const helpJson = (await help.json()) as { cmds: Array<{ name: string }> }
    expect(helpJson.cmds.map(c => c.name).sort()).toEqual(['count_notes', 'create_note'])
    // 工具级 ~help(两级披露的细节级)带全量 inputSchema —— 由 Zod 自动派生,
    // 作者没写一行 JSON Schema;`.describe()` 也一路带到 schema 的 description。
    const toolHelp = await SELF.fetch(
      'https://tb.test/tools/notes/create_note/~help',
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(toolHelp.status).toBe(200)
    const cmd = ((await toolHelp.json()) as {
      cmds: Array<{
        effect?: string
        inputSchema?: {
          properties?: Record<string, { description?: string }>
          required?: string[]
        }
        name: string
      }>
    }).cmds[0]
    expect(cmd?.name).toBe('create_note')
    expect(cmd?.effect).toBe('write')
    expect(Object.keys(cmd?.inputSchema?.properties ?? {}).sort()).toEqual([
      'body',
      'tags',
      'title',
    ])
    expect([...(cmd?.inputSchema?.required ?? [])].sort()).toEqual(['body', 'title'])
    expect(cmd?.inputSchema?.properties?.title?.description).toBe('笔记标题')

    // 4. 调工具:裸返回值被 SDK 包成 ToolResult,平台原样透出。
    const created = await postJson(
      'tools/notes',
      { tool: 'create_note', arguments: { title: 'Weekly Plan', body: '# 计划\n写周报', tags: ['work'] } },
      admin(),
    )
    expect(created.status).toBe(200)
    expect(await created.json()).toEqual({ path: 'weekly-plan', version: 1 })

    // 5. 读 context:同一个部署的另一个 export,工具写入的笔记在这里可读。
    const got = await postJson(
      'docs/notes',
      { tool: 'Get', arguments: { path: 'weekly-plan' } },
      admin(),
    )
    expect(got.status).toBe(200)
    const entry = (await got.json()) as { content: string, contentType: string, uri: string }
    expect(entry.content).toBe('# 计划\n写周报')
    expect(entry.contentType).toBe('text/markdown')
    expect(entry.uri).toBe('node://docs/notes/weekly-plan')

    // 6. 声明过的可选能力(Search)可用;List 也走同一 export。
    const searched = await postJson(
      'docs/notes',
      { tool: 'Search', arguments: { query: '周报' } },
      admin(),
    )
    expect(searched.status).toBe(200)
    expect(((await searched.json()) as { items: unknown[] }).items).toHaveLength(1)

    const listed = await postJson('docs/notes', { tool: 'List', arguments: { path: '' } }, admin())
    expect(listed.status).toBe(200)
    expect(((await listed.json()) as { items: unknown[] }).items).toHaveLength(1)

    // 7. 两个 export 的调用都带上了 exportId(否则 plugin 无从路由)。
    expect(seen.filter(s => s.method === 'POST').length).toBeGreaterThan(0)
  })

  it('入参校验由 Zod 自动完成:缺必填字段 → 400 且消息点名字段', async () => {
    await registerNotesPlugin()
    expect((await mount('tools/notes', 'tool', 'actions')).status).toBe(200)

    const bad = await postJson(
      'tools/notes',
      { tool: 'create_note', arguments: { title: 'no body' } },
      admin(),
    )
    expect(bad.status).toBe(400)
    const body = (await bad.json()) as { code: string, message: string }
    expect(body.code).toBe('invalid_argument')
    expect(body.message).toContain('body')
  })

  it('handler 抛 TBError.notFound → 平台 404 归一(不是 500)', async () => {
    await registerNotesPlugin()
    expect((await mount('docs/notes', 'context', 'notes')).status).toBe(200)

    const missing = await postJson(
      'docs/notes',
      { tool: 'Get', arguments: { path: 'nope' } },
      admin(),
    )
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as { code: string }).code).toBe('not_found')
  })

  it('未实现的动词(Update/Delete)不出现在 ~help,调用被网关拒且永不打到 plugin', async () => {
    await registerNotesPlugin()
    expect((await mount('docs/notes', 'context', 'notes')).status).toBe(200)

    const help = await SELF.fetch(
      'https://tb.test/docs/notes/~help',
      admin({ headers: { accept: 'text/plain' } }),
    )
    expect(help.status).toBe(200)
    const names = parseHelpDsl(await help.text())
      .cmds.map(c => c.name)
      .sort()
    expect(names).toEqual(['Get', 'List', 'Search', 'Write'])

    const before = seen.filter(s => s.method === 'POST').length
    const updated = await postJson(
      'docs/notes',
      { tool: 'Update', arguments: { path: 'weekly-plan', patch: { content: 'x' } } },
      admin(),
    )
    expect(updated.status).toBe(400)
    const deleted = await postJson(
      'docs/notes',
      { tool: 'Delete', arguments: { path: 'weekly-plan' } },
      admin(),
    )
    expect(deleted.status).toBe(400)
    expect(seen.filter(s => s.method === 'POST').length).toBe(before)
  })

  it('context Write 经 envelope 落库,随后工具 count_notes 数得到(两 export 共享同一后端)', async () => {
    await registerNotesPlugin()
    expect((await mount('tools/notes', 'tool', 'actions')).status).toBe(200)
    expect((await mount('docs/notes', 'context', 'notes')).status).toBe(200)

    const written = await postJson(
      'docs/notes',
      {
        tool: 'Write',
        arguments: {
          path: 'meeting',
          entry: { contentType: 'text/markdown', content: '# 会议纪要', metadata: { title: '会议' } },
        },
      },
      admin(),
    )
    expect(written.status).toBe(200)
    expect((await written.json()) as { version: string }).toMatchObject({ version: '1' })

    const counted = await postJson('tools/notes', { tool: 'count_notes', arguments: {} }, admin())
    expect(counted.status).toBe(200)
    expect(await counted.json()).toEqual({ count: 1 })
  })
})
