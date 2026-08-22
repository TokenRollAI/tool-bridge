import { describe, expect, it } from 'vitest'
import { CONTEXT_CAPABILITIES, contextHelpModel, contextScopeForCmd } from '../../src/context/help'

const node = { path: 'ctx/main', description: 'main context' }

describe('contextHelpModel', () => {
  it('六 cmd 全小写,scope:list/get/search=read,write/update/delete=write', () => {
    const help = contextHelpModel(node)
    expect(help.node).toEqual({ path: 'ctx/main', kind: 'context', description: 'main context' })
    expect(help.cmds.map(c => c.name)).toEqual([
      'list',
      'get',
      'write',
      'update',
      'delete',
      'search',
    ])
    const scopeOf = (name: string) => help.cmds.find(c => c.name === name)?.scope
    for (const name of ['list', 'get', 'search']) expect(scopeOf(name)).toBe('read')
    for (const name of ['write', 'update', 'delete']) expect(scopeOf(name)).toBe('write')
    for (const c of help.cmds) {
      expect(c.method).toBe('POST')
      expect(c.path).toBe(`/ctx/main/${c.name}`)
    }
  })

  it('inputSchema 为真 JSON Schema(arguments 形状与接口签名一致)', () => {
    const help = contextHelpModel(node)
    const schemaOf = (name: string) =>
      help.cmds.find(c => c.name === name)?.inputSchema as {
        properties: Record<string, unknown>
        required?: string[]
        type: string
      }
    expect(Object.keys(schemaOf('list').properties).sort()).toEqual(['opts', 'path'])
    expect(schemaOf('get').required).toEqual(['path'])
    expect(schemaOf('write').required).toEqual(['path', 'entry'])
    expect(schemaOf('update').required).toEqual(['path', 'patch'])
    expect(schemaOf('search').required).toEqual(['query'])
    for (const c of help.cmds) expect((c.inputSchema as { type: string }).type).toBe('object')
  })

  it('readOnly 隐藏 write/update/delete(决策 D11)', () => {
    const help = contextHelpModel(node, { readOnly: true })
    expect(help.cmds.map(c => c.name)).toEqual(['list', 'get', 'search'])
  })
})

describe('contextScopeForCmd', () => {
  it('read/write 映射;未知或大写 cmd → null', () => {
    expect(contextScopeForCmd('list')).toBe('read')
    expect(contextScopeForCmd('get')).toBe('read')
    expect(contextScopeForCmd('search')).toBe('read')
    expect(contextScopeForCmd('write')).toBe('write')
    expect(contextScopeForCmd('update')).toBe('write')
    expect(contextScopeForCmd('delete')).toBe('write')
    expect(contextScopeForCmd('List')).toBeNull()
    expect(contextScopeForCmd('Watch')).toBeNull()
  })
})

describe('CONTEXT_CAPABILITIES', () => {
  it('声明 search 与 delete(可选能力)', () => {
    expect([...CONTEXT_CAPABILITIES].sort()).toEqual(['delete', 'search'])
  })
})
