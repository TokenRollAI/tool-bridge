import { type CallContext, encodeCallContext, HEADER_TB_CONTEXT } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { createNotesPlugin } from '../../src/notes/index'

/**
 * 多挂载隔离,以及它与"一个部署两个 export"的张力。
 *
 * `export default` 是**单例**:多个团队挂同一部署时需要隔离。但这个 plugin 的两个 export
 * (tools 写、context 读)会被挂在**不同路径**,它们本该看到同一份数据 —— 按 mountPath 分区
 * 会把那条能力切断(这就是最初改错的那一刀,被 pluginExample 集成测试抓住)。
 *
 * 结论:归属只能由**挂载方**声明 —— `providerConfig: { workspace: 'x' }`。同 workspace 共享,
 * 不同的互不可见,没声明的落默认区。notes 是别人抄的模板,这件事必须做对。
 */

const plugin = createNotesPlugin()

describe('挂载契约', () => {
  it('两个 export 都明确无需凭证,并声明 workspace 配置', async () => {
    const response = await plugin.fetch(new Request('https://p.test/~describe'), {
      PLUGIN_TOKEN: 't',
    } as never)
    const body = (await response.json()) as {
      exports: Array<{
        auth?: { kind: string }
        id: string
        mountConfigFields?: Array<{ key: string }>
      }>
    }
    expect(body.exports.map(exported => exported.id).sort()).toEqual(['actions', 'notes'])
    for (const exported of body.exports) {
      expect(exported.auth).toEqual({ kind: 'none' })
      expect(exported.mountConfigFields?.map(field => field.key)).toEqual(['workspace'])
    }
  })
})

function call(
  workspace: string | undefined,
  name: string,
  args: unknown,
  mountPath = 'tools/notes',
): Promise<Response> {
  const caller: CallContext = {
    keyId: 'k',
    owner: 'agent:x',
    scopes: [],
    traceId: 't',
    mountPath,
    exportId: 'actions',
    ...(workspace === undefined ? {} : { mountConfig: { workspace } }),
  }
  return Promise.resolve(plugin.fetch(
    new Request('https://p.test/', {
      method: 'POST',
      headers: { authorization: 'Bearer t', [HEADER_TB_CONTEXT]: encodeCallContext(caller) },
      body: JSON.stringify({ tool: 'Call', arguments: { name, args } }),
    }),
    { PLUGIN_TOKEN: 't' } as never,
  ))
}

function ctxCall(
  workspace: string | undefined,
  verb: string,
  args: unknown,
  mountPath = 'docs/notes',
): Promise<Response> {
  const caller: CallContext = {
    keyId: 'k',
    owner: 'agent:x',
    scopes: [],
    traceId: 't',
    mountPath,
    exportId: 'notes',
    ...(workspace === undefined ? {} : { mountConfig: { workspace } }),
  }
  return Promise.resolve(plugin.fetch(
    new Request('https://p.test/', {
      method: 'POST',
      headers: { authorization: 'Bearer t', [HEADER_TB_CONTEXT]: encodeCallContext(caller) },
      body: JSON.stringify({ tool: verb, arguments: args }),
    }),
    { PLUGIN_TOKEN: 't' } as never,
  ))
}

describe('workspace 之间隔离', () => {
  it('**一个 workspace 写的笔记,另一个数不到**', async () => {
    await call('team-a', 'create_note', { title: 'Secret A', body: 'a' })
    await call('team-a', 'create_note', { title: 'Also A', body: 'a2' })

    const b = (await (await call('team-b', 'count_notes', {})).json()) as {
      content: { count: number }
    }
    expect(b.content.count, 'team-b 看到了 team-a 的笔记 —— 跨挂载串号').toBe(0)

    const a = (await (await call('team-a', 'count_notes', {})).json()) as {
      content: { count: number }
    }
    expect(a.content.count).toBe(2)
  })

  it('同名标题在不同 workspace 下互不覆盖', async () => {
    await call('ws-x', 'create_note', { title: 'Same', body: 'from-x' })
    const y = (await (await call('ws-y', 'create_note', { title: 'Same', body: 'from-y' })).json()) as {
      content: { version: number }
    }
    // 若共享存储,y 这次会被当成 x 那条的第 2 版。
    expect(y.content.version).toBe(1)
  })

  it('context export 也按 workspace 隔离(读与搜索)', async () => {
    await ctxCall('ctx-a', 'Write', {
      path: 'shared-name',
      entry: { content: 'A 的内容', metadata: { title: 'A' } },
    })

    const listed = (await (await ctxCall('ctx-b', 'List', { path: '' })).json()) as {
      items: unknown[]
    }
    expect(listed.items, 'ctx-b 列出了 ctx-a 的条目').toEqual([])
    expect((await ctxCall('ctx-b', 'Get', { path: 'shared-name' })).status).toBe(404)

    const found = (await (await ctxCall('ctx-b', 'Search', { query: 'A 的' })).json()) as {
      items: unknown[]
    }
    expect(found.items).toEqual([])
  })
})

describe('同一 workspace 的两个 export 共享数据', () => {
  it('**tools 写、context 读 —— 这是"一个部署两个面"的意义,不能被隔离切断**', async () => {
    await call('shared-ws', 'create_note', { title: 'Weekly Plan', body: '# 计划' })

    // 注意 mountPath 不同(tools/notes vs docs/notes),但 workspace 相同。
    const got = await ctxCall('shared-ws', 'Get', { path: 'weekly-plan' })
    expect(got.status, 'context export 读不到 tools export 写的笔记').toBe(200)
    expect(((await got.json()) as { content: string }).content).toBe('# 计划')
  })

  it('都不声明 workspace 时落同一默认区(单团队用法零配置)', async () => {
    await call(undefined, 'create_note', { title: 'Default Zone', body: 'd' })
    const got = await ctxCall(undefined, 'Get', { path: 'default-zone' })
    expect(got.status).toBe(200)
  })
})
