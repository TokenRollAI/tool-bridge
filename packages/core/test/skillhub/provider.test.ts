import { describe, expect, it } from 'vitest'
import { MemoryObjectStore } from '../../src/context/objectStore'
import { isTBError, type TBErrorCode } from '../../src/errors'
import { createSkillhubProvider, type SkillhubProvider } from '../../src/skillhub/provider'

const NOW = '2026-07-16T00:00:00.000Z'
const NS = 'skills/team'

function make(opts: Partial<Parameters<typeof createSkillhubProvider>[1]> = {}): {
  store: MemoryObjectStore
  provider: SkillhubProvider
} {
  const store = new MemoryObjectStore(() => NOW)
  const provider = createSkillhubProvider(store, { nsPath: NS, keyPrefix: NS, ...opts })
  return { store, provider }
}

async function codeOf(p: Promise<unknown>): Promise<TBErrorCode | string | null> {
  try {
    await p
    return null
  } catch (err) {
    return isTBError(err) ? err.code : String(err)
  }
}

const DOC = '---\nname: pdf-tools\ndescription: Fill PDF forms\nversion: 2.0\n---\n# PDF\n'

describe('createSkillhubProvider', () => {
  it('Publish → List(目录来自 frontmatter)→ Get(正文+清单)', async () => {
    const { provider } = make()
    const res = await provider.Publish({
      files: [
        { path: 'SKILL.md', content: DOC },
        { path: 'scripts/fill.py', content: 'print(1)\n' },
      ],
    })
    expect(res.id).toBe('pdf-tools') // slug from frontmatter name
    expect(res.fileCount).toBe(2)

    const list = await provider.List()
    const entry = list.items.find((s) => s.id === 'pdf-tools')
    expect(entry?.name).toBe('pdf-tools')
    expect(entry?.description).toBe('Fill PDF forms')
    expect(entry?.version).toBe('2.0')

    const detail = await provider.Get('pdf-tools')
    expect(detail.content).toContain('# PDF')
    expect(detail.files.map((f) => f.path).sort()).toEqual(['SKILL.md', 'scripts/fill.py'])

    const file = await provider.GetFile('pdf-tools', 'scripts/fill.py')
    expect(file.content).toBe('print(1)\n')
  })

  it('显式 id 覆盖 slug', async () => {
    const { provider } = make()
    const res = await provider.Publish({
      id: 'custom',
      files: [{ path: 'SKILL.md', content: DOC }],
    })
    expect(res.id).toBe('custom')
    expect((await provider.Get('custom')).id).toBe('custom')
  })

  it('缺 SKILL.md / 缺 name·description → invalid_argument', async () => {
    const { provider } = make()
    expect(await codeOf(provider.Publish({ files: [{ path: 'x.md', content: 'no doc' }] }))).toBe(
      'invalid_argument',
    )
    expect(
      await codeOf(
        provider.Publish({ files: [{ path: 'SKILL.md', content: '---\nname: only\n---\nb' }] }),
      ),
    ).toBe('invalid_argument')
  })

  it('Publish 整体替换:移除未列出的旧文件', async () => {
    const { provider } = make()
    await provider.Publish({
      id: 's',
      files: [
        { path: 'SKILL.md', content: DOC },
        { path: 'old.txt', content: 'old' },
      ],
    })
    await provider.Publish({ id: 's', files: [{ path: 'SKILL.md', content: DOC }] })
    expect((await provider.Get('s')).files.map((f) => f.path)).toEqual(['SKILL.md'])
  })

  it('Search 命中 description;Remove 后 Get 404;Remove 不存在 404', async () => {
    const { provider } = make()
    await provider.Publish({ id: 'pdf-tools', files: [{ path: 'SKILL.md', content: DOC }] })
    const found = await provider.Search('fill')
    expect(found.items.some((s) => s.id === 'pdf-tools')).toBe(true)

    await provider.Remove('pdf-tools')
    expect(await codeOf(provider.Get('pdf-tools'))).toBe('not_found')
    expect(await codeOf(provider.Remove('pdf-tools'))).toBe('not_found')
  })

  it('readOnly:拒 Publish/Remove(permission_denied),仍可 List/Get', async () => {
    const seed = make()
    await seed.provider.Publish({ id: 's', files: [{ path: 'SKILL.md', content: DOC }] })
    // 复用同一底层 store 造 readOnly provider。
    const ro = createSkillhubProvider(seed.store, { nsPath: NS, keyPrefix: NS, readOnly: true })
    expect(await codeOf(ro.Publish({ files: [{ path: 'SKILL.md', content: DOC }] }))).toBe(
      'permission_denied',
    )
    expect(await codeOf(ro.Remove('s'))).toBe('permission_denied')
    expect((await ro.List()).items.length).toBe(1)
    expect((await ro.Get('s')).id).toBe('s')
  })

  it('非法 skill id(含 /)→ invalid_argument', async () => {
    const { provider } = make()
    expect(await codeOf(provider.Get('a/b'))).toBe('invalid_argument')
    expect(await codeOf(provider.Remove('..'))).toBe('invalid_argument')
  })

  it('非字符串 content → invalid_argument', async () => {
    const { provider } = make()
    expect(
      await codeOf(
        provider.Publish({
          files: [{ path: 'SKILL.md', content: 123 as unknown as string }],
        }),
      ),
    ).toBe('invalid_argument')
  })
})
