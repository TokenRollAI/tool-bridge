import { describe, expect, it } from 'vitest'
import { parseHelpDsl, renderHelpDsl, renderHelpJson } from '../../src/htbp/helpDsl'
import type { HelpModel } from '../../src/htbp/model'

/** 覆盖:必填 scope + 可选 inputSchema/returns/effect/confirm + directory children。 */
const model: HelpModel = {
  node: { path: 'docs/context7', kind: 'mcp', description: 'Context7 文档检索' },
  cmds: [
    {
      name: 'resolve-library-id',
      method: 'POST',
      path: '/docs/context7',
      inputSchema: {
        type: 'object',
        properties: { libraryName: { type: 'string' } },
        required: ['libraryName'],
      },
      returns: 'markdown 文档库列表',
      scope: 'call',
    },
    {
      name: 'delete-cache',
      method: 'POST',
      path: '/docs/context7',
      scope: 'write',
      effect: '清空本地缓存',
      confirm: true,
    },
  ],
  children: [{ path: 'docs/context7/sub', kind: 'directory', description: '子目录' }],
}

describe('DSL↔JSON 语义等价(同一 HelpModel 两种表现字段一致)', () => {
  it('DSL 经 parse 得到的 cmd name/method/path/scope 集合 === JSON cmds 对应字段', () => {
    const parsed = parseHelpDsl(renderHelpDsl(model))
    const json = renderHelpJson(model)

    const fromDsl = parsed.cmds.map((c) => ({
      name: c.name,
      method: c.method,
      path: c.path,
      scope: c.scope,
    }))
    const fromJson = json.cmds.map((c) => ({
      name: c.name,
      method: c.method,
      path: c.path,
      scope: c.scope,
    }))
    expect(fromDsl).toEqual(fromJson)
  })

  it('每个 cmd 都解析出 scope(scope 必填)', () => {
    const parsed = parseHelpDsl(renderHelpDsl(model))
    expect(parsed.cmds).toHaveLength(2)
    for (const cmd of parsed.cmds) {
      expect(cmd.scope).toBeDefined()
    }
    expect(parsed.cmds.map((c) => c.scope)).toEqual(['call', 'write'])
  })

  it('JSON htbp 版本 === DSL 首行版本', () => {
    const parsed = parseHelpDsl(renderHelpDsl(model))
    expect(parsed.htbp).toBe(renderHelpJson(model).htbp)
    expect(parsed.htbp).toBe('0.1')
  })

  it('directory children 在 DSL(node 行)与 JSON(children)中一致', () => {
    const parsed = parseHelpDsl(renderHelpDsl(model))
    const json = renderHelpJson(model)
    // 解析出的 node 行 = 主节点 + 1 个子节点
    expect(parsed.nodes).toHaveLength(2)
    const childNode = parsed.nodes.find((n) => n.path === 'docs/context7/sub')
    expect(childNode).toEqual({
      path: 'docs/context7/sub',
      kind: 'directory',
      description: '子目录',
    })
    expect(json.children).toEqual([
      { path: 'docs/context7/sub', kind: 'directory', description: '子目录' },
    ])
  })
})

describe('renderHelpJson 字段不多不少(规范性)', () => {
  const json = renderHelpJson(model)

  it('有值字段出现、无值字段缺席(toEqual 精确匹配即断言无多余键)', () => {
    // 第一条:带 inputSchema/returns,无 effect/confirm
    expect(json.cmds[0]).toEqual({
      name: 'resolve-library-id',
      method: 'POST',
      path: '/docs/context7',
      scope: 'call',
      inputSchema: {
        type: 'object',
        properties: { libraryName: { type: 'string' } },
        required: ['libraryName'],
      },
      returns: 'markdown 文档库列表',
    })
    // 第二条:带 effect/confirm,无 inputSchema/returns
    expect(json.cmds[1]).toEqual({
      name: 'delete-cache',
      method: 'POST',
      path: '/docs/context7',
      scope: 'write',
      effect: '清空本地缓存',
      confirm: true,
    })
  })

  it('confirm 为 false 时 DSL 与 JSON 都不体现(存在性对齐)', () => {
    const m: HelpModel = {
      node: { path: 'x', kind: 'builtin', description: 'x' },
      cmds: [{ name: 'a', method: 'POST', path: '/x', scope: 'read', confirm: false }],
    }
    expect(renderHelpDsl(m)).not.toContain('confirm')
    // toEqual 精确匹配:无 confirm 键
    expect(renderHelpJson(m).cmds[0]).toEqual({
      name: 'a',
      method: 'POST',
      path: '/x',
      scope: 'read',
    })
  })

  it('无 children 时 JSON 不含 children 键', () => {
    const m: HelpModel = {
      node: { path: 'x', kind: 'builtin', description: 'x' },
      cmds: [{ name: 'a', method: 'POST', path: '/x', scope: 'read' }],
    }
    expect('children' in renderHelpJson(m)).toBe(false)
  })
})

describe('note/feedback 的 DSL↔JSON 等价(新扩展字段)', () => {
  const enriched: HelpModel = {
    ...model,
    note: '管理员补充',
    feedback: [{ id: 'fb_abc123', title: '坑:参数大小写敏感', score: 2 }],
  }

  it('JSON 输出同名字段;DSL 输出对应行(同一 HelpModel 两侧同源)', () => {
    const json = renderHelpJson(enriched)
    expect(json.note).toBe('管理员补充')
    expect(json.feedback).toEqual([{ id: 'fb_abc123', title: '坑:参数大小写敏感', score: 2 }])
    const dsl = renderHelpDsl(enriched)
    expect(dsl).toContain('note "管理员补充"')
    expect(dsl).toContain('feedback 1 GET /docs/context7/~feedback')
    expect(dsl).toContain('  fb_abc123 2 "坑:参数大小写敏感"')
  })

  it('无值/空数组时两侧都缺席(存在性对齐)', () => {
    const json = renderHelpJson(model)
    expect('note' in json).toBe(false)
    expect('feedback' in json).toBe(false)
    const emptyJson = renderHelpJson({ ...model, feedback: [] })
    expect('feedback' in emptyJson).toBe(false)
    const dsl = renderHelpDsl({ ...model, feedback: [] })
    expect(dsl).not.toContain('feedback ')
  })

  it('新行不影响既有消费方(parse 结果与未扩展时一致)', () => {
    expect(parseHelpDsl(renderHelpDsl(enriched))).toEqual(parseHelpDsl(renderHelpDsl(model)))
  })
})
