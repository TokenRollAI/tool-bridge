import { SELF } from 'cloudflare:test'
import { parseHelpDsl } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { TEST_ADMIN_SK } from './fixtures'

// system/annotation(builtin)+ ~feedback(保留段,per-path 一级协议能力)集成测试:
// builtin 物化、权限面(agent SK 开箱 submit/vote 但写不了 annotation;权限判定落目标
// path,窄 scope SK 对自己够得着的路径天然可反馈)、~help 三表现注入(节点级 + 工具级
// 子路径)、净分阈值隐藏。全部离线(http 节点 ~help 从 config 生成,不打上游)。

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

async function getJson(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://tb.test/${path}`, {
    ...init,
    headers: { accept: 'application/json', ...(init.headers ?? {}) },
  })
}

async function issueSk(input: unknown): Promise<string> {
  const res = await postJson('system/sk', { tool: 'write', arguments: input }, admin())
  expect(res.status).toBe(200)
  return ((await res.json()) as { secret: string }).secret
}

/** 典型 agent SK:全树 read+call(无 write/admin)。 */
async function issueAgentSk(name: string, pattern = '**'): Promise<string> {
  return issueSk({
    owner: `agent:${name}`,
    scopes: [{ pattern, actions: ['read', 'call'] }],
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

/** submit 反馈并返回 id(缺省 admin 身份)。 */
async function submitFeedback(
  path: string,
  title: string,
  init: RequestInit = admin(),
): Promise<string> {
  const res = await postJson(`${path}/~feedback`, { title, detail: 'd' }, init)
  expect(res.status).toBe(200)
  return ((await res.json()) as { id: string }).id
}

describe('builtin 物化与 ~help 契约', () => {
  it('system/annotation 节点存在且 cmd/scope 符合契约;system/feedback 不存在(走 ~feedback)', async () => {
    const anno = parseHelpDsl(await helpOf('system/annotation', 'text/plain'))
    expect(Object.fromEntries(anno.cmds.map((c) => [c.name, c.scope]))).toEqual({
      set: 'admin',
      get: 'read',
      remove: 'admin',
      list: 'read',
    })
    const fb = await SELF.fetch('https://tb.test/system/feedback/~help', admin())
    expect(fb.status).toBe(404)
  })
})

describe('根 ~help 引导 ~feedback 双向使用', () => {
  it('hint 同时指引「用前查经验(GET)」与「踩坑回馈(POST)」', async () => {
    const root = JSON.parse(await helpOf('', 'application/json')) as { hint?: string }
    expect(root.hint).toContain('GET /<path>/~feedback')
    expect(root.hint).toContain('POST /<path>/~feedback')
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

describe('~feedback 保留段:agent 开箱提交/投票,~help 区块与阈值隐藏', () => {
  it('agent SK POST /<path>/~feedback → ~help 三表现出现区块;GET .../<id> 下钻含 detail', async () => {
    await mountEcho('ext/fb-node')
    const agentSk = await issueAgentSk('reporter')
    const res = await postJson(
      'ext/fb-node/~feedback',
      { title: 'get_thing 偶发 500', detail: '重试一次即可恢复' },
      bearer(agentSk),
    )
    expect(res.status).toBe(200)
    const { id } = (await res.json()) as { id: string }
    expect(id).toMatch(/^fb_[a-z0-9]{6}$/)

    const json = await helpJson('ext/fb-node')
    expect(json.feedback).toEqual([{ id, title: 'get_thing 偶发 500', score: 0 }])
    const dsl = await helpOf('ext/fb-node', 'text/plain')
    expect(dsl).toContain('feedback 1 GET /ext/fb-node/~feedback')
    expect(dsl).toContain(`  ${id} 0 "get_thing 偶发 500"`)
    const md = await helpOf('ext/fb-node', 'text/markdown')
    expect(md).toContain('## Agent feedback')
    expect(md).toContain('POST /ext/fb-node/~feedback')

    const got = await getJson(`ext/fb-node/~feedback/${id}`, bearer(agentSk))
    expect(got.status).toBe(200)
    const detail = (await got.json()) as { detail: string; by: string }
    expect(detail.detail).toBe('重试一次即可恢复')
    expect(detail.by).toBe('agent:reporter')
  })

  it('工具子路径可反馈;窄 scope SK 对自己够得着的路径可反馈,树外路径 404', async () => {
    await mountEcho('ext/fb-scoped')
    await mountEcho('ext/fb-other')
    const narrowSk = await issueAgentSk('narrow', 'ext/fb-scoped/**')

    const onTool = await postJson(
      'ext/fb-scoped/get_thing/~feedback',
      { title: '参数要小写', detail: 'x' },
      bearer(narrowSk),
    )
    expect(onTool.status).toBe(200)
    expect((await helpJson('ext/fb-scoped/get_thing')).feedback).toHaveLength(1)

    // 窄 scope 之外的路径:read 判不过 → 404 不泄露存在性。
    const outside = await postJson(
      'ext/fb-other/~feedback',
      { title: 't', detail: 'd' },
      bearer(narrowSk),
    )
    expect(outside.status).toBe(404)
  })

  it('vote 改净分:被踩到 -3 → ~help 区块与默认列表消失,?hidden=1 仍可查', async () => {
    await mountEcho('ext/fb-hide')
    const author = await issueAgentSk('author')
    const id = await submitFeedback('ext/fb-hide', '误导性反馈', bearer(author))

    for (const name of ['voter1', 'voter2', 'voter3']) {
      const voterSk = await issueAgentSk(name)
      const res = await postJson(`ext/fb-hide/~feedback/${id}`, { vote: 'down' }, bearer(voterSk))
      expect(res.status).toBe(200)
    }

    expect((await helpJson('ext/fb-hide')).feedback).toBeUndefined()
    const dft = await getJson('ext/fb-hide/~feedback', bearer(author))
    expect(((await dft.json()) as { items: unknown[] }).items).toHaveLength(0)
    const full = await getJson('ext/fb-hide/~feedback?hidden=1', bearer(author))
    const items = ((await full.json()) as { items: Array<{ id: string; score: number }> }).items
    expect(items).toEqual([expect.objectContaining({ id, score: -3 })])
  })

  it('校验与权限:title 超长 → 400;非法 vote → 400;悬空路径 → 404;DELETE 仅 admin', async () => {
    await mountEcho('ext/fb-guard')
    const agentSk = await issueAgentSk('guard')

    const tooLong = await postJson(
      'ext/fb-guard/~feedback',
      { title: 'x'.repeat(81), detail: 'd' },
      bearer(agentSk),
    )
    expect(tooLong.status).toBe(400)

    const dangling = await postJson('no/such/node/~feedback', { title: 't', detail: 'd' }, admin())
    expect(dangling.status).toBe(404)

    const id = await submitFeedback('ext/fb-guard', 't', bearer(agentSk))
    const badVote = await postJson(
      `ext/fb-guard/~feedback/${id}`,
      { vote: 'sideways' },
      bearer(agentSk),
    )
    expect(badVote.status).toBe(400)

    const denied = await SELF.fetch(`https://tb.test/ext/fb-guard/~feedback/${id}`, {
      method: 'DELETE',
      ...bearer(agentSk),
    })
    expect(denied.status).toBe(403)
    const removed = await SELF.fetch(`https://tb.test/ext/fb-guard/~feedback/${id}`, {
      method: 'DELETE',
      ...admin(),
    })
    expect(removed.status).toBe(200)
    expect((await helpJson('ext/fb-guard')).feedback).toBeUndefined()
  })
})
