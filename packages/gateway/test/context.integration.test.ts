import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { TEST_ADMIN_SK } from './fixtures'

// Phase 3(Context Layer)集成测试:r2 namespace 四动词 + Search/Delete、readOnly、
// ttl 懒回收、~describe、entry 非 Node、大对象 $ref(/~ref 中转)、权限、路径穿越、
// 挂载校验。默认套件只依赖 miniflare 本地 R2 binding(无外部网络);
// s3 provider 走 opt-in(TB_TEST_S3_* 四变量齐才跑,可用 `pnpm s3-mock` 起本地端点)。

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

/** admin 经 ~register 挂 r2 context namespace。 */
async function mountR2(path: string, extra: Record<string, unknown> = {}): Promise<Response> {
  return postJson(
    `${path}/~register`,
    {
      path,
      kind: 'context',
      description: 'r2 namespace',
      config: { kind: 'context', provider: 'r2', ...extra },
    },
    admin(),
  )
}

/** 数据面调用 context 动词(admin,JSON 协商)。 */
async function ctxCall(
  path: string,
  tool: string,
  args: Record<string, unknown>,
  init: RequestInit = admin(),
): Promise<Response> {
  return postJson(path, { tool, arguments: args }, init)
}

interface EntryMeta {
  uri: string
  contentType: string
  size?: number
  version: string
  updatedAt: string
  metadata: Record<string, string>
}

describe('r2 namespace 四动词循环(DOD Phase 3)', () => {
  it('~register 挂载 → Write→List→Get→Update 全循环', async () => {
    expect((await mountR2('ctxtest/rw')).status).toBe(200)

    // Write:创建条目,uri 形状 node://<nsPath>/<entryPath>。
    const w = await ctxCall('ctxtest/rw', 'Write', {
      path: 'notes/a.md',
      entry: { contentType: 'text/markdown', content: '# hi', metadata: { topic: 'demo' } },
    })
    expect(w.status).toBe(200)
    const wrote = (await w.json()) as EntryMeta
    expect(wrote.uri).toBe('node://ctxtest/rw/notes/a.md')
    expect(wrote.version).not.toBe('')

    // List:浅层列举,子目录折叠为 application/x-directory。
    const l = await ctxCall('ctxtest/rw', 'List', {})
    expect(l.status).toBe(200)
    const listed = (await l.json()) as { items: EntryMeta[] }
    const dir = listed.items.find((i) => i.uri === 'node://ctxtest/rw/notes/')
    expect(dir?.contentType).toBe('application/x-directory')

    // Get:内联文本内容。
    const g = await ctxCall('ctxtest/rw', 'Get', { path: 'notes/a.md' })
    expect(g.status).toBe(200)
    const got = (await g.json()) as EntryMeta & { content: unknown }
    expect(got.content).toBe('# hi')

    // Update:content + metadata 浅合并,version 前进。
    // (r2 的 etag 是内容 MD5:metadata-only patch 内容不变则 version 不变,故 patch 带 content。)
    const u = await ctxCall('ctxtest/rw', 'Update', {
      path: 'notes/a.md',
      patch: { content: '# hi v2', metadata: { extra: 'x' } },
    })
    expect(u.status).toBe(200)
    const updated = (await u.json()) as EntryMeta
    expect(updated.version).not.toBe(wrote.version)
    expect(updated.metadata).toEqual({ topic: 'demo', extra: 'x' })

    // Delete → 再 Get 404;Delete 幂等(重复 200)。
    expect((await ctxCall('ctxtest/rw', 'Delete', { path: 'notes/a.md' })).status).toBe(200)
    expect((await ctxCall('ctxtest/rw', 'Get', { path: 'notes/a.md' })).status).toBe(404)
    expect((await ctxCall('ctxtest/rw', 'Delete', { path: 'notes/a.md' })).status).toBe(200)
  })

  it('Write 幂等复写 200;ifVersion 错 → 409;Update 不存在 → 404', async () => {
    expect((await mountR2('ctxtest/ver')).status).toBe(200)
    const w1 = await ctxCall('ctxtest/ver', 'Write', {
      path: 'a.txt',
      entry: { contentType: 'text/plain', content: 'one' },
    })
    expect(w1.status).toBe(200)
    const m1 = (await w1.json()) as EntryMeta

    // 幂等 upsert:复写 200,version 前进。
    const w2 = await ctxCall('ctxtest/ver', 'Write', {
      path: 'a.txt',
      entry: { contentType: 'text/plain', content: 'two' },
    })
    expect(w2.status).toBe(200)
    expect(((await w2.json()) as EntryMeta).version).not.toBe(m1.version)

    // ifVersion 不匹配 → 409 conflict。
    const stale = await ctxCall('ctxtest/ver', 'Write', {
      path: 'a.txt',
      entry: { contentType: 'text/plain', content: 'three', ifVersion: m1.version },
    })
    expect(stale.status).toBe(409)

    const ghost = await ctxCall('ctxtest/ver', 'Update', { path: 'ghost', patch: { content: 'x' } })
    expect(ghost.status).toBe(404)
  })

  it('未知 cmd → 400;路径穿越 Get "../x" → 400', async () => {
    expect((await mountR2('ctxtest/bad')).status).toBe(200)
    expect((await ctxCall('ctxtest/bad', 'list', {})).status).toBe(400) // 大小写不符
    expect((await ctxCall('ctxtest/bad', 'Get', { path: '../x' })).status).toBe(400)
  })
})

describe('Search(keyword 基线;semantic 未声明 → 400)', () => {
  it('keyword 召回路径名与 metadata 值;mode:semantic → 400', async () => {
    expect((await mountR2('ctxtest/search')).status).toBe(200)
    await ctxCall('ctxtest/search', 'Write', {
      path: 'docs/alpha.md',
      entry: { contentType: 'text/markdown', content: 'x' },
    })
    await ctxCall('ctxtest/search', 'Write', {
      path: 'docs/beta.md',
      entry: { contentType: 'text/markdown', content: 'y', metadata: { tag: 'alpha-team' } },
    })

    const s = await ctxCall('ctxtest/search', 'Search', { query: 'alpha' })
    expect(s.status).toBe(200)
    const found = ((await s.json()) as { items: EntryMeta[] }).items.map((i) => i.uri).sort()
    // alpha.md 命中路径名;beta.md 命中 metadata 值(r2 list 带 customMetadata)。
    expect(found).toEqual([
      'node://ctxtest/search/docs/alpha.md',
      'node://ctxtest/search/docs/beta.md',
    ])

    const sem = await ctxCall('ctxtest/search', 'Search', {
      query: 'alpha',
      opts: { mode: 'semantic' },
    })
    expect(sem.status).toBe(400)
  })
})

describe('readOnly 挂载(Proto §5.3 / D11)', () => {
  it('~help JSON 隐藏写动词;POST Write → 403', async () => {
    expect((await mountR2('ctxtest/ro', { readOnly: true })).status).toBe(200)
    const help = await SELF.fetch(
      'https://tb.test/ctxtest/ro/~help',
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(help.status).toBe(200)
    const names = ((await help.json()) as { cmds: Array<{ name: string }> }).cmds
      .map((c) => c.name)
      .sort()
    expect(names).toEqual(['Get', 'List', 'Search'])

    const w = await ctxCall('ctxtest/ro', 'Write', {
      path: 'x.txt',
      entry: { contentType: 'text/plain', content: 'x' },
    })
    expect(w.status).toBe(403)
  })
})

describe('ttl 懒回收(Proto §5.3:下次访问回收)', () => {
  it('ttl=1 → 过期后 POST 404,节点从 ~tree 消失', async () => {
    expect((await mountR2('ctxtest/tmp', { ttl: 1 })).status).toBe(200)
    expect((await ctxCall('ctxtest/tmp', 'List', {})).status).toBe(200)

    await new Promise((r) => setTimeout(r, 1300))

    expect((await ctxCall('ctxtest/tmp', 'List', {})).status).toBe(404)
    const tree = (await (
      await SELF.fetch(
        'https://tb.test/~tree?depth=4',
        admin({ headers: { accept: 'application/json' } }),
      )
    ).json()) as { children?: Array<{ path: string; children?: Array<{ path: string }> }> }
    const ctxDir = tree.children?.find((n) => n.path === 'ctxtest')
    expect(ctxDir?.children?.map((n) => n.path) ?? []).not.toContain('ctxtest/tmp')
  }, 10000)
})

describe('~describe(Proto §1.1)', () => {
  it('context 节点 → {kind, capabilities};非 context 节点 → 404', async () => {
    expect((await mountR2('ctxtest/desc')).status).toBe(200)
    const res = await SELF.fetch('https://tb.test/ctxtest/desc/~describe', admin())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ kind: 'context', capabilities: ['search', 'delete'] })

    const builtin = await SELF.fetch('https://tb.test/system/sk/~describe', admin())
    expect(builtin.status).toBe(404)
  })
})

describe('entry 非 Node(Proto §5.3 / D10)', () => {
  it('/<ns>/<entry> 的 ~help/~describe/POST 一律 404', async () => {
    expect((await mountR2('ctxtest/leaf')).status).toBe(200)
    await ctxCall('ctxtest/leaf', 'Write', {
      path: 'some/entry',
      entry: { contentType: 'text/plain', content: 'x' },
    })
    expect(
      (await SELF.fetch('https://tb.test/ctxtest/leaf/some/entry/~help', admin())).status,
    ).toBe(404)
    expect(
      (await SELF.fetch('https://tb.test/ctxtest/leaf/some/entry/~describe', admin())).status,
    ).toBe(404)
    expect((await ctxCall('ctxtest/leaf/some/entry', 'Get', { path: 'x' })).status).toBe(404)
  })
})

describe('大对象 $ref(/~ref 中转,Proto §5.2)', () => {
  it('>1MiB 文本 → content.$ref 含 /~ref/,免 SK fetch 内容一致;篡改 token → 404', async () => {
    expect((await mountR2('ctxtest/big')).status).toBe(200)
    const bigText = 'A'.repeat(1024 * 1024 + 1)
    const w = await ctxCall('ctxtest/big', 'Write', {
      path: 'big.txt',
      entry: { contentType: 'text/plain', content: bigText },
    })
    expect(w.status).toBe(200)

    const g = await ctxCall('ctxtest/big', 'Get', { path: 'big.txt' })
    expect(g.status).toBe(200)
    const entry = (await g.json()) as { content: { $ref?: string } }
    const refUrl = entry.content.$ref ?? ''
    expect(refUrl).toContain('/~ref/')

    // 不带 Authorization 直接取回(token 即凭证)。
    const fetched = await SELF.fetch(refUrl)
    expect(fetched.status).toBe(200)
    expect(fetched.headers.get('content-type')).toContain('text/plain')
    expect(await fetched.text()).toBe(bigText)

    // 篡改 token(签名段尾部翻转)→ 404 不泄露。
    const tampered = refUrl.slice(0, -2) + (refUrl.endsWith('AA') ? 'BB' : 'AA')
    expect((await SELF.fetch(tampered)).status).toBe(404)
  }, 15000)

  it('二进制 contentType(小体积)同样走 $ref', async () => {
    expect((await mountR2('ctxtest/bin')).status).toBe(200)
    await ctxCall('ctxtest/bin', 'Write', {
      path: 'blob',
      entry: { contentType: 'application/octet-stream', content: 'xx' },
    })
    const g = await ctxCall('ctxtest/bin', 'Get', { path: 'blob' })
    expect(g.status).toBe(200)
    const entry = (await g.json()) as { content: { $ref?: string } }
    expect(entry.content.$ref).toContain('/~ref/')
  })
})

describe('权限(read/write scope 分离)', () => {
  it('read-only scope:List 200、Write 403;无 read scope:List/Get 404', async () => {
    expect((await mountR2('ctxperm/ns')).status).toBe(200)

    const roSk = await issueSk({
      owner: 'agent:ctx-ro',
      scopes: [{ pattern: 'ctxperm/**', actions: ['read'] }],
    })
    const ro = { headers: { authorization: `Bearer ${roSk}` } }
    expect((await ctxCall('ctxperm/ns', 'List', {}, ro)).status).toBe(200)
    expect(
      (
        await ctxCall(
          'ctxperm/ns',
          'Write',
          { path: 'x.txt', entry: { contentType: 'text/plain', content: 'x' } },
          ro,
        )
      ).status,
    ).toBe(403)

    const otherSk = await issueSk({
      owner: 'agent:ctx-other',
      scopes: [{ pattern: 'elsewhere/**', actions: ['read', 'write'] }],
    })
    const other = { headers: { authorization: `Bearer ${otherSk}` } }
    expect((await ctxCall('ctxperm/ns', 'List', {}, other)).status).toBe(404)
    expect((await ctxCall('ctxperm/ns', 'Get', { path: 'x.txt' }, other)).status).toBe(404)
  })
})

describe('挂载校验(Proto §3.2/§5.3)', () => {
  it("provider:'file' → 400(词表外);s3 缺 authRef → 400", async () => {
    const file = await postJson(
      'ctxbad/file/~register',
      {
        path: 'ctxbad/file',
        kind: 'context',
        description: 'bad',
        config: { kind: 'context', provider: 'file' },
      },
      admin(),
    )
    expect(file.status).toBe(400)

    const s3 = await postJson(
      'ctxbad/s3/~register',
      {
        path: 'ctxbad/s3',
        kind: 'context',
        description: 'bad',
        config: {
          kind: 'context',
          provider: 's3',
          providerConfig: { endpoint: 'https://s3.example.com', bucket: 'b' },
        },
      },
      admin(),
    )
    expect(s3.status).toBe(400)
  })
})

// opt-in:TB_TEST_S3_* 四变量齐才跑(`pnpm s3-mock` 起本地 s3rver,或指真实端点)。
// s3rver 不校验 SigV4 签名——签名正确性留真实端点验证。
const s3Env = env as {
  TB_TEST_S3_ENDPOINT?: string
  TB_TEST_S3_ACCESS_KEY_ID?: string
  TB_TEST_S3_SECRET_ACCESS_KEY?: string
  TB_TEST_S3_BUCKET?: string
}
const s3Ready =
  s3Env.TB_TEST_S3_ENDPOINT !== undefined &&
  s3Env.TB_TEST_S3_ACCESS_KEY_ID !== undefined &&
  s3Env.TB_TEST_S3_SECRET_ACCESS_KEY !== undefined &&
  s3Env.TB_TEST_S3_BUCKET !== undefined

describe.skipIf(!s3Ready)('s3 provider E2E(opt-in via TB_TEST_S3_*)', () => {
  async function mountS3(path: string): Promise<Response> {
    // 凭证按 Proto §5.2 形状入 SecretStore,挂载走 authRef 引用。
    const cred = await postJson(
      'system/secret',
      {
        tool: 'set',
        arguments: {
          name: 's3-test-cred',
          value: JSON.stringify({
            accessKeyId: s3Env.TB_TEST_S3_ACCESS_KEY_ID,
            secretAccessKey: s3Env.TB_TEST_S3_SECRET_ACCESS_KEY,
          }),
        },
      },
      admin(),
    )
    expect(cred.status).toBe(200)
    return postJson(
      `${path}/~register`,
      {
        path,
        kind: 'context',
        description: 's3 namespace',
        config: {
          kind: 'context',
          provider: 's3',
          authRef: 's3-test-cred',
          providerConfig: {
            endpoint: s3Env.TB_TEST_S3_ENDPOINT,
            bucket: s3Env.TB_TEST_S3_BUCKET,
            prefix: `it-${Date.now()}`, // 每轮独立前缀,避免共享 bucket 里的残留互相干扰
          },
        },
      },
      admin(),
    )
  }

  it('挂载(连通探测过)→ put→ls→cat→patch 循环', async () => {
    expect((await mountS3('ctxs3/rw')).status).toBe(200)

    const w = await ctxCall('ctxs3/rw', 'Write', {
      path: 'notes/a.md',
      entry: { contentType: 'text/markdown', content: '# s3', metadata: { topic: 'demo' } },
    })
    expect(w.status).toBe(200)
    const wrote = (await w.json()) as EntryMeta
    expect(wrote.uri).toBe('node://ctxs3/rw/notes/a.md')
    expect(wrote.version).not.toBe('')

    const l = await ctxCall('ctxs3/rw', 'List', {})
    expect(l.status).toBe(200)
    const listed = (await l.json()) as { items: EntryMeta[] }
    expect(listed.items.some((i) => i.uri === 'node://ctxs3/rw/notes/')).toBe(true)

    const g = await ctxCall('ctxs3/rw', 'Get', { path: 'notes/a.md' })
    expect(g.status).toBe(200)
    const got = (await g.json()) as EntryMeta & { content: unknown }
    expect(got.content).toBe('# s3')
    expect(got.metadata.topic).toBe('demo')

    const u = await ctxCall('ctxs3/rw', 'Update', {
      path: 'notes/a.md',
      patch: { content: '# s3 v2' },
    })
    expect(u.status).toBe(200)
    expect(
      (await (await ctxCall('ctxs3/rw', 'Get', { path: 'notes/a.md' })).json()) as object,
    ).toMatchObject({
      content: '# s3 v2',
    })
  }, 20000)

  it('s3 有凭证必有 presign:大对象 $ref 是外部 URL 非 /~ref', async () => {
    expect((await mountS3('ctxs3/big')).status).toBe(200)
    await ctxCall('ctxs3/big', 'Write', {
      path: 'blob',
      entry: { contentType: 'application/octet-stream', content: 'binary-ish' },
    })
    const g = await ctxCall('ctxs3/big', 'Get', { path: 'blob' })
    expect(g.status).toBe(200)
    const entry = (await g.json()) as { content: { $ref?: string } }
    const refUrl = entry.content.$ref ?? ''
    expect(refUrl).not.toContain('/~ref/')
    expect(refUrl).toContain(String(s3Env.TB_TEST_S3_ENDPOINT).replace(/\/+$/, ''))
    expect(refUrl).toContain('X-Amz-Signature=')
  }, 20000)

  it('Search 召回 metadata 值命中(ListObjectsV2 不带 metadata,经 head 补取)', async () => {
    expect((await mountS3('ctxs3/search')).status).toBe(200)
    // 路径不含关键字、metadata 值含关键字 → 必须经 head 补取才可召回(Proto §5.2 基线)
    await ctxCall('ctxs3/search', 'Write', {
      path: 'docs/plain.md',
      entry: { contentType: 'text/markdown', content: 'x', metadata: { tag: 'needle-topic' } },
    })
    await ctxCall('ctxs3/search', 'Write', {
      path: 'docs/other.md',
      entry: { contentType: 'text/markdown', content: 'y' },
    })
    const s = await ctxCall('ctxs3/search', 'Search', { query: 'needle' })
    expect(s.status).toBe(200)
    const items = ((await s.json()) as { items: EntryMeta[] }).items
    expect(items.map((i) => i.uri)).toEqual(['node://ctxs3/search/docs/plain.md'])
    expect(items[0]?.metadata).toEqual({ tag: 'needle-topic' })
  }, 20000)
})
