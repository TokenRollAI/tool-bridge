import { describe, expect, it } from 'vitest'
import type { ContextProvider } from '../../src/context/types'
import {
  contextCapabilitiesOf,
  contextMethodsOf,
  isReadOnlyProvider,
} from '../../src/context/capabilities'
import { contextHelpModel } from '../../src/context/help'

const node = { path: 'docs', description: 'docs ns' }

// 只读资源:只实现 get —— 旧契约下这是写不出来的(四动词强制全实现)。
const readOnlyOne: ContextProvider = {
  get: () => Promise.reject(new Error('unused')),
}

// 纯搜索服务:只实现 search。
const searchOnly: ContextProvider = {
  search: () => Promise.reject(new Error('unused')),
}

// append-only:有 write 但没有 update/delete。
const appendOnly: ContextProvider = {
  list: () => Promise.reject(new Error('unused')),
  get: () => Promise.reject(new Error('unused')),
  write: () => Promise.reject(new Error('unused')),
}

describe('按 handler 存在性推导能力', () => {
  it('contextMethodsOf 只报真实实现的动词', () => {
    expect([...contextMethodsOf(readOnlyOne)]).toEqual(['get'])
    expect([...contextMethodsOf(searchOnly)]).toEqual(['search'])
    expect([...contextMethodsOf(appendOnly)].sort()).toEqual(['get', 'list', 'write'])
  })

  it('无任何写动词 → 自动只读;有 write 即非只读', () => {
    expect(isReadOnlyProvider(readOnlyOne)).toBe(true)
    expect(isReadOnlyProvider(searchOnly)).toBe(true)
    expect(isReadOnlyProvider(appendOnly)).toBe(false)
  })

  it('capabilities 只报可选能力(search/delete),核心动词不进 capabilities', () => {
    expect(contextCapabilitiesOf(readOnlyOne)).toEqual([])
    expect(contextCapabilitiesOf(searchOnly)).toEqual(['search'])
    expect(contextCapabilitiesOf({ ...appendOnly, delete: () => Promise.resolve() })).toEqual([
      'delete',
    ])
  })
})

describe('~help 只展示真实存在的操作', () => {
  it('只读单动词 provider 的 cmd 表只有 get', () => {
    const model = contextHelpModel(node, {
      methods: contextMethodsOf(readOnlyOne),
      readOnly: isReadOnlyProvider(readOnlyOne),
    })
    expect(model.cmds.map(c => c.name)).toEqual(['get'])
  })

  it('纯搜索 provider 的 cmd 表只有 search', () => {
    const model = contextHelpModel(node, {
      methods: contextMethodsOf(searchOnly),
      readOnly: isReadOnlyProvider(searchOnly),
    })
    expect(model.cmds.map(c => c.name)).toEqual(['search'])
  })

  it('append-only:列 list/get/write,不列 update/delete', () => {
    const model = contextHelpModel(node, {
      methods: contextMethodsOf(appendOnly),
      readOnly: isReadOnlyProvider(appendOnly),
    })
    const names = model.cmds.map(c => c.name).sort()
    expect(names).toEqual(['get', 'list', 'write'])
  })

  it('methods 缺省 → 沿用全动词表(内置 r2/s3 与 plugin 分支的既有行为不变)', () => {
    const names = contextHelpModel(node, {}).cmds.map(c => c.name)
    expect(names).toContain('list')
    expect(names).toContain('write')
    expect(names).toContain('delete')
  })

  it('显式 readOnly 可在真实动词之上再收紧(写动词被隐藏)', () => {
    const model = contextHelpModel(node, {
      methods: contextMethodsOf(appendOnly),
      readOnly: true,
    })
    expect(model.cmds.map(c => c.name).sort()).toEqual(['get', 'list'])
  })
})
