import { beforeEach, describe, expect, it } from 'vitest'
import { createFeedbackModule } from '../../src/builtin/feedback'
import type { BuiltinModule } from '../../src/builtin/types'
import { isTBError } from '../../src/errors'
import { FeedbackStore } from '../../src/feedback/store'
import { MemoryStateStore } from '../../src/store'
import { NodeRegistryStore } from '../../src/tree/registry'
import type { CallContext } from '../../src/types'

const NOW = '2026-07-08T00:00:00.000Z'
const agentA: CallContext = { keyId: 'k-a', owner: 'agent:a', scopes: [], traceId: 't' }
const agentB: CallContext = { keyId: 'k-b', owner: 'agent:b', scopes: [], traceId: 't' }

interface View {
  id: string
  title: string
  score: number
  up: number
  down: number
}

describe('builtin feedback 模块', () => {
  let mod: BuiltinModule

  beforeEach(async () => {
    const state = new MemoryStateStore()
    const registry = new NodeRegistryStore(state)
    await registry.write(
      { path: 'feishu', kind: 'mcp', description: '', config: { kind: 'mcp', url: 'https://x' } },
      'k-admin',
      NOW,
    )
    mod = createFeedbackModule({ store: new FeedbackStore(state), registry, now: () => NOW })
  })

  it('help():submit/vote 为 call,list/get 为 read,remove 为 admin', () => {
    const help = mod.help('system/feedback')
    const scopes = Object.fromEntries(help.cmds.map((c) => [c.name, c.scope]))
    expect(scopes).toEqual({
      submit: 'call',
      get: 'read',
      list: 'read',
      vote: 'call',
      remove: 'admin',
    })
  })

  it('submit 记 ctx.owner;get 下钻含 detail', async () => {
    const created = (await mod.dispatch(
      'submit',
      { path: 'feishu/create-doc', title: 'mode 必填', detail: '不传报 invalid_argument' },
      agentA,
    )) as { id: string; path: string }
    expect(created.path).toBe('feishu/create-doc')
    const got = (await mod.dispatch(
      'get',
      { path: 'feishu/create-doc', id: created.id },
      agentB,
    )) as {
      by: string
      detail: string
      score: number
    }
    expect(got.by).toBe('agent:a')
    expect(got.detail).toBe('不传报 invalid_argument')
    expect(got.score).toBe(0)
  })

  it('submit 悬空路径 → not_found', async () => {
    await expect(
      mod.dispatch('submit', { path: 'nope/x', title: 't', detail: 'd' }, agentA),
    ).rejects.toSatisfy((e) => isTBError(e) && e.code === 'not_found')
  })

  it('vote 以 ctx.owner 去重;value 非法 → invalid_argument', async () => {
    const { id } = (await mod.dispatch(
      'submit',
      { path: 'feishu', title: 't', detail: 'd' },
      agentA,
    )) as { id: string }
    let v = (await mod.dispatch('vote', { path: 'feishu', id, value: 'up' }, agentB)) as View
    expect([v.up, v.score]).toEqual([1, 1])
    v = (await mod.dispatch('vote', { path: 'feishu', id, value: 'up' }, agentB)) as View
    expect([v.up, v.score]).toEqual([1, 1])
    await expect(
      mod.dispatch('vote', { path: 'feishu', id, value: 'sideways' }, agentB),
    ).rejects.toSatisfy((e) => isTBError(e) && e.code === 'invalid_argument')
  })

  it('list 默认隐藏净分 ≤ -3 条目;includeHidden 全量;不含 detail', async () => {
    const bad = (await mod.dispatch(
      'submit',
      { path: 'feishu', title: 'bad', detail: 'd' },
      agentA,
    )) as { id: string }
    await mod.dispatch('submit', { path: 'feishu', title: 'good', detail: 'd' }, agentB)
    for (const voter of ['agent:1', 'agent:2', 'agent:3']) {
      await mod.dispatch(
        'vote',
        { path: 'feishu', id: bad.id, value: 'down' },
        { ...agentA, owner: voter },
      )
    }
    const dft = (await mod.dispatch('list', { path: 'feishu' }, agentA)) as { items: View[] }
    expect(dft.items.map((i) => i.title)).toEqual(['good'])
    expect(dft.items[0]).not.toHaveProperty('detail')
    const full = (await mod.dispatch('list', { path: 'feishu', includeHidden: true }, agentA)) as {
      items: View[]
    }
    expect(full.items.map((i) => i.title)).toEqual(['good', 'bad'])
  })

  it('remove 删条目;不存在 → not_found;未知 cmd → invalid_argument', async () => {
    const { id } = (await mod.dispatch(
      'submit',
      { path: 'feishu', title: 't', detail: 'd' },
      agentA,
    )) as { id: string }
    expect(await mod.dispatch('remove', { path: 'feishu', id }, agentA)).toEqual({ ok: true })
    await expect(mod.dispatch('remove', { path: 'feishu', id }, agentA)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'not_found',
    )
    await expect(mod.dispatch('nope', {}, agentA)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'invalid_argument',
    )
  })
})
