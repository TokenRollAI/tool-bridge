import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../../src/skillhub/frontmatter'

describe('parseFrontmatter', () => {
  it('解析顶层标量,去引号', () => {
    const { meta, body } = parseFrontmatter(
      '---\nname: "pdf-tools"\ndescription: Fill forms\nversion: 1.0.0\n---\n# Body\n\ntext\n',
    )
    expect(meta.name).toBe('pdf-tools')
    expect(meta.description).toBe('Fill forms')
    expect(meta.version).toBe('1.0.0')
    expect(body).toBe('# Body\n\ntext\n')
  })

  it('无 frontmatter → meta 空、body 为原文', () => {
    const { meta, body } = parseFrontmatter('# just markdown\n')
    expect(meta).toEqual({})
    expect(body).toBe('# just markdown\n')
  })

  it('起始 --- 但无闭合 → 视为无 frontmatter(不吞正文)', () => {
    const text = '---\nname: x\nstill body no fence\n'
    const { meta, body } = parseFrontmatter(text)
    expect(meta).toEqual({})
    expect(body).toBe(text)
  })

  it('容忍 CRLF、注释行与列表项', () => {
    const { meta } = parseFrontmatter(
      '---\r\n# a comment\r\nname: demo\r\ntags:\r\n  - a\r\n  - b\r\ndescription: d\r\n---\r\nbody\r\n',
    )
    expect(meta.name).toBe('demo')
    expect(meta.description).toBe('d')
    // 列表项(无 "key:" 的 "- a")被跳过,不污染 meta。
    expect(meta.tags).toBe('') // "tags:" 空值行 → 空串
    expect(Object.keys(meta)).not.toContain('- a')
  })

  it('单引号包裹的值', () => {
    const { meta } = parseFrontmatter("---\nname: 'quoted name'\ndescription: d\n---\nx")
    expect(meta.name).toBe('quoted name')
  })
})
