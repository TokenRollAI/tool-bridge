import { beforeEach, describe, expect, it } from 'vitest'
import type { BuiltinModule } from '../../src/builtin/types'
import type { CallContext } from '../../src/types'
import { createFederationModule, type FederationHost } from '../../src/builtin/federation'
import { RemoteAllowlistStore } from '../../src/tool/allowlist'
import { MemoryStateStore } from '../../src/store'
import { isTBError } from '../../src/errors'

const NOW = '2026-07-08T00:00:00.000Z'
const ctx: CallContext = { keyId: 'k', owner: 'user:admin', scopes: [], traceId: 't' }

function makeMod(base: string[]): { mod: BuiltinModule, store: RemoteAllowlistStore } {
  const store = new RemoteAllowlistStore(new MemoryStateStore())
  const mod = createFederationModule({ store, base, now: () => NOW })
  return { mod, store }
}

describe('builtin federation 模块', () => {
  let mod: BuiltinModule

  beforeEach(() => {
    mod = makeMod(['env-base.com']).mod
  })

  it('help() 含 list/add/remove 且 scope=admin', () => {
    const help = mod.help('system/federation')
    expect(help.cmds.map(c => c.name).sort()).toEqual(['add', 'list', 'remove'])
    expect(help.cmds.every(c => c.scope === 'admin')).toBe(true)
  })

  it('list 合并 env 基线(不可删)与运行时条目(可删)', async () => {
    await mod.dispatch('add', { host: 'runtime.com' }, ctx)
    const page = (await mod.dispatch('list', {}, ctx)) as { items: FederationHost[] }
    expect(page.items).toEqual([
      { host: 'env-base.com', source: 'env', removable: false },
      { host: 'runtime.com', source: 'store', removable: true, updatedAt: NOW },
    ])
  })

  it('add 规范化 host 并返回条目', async () => {
    const entry = await mod.dispatch('add', { host: '  API.Example.COM ' }, ctx)
    expect(entry).toEqual({ host: 'api.example.com', updatedAt: NOW })
  })

  it('add 已在 env 基线中 → invalid_argument', async () => {
    await expect(mod.dispatch('add', { host: 'env-base.com' }, ctx)).rejects.toSatisfy(
      e => isTBError(e) && e.code === 'invalid_argument',
    )
  })

  it('remove env 基线条目 → invalid_argument(不可删)', async () => {
    await expect(mod.dispatch('remove', { host: 'env-base.com' }, ctx)).rejects.toSatisfy(
      e => isTBError(e) && e.code === 'invalid_argument',
    )
  })

  it('remove 运行时条目成功;删不存在 → not_found', async () => {
    await mod.dispatch('add', { host: 'runtime.com' }, ctx)
    await mod.dispatch('remove', { host: 'runtime.com' }, ctx)
    const page = (await mod.dispatch('list', {}, ctx)) as { items: FederationHost[] }
    expect(page.items.map(i => i.host)).toEqual(['env-base.com'])
    await expect(mod.dispatch('remove', { host: 'runtime.com' }, ctx)).rejects.toSatisfy(
      e => isTBError(e) && e.code === 'not_found',
    )
  })

  it('未知 cmd → invalid_argument', async () => {
    await expect(mod.dispatch('nope', {}, ctx)).rejects.toSatisfy(
      e => isTBError(e) && e.code === 'invalid_argument',
    )
  })
})
