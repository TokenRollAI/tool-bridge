import { describe, expect, it } from 'vitest'
import { parseHelpDsl, renderHelpDsl } from '../../src/htbp/helpDsl'
import { toolHelpModel, toolsToHelpModel } from '../../src/tool/mcpSchema'
import type { ToolSpec } from '../../src/tool/types'

const tools: ToolSpec[] = [
  {
    name: 'resolve-library-id',
    description: '解析库 id',
    inputSchema: { type: 'object', properties: { libraryName: { type: 'string' } } },
    effect: 'read',
  },
  { name: 'drop-db', description: '删库', effect: 'destructive' },
]

describe('toolsToHelpModel(上游工具集 → HelpModel)', () => {
  const model = toolsToHelpModel('docs/context7', { kind: 'mcp', description: 'Context7' }, tools)

  it('node 行:节点路径/kind/description', () => {
    expect(model.node).toEqual({ path: 'docs/context7', kind: 'mcp', description: 'Context7' })
  })

  it('每工具一条 cmd:name=虚拟名、POST、path=/<nodePath>/<tool> 直连、scope=call', () => {
    expect(model.cmds).toHaveLength(2)
    const c0 = model.cmds[0]
    expect(c0?.name).toBe('resolve-library-id')
    expect(c0?.method).toBe('POST')
    expect(c0?.path).toBe('/docs/context7/resolve-library-id')
    expect(c0?.scope).toBe('call')
    expect(c0?.flatBody).toBe(true)
  })

  it('description → h 行;inputSchema 透传;effect 透传', () => {
    const c0 = model.cmds[0]
    expect(c0?.h).toBe('解析库 id')
    expect(c0?.inputSchema).toEqual({
      type: 'object',
      properties: { libraryName: { type: 'string' } },
    })
    expect(c0?.effect).toBe('read')
  })

  it('effect=destructive 且未显式 confirm → 派生 confirm:true', () => {
    const c1 = model.cmds[1]
    expect(c1?.effect).toBe('destructive')
    expect(c1?.confirm).toBe(true)
  })

  it('经 renderHelpDsl:cmd 行是直连路径,h 行在 scope 前,body 为裸 inputSchema', () => {
    const dsl = renderHelpDsl(model)
    const lines = dsl.split('\n')
    expect(lines).toContain('cmd resolve-library-id POST /docs/context7/resolve-library-id')
    expect(lines).toContain('  h 解析库 id')
    expect(lines).toContain('  scope call')
    // flatBody:body 行是裸 inputSchema,不含 {tool,arguments} 信封
    const bodyLine = lines.find((l) => l.startsWith('  body '))
    expect(bodyLine).toBeDefined()
    expect(bodyLine).not.toContain('"tool"')
    expect(JSON.parse((bodyLine ?? '').slice('  body '.length))).toEqual(tools[0]?.inputSchema)
    // h 行位于对应 cmd 的 scope 行之前
    const cmdIdx = lines.indexOf('cmd resolve-library-id POST /docs/context7/resolve-library-id')
    const hIdx = lines.indexOf('  h 解析库 id')
    const scopeIdx = lines.indexOf('  scope call')
    expect(cmdIdx).toBeLessThan(hIdx)
    expect(hIdx).toBeLessThan(scopeIdx)
  })

  it('经最小 parser:cmd 的 name/method/path/scope 完整', () => {
    const parsed = parseHelpDsl(renderHelpDsl(model))
    expect(parsed.cmds[0]).toEqual({
      name: 'resolve-library-id',
      method: 'POST',
      path: '/docs/context7/resolve-library-id',
      scope: 'call',
    })
  })

  it('无 description 的工具:不渲染 h 行', () => {
    const m = toolsToHelpModel('x', { kind: 'http', description: 'X' }, [{ name: 'bare' }])
    const dsl = renderHelpDsl(m)
    expect(dsl).not.toContain('  h ')
    expect(dsl).toContain('cmd bare POST /x/bare')
  })
})

describe('两级披露:索引形态与单工具全量', () => {
  it('index:true → cmd 不含 inputSchema;h/scope/effect/confirm 保留', () => {
    const m = toolsToHelpModel('docs/context7', { kind: 'mcp', description: 'Context7' }, tools, {
      index: true,
    })
    expect(m.cmds[0]?.inputSchema).toBeUndefined()
    expect(m.cmds[0]?.h).toBe('解析库 id')
    expect(m.cmds[0]?.scope).toBe('call')
    expect(m.cmds[1]?.confirm).toBe(true)
    // DSL 表现:无 body 行
    expect(renderHelpDsl(m)).not.toContain('  body ')
  })

  it('index:true → description 保持干净,下钻指引落 hint 字段(index 标记为真)', () => {
    const m = toolsToHelpModel('docs/context7', { kind: 'mcp', description: 'Context7' }, tools, {
      index: true,
    })
    expect(m.node.description).toBe('Context7')
    expect(m.index).toBe(true)
    expect(m.hint).toContain('GET /docs/context7/<tool>/~help')
    // DSL 表现:hint 行紧随 node 行
    const lines = renderHelpDsl(m).split('\n')
    expect(lines[2]?.startsWith('hint ')).toBe(true)
  })

  it('index:true → 多行 description 的 h 压缩为一句话摘要(全文只在单工具全量)', () => {
    const longTool: ToolSpec = {
      name: 'explore',
      description:
        '查看日志数据聚合分析结果。\n\n## 功能概述\n\n该工具可以给出概览信息。\n\nArgs:\n    project: 项目名',
    }
    const m = toolsToHelpModel('logs', { kind: 'mcp', description: 'SLS' }, [longTool], {
      index: true,
    })
    expect(m.cmds[0]?.h).toBe('查看日志数据聚合分析结果。')
    // 单工具全量保留全文
    const full = toolHelpModel('logs', { kind: 'mcp', description: 'SLS' }, longTool)
    expect(full.cmds[0]?.h).toBe(longTool.description)
    // 但 node 行 description 是一句话摘要(不整篇重复)
    expect(full.node.description).toBe('查看日志数据聚合分析结果。')
  })

  it('toolHelpModel:node 行是工具伪节点路径,cmd path 同为直连路径', () => {
    const tool = tools[0] as ToolSpec
    const m = toolHelpModel('docs/context7', { kind: 'mcp', description: 'Context7' }, tool)
    expect(m.node.path).toBe('docs/context7/resolve-library-id')
    expect(m.node.description).toBe('解析库 id')
    expect(m.cmds).toHaveLength(1)
    expect(m.cmds[0]?.path).toBe('/docs/context7/resolve-library-id')
    expect(m.cmds[0]?.inputSchema).toEqual(tool.inputSchema)
  })

  it('toolHelpModel:无 description 的工具回落节点描述', () => {
    const m = toolHelpModel('x', { kind: 'http', description: 'X 上游' }, { name: 'bare' })
    expect(m.node.description).toBe('X 上游')
  })
})
