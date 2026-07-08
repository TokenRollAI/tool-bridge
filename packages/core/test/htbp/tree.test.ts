import { describe, expect, it } from 'vitest'
import {
  buildTree,
  clampDepth,
  DEFAULT_TREE_DEPTH,
  MAX_TREE_DEPTH,
  type TreeEntry,
} from '../../src/htbp/tree'

/** 用静态邻接表造一个 getChildren。 */
function childrenFrom(map: Record<string, TreeEntry[]>) {
  return async (path: string): Promise<TreeEntry[]> => map[path] ?? []
}

describe('clampDepth(默认 2,上限 8,非法→默认)', () => {
  it('undefined → 默认 2', () => {
    expect(clampDepth(undefined)).toBe(DEFAULT_TREE_DEPTH)
    expect(DEFAULT_TREE_DEPTH).toBe(2)
  })
  it('0 与负数 → 默认 2', () => {
    expect(clampDepth(0)).toBe(2)
    expect(clampDepth(-3)).toBe(2)
  })
  it('9(超上限)→ 钳到 8', () => {
    expect(clampDepth(9)).toBe(MAX_TREE_DEPTH)
    expect(MAX_TREE_DEPTH).toBe(8)
  })
  it('合法值原样返回', () => {
    expect(clampDepth(1)).toBe(1)
    expect(clampDepth(5)).toBe(5)
    expect(clampDepth(8)).toBe(8)
  })
  it('非整数 → 默认 2', () => {
    expect(clampDepth(3.5)).toBe(2)
    expect(clampDepth(Number.NaN)).toBe(2)
  })
})

describe('buildTree 基本形状', () => {
  const map: Record<string, TreeEntry[]> = {
    '': [
      { path: 'a', kind: 'directory', description: 'A' },
      { path: 'b', kind: 'mcp', description: 'B' },
    ],
    a: [{ path: 'a/x', kind: 'mcp', description: 'AX' }],
    b: [],
    'a/x': [],
  }

  it('从根递归构建,根渲染为 directory + 空描述', async () => {
    const tree = await buildTree({ root: '', depth: 3, getChildren: childrenFrom(map) })
    expect(tree.path).toBe('')
    expect(tree.kind).toBe('directory')
    expect(tree.description).toBe('')
    expect(tree.children?.map((c) => c.path)).toEqual(['a', 'b'])
    const a = tree.children?.find((c) => c.path === 'a')
    expect(a?.children?.map((c) => c.path)).toEqual(['a/x'])
  })

  it('叶子(无子节点)不设 truncated、不带 children', async () => {
    const tree = await buildTree({ root: '', depth: 3, getChildren: childrenFrom(map) })
    const b = tree.children?.find((c) => c.path === 'b')
    expect(b?.truncated).toBeUndefined()
    expect(b?.children).toBeUndefined()
  })

  it('携带 online 字段', async () => {
    const withOnline: Record<string, TreeEntry[]> = {
      '': [{ path: 'd', kind: 'device', description: 'D', online: false }],
      d: [],
    }
    const tree = await buildTree({ root: '', depth: 2, getChildren: childrenFrom(withOnline) })
    expect(tree.children?.[0]?.online).toBe(false)
  })

  it('rootEntry 提供时用真实节点元数据(不伪造为 directory)', async () => {
    const sub: Record<string, TreeEntry[]> = {
      'system/sk': [],
    }
    const tree = await buildTree({
      root: 'system/sk',
      depth: 2,
      getChildren: childrenFrom(sub),
      rootEntry: { path: 'system/sk', kind: 'builtin', description: 'SK registry' },
    })
    expect(tree.kind).toBe('builtin')
    expect(tree.description).toBe('SK registry')
  })
})

describe('buildTree 截断:深度 / 节点上限 / 环', () => {
  const deep: Record<string, TreeEntry[]> = {
    '': [{ path: 'a', kind: 'directory', description: 'A' }],
    a: [{ path: 'a/b', kind: 'directory', description: 'B' }],
    'a/b': [{ path: 'a/b/c', kind: 'mcp', description: 'C' }],
    'a/b/c': [],
  }

  it('深度到底:确有子节点的边界节点标 truncated', async () => {
    const tree = await buildTree({ root: '', depth: 2, getChildren: childrenFrom(deep) })
    // 根(depthLeft2)→ a(1)→ a/b(0):a/b 仍有子节点 → truncated,不再展开
    const a = tree.children?.find((c) => c.path === 'a')
    const ab = a?.children?.find((c) => c.path === 'a/b')
    expect(ab?.truncated).toBe(true)
    expect(ab?.children).toBeUndefined()
  })

  it('深度足够时,边界叶子不误标 truncated', async () => {
    const tree = await buildTree({ root: '', depth: 3, getChildren: childrenFrom(deep) })
    const abc = tree.children?.[0]?.children?.[0]?.children?.find((c) => c.path === 'a/b/c')
    expect(abc?.truncated).toBeUndefined()
  })

  it('节点上限:达上限则父节点 truncated 并停止展开', async () => {
    const wide: Record<string, TreeEntry[]> = {
      '': [
        { path: 'a', kind: 'mcp', description: 'A' },
        { path: 'b', kind: 'mcp', description: 'B' },
        { path: 'c', kind: 'mcp', description: 'C' },
      ],
      a: [],
      b: [],
      c: [],
    }
    // maxNodes=2:根计 1,展开 a 后计 2,再遇 b 时达上限
    const tree = await buildTree({
      root: '',
      depth: 3,
      maxNodes: 2,
      getChildren: childrenFrom(wide),
    })
    expect(tree.truncated).toBe(true)
    expect(tree.children?.map((c) => c.path)).toEqual(['a'])
  })

  it('环检测:getChildren 构造 a→b→a,重复路径作 truncated 叶子且不递归', async () => {
    const cyclic: Record<string, TreeEntry[]> = {
      a: [{ path: 'b', kind: 'directory', description: 'B' }],
      b: [{ path: 'a', kind: 'directory', description: 'A(环)' }],
    }
    const tree = await buildTree({ root: 'a', depth: 5, getChildren: childrenFrom(cyclic) })
    // 注:根 path='a' 被 buildTree 渲染为 directory;其子 b 的子又指回 a
    const b = tree.children?.find((c) => c.path === 'b')
    const backToA = b?.children?.find((c) => c.path === 'a')
    expect(backToA?.truncated).toBe(true)
    expect(backToA?.children).toBeUndefined()
  })

  it('opaqueKinds:深度边界遇 remote 节点直接标 truncated,不调 getChildren 探测', async () => {
    const map: Record<string, TreeEntry[]> = {
      '': [{ path: 'r', kind: 'remote', description: 'R' }],
      // r 确有子,但边界探测不应调用 getChildren('r')
      r: [{ path: 'r/x', kind: 'http', description: 'RX' }],
    }
    const probed: string[] = []
    const getChildren = async (path: string): Promise<TreeEntry[]> => {
      probed.push(path)
      return map[path] ?? []
    }
    // depth=1:根展开一层,r 落在 depthLeft=0 边界
    const tree = await buildTree({
      root: '',
      depth: 1,
      getChildren,
      opaqueKinds: new Set(['remote']),
    })
    const r = tree.children?.find((c) => c.path === 'r')
    expect(r?.truncated).toBe(true)
    expect(r?.children).toBeUndefined()
    // 关键:边界上没有为探测 r 的子而调用 getChildren('r')(remote 免 fetch)
    expect(probed).not.toContain('r')
  })

  it('opaqueKinds:depthLeft>0 时 remote 节点仍正常展开(只影响边界探测)', async () => {
    const map: Record<string, TreeEntry[]> = {
      '': [{ path: 'r', kind: 'remote', description: 'R' }],
      r: [{ path: 'r/x', kind: 'http', description: 'RX' }],
    }
    // depth=2:r 落在 depthLeft=1,应正常展开其子 r/x
    const tree = await buildTree({
      root: '',
      depth: 2,
      getChildren: childrenFrom(map),
      opaqueKinds: new Set(['remote']),
    })
    const r = tree.children?.find((c) => c.path === 'r')
    expect(r?.children?.map((c) => c.path)).toEqual(['r/x'])
  })
})
