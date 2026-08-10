import { describe, expect, it } from 'vitest'
import type { ContextProvider } from '../../src/context/types'
import {
  contextCapabilitiesOf,
  contextMethodsOf,
  isReadOnlyProvider,
} from '../../src/context/capabilities'
import { contextHelpModel } from '../../src/context/help'

const node = { path: 'docs', description: 'docs ns' }

// 只读资源:只实现 Get —— 旧契约下这是写不出来的(四动词强制全实现)。
const readOnlyOne: ContextProvider = {
  Get: () => Promise.reject(new Error('unused')),
}

// 纯搜索服务:只实现 Search。
const searchOnly: ContextProvider = {
  Search: () => Promise.reject(new Error('unused')),
}

// append-only:有 Write 但没有 Update/Delete。
const appendOnly: ContextProvider = {
  List: () => Promise.reject(new Error('unused')),
  Get: () => Promise.reject(new Error('unused')),
  Write: () => Promise.reject(new Error('unused')),
}

describe('按 handler 存在性推导能力', () => {
  it('contextMethodsOf 只报真实实现的动词', () => {
    expect([...contextMethodsOf(readOnlyOne)]).toEqual(['Get'])
    expect([...contextMethodsOf(searchOnly)]).toEqual(['Search'])
    expect([...contextMethodsOf(appendOnly)].sort()).toEqual(['Get', 'List', 'Write'])
  })

  it('无任何写动词 → 自动只读;有 Write 即非只读', () => {
    expect(isReadOnlyProvider(readOnlyOne)).toBe(true)
    expect(isReadOnlyProvider(searchOnly)).toBe(true)
    expect(isReadOnlyProvider(appendOnly)).toBe(false)
  })

  it('capabilities 只报可选能力(search/delete),核心动词不进 capabilities', () => {
    expect(contextCapabilitiesOf(readOnlyOne)).toEqual([])
    expect(contextCapabilitiesOf(searchOnly)).toEqual(['search'])
    expect(contextCapabilitiesOf({ ...appendOnly, Delete: () => Promise.resolve() })).toEqual([
      'delete',
    ])
  })
})

describe('~help 只展示真实存在的操作', () => {
  it('只读单动词 provider 的 cmd 表只有 Get', () => {
    const model = contextHelpModel(node, {
      methods: contextMethodsOf(readOnlyOne),
      readOnly: isReadOnlyProvider(readOnlyOne),
    })
    expect(model.cmds.map(c => c.name)).toEqual(['Get'])
  })

  it('纯搜索 provider 的 cmd 表只有 Search', () => {
    const model = contextHelpModel(node, {
      methods: contextMethodsOf(searchOnly),
      readOnly: isReadOnlyProvider(searchOnly),
    })
    expect(model.cmds.map(c => c.name)).toEqual(['Search'])
  })

  it('append-only:列 List/Get/Write,不列 Update/Delete', () => {
    const model = contextHelpModel(node, {
      methods: contextMethodsOf(appendOnly),
      readOnly: isReadOnlyProvider(appendOnly),
    })
    const names = model.cmds.map(c => c.name).sort()
    expect(names).toEqual(['Get', 'List', 'Write'])
  })

  it('methods 缺省 → 沿用全动词表(内置 r2/s3 与 plugin 分支的既有行为不变)', () => {
    const names = contextHelpModel(node, {}).cmds.map(c => c.name)
    expect(names).toContain('List')
    expect(names).toContain('Write')
    expect(names).toContain('Delete')
  })

  it('显式 readOnly 可在真实动词之上再收紧(写动词被隐藏)', () => {
    const model = contextHelpModel(node, {
      methods: contextMethodsOf(appendOnly),
      readOnly: true,
    })
    expect(model.cmds.map(c => c.name).sort()).toEqual(['Get', 'List'])
  })
})
