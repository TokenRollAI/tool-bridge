import { beforeEach, describe, expect, it } from 'vitest'
import { createRegistryModule } from '../../src/builtin/registry'
import type { BuiltinModule } from '../../src/builtin/types'
import { isTBError } from '../../src/errors'
import { MemoryStateStore } from '../../src/store'
import { NodeRegistryStore } from '../../src/tree/registry'
import type { CallContext } from '../../src/types'

const NOW = '2026-07-06T00:00:00.000Z'
const ctx: CallContext = {
  keyId: 'key-123',
  owner: 'agent:x',
  scopes: [{ pattern: '**', actions: ['register', 'read'] }],
  traceId: 't',
}

describe('builtin registry 模块', () => {
  let store: MemoryStateStore
  let registry: NodeRegistryStore
  let mod: BuiltinModule

  beforeEach(() => {
    store = new MemoryStateStore()
    registry = new NodeRegistryStore(store)
    mod = createRegistryModule(registry, () => NOW)
  })

  it('help():list/get scope=read,write/update/delete scope=register(Proto §3.3)', () => {
    const help = mod.help('system/registry')
    const scopeOf = (name: string) => help.cmds.find((c) => c.name === name)?.scope
    expect(scopeOf('list')).toBe('read')
    expect(scopeOf('get')).toBe('read')
    expect(scopeOf('write')).toBe('register')
    expect(scopeOf('update')).toBe('register')
    expect(scopeOf('delete')).toBe('register')
  })

  it('write 用调用者 keyId 作 registeredBy;get 取回;delete 回收', async () => {
    const node = (await mod.dispatch(
      'write',
      { path: 'docs/ctx7', kind: 'directory', description: 'ctx7' },
      ctx,
    )) as { registeredBy: string; path: string }
    expect(node.registeredBy).toBe('key-123')
    expect(node.path).toBe('docs/ctx7')

    const got = (await mod.dispatch('get', { path: 'docs/ctx7' }, ctx)) as { path: string }
    expect(got.path).toBe('docs/ctx7')

    await mod.dispatch('delete', { path: 'docs/ctx7' }, ctx)
    await expect(mod.dispatch('get', { path: 'docs/ctx7' }, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'not_found',
    )
  })

  it('未知 cmd → invalid_argument', async () => {
    await expect(mod.dispatch('resolve', { path: 'x' }, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'invalid_argument',
    )
  })
})
