import { beforeEach, describe, expect, it } from 'vitest'
import { AnnotationStore } from '../../src/annotation/store'
import { createAnnotationModule } from '../../src/builtin/annotation'
import type { BuiltinModule } from '../../src/builtin/types'
import { isTBError } from '../../src/errors'
import { MemoryStateStore } from '../../src/store'
import { NodeRegistryStore } from '../../src/tree/registry'
import type { CallContext } from '../../src/types'

const NOW = '2026-07-08T00:00:00.000Z'
const ctx: CallContext = { keyId: 'k-admin', owner: 'user:admin', scopes: [], traceId: 't' }

describe('builtin annotation 模块', () => {
  let mod: BuiltinModule
  let registry: NodeRegistryStore

  beforeEach(async () => {
    const state = new MemoryStateStore()
    registry = new NodeRegistryStore(state)
    await registry.write(
      { path: 'feishu', kind: 'mcp', description: '', config: { kind: 'mcp', url: 'https://x' } },
      'k-admin',
      NOW,
    )
    mod = createAnnotationModule({
      store: new AnnotationStore(state),
      registry,
      now: () => NOW,
    })
  })

  it('help():set/remove 为 admin,get/list 为 read', () => {
    const help = mod.help('system/annotation')
    const scopes = Object.fromEntries(help.cmds.map((c) => [c.name, c.scope]))
    expect(scopes).toEqual({ set: 'admin', get: 'read', remove: 'admin', list: 'read' })
  })

  it('set → get 回读(updatedBy = ctx.keyId)', async () => {
    await mod.dispatch('set', { path: 'feishu', text: '注意 TAT 过期' }, ctx)
    const got = await mod.dispatch('get', { path: 'feishu' }, ctx)
    expect(got).toEqual({
      path: 'feishu',
      text: '注意 TAT 过期',
      updatedAt: NOW,
      updatedBy: 'k-admin',
    })
  })

  it('set 工具子路径(最长前缀命中 mcp 节点)通过;悬空路径 → not_found', async () => {
    await mod.dispatch('set', { path: 'feishu/create-doc', text: 'mode 必填' }, ctx)
    await expect(mod.dispatch('set', { path: 'nope/x', text: 'x' }, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'not_found',
    )
  })

  it('set 根路径(空串)免 resolve = 全树公告', async () => {
    await mod.dispatch('set', { path: '', text: '维护窗口 22:00' }, ctx)
    const got = (await mod.dispatch('get', { path: '' }, ctx)) as { text: string }
    expect(got.text).toBe('维护窗口 22:00')
  })

  it('get/remove 不存在 → not_found;remove 后 get 不到', async () => {
    await expect(mod.dispatch('get', { path: 'feishu' }, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'not_found',
    )
    await mod.dispatch('set', { path: 'feishu', text: 'x' }, ctx)
    expect(await mod.dispatch('remove', { path: 'feishu' }, ctx)).toEqual({ ok: true })
    await expect(mod.dispatch('remove', { path: 'feishu' }, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'not_found',
    )
  })

  it('list 按 prefix 过滤', async () => {
    await mod.dispatch('set', { path: 'feishu', text: 'a' }, ctx)
    await mod.dispatch('set', { path: 'feishu/create-doc', text: 'b' }, ctx)
    await mod.dispatch('set', { path: '', text: 'root' }, ctx)
    const all = (await mod.dispatch('list', {}, ctx)) as { items: { path: string }[] }
    expect(all.items.map((i) => i.path)).toEqual(['', 'feishu', 'feishu/create-doc'])
    const under = (await mod.dispatch('list', { prefix: 'feishu' }, ctx)) as {
      items: { path: string }[]
    }
    expect(under.items.map((i) => i.path)).toEqual(['feishu', 'feishu/create-doc'])
  })

  it('缺参/未知 cmd → invalid_argument', async () => {
    await expect(mod.dispatch('set', { path: 'feishu' }, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'invalid_argument',
    )
    await expect(mod.dispatch('nope', {}, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'invalid_argument',
    )
  })
})
