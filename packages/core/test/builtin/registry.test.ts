import { beforeEach, describe, expect, it } from 'vitest'
import { checkScopes } from '../../src/auth/scope'
import { createRegistryModule } from '../../src/builtin/registry'
import type { BuiltinModule } from '../../src/builtin/types'
import { isTBError } from '../../src/errors'
import { MemoryStateStore } from '../../src/store'
import { NodeRegistryStore } from '../../src/tree/registry'
import type { CallContext, Page, TreeNode } from '../../src/types'

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

  it('help():list/get scope=read,write/update/delete scope=register', () => {
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

  it('write:kind 非枚举 → invalid_argument;description 缺失 → invalid_argument', async () => {
    await expect(
      mod.dispatch('write', { path: 'a', kind: 'bogus', description: 'd' }, ctx),
    ).rejects.toSatisfy((e) => isTBError(e) && e.code === 'invalid_argument')
    await expect(mod.dispatch('write', { path: 'a', kind: 'directory' }, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'invalid_argument',
    )
  })
})

describe('builtin registry 可见性裁剪(注入 visibility)', () => {
  let store: MemoryStateStore
  let registry: NodeRegistryStore
  let mod: BuiltinModule

  // 宽 allow(**read)+ 窄 deny(secret/** read):denied 子树对本 SK 不可见。
  const scopedCtx: CallContext = {
    keyId: 'k',
    owner: 'agent:x',
    scopes: [
      { pattern: '**', actions: ['read', 'register'] },
      { pattern: 'secret/**', actions: ['read'], effect: 'deny' },
    ],
    traceId: 't',
  }

  beforeEach(async () => {
    store = new MemoryStateStore()
    registry = new NodeRegistryStore(store)
    mod = createRegistryModule(registry, () => NOW, checkScopes)
    await registry.write({ path: 'docs/a', kind: 'directory', description: 'a' }, 'k', NOW)
    await registry.write({ path: 'secret/x', kind: 'directory', description: 'x' }, 'k', NOW)
  })

  it('list:裁掉对 (path,read) 判 deny 的节点(secret/* 不出现)', async () => {
    const page = (await mod.dispatch('list', {}, scopedCtx)) as Page<TreeNode>
    const paths = page.items.map((n) => n.path)
    expect(paths).toContain('docs/a')
    expect(paths.some((p) => p === 'secret' || p.startsWith('secret/'))).toBe(false)
  })

  it('get:denied 路径 → not_found(deny==not_found,不泄露存在性)', async () => {
    await expect(mod.dispatch('get', { path: 'secret/x' }, scopedCtx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'not_found',
    )
    // 可见路径正常返回
    const got = (await mod.dispatch('get', { path: 'docs/a' }, scopedCtx)) as { path: string }
    expect(got.path).toBe('docs/a')
  })
})
