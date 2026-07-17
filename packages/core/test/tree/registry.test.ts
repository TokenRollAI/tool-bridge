import { beforeEach, describe, expect, it } from 'vitest'
import { type NodeInput, SYSTEM_AUTO } from '../../src/types'
import { NodeRegistryStore } from '../../src/tree/registry'
import { isTBError, type TBError } from '../../src/index'
import { MemoryStateStore } from '../../src/store'

const T1 = '2026-01-01T00:00:00.000Z'
const T2 = '2026-02-02T00:00:00.000Z'

function mcp(path: string): NodeInput {
  return {
    path,
    kind: 'mcp',
    description: `mcp ${path}`,
    config: { kind: 'mcp', url: 'https://x' },
  }
}

/** 捕获异步方法抛出的 TBError。 */
async function grabError(fn: () => Promise<unknown>): Promise<TBError> {
  try {
    await fn()
  } catch (e) {
    if (isTBError(e)) return e
    throw e
  }
  throw new Error('expected TBError, but no error thrown')
}

let reg: NodeRegistryStore

beforeEach(() => {
  reg = new NodeRegistryStore(new MemoryStateStore())
})

describe('自动物化中间 directory', () => {
  it('write a/b/c 后 a、a/b、a/b/c 三级都可 get', async () => {
    await reg.write(mcp('a/b/c'), 'user:1', T1)
    const a = await reg.get('a')
    const ab = await reg.get('a/b')
    const abc = await reg.get('a/b/c')

    expect(a.kind).toBe('directory')
    expect(a.registeredBy).toBe(SYSTEM_AUTO)
    expect(a.description).toBe('')
    expect(ab.kind).toBe('directory')
    expect(ab.registeredBy).toBe(SYSTEM_AUTO)
    expect(abc.kind).toBe('mcp')
    expect(abc.registeredBy).toBe('user:1')
  })

  it('已存在的祖先不被物化覆盖(显式 directory 保留 registeredBy)', async () => {
    await reg.write({ path: 'x', kind: 'directory', description: '显式' }, 'user:1', T1)
    await reg.write(mcp('x/y/z'), 'user:2', T2)
    const x = await reg.get('x')
    expect(x.registeredBy).toBe('user:1')
    expect(x.description).toBe('显式')
    expect((await reg.get('x/y')).registeredBy).toBe(SYSTEM_AUTO)
  })
})

describe('write 幂等 upsert', () => {
  it('同输入两次:createdAt 不变、updatedAt 刷新', async () => {
    const first = await reg.write(mcp('a/b/c'), 'user:1', T1)
    const second = await reg.write(mcp('a/b/c'), 'user:1', T2)
    expect(first.createdAt).toBe(T1)
    expect(second.createdAt).toBe(T1)
    expect(second.updatedAt).toBe(T2)
  })
})

describe('write 校验', () => {
  it('保留段作段 → invalid_argument', async () => {
    const e = await grabError(() => reg.write(mcp('a/~help/c'), 'user:1', T1))
    expect(e.code).toBe('invalid_argument')
  })

  it('kind 与 config.kind 不一致 → invalid_argument', async () => {
    const bad = {
      path: 'a',
      kind: 'mcp',
      description: 'x',
      config: { kind: 'http', endpoint: 'e', tools: [] },
    } as NodeInput
    const e = await grabError(() => reg.write(bad, 'user:1', T1))
    expect(e.code).toBe('invalid_argument')
  })

  it('保留根(system/*)在 registry 层不拒(那是注册路径规则的事)', async () => {
    const n = await reg.write(
      {
        path: 'system/foo',
        kind: 'builtin',
        description: 'b',
        config: { kind: 'builtin', module: 'status' },
      },
      'user:1',
      T1,
    )
    expect(n.path).toBe('system/foo')
  })
})

describe('delete 级联回收', () => {
  it('卸载 a/b/c 后空中间节点 a、a/b 回收', async () => {
    await reg.write(mcp('a/b/c'), 'user:1', T1)
    await reg.delete('a/b/c')
    expect(await grabError(() => reg.get('a/b/c'))).toMatchObject({ code: 'not_found' })
    expect(await grabError(() => reg.get('a/b'))).toMatchObject({ code: 'not_found' })
    expect(await grabError(() => reg.get('a'))).toMatchObject({ code: 'not_found' })
  })

  it('显式 directory 不回收', async () => {
    await reg.write({ path: 'x', kind: 'directory', description: '显式' }, 'user:1', T1)
    await reg.write(mcp('x/y/z'), 'user:2', T1)
    await reg.delete('x/y/z')
    // y 是 system:auto 且空 → 回收;x 是显式 → 保留
    expect(await grabError(() => reg.get('x/y'))).toMatchObject({ code: 'not_found' })
    expect((await reg.get('x')).description).toBe('显式')
  })

  it('中间级仍有其它子节点则不回收', async () => {
    await reg.write(mcp('a/b/c'), 'user:1', T1)
    await reg.write(mcp('a/b/d'), 'user:1', T1)
    await reg.delete('a/b/c')
    expect((await reg.get('a/b')).kind).toBe('directory')
    expect((await reg.get('a')).kind).toBe('directory')
    expect((await reg.get('a/b/d')).kind).toBe('mcp')
  })

  it('删除不存在 → not_found', async () => {
    expect(await grabError(() => reg.delete('nope'))).toMatchObject({ code: 'not_found' })
  })

  it('删除非空子树 → conflict(实现决策)', async () => {
    await reg.write(mcp('a/b/c'), 'user:1', T1)
    // a/b 是有后代的 directory
    expect(await grabError(() => reg.delete('a/b'))).toMatchObject({ code: 'conflict' })
  })
})

describe('update', () => {
  it('不存在 → not_found', async () => {
    expect(await grabError(() => reg.update('nope', { description: 'x' }, T2))).toMatchObject({
      code: 'not_found',
    })
  })

  it('patch 部分更新:description 改、createdAt 保留、updatedAt 刷新', async () => {
    await reg.write(mcp('a/b/c'), 'user:1', T1)
    const u = await reg.update('a/b/c', { description: '新描述' }, T2)
    expect(u.description).toBe('新描述')
    expect(u.createdAt).toBe(T1)
    expect(u.updatedAt).toBe(T2)
    expect(u.kind).toBe('mcp')
  })

  it('patch 携带不同 path → invalid_argument(path 不可改)', async () => {
    await reg.write(mcp('a/b/c'), 'user:1', T1)
    expect(await grabError(() => reg.update('a/b/c', { path: 'a/b/d' }, T2))).toMatchObject({
      code: 'invalid_argument',
    })
  })

  it('patch 注入 registeredBy/createdAt 被忽略(只覆盖白名单字段)', async () => {
    await reg.write(mcp('a/b/c'), 'user:1', T1)
    const u = await reg.update(
      'a/b/c',
      { description: '改', registeredBy: 'attacker', createdAt: T2 } as never,
      T2,
    )
    expect(u.registeredBy).toBe('user:1')
    expect(u.createdAt).toBe(T1)
    expect(u.description).toBe('改')
    expect(u.updatedAt).toBe(T2)
  })
})

describe('resolve 最长前缀匹配', () => {
  it('命中中间节点,rest 为剩余段', async () => {
    await reg.write(
      {
        path: 'device/build-01',
        kind: 'device',
        description: 'd',
        config: { kind: 'device', deviceId: 'b01', expose: {} },
      },
      'user:1',
      T1,
    )
    const r = await reg.resolve('device/build-01/shell')
    expect(r.node.path).toBe('device/build-01')
    expect(r.rest).toBe('shell')
  })

  it('完全匹配 → rest 为空', async () => {
    await reg.write(mcp('a/b/c'), 'user:1', T1)
    const r = await reg.resolve('a/b/c')
    expect(r.node.path).toBe('a/b/c')
    expect(r.rest).toBe('')
  })

  it('最长前缀:更深候选优先命中', async () => {
    await reg.write(mcp('a/b/c'), 'user:1', T1)
    const r = await reg.resolve('a/b/c/x/y')
    expect(r.node.path).toBe('a/b/c')
    expect(r.rest).toBe('x/y')
  })

  it('无任何匹配 → not_found', async () => {
    expect(await grabError(() => reg.resolve('nope/x'))).toMatchObject({ code: 'not_found' })
  })
})

describe('children 直接子节点', () => {
  it('只返回段深 +1 的直接子节点', async () => {
    await reg.write(mcp('a/b/c'), 'user:1', T1)
    await reg.write(mcp('a/b/d'), 'user:1', T1)
    const abKids = await reg.children('a/b')
    expect(abKids.map(n => n.path)).toEqual(['a/b/c', 'a/b/d'])
    const aKids = await reg.children('a')
    expect(aKids.map(n => n.path)).toEqual(['a/b'])
  })

  it('根的直接子节点为单段节点', async () => {
    await reg.write(mcp('a/b/c'), 'user:1', T1)
    await reg.write(mcp('m/n'), 'user:1', T1)
    const rootKids = await reg.children('')
    expect(rootKids.map(n => n.path)).toEqual(['a', 'm'])
  })
})

describe('subtree 一次性取整棵子树', () => {
  it('含 path 自身 + 全部后代,按 path 排序', async () => {
    await reg.write(mcp('a/b/c'), 'user:1', T1)
    await reg.write(mcp('a/b/d'), 'user:1', T1)
    const sub = await reg.subtree('a')
    expect(sub.map(n => n.path)).toEqual(['a', 'a/b', 'a/b/c', 'a/b/d'])
  })

  it('根("")= 全树', async () => {
    await reg.write(mcp('a/b'), 'user:1', T1)
    await reg.write(mcp('m/n'), 'user:1', T1)
    const all = await reg.subtree('')
    expect(all.map(n => n.path)).toEqual(['a', 'a/b', 'm', 'm/n'])
  })

  it('不误纳字符串前缀相邻目录(段级)', async () => {
    await reg.write(mcp('bulk/leaf'), 'user:1', T1)
    await reg.write(mcp('bulkx/leaf'), 'user:1', T1)
    const sub = await reg.subtree('bulk')
    expect(sub.map(n => n.path)).toEqual(['bulk', 'bulk/leaf'])
  })

  it('不存在的根返回空数组', async () => {
    expect(await reg.subtree('ghost')).toEqual([])
  })
})

describe('list 分页与 limit 钳制', () => {
  beforeEach(async () => {
    for (let i = 0; i < 205; i++) {
      await reg.write(mcp(`bulk/n${String(i).padStart(3, '0')}`), 'user:1', T1)
    }
  })

  it('缺省 limit = 50', async () => {
    const page = await reg.list('bulk')
    expect(page.items).toHaveLength(50)
    expect(page.cursor).toBeDefined()
  })

  it('limit 超上限 200 静默钳制', async () => {
    const page = await reg.list('bulk', { limit: 1000 })
    expect(page.items).toHaveLength(200)
    expect(page.cursor).toBeDefined()
  })

  it('cursor 可翻至末页且末页无 cursor', async () => {
    // bulk 目录自身 + 205 叶 = 206 个匹配节点
    const first = await reg.list('bulk', { limit: 200 })
    const second = await reg.list('bulk', { limit: 200, cursor: first.cursor })
    expect(second.items).toHaveLength(6)
    expect(second.cursor).toBeUndefined()
  })

  it('list 按段前缀匹配(不误纳字符串前缀相邻目录)', async () => {
    await reg.write(mcp('bulkx/leaf'), 'user:1', T1)
    const page = await reg.list('bulk', { limit: 1000 })
    expect(page.items.every(n => n.path === 'bulk' || n.path.startsWith('bulk/'))).toBe(true)
  })
})
