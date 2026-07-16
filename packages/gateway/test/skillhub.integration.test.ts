import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { TEST_ADMIN_SK } from './fixtures'

// skillhub 集成测试(默认套件只依赖 miniflare 本地 R2 binding,无外部网络):
// ~register 挂载 → Publish(多文件)→ List(目录来自 frontmatter)→ Get(SKILL.md 内联 + 清单)
// → GetFile → Search → Remove;含缺 SKILL.md/缺 name·description 拒绝、readOnly、窄 scope 权限、
// ~help / ~describe。

const admin = (extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, ...(extra.headers ?? {}) },
})

const bearer = (sk: string, extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { authorization: `Bearer ${sk}`, ...(extra.headers ?? {}) },
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

/** admin 经 ~register 挂 r2 skillhub。 */
async function mountHub(path: string, extra: Record<string, unknown> = {}): Promise<Response> {
  return postJson(
    `${path}/~register`,
    {
      path,
      kind: 'skillhub',
      description: 'skill hub',
      config: { kind: 'skillhub', provider: 'r2', ...extra },
    },
    admin(),
  )
}

async function call(
  path: string,
  tool: string,
  args: Record<string, unknown>,
  init: RequestInit = admin(),
): Promise<Response> {
  return postJson(path, { tool, arguments: args }, init)
}

const SKILL_MD = `---
name: pdf-tools
description: Fill and read PDF forms.
version: 1.2.0
---
# PDF tools

Use scripts/fill.py to fill a form.
`

interface SkillSummary {
  id: string
  name: string
  description: string
  version?: string
}

describe('skillhub 发布/发现循环', () => {
  it('~register → Publish(多文件)→ List → Get → GetFile → Search → Remove', async () => {
    expect((await mountHub('hubtest/main')).status).toBe(200)

    // Publish:一个多文件 skill(SKILL.md + 脚本 + 参考)。
    const pub = await call('hubtest/main', 'Publish', {
      files: [
        { path: 'SKILL.md', content: SKILL_MD },
        { path: 'scripts/fill.py', content: 'print("fill")\n' },
        { path: 'references/spec.md', content: '# spec\n' },
      ],
    })
    expect(pub.status).toBe(200)
    const pubbed = (await pub.json()) as { id: string; name: string; fileCount: number }
    expect(pubbed.id).toBe('pdf-tools') // slug from frontmatter name
    expect(pubbed.name).toBe('pdf-tools')
    expect(pubbed.fileCount).toBe(3)

    // List:目录条目 name/description 来自 frontmatter。
    const l = await call('hubtest/main', 'List', {})
    expect(l.status).toBe(200)
    const listed = (await l.json()) as { items: SkillSummary[] }
    const entry = listed.items.find((s) => s.id === 'pdf-tools')
    expect(entry?.name).toBe('pdf-tools')
    expect(entry?.description).toBe('Fill and read PDF forms.')
    expect(entry?.version).toBe('1.2.0')

    // Get:SKILL.md 正文内联 + 文件清单。
    const g = await call('hubtest/main', 'Get', { id: 'pdf-tools' })
    expect(g.status).toBe(200)
    const detail = (await g.json()) as {
      content: string
      files: { path: string }[]
      description: string
    }
    expect(detail.content).toContain('# PDF tools')
    expect(detail.description).toBe('Fill and read PDF forms.')
    expect(detail.files.map((f) => f.path).sort()).toEqual([
      'SKILL.md',
      'references/spec.md',
      'scripts/fill.py',
    ])

    // GetFile:取单个 bundled 文件(内联文本)。
    const gf = await call('hubtest/main', 'Get', { id: 'pdf-tools', file: 'scripts/fill.py' })
    expect(gf.status).toBe(200)
    const one = (await gf.json()) as { path: string; content: unknown }
    expect(one.path).toBe('scripts/fill.py')
    expect(one.content).toBe('print("fill")\n')

    // Search:命中 description。
    const s = await call('hubtest/main', 'Search', { query: 'pdf' })
    expect(s.status).toBe(200)
    expect(
      ((await s.json()) as { items: SkillSummary[] }).items.some((x) => x.id === 'pdf-tools'),
    ).toBe(true)

    // Remove → 再 Get 404;Remove 不存在 → 404。
    expect((await call('hubtest/main', 'Remove', { id: 'pdf-tools' })).status).toBe(200)
    expect((await call('hubtest/main', 'Get', { id: 'pdf-tools' })).status).toBe(404)
    expect((await call('hubtest/main', 'Remove', { id: 'pdf-tools' })).status).toBe(404)
  })

  it('Publish 整体替换:移除旧文件', async () => {
    expect((await mountHub('hubtest/replace')).status).toBe(200)
    await call('hubtest/replace', 'Publish', {
      id: 's',
      files: [
        { path: 'SKILL.md', content: SKILL_MD },
        { path: 'old.txt', content: 'old\n' },
      ],
    })
    await call('hubtest/replace', 'Publish', {
      id: 's',
      files: [{ path: 'SKILL.md', content: SKILL_MD }],
    })
    const g = await call('hubtest/replace', 'Get', { id: 's' })
    const detail = (await g.json()) as { files: { path: string }[] }
    expect(detail.files.map((f) => f.path)).toEqual(['SKILL.md'])
  })
})

describe('skillhub 校验与权限', () => {
  it('缺 SKILL.md → 400;frontmatter 缺 name/description → 400', async () => {
    expect((await mountHub('hubtest/valid')).status).toBe(200)
    const noDoc = await call('hubtest/valid', 'Publish', {
      id: 'x',
      files: [{ path: 'readme.md', content: '# nope\n' }],
    })
    expect(noDoc.status).toBe(400)
    const noName = await call('hubtest/valid', 'Publish', {
      files: [{ path: 'SKILL.md', content: '---\ndescription: only desc\n---\nbody\n' }],
    })
    expect(noName.status).toBe(400)
  })

  it('readOnly 挂载拒绝 Publish/Remove(403),仍可 List/Get', async () => {
    expect((await mountHub('hubtest/ro-seed')).status).toBe(200)
    await call('hubtest/ro-seed', 'Publish', {
      id: 'seed',
      files: [{ path: 'SKILL.md', content: SKILL_MD }],
    })
    // 同一底层桶前缀:再挂一个 readOnly 节点覆盖同路径不可行,故直接在 readOnly 节点上验证拒写。
    expect((await mountHub('hubtest/ro', { readOnly: true })).status).toBe(200)
    expect(
      (
        await call('hubtest/ro', 'Publish', {
          files: [{ path: 'SKILL.md', content: SKILL_MD }],
        })
      ).status,
    ).toBe(403)
    expect((await call('hubtest/ro', 'Remove', { id: 'x' })).status).toBe(403)
    expect((await call('hubtest/ro', 'List', {})).status).toBe(200)
  })

  it('窄 scope SK:read 可 List、write 被拒 403', async () => {
    expect((await mountHub('hubtest/scoped')).status).toBe(200)
    const readerSk = await issueSk({
      owner: 'agent:reader',
      scopes: [{ pattern: 'hubtest/scoped', actions: ['read'] }],
    })
    expect((await call('hubtest/scoped', 'List', {}, bearer(readerSk))).status).toBe(200)
    expect(
      (
        await call(
          'hubtest/scoped',
          'Publish',
          { files: [{ path: 'SKILL.md', content: SKILL_MD }] },
          bearer(readerSk),
        )
      ).status,
    ).toBe(403)
  })

  it('未知 cmd → 400', async () => {
    expect((await mountHub('hubtest/unk')).status).toBe(200)
    expect((await call('hubtest/unk', 'Frobnicate', {})).status).toBe(400)
  })
})

describe('skillhub ~help / ~describe', () => {
  it('~help(JSON)列出 skillhub 动词', async () => {
    expect((await mountHub('hubtest/help')).status).toBe(200)
    const res = await SELF.fetch(
      'https://tb.test/hubtest/help/~help',
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(res.status).toBe(200)
    const help = (await res.json()) as { node: { kind: string }; cmds: { name: string }[] }
    expect(help.node.kind).toBe('skillhub')
    const names = help.cmds.map((c) => c.name).sort()
    expect(names).toEqual(['Get', 'List', 'Publish', 'Remove', 'Search'])
  })

  it('~describe 返回 skillhub capabilities', async () => {
    expect((await mountHub('hubtest/desc')).status).toBe(200)
    const res = await SELF.fetch('https://tb.test/hubtest/desc/~describe', admin())
    expect(res.status).toBe(200)
    const d = (await res.json()) as { kind: string; capabilities: string[] }
    expect(d.kind).toBe('skillhub')
    expect(d.capabilities).toContain('search')
  })

  it('readOnly 节点 ~help 隐藏写动词', async () => {
    expect((await mountHub('hubtest/rohelp', { readOnly: true })).status).toBe(200)
    const res = await SELF.fetch(
      'https://tb.test/hubtest/rohelp/~help',
      admin({ headers: { accept: 'application/json' } }),
    )
    const help = (await res.json()) as { cmds: { name: string }[] }
    const names = help.cmds.map((c) => c.name)
    expect(names).not.toContain('Publish')
    expect(names).not.toContain('Remove')
    expect(names).toContain('List')
  })
})
