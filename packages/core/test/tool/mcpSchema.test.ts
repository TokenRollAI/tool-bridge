import { describe, expect, it } from 'vitest'
import { parseHelpDsl, renderHelpDsl } from '../../src/htbp/helpDsl'
import { toolsToHelpModel } from '../../src/tool/mcpSchema'
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

describe('toolsToHelpModel(Proto §4.1 → §1.3)', () => {
  const model = toolsToHelpModel('docs/context7', { kind: 'mcp', description: 'Context7' }, tools)

  it('node 行:节点路径/kind/description', () => {
    expect(model.node).toEqual({ path: 'docs/context7', kind: 'mcp', description: 'Context7' })
  })

  it('每工具一条 cmd:name=虚拟名、POST、path=/<nodePath>、scope=call', () => {
    expect(model.cmds).toHaveLength(2)
    const c0 = model.cmds[0]
    expect(c0?.name).toBe('resolve-library-id')
    expect(c0?.method).toBe('POST')
    expect(c0?.path).toBe('/docs/context7')
    expect(c0?.scope).toBe('call')
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

  it('经 renderHelpDsl:cmd 行完整,h 行在 scope 前,scope call 存在', () => {
    const dsl = renderHelpDsl(model)
    const lines = dsl.split('\n')
    expect(lines).toContain('cmd resolve-library-id POST /docs/context7')
    expect(lines).toContain('  h 解析库 id')
    expect(lines).toContain('  scope call')
    // h 行位于对应 cmd 的 scope 行之前
    const cmdIdx = lines.indexOf('cmd resolve-library-id POST /docs/context7')
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
      path: '/docs/context7',
      scope: 'call',
    })
  })

  it('无 description 的工具:不渲染 h 行', () => {
    const m = toolsToHelpModel('x', { kind: 'http', description: 'X' }, [{ name: 'bare' }])
    const dsl = renderHelpDsl(m)
    expect(dsl).not.toContain('  h ')
    expect(dsl).toContain('cmd bare POST /x')
  })
})
