import { describe, expect, it } from 'vitest'
import { SELF } from 'cloudflare:test'
import pkg from '../package.json' with { type: 'json' }
import { TEST_ADMIN_SK } from './fixtures'

// 穿透测试:HTTP 进 → Worker 出(认证 + HTBP 核心树 + builtin)。
// 认证策略:除 /healthz 外全部要求 SK(缺 SK → 401)。测试 Admin SK 经
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
      'accept': 'application/json',
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

describe('GET /healthz(树外免认证)', () => {
  it('200 + JSON {healthy, version},无需 SK', async () => {
    const res = await SELF.fetch('https://tb.test/healthz')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { healthy: boolean, version: string }
    expect(body.healthy).toBe(true)
    expect(body.version).toBe(pkg.version)
  })
})

describe('认证(除 /healthz 外全路由要求 SK)', () => {
  it('无 SK → 401 裸 TBError(permission_denied, retryable false)', async () => {
    const res = await SELF.fetch('https://tb.test/~help')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { code: string, retryable: boolean }
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
  it('根 ~help 默认 markdown;显式 text/plain 得 DSL(首行 htbp 0.1)', async () => {
    const res = await SELF.fetch('https://tb.test/~help', admin())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    expect(await res.text()).toContain('system')

    const dslRes = await SELF.fetch(
      'https://tb.test/~help',
      admin({ headers: { accept: 'text/plain' } }),
    )
    expect(dslRes.status).toBe(200)
    expect(dslRes.headers.get('content-type')).toContain('text/plain')
    const text = await dslRes.text()
    expect(text.split('\n')[0]).toBe('htbp 0.1')
    expect(text).toContain('system')
  })

  it('system/sk ~help:DSL 与 JSON 语义等价(抽查 cmd 名集合)', async () => {
    const dslRes = await SELF.fetch(
      'https://tb.test/system/sk/~help',
      admin({ headers: { accept: 'text/plain' } }),
    )
    const jsonRes = await SELF.fetch(
      'https://tb.test/system/sk/~help',
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(dslRes.status).toBe(200)
    expect(jsonRes.status).toBe(200)
    const dsl = await dslRes.text()
    const json = (await jsonRes.json()) as { cmds: Array<{ name: string }>, htbp: string }
    const jsonNames = json.cmds.map(c => c.name).sort()
    const dslNames = [...dsl.matchAll(/^cmd (\S+) /gm)].map(m => m[1]).sort()
    expect(jsonNames).toEqual(['delete', 'get', 'list', 'update', 'write'])
    expect(dslNames).toEqual(jsonNames)
    expect(json.htbp).toBe('0.1')
  })

  it('~help Accept: text/markdown → 可读 Markdown 表现(text/markdown)', async () => {
    const res = await SELF.fetch(
      'https://tb.test/system/sk/~help',
      admin({ headers: { accept: 'text/markdown' } }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    const md = await res.text()
    expect(md.startsWith('# /system/sk\n')).toBe(true)
    expect(md).toContain('## How to call')
    expect(md).toContain('### `write`')
    expect(md).toContain('- Required scope: `admin`')
  })

  it('根 ~help markdown:children 表格 + 下钻 hint', async () => {
    const res = await SELF.fetch(
      'https://tb.test/~help',
      admin({ headers: { accept: 'text/markdown' } }),
    )
    expect(res.status).toBe(200)
    const md = await res.text()
    expect(md).toContain('## Child nodes')
    expect(md).toContain('| `system` | directory |')
    expect(md).toContain('> **Next step**: GET /<child-path>/~help')
  })

  it('root ~tree json 含 system 子树', async () => {
    const res = await SELF.fetch(
      'https://tb.test/~tree',
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(res.status).toBe(200)
    const tree = (await res.json()) as { children?: Array<{ path: string }> }
    expect(tree.children?.some(c => c.path === 'system')).toBe(true)
  })

  it('root ~tree 默认 markdown(code fence 包缩进树);显式 text/plain 得裸文本', async () => {
    const res = await SELF.fetch('https://tb.test/~tree', admin())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    const md = await res.text()
    expect(md.startsWith('```text\n')).toBe(true)
    expect(md.endsWith('```\n')).toBe(true)
    expect(md).toContain('system [directory]')

    const plain = await SELF.fetch(
      'https://tb.test/~tree',
      admin({ headers: { accept: 'text/plain' } }),
    )
    expect(plain.status).toBe(200)
    expect(plain.headers.get('content-type')).toContain('text/plain')
    const text = await plain.text()
    expect(text).not.toContain('```')
    expect(text).toContain('system [directory]')
  })
})

describe('受限 SK 的可见性裁剪', () => {
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
    const topPaths = (tree.children ?? []).map(c => c.path)
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

describe('注册与三级 ~help(集成面)', () => {
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

  it('保留根 system 下 ~register 被拒:未声明 registerPaths 的 SK → 403', async () => {
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

describe('secret 只写不读(集成面)', () => {
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
    const body = (await list.json()) as { items: Array<{ name: string, updatedAt: string }> }
    const item = body.items.find(i => i.name === 'ctx7')
    expect(item).toBeDefined()
    expect(Object.keys(item ?? {}).sort()).toEqual(['name', 'updatedAt'])
    expect(JSON.stringify(body)).not.toContain(SECRET)
  })
})

describe('status get', () => {
  it('admin 调 system/status get → { healthy, version, nodeCount }', async () => {
    const res = await postJson('system/status', { tool: 'get', arguments: {} }, admin())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { healthy: boolean, nodeCount: number, version: string }
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

describe('system/registry 管理通道也遵守可见性裁剪(修复 5)', () => {
  it('宽 allow + 窄 deny:list 不见 denied 节点,get denied 路径 → 404', async () => {
    // 先以 admin 注册可见/不可见两棵子树。
    await postJson(
      'system/registry',
      { tool: 'write', arguments: { path: 'vis/y', kind: 'directory', description: 'y' } },
      admin(),
    )
    await postJson(
      'system/registry',
      { tool: 'write', arguments: { path: 'hidden/x', kind: 'directory', description: 'x' } },
      admin(),
    )
    // 一把对 system/registry 可读、但 deny hidden/** read 的 SK。
    const sk = await issueSk({
      owner: 'agent:reg-vis',
      scopes: [
        { pattern: '**', actions: ['read', 'register'] },
        { pattern: 'hidden/**', actions: ['read'], effect: 'deny' },
      ],
    })
    const auth = { authorization: `Bearer ${sk}` }

    const list = await postJson(
      'system/registry',
      { tool: 'list', arguments: {} },
      { headers: auth },
    )
    expect(list.status).toBe(200)
    const body = (await list.json()) as { items: Array<{ path: string }> }
    const paths = body.items.map(i => i.path)
    expect(paths).toContain('vis/y')
    expect(paths.some(p => p === 'hidden' || p.startsWith('hidden/'))).toBe(false)

    // get denied 路径 → 404(deny==not_found,不泄露存在性)。
    const get = await postJson(
      'system/registry',
      { tool: 'get', arguments: { path: 'hidden/x' } },
      { headers: auth },
    )
    expect(get.status).toBe(404)
  })
})

describe('~tree 子树根真实性(修复 6)', () => {
  it('GET /ghost/~tree → 404(不存在的子树根)', async () => {
    const res = await SELF.fetch('https://tb.test/ghost/~tree', admin())
    expect(res.status).toBe(404)
  })

  it('GET /system/sk/~tree 根 kind === builtin(用真实节点元数据,不伪造 directory)', async () => {
    const res = await SELF.fetch(
      'https://tb.test/system/sk/~tree',
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(res.status).toBe(200)
    const tree = (await res.json()) as { kind: string, path: string }
    expect(tree.path).toBe('system/sk')
    expect(tree.kind).toBe('builtin')
  })
})

describe('URL 路径解码(修复 7)', () => {
  it('注册含空格路径 \'docs/hello world\' 后 GET /docs/hello%20world/~help → 200', async () => {
    const regSk = await issueSk({
      owner: 'agent:space',
      scopes: [{ pattern: '**', actions: ['read', 'register'] }],
    })
    const auth = { authorization: `Bearer ${regSk}` }
    const mk = await postJson(
      'system/registry',
      {
        tool: 'write',
        arguments: { path: 'docs/hello world', kind: 'directory', description: 'spaced' },
      },
      { headers: auth },
    )
    expect(mk.status).toBe(200)
    const res = await SELF.fetch('https://tb.test/docs/hello%20world/~help', { headers: auth })
    expect(res.status).toBe(200)
  })
})

describe('~register body 校验(修复 8)', () => {
  it('缺 kind → 400', async () => {
    const sk = await issueSk({
      owner: 'agent:reg8a',
      scopes: [{ pattern: '**', actions: ['read', 'register'] }],
    })
    const res = await postJson(
      'r8a/~register',
      { path: 'r8a', description: 'no kind' },
      { headers: { authorization: `Bearer ${sk}` } },
    )
    expect(res.status).toBe(400)
  })

  it('body.path ≠ URL path → 400', async () => {
    const sk = await issueSk({
      owner: 'agent:reg8b',
      scopes: [{ pattern: '**', actions: ['read', 'register'] }],
    })
    const res = await postJson(
      'r8b/~register',
      { path: 'r8b-other', kind: 'directory', description: 'mismatch' },
      { headers: { authorization: `Bearer ${sk}` } },
    )
    expect(res.status).toBe(400)
  })
})

describe('mcp 节点 ~help(上游 https 强制)', () => {
  it('挂一个 http:// url 的 mcp 节点 → ~help 因非 https(未放行)被拒', async () => {
    const sk = await issueSk({
      owner: 'agent:mcp',
      scopes: [{ pattern: '**', actions: ['read', 'register'] }],
    })
    const auth = { authorization: `Bearer ${sk}` }
    const mk = await postJson(
      'system/registry',
      {
        tool: 'write',
        arguments: {
          path: 'ext/ctx7',
          kind: 'mcp',
          description: 'ctx7',
          config: { kind: 'mcp', url: 'http://insecure.invalid/mcp' },
        },
      },
      admin(),
    )
    expect(mk.status).toBe(200)
    const res = await SELF.fetch('https://tb.test/ext/ctx7/~help', { headers: auth })
    // 未设 TB_ALLOW_INSECURE_HTTP → 400 invalid_argument;若 opt-in 运行放行了 http,
    // 则转为上游不可达的归一错误(5xx)。两种都不是 501。
    expect([400, 500, 503]).toContain(res.status)
    expect(res.status).not.toBe(501)
  })
})

describe('SK 吊销 / 认证失效(修复 9)', () => {
  it('issueSk → delete → 被吊销 SK 请求 → 401', async () => {
    const secret = await issueSk({
      owner: 'agent:revoke',
      scopes: [{ pattern: 'docs/**', actions: ['read'] }],
    })
    const auth = { authorization: `Bearer ${secret}` }
    // 吊销前可用(root ~help 200,免 read 判定)。
    expect((await SELF.fetch('https://tb.test/~help', { headers: auth })).status).toBe(200)
    // 取该 SK 的 id 以 delete。
    const list = (await (
      await postJson('system/sk', { tool: 'list', arguments: {} }, admin())
    ).json()) as { items: Array<{ id: string, owner: string }> }
    const id = list.items.find(k => k.owner === 'agent:revoke')?.id
    expect(id).toBeDefined()
    const del = await postJson('system/sk', { tool: 'delete', arguments: { id } }, admin())
    expect(del.status).toBe(200)
    // 吊销后 → 401。
    expect((await SELF.fetch('https://tb.test/~help', { headers: auth })).status).toBe(401)
  })

  it('update{disabled:true} → 401', async () => {
    const secret = await issueSk({
      owner: 'agent:disable',
      scopes: [{ pattern: 'docs/**', actions: ['read'] }],
    })
    const auth = { authorization: `Bearer ${secret}` }
    expect((await SELF.fetch('https://tb.test/~help', { headers: auth })).status).toBe(200)
    const list = (await (
      await postJson('system/sk', { tool: 'list', arguments: {} }, admin())
    ).json()) as { items: Array<{ id: string, owner: string }> }
    const id = list.items.find(k => k.owner === 'agent:disable')?.id
    const upd = await postJson(
      'system/sk',
      { tool: 'update', arguments: { id, patch: { disabled: true } } },
      admin(),
    )
    expect(upd.status).toBe(200)
    expect((await SELF.fetch('https://tb.test/~help', { headers: auth })).status).toBe(401)
  })

  it('expiresAt 为过去 → 401(过期视同禁用)', async () => {
    const secret = await issueSk({
      owner: 'agent:expired',
      scopes: [{ pattern: 'docs/**', actions: ['read'] }],
      expiresAt: '2000-01-01T00:00:00.000Z',
    })
    const res = await SELF.fetch('https://tb.test/~help', {
      headers: { authorization: `Bearer ${secret}` },
    })
    expect(res.status).toBe(401)
  })
})
