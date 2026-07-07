import { beforeEach, describe, expect, it } from 'vitest'
import { SKRegistryStore } from '../../src/auth/sk'
import { createSkModule } from '../../src/builtin/sk'
import type { BuiltinModule } from '../../src/builtin/types'
import { isTBError } from '../../src/errors'
import { MemoryStateStore } from '../../src/store'
import type { CallContext } from '../../src/types'

const NOW = '2026-07-06T00:00:00.000Z'

const ctx: CallContext = {
  keyId: 'admin-key',
  owner: 'user:admin',
  scopes: [{ pattern: '**', actions: ['admin'] }],
  traceId: 't',
}

describe('builtin sk 模块', () => {
  let store: MemoryStateStore
  let mod: BuiltinModule

  beforeEach(() => {
    store = new MemoryStateStore()
    mod = createSkModule(new SKRegistryStore(store), () => NOW)
  })

  it('help() 列出全部 cmd 且 scope 均为 admin', () => {
    const help = mod.help('system/sk')
    expect(help.node).toEqual({
      path: 'system/sk',
      kind: 'builtin',
      description: expect.any(String),
    })
    expect(help.cmds.map((c) => c.name).sort()).toEqual([
      'delete',
      'get',
      'list',
      'update',
      'write',
    ])
    expect(help.cmds.every((c) => c.scope === 'admin')).toBe(true)
    expect(help.cmds.every((c) => c.method === 'POST' && c.path === '/system/sk')).toBe(true)
  })

  it('write → list:签发的 SK 出现在 list 且投影不含 hash;write 返回一次性 secret', async () => {
    const res = (await mod.dispatch(
      'write',
      { owner: 'agent:x', scopes: [{ pattern: 'docs/**', actions: ['read'] }] },
      ctx,
    )) as { key: Record<string, unknown>; secret: string }
    expect(res.secret.startsWith('tbk_')).toBe(true)
    expect(res.key).not.toHaveProperty('hash')

    const page = (await mod.dispatch('list', {}, ctx)) as { items: Array<Record<string, unknown>> }
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).not.toHaveProperty('hash')
    // 落盘的 SK 记录含 hash(sha256),但 hash 不是明文——dump 不含明文 secret。
    const dump = JSON.stringify((await store.list('')).items)
    expect(dump).not.toContain(res.secret)
  })

  it('get 取回投影(无 hash);delete 后 list 为空', async () => {
    const res = (await mod.dispatch('write', { owner: 'agent:x', scopes: [] }, ctx)) as {
      key: { id: string }
    }
    const got = (await mod.dispatch('get', { id: res.key.id }, ctx)) as Record<string, unknown>
    expect(got).not.toHaveProperty('hash')
    expect(got.id).toBe(res.key.id)

    await mod.dispatch('delete', { id: res.key.id }, ctx)
    const page = (await mod.dispatch('list', {}, ctx)) as { items: unknown[] }
    expect(page.items).toHaveLength(0)
  })

  it('未知 cmd → invalid_argument', async () => {
    await expect(mod.dispatch('frobnicate', {}, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'invalid_argument',
    )
  })

  it('write 缺 owner / scopes 非数组 → invalid_argument', async () => {
    await expect(mod.dispatch('write', { scopes: [] }, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'invalid_argument',
    )
    await expect(mod.dispatch('write', { owner: 'user:x', scopes: 'nope' }, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'invalid_argument',
    )
  })
})
