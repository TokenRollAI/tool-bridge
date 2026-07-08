import { SELF } from 'cloudflare:test'
import { parseHelpDsl } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { TEST_ADMIN_SK } from './fixtures'

// system/annotation + system/feedback 集成测试:builtin 物化、权限面(agent SK 开箱可
// submit/vote 但写不了 annotation)、~help 三表现注入(节点级 + 工具级子路径)、
// 净分阈值隐藏。全部离线(http 节点 ~help 从 config 生成,不打上游)。

const admin = (extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, ...(extra.headers ?? {}) },
})

const bearer = (sk: string): RequestInit => ({ headers: { authorization: `Bearer ${sk}` } })

async function postJson(path: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://tb.test/${path}`, {
    method: 'POST',
    ...init,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

async function issueSk(input: unknown): Promise<string> {
  const res = await postJson('system/sk', { tool: 'write', arguments: input }, admin())
  expect(res.status).toBe(200)
  return ((await res.json()) as { secret: string }).secret
}

/** 典型 agent SK:全树 read+call(无 write/admin)。 */
async function issueAgentSk(name: string): Promise<string> {
  return issueSk({
    owner: `agent:${name}`,
    scopes: [{ pattern: '**', actions: ['read', 'call'] }],
  })
}

async function mountEcho(path: string): Promise<void> {
  const res = await postJson(
    'system/registry',
    {
      tool: 'write',
      arguments: {
        path,
        kind: 'http',
        description: 'echo tools',
        config: {
          kind: 'http',
          endpoint: 'https://postman-echo.com',
          tools: [
            { name: 'get_thing', description: 'GET a thing', method: 'GET', pathTemplate: '/get' },
          ],
        },
      },
    },
    admin(),
  )
  expect(res.status).toBe(200)
}

async function helpOf(path: string, accept: string, init: RequestInit = admin()): Promise<string> {
  const url = path === '' ? 'https://tb.test/~help' : `https://tb.test/${path}/~help`
  const res = await SELF.fetch(url, { ...init, headers: { accept, ...(init.headers ?? {}) } })
  expect(res.status).toBe(200)
  return res.text()
}

interface HelpJsonLite {
  note?: string
  feedback?: Array<{ id: string; title: string; score: number }>
}

async function helpJson(path: string): Promise<HelpJsonLite> {
  return JSON.parse(await helpOf(path, 'application/json')) as HelpJsonLite
}

describe('builtin 物化与 ~help 契约', () => {
  it('system/annotation 与 system/feedback 节点存在且 cmd/scope 符合契约', async () => {
    const anno = parseHelpDsl(await helpOf('system/annotation', 'text/plain'))
    expect(Object.fromEntries(anno.cmds.map((c) => [c.name, c.scope]))).toEqual({
      set: 'admin',
      get: 'read',
      remove: 'admin',
      list: 'read',
    })
    const fb = parseHelpDsl(await helpOf('system/feedback', 'text/plain'))
    expect(Object.fromEntries(fb.cmds.map((c) => [c.name, c.scope]))).toEqual({
      submit: 'call',
      get: 'read',
      list: 'read',
      vote: 'call',
      remove: 'admin',
    })
  })
})

describe('annotation:admin 写,~help 三表现注入(节点级 + 工具级 + 根)', () => {
  it('set 后节点 ~help 的 DSL note 行 / JSON note 字段 / Markdown Notes 节都出现', async () => {
    await mountEcho('ext/anno-node')
    const set = await postJson(
      'system/annotation',
      { tool: 'set', arguments: { path: 'ext/anno-node', text: '上游偶发限流,重试即可' } },
      admin(),
    )
    expect(set.status).toBe(200)

    const dsl = await helpOf('ext/anno-node', 'text/plain')
    expect(dsl).toContain('note "上游偶发限流,重试即可"')
    expect((await helpJson('ext/anno-node')).note).toBe('上游偶发限流,重试即可')
    const md = await helpOf('ext/anno-node', 'text/markdown')
    expect(md).toContain('## Notes')
    expect(md).toContain('上游偶发限流,重试即可')
  })

  it('工具子路径(非注册节点)的 annotation 注入工具级 ~help', async () => {
    await mountEcho('ext/anno-tool')
    await postJson(
      'system/annotation',
      { tool: 'set', arguments: { path: 'ext/anno-tool/get_thing', text: '参数区分大小写' } },
      admin(),
    )
    expect((await helpJson('ext/anno-tool/get_thing')).note).toBe('参数区分大小写')
  })

  it('根路径 annotation = 全树公告,注入根 ~help', async () => {
    await postJson(
      'system/annotation',
      { tool: 'set', arguments: { path: '', text: '本网关处于灰度窗口' } },
      admin(),
    )
    expect((await helpJson('')).note).toBe('本网关处于灰度窗口')
  })

  it('悬空路径 set → 404;agent SK(read+call)set → 403', async () => {
    const dangling = await postJson(
      'system/annotation',
      { tool: 'set', arguments: { path: 'no/such/node', text: 'x' } },
      admin(),
    )
    expect(dangling.status).toBe(404)

    const agentSk = await issueAgentSk('anno-writer')
    const denied = await postJson(
      'system/annotation',
      { tool: 'set', arguments: { path: 'system', text: 'x' } },
      bearer(agentSk),
    )
    expect(denied.status).toBe(403)
  })
})

describe('feedback:agent 开箱提交/投票,~help 区块与阈值隐藏', () => {
  it('agent SK submit → 节点 ~help 三表现出现区块;get 下钻含 detail', async () => {
    await mountEcho('ext/fb-node')
    const agentSk = await issueAgentSk('reporter')
    const submit = await postJson(
      'system/feedback',
      {
        tool: 'submit',
        arguments: { path: 'ext/fb-node', title: 'get_thing 偶发 500', detail: '重试一次即可恢复' },
      },
      bearer(agentSk),
    )
    expect(submit.status).toBe(200)
    const { id } = (await submit.json()) as { id: string }
    expect(id).toMatch(/^fb_[a-z0-9]{6}$/)

    const json = await helpJson('ext/fb-node')
    expect(json.feedback).toEqual([{ id, title: 'get_thing 偶发 500', score: 0 }])
    const dsl = await helpOf('ext/fb-node', 'text/plain')
    expect(dsl).toContain('feedback 1 POST /system/feedback')
    expect(dsl).toContain(`  ${id} 0 "get_thing 偶发 500"`)
    const md = await helpOf('ext/fb-node', 'text/markdown')
    expect(md).toContain('## Agent feedback')
    expect(md).toContain(`\`${id}\``)

    const got = await postJson(
      'system/feedback',
      { tool: 'get', arguments: { path: 'ext/fb-node', id } },
      bearer(agentSk),
    )
    expect(((await got.json()) as { detail: string }).detail).toBe('重试一次即可恢复')
  })

  it('净分被踩到 -3 → 从 ~help 区块与默认 list 消失,includeHidden 仍可查', async () => {
    await mountEcho('ext/fb-hide')
    const author = await issueAgentSk('author')
    const submit = await postJson(
      'system/feedback',
      { tool: 'submit', arguments: { path: 'ext/fb-hide', title: '误导性反馈', detail: 'x' } },
      bearer(author),
    )
    const { id } = (await submit.json()) as { id: string }

    for (const name of ['voter1', 'voter2', 'voter3']) {
      const voterSk = await issueAgentSk(name)
      const res = await postJson(
        'system/feedback',
        { tool: 'vote', arguments: { path: 'ext/fb-hide', id, value: 'down' } },
        bearer(voterSk),
      )
      expect(res.status).toBe(200)
    }

    expect((await helpJson('ext/fb-hide')).feedback).toBeUndefined()
    const dft = await postJson(
      'system/feedback',
      { tool: 'list', arguments: { path: 'ext/fb-hide' } },
      bearer(author),
    )
    expect(((await dft.json()) as { items: unknown[] }).items).toHaveLength(0)
    const full = await postJson(
      'system/feedback',
      { tool: 'list', arguments: { path: 'ext/fb-hide', includeHidden: true } },
      bearer(author),
    )
    const items = ((await full.json()) as { items: Array<{ id: string; score: number }> }).items
    expect(items).toEqual([expect.objectContaining({ id, score: -3 })])
  })

  it('校验与权限:title 超长 → 400;悬空路径 → 404;agent remove → 403,admin remove 生效', async () => {
    await mountEcho('ext/fb-guard')
    const agentSk = await issueAgentSk('guard')
    const tooLong = await postJson(
      'system/feedback',
      { tool: 'submit', arguments: { path: 'ext/fb-guard', title: 'x'.repeat(81), detail: 'd' } },
      bearer(agentSk),
    )
    expect(tooLong.status).toBe(400)

    const dangling = await postJson(
      'system/feedback',
      { tool: 'submit', arguments: { path: 'no/such/node', title: 't', detail: 'd' } },
      bearer(agentSk),
    )
    expect(dangling.status).toBe(404)

    const submit = await postJson(
      'system/feedback',
      { tool: 'submit', arguments: { path: 'ext/fb-guard', title: 't', detail: 'd' } },
      bearer(agentSk),
    )
    const { id } = (await submit.json()) as { id: string }
    const denied = await postJson(
      'system/feedback',
      { tool: 'remove', arguments: { path: 'ext/fb-guard', id } },
      bearer(agentSk),
    )
    expect(denied.status).toBe(403)
    const removed = await postJson(
      'system/feedback',
      { tool: 'remove', arguments: { path: 'ext/fb-guard', id } },
      admin(),
    )
    expect(removed.status).toBe(200)
    expect((await helpJson('ext/fb-guard')).feedback).toBeUndefined()
  })
})
