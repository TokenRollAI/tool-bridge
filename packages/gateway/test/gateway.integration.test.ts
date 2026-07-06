import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import pkg from '../package.json' with { type: 'json' }
import { TEST_ADMIN_SK } from './fixtures'

// 穿透测试(DOD.md:27):HTTP 进 → Worker 出。Phase 1:认证 + HTBP 核心树 + builtin。
// 认证策略:除 /healthz 外全部要求 SK(Proto §0.2 缺 SK → 401)。测试 Admin SK 经
// miniflare bindings 注入(vitest.config.ts),引导时以它为 Admin SK 明文。

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
      // 数据面默认返回 markdown(```json 包裹);测试断言 JSON,故显式声明 Accept。
      accept: 'application/json',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

/** 用 Admin SK 调 system/sk write 签发一把新 SK,返回明文 secret。 */
async function issueSk(input: unknown): Promise<string> {
  const res = await postJson('system/sk', { tool: 'write', arguments: input }, admin())
  expect(res.status).toBe(200)
  const body = (await res.json()) as { secret: string }
  return body.secret
}

describe('GET /healthz(树外免认证,Phase 0 回归)', () => {
  it('200 + JSON {healthy, version},无需 SK(DOD.md:40)', async () => {
    const res = await SELF.fetch('https://tb.test/healthz')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { healthy: boolean; version: string }
    expect(body.healthy).toBe(true)
    expect(body.version).toBe(pkg.version)
  })
})

describe('认证(Proto §0.2:除 /healthz 外全路由要求 SK)', () => {
  it('无 SK → 401 裸 TBError(permission_denied, retryable false)(DOD.md:54)', async () => {
    const res = await SELF.fetch('https://tb.test/~help')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { code: string; retryable: boolean }
    expect(body.code).toBe('permission_denied')
    expect(body.retryable).toBe(false)
  })

  it('无效 SK → 401', async () => {
    const res = await SELF.fetch('https://tb.test/~help', {
      headers: { authorization: 'Bearer tbk_bogus' },
    })
    expect(res.status).toBe(401)
  })

  it('Admin SK → 根 ~help 200', async () => {
    const res = await SELF.fetch('https://tb.test/~help', admin())
    expect(res.status).toBe(200)
  })
})

describe('根 ~help / ~tree(Admin 视角)', () => {
  it('根 ~help 首行 htbp 0.1,列出 system 顶层节点', async () => {
    const res = await SELF.fetch('https://tb.test/~help', admin())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    const text = await res.text()
    expect(text.split('\n')[0]).toBe('htbp 0.1')
    expect(text).toContain('system')
  })

  it('system/sk ~help:DSL 与 JSON 语义等价(抽查 cmd 名集合)(DOD.md:53)', async () => {
    const dslRes = await SELF.fetch('https://tb.test/system/sk/~help', admin())
    const jsonRes = await SELF.fetch(
      'https://tb.test/system/sk/~help',
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(dslRes.status).toBe(200)
    expect(jsonRes.status).toBe(200)
    const dsl = await dslRes.text()
    const json = (await jsonRes.json()) as { htbp: string; cmds: Array<{ name: string }> }
    const jsonNames = json.cmds.map((c) => c.name).sort()
    const dslNames = [...dsl.matchAll(/^cmd (\S+) /gm)].map((m) => m[1]).sort()
    expect(jsonNames).toEqual(['delete', 'get', 'list', 'update', 'write'])
    expect(dslNames).toEqual(jsonNames)
    expect(json.htbp).toBe('0.1')
  })

  it('root ~tree json 含 system 子树', async () => {
    const res = await SELF.fetch(
      'https://tb.test/~tree',
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(res.status).toBe(200)
    const tree = (await res.json()) as { children?: Array<{ path: string }> }
    expect(tree.children?.some((c) => c.path === 'system')).toBe(true)
  })
})

describe('受限 SK 的可见性裁剪(DOD.md:54 本地版)', () => {
  it('新 SK 只见其可见子树,且不能调 system/sk(403)', async () => {
    const docsSk = await issueSk({
      owner: 'agent:docs',
      scopes: [{ pattern: 'docs/**', actions: ['read', 'register'] }],
    })
    const authDocs = { authorization: `Bearer ${docsSk}` }

    // 受限 SK 经 ~register 端点挂 docs/a/b/c(register scope + 未声明 registerPaths →
    // 非保留根放行)。走 ~register 而非 system/registry 数据面:后者需对 system/registry
    // 节点可见(read),受限 SK 不可见。
    const mk = await postJson(
      'docs/a/b/c/~register',
      { path: 'docs/a/b/c', kind: 'directory', description: 'leaf' },
      { headers: authDocs },
    )
    expect(mk.status).toBe(200)

    // 受限 SK 的根 ~tree:只见 docs 子树,不见 system。
    const tree = (await (
      await SELF.fetch('https://tb.test/~tree', {
        headers: { ...authDocs, accept: 'application/json' },
      })
    ).json()) as { children?: Array<{ path: string }> }
    const topPaths = (tree.children ?? []).map((c) => c.path)
    expect(topPaths).toContain('docs')
    expect(topPaths).not.toContain('system')

    // 受限 SK 调 system/sk list → 403(system/sk 需 read 可见 → 实际 404 隐藏存在性)。
    // system/sk 对 docsSk 的 read 判不过 → 404(不泄露存在性,v1 教训)。
    const skList = await postJson(
      'system/sk',
      { tool: 'list', arguments: {} },
      { headers: authDocs },
    )
    expect(skList.status).toBe(404)
    const skHelp = await SELF.fetch('https://tb.test/system/sk/~help', { headers: authDocs })
    expect(skHelp.status).toBe(404)
  })
})

describe('注册与三级 ~help(DOD.md:52 集成面)', () => {
  it('POST system/registry write 挂 a/b/c → a、a/b、a/b/c 三级 ~help 都 200', async () => {
    const regSk = await issueSk({
      owner: 'agent:reg',
      scopes: [{ pattern: '**', actions: ['read', 'register'] }],
    })
    const authReg = { authorization: `Bearer ${regSk}` }
    const mk = await postJson(
      'system/registry',
      { tool: 'write', arguments: { path: 'a/b/c', kind: 'directory', description: 'c' } },
      { headers: authReg },
    )
    expect(mk.status).toBe(200)
    for (const p of ['a', 'a/b', 'a/b/c']) {
      const res = await SELF.fetch(`https://tb.test/${p}/~help`, { headers: authReg })
      expect(res.status, `~help ${p}`).toBe(200)
    }
  })

  it('保留根 system 下 ~register 被拒(§2.4b):未声明 registerPaths 的 SK → 403', async () => {
    const regSk = await issueSk({
      owner: 'agent:reg2',
      scopes: [{ pattern: '**', actions: ['read', 'register'] }],
    })
    const authReg = { authorization: `Bearer ${regSk}` }
    const res = await postJson(
      'system/x/~register',
      { path: 'system/x', kind: 'directory', description: 'x' },
      { headers: authReg },
    )
    expect(res.status).toBe(403)
  })
})

describe('secret 只写不读(DOD.md:55 集成面)', () => {
  it('admin set → list 只见 name + updatedAt,不回显明文', async () => {
    const SECRET = 'upstream-token-xyz'
    const set = await postJson(
      'system/secret',
      { tool: 'set', arguments: { name: 'ctx7', value: SECRET } },
      admin(),
    )
    expect(set.status).toBe(200)
    const setText = await set.text()
    expect(setText).not.toContain(SECRET)

    const list = await postJson('system/secret', { tool: 'list', arguments: {} }, admin())
    const body = (await list.json()) as { items: Array<{ name: string; updatedAt: string }> }
    const item = body.items.find((i) => i.name === 'ctx7')
    expect(item).toBeDefined()
    expect(Object.keys(item ?? {}).sort()).toEqual(['name', 'updatedAt'])
    expect(JSON.stringify(body)).not.toContain(SECRET)
  })
})

describe('status get', () => {
  it('admin 调 system/status get → { healthy, version, nodeCount }', async () => {
    const res = await postJson('system/status', { tool: 'get', arguments: {} }, admin())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { healthy: boolean; version: string; nodeCount: number }
    expect(body.healthy).toBe(true)
    expect(body.version).toBe(pkg.version)
    expect(typeof body.nodeCount).toBe('number')
  })
})

describe('~skill 占位 501', () => {
  it('认证后 GET system/sk/~skill → 501', async () => {
    const res = await SELF.fetch('https://tb.test/system/sk/~skill', admin())
    expect(res.status).toBe(501)
  })
})
