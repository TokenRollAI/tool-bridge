import { describe, expect, it } from 'vitest'
import { CONTEXT_CAPABILITIES, contextHelpModel, contextScopeForCmd } from '../../src/context/help'

const node = { path: 'ctx/main', description: 'main context' }

describe('contextHelpModel', () => {
  it('六 cmd 首字母大写,scope:List/Get/Search=read,Write/Update/Delete=write', () => {
    const help = contextHelpModel(node)
    expect(help.node).toEqual({ path: 'ctx/main', kind: 'context', description: 'main context' })
    expect(help.cmds.map((c) => c.name)).toEqual([
      'List',
      'Get',
      'Write',
      'Update',
      'Delete',
      'Search',
    ])
    const scopeOf = (name: string) => help.cmds.find((c) => c.name === name)?.scope
    for (const name of ['List', 'Get', 'Search']) expect(scopeOf(name)).toBe('read')
    for (const name of ['Write', 'Update', 'Delete']) expect(scopeOf(name)).toBe('write')
    for (const c of help.cmds) {
      expect(c.method).toBe('POST')
      expect(c.path).toBe('/ctx/main')
    }
  })

  it('inputSchema 为真 JSON Schema(arguments 形状与接口签名一致)', () => {
    const help = contextHelpModel(node)
    const schemaOf = (name: string) =>
      help.cmds.find((c) => c.name === name)?.inputSchema as {
        type: string
        required?: string[]
        properties: Record<string, unknown>
      }
    expect(Object.keys(schemaOf('List').properties).sort()).toEqual(['opts', 'path'])
    expect(schemaOf('Get').required).toEqual(['path'])
    expect(schemaOf('Write').required).toEqual(['path', 'entry'])
    expect(schemaOf('Update').required).toEqual(['path', 'patch'])
    expect(schemaOf('Search').required).toEqual(['query'])
    for (const c of help.cmds) expect((c.inputSchema as { type: string }).type).toBe('object')
  })

  it('readOnly 隐藏 Write/Update/Delete(决策 D11)', () => {
    const help = contextHelpModel(node, { readOnly: true })
    expect(help.cmds.map((c) => c.name)).toEqual(['List', 'Get', 'Search'])
  })
})

describe('contextScopeForCmd', () => {
  it('read/write 映射;未知或小写 cmd → null', () => {
    expect(contextScopeForCmd('List')).toBe('read')
    expect(contextScopeForCmd('Get')).toBe('read')
    expect(contextScopeForCmd('Search')).toBe('read')
    expect(contextScopeForCmd('Write')).toBe('write')
    expect(contextScopeForCmd('Update')).toBe('write')
    expect(contextScopeForCmd('Delete')).toBe('write')
    expect(contextScopeForCmd('list')).toBeNull()
    expect(contextScopeForCmd('Watch')).toBeNull()
  })
})

describe('CONTEXT_CAPABILITIES', () => {
  it('声明 search 与 delete(Proto §5.1 可选能力)', () => {
    expect([...CONTEXT_CAPABILITIES].sort()).toEqual(['delete', 'search'])
  })
})
