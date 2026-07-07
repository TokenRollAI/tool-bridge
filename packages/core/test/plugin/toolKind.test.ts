import { describe, expect, it } from 'vitest'
import { createRegistryModule, parseNodeInput } from '../../src/builtin/registry'
import { decodeDeviceFrame } from '../../src/device/frames'
import { TBError } from '../../src/errors'
import { MemoryStateStore } from '../../src/store'
import { NodeRegistryStore } from '../../src/tree/registry'
import { filterVisible } from '../../src/tree/visibility'
import { NODE_KINDS, type NodeConfig, type Scope, type TreeNode } from '../../src/types'

const NOW = '2026-07-07T00:00:00Z'

const TOOL_CONFIG: NodeConfig = { kind: 'tool', provider: 'orders' }

describe("Node.kind 词表增 'tool'(Q2)", () => {
  it("NODE_KINDS 含 'tool'", () => {
    expect(NODE_KINDS).toContain('tool')
  })

  it("parseNodeInput 接受 kind:'tool'", () => {
    const input = parseNodeInput({
      path: 'tools/orders',
      kind: 'tool',
      description: '订单工具',
      config: TOOL_CONFIG,
    })
    expect(input.kind).toBe('tool')
    expect(input.config).toEqual(TOOL_CONFIG)
  })

  it('parseNodeInput 对未知 kind 仍拒(词表未意外放宽)', () => {
    expect(() => parseNodeInput({ path: 'x', kind: 'widget', description: 'x' })).toThrowError(
      TBError,
    )
  })
})

describe("registry 对 kind:'tool' 的写入/读取", () => {
  function makeStore() {
    return new NodeRegistryStore(new MemoryStateStore())
  }

  it('write → get 保留 kind 与 provider config', async () => {
    const store = makeStore()
    await store.write(
      { path: 'tools/orders', kind: 'tool', description: '订单工具', config: TOOL_CONFIG },
      'sk_admin',
      NOW,
    )
    const node = await store.get('tools/orders')
    expect(node.kind).toBe('tool')
    expect(node.config).toEqual(TOOL_CONFIG)
  })

  it("kind:'tool' 配错误 config.kind → invalid_argument(§3.2 一致性照旧生效)", async () => {
    const store = makeStore()
    await expect(
      store.write(
        {
          path: 'tools/orders',
          kind: 'tool',
          description: 'x',
          config: { kind: 'context', provider: 'p' },
        },
        'sk_admin',
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'invalid_argument' })
  })

  it('builtin registry 模块 write/get 数据面对新 kind 可用', async () => {
    const store = makeStore()
    const mod = createRegistryModule(store, () => NOW)
    const ctx = { keyId: 'sk_admin', owner: 'user:a', scopes: [], traceId: 't' }
    const written = (await mod.dispatch(
      'write',
      { path: 'tools/orders', kind: 'tool', description: '订单工具', config: TOOL_CONFIG },
      ctx,
    )) as TreeNode
    expect(written.kind).toBe('tool')
    const fetched = (await mod.dispatch('get', { path: 'tools/orders' }, ctx)) as TreeNode
    expect(fetched.config).toEqual(TOOL_CONFIG)
  })
})

describe("visibility 对 kind:'tool' 的行为", () => {
  const toolNode: TreeNode = {
    path: 'tools/orders',
    kind: 'tool',
    description: '订单工具',
    config: TOOL_CONFIG,
    registeredBy: 'sk_admin',
    createdAt: NOW,
    updatedAt: NOW,
  }

  // 简化 checker:pattern 'tools/**' 且 action read 放行。
  const check = (scopes: Scope[], path: string) =>
    scopes.some((s) => s.pattern === 'tools/**' && path.startsWith('tools/'))

  it('有 read scope 时可见', () => {
    const scopes: Scope[] = [{ pattern: 'tools/**', actions: ['read'] }]
    expect(filterVisible([toolNode], scopes, check)).toEqual([toolNode])
  })

  it('无 scope 时被裁剪(kind 不影响可见性判定)', () => {
    expect(filterVisible([toolNode], [], check)).toEqual([])
  })
})

describe("expose.nodes 帧层接受 kind:'tool'(SDK 自定义节点经 hello 挂载)", () => {
  it("hello 帧 nodes 含 kind:'tool' 节点可解码,config 经 passthrough 保留", () => {
    const frame = decodeDeviceFrame(
      JSON.stringify({
        type: 'hello',
        deviceId: 'd1',
        expose: {
          nodes: [{ path: 'orders', kind: 'tool', description: '订单工具', config: TOOL_CONFIG }],
        },
      }),
    )
    expect(frame).toMatchObject({
      type: 'hello',
      expose: { nodes: [{ kind: 'tool', config: TOOL_CONFIG }] },
    })
  })
})
