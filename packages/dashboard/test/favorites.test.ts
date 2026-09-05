import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let favorites: typeof import('../src/lib/favorites')
let values: Map<string, string>
const key = (scope: string) => `tb.favorites.v1.${encodeURIComponent(scope)}`

describe('本机工具收藏', () => {
  beforeEach(async () => {
    vi.resetModules()
    values = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => values.set(name, value),
      removeItem: (name: string) => values.delete(name),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size },
    })
    favorites = await import('../src/lib/favorites')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('按稳定 profile ID 和 gateway 隔离，删除档案清除其全部地址', async () => {
    const { historyScope } = await import('../src/lib/history')
    const a = historyScope({ id: 'a', baseUrl: 'https://one.test' })
    const b = historyScope({ id: 'b', baseUrl: 'https://one.test' })
    const changedGateway = historyScope({ id: 'a', baseUrl: 'https://two.test' })
    const tool = { path: 'team/weather', tool: 'read' }
    favorites.toggleFavorite(a, tool)
    expect(favorites.loadFavorites(b)).toEqual([])
    expect(favorites.loadFavorites(changedGateway)).toEqual([])
    favorites.toggleFavorite(changedGateway, tool)
    favorites.toggleFavorite(b, tool)
    favorites.clearProfileFavorites('a')
    expect(favorites.loadFavorites(a)).toEqual([])
    expect(favorites.loadFavorites(changedGateway)).toEqual([])
    expect(favorites.loadFavorites(b)).toEqual([tool])
    expect(values.has(key(a))).toBe(false)
    expect(values.has(key(changedGateway))).toBe(false)
  })

  it('读取旧数据和新增时都只保留 path/tool，并去重丢弃畸形数据', () => {
    const tool = { path: 'team/weather', tool: 'read' }
    values.set(key('legacy'), JSON.stringify([{ ...tool, args: { token: 'sensitive' }, authRef: 'secret-name', result: 'private' }, tool, null, { path: 42, tool: 'x' }]))
    expect(favorites.loadFavorites('legacy')).toEqual([tool])
    expect(values.get(key('legacy'))).toBe(JSON.stringify([tool]))
    favorites.toggleFavorite('new', { ...tool, args: { token: 'sensitive' } } as typeof tool)
    expect(values.get(key('new'))).toBe(JSON.stringify([tool]))
  })

  it('达到容量后保留已有收藏，取消收藏立即通知订阅者', () => {
    for (let index = 0; index < 50; index++) favorites.toggleFavorite('full', { path: 'team', tool: `tool-${index}` })
    expect(favorites.toggleFavorite('full', { path: 'team', tool: 'extra' })).toBe('full')
    const changed = vi.fn()
    const unsubscribe = favorites.subscribeFavorites(changed)
    expect(favorites.toggleFavorite('full', { path: 'team', tool: 'tool-0' })).toBe('removed')
    expect(changed).toHaveBeenCalledOnce()
    expect(favorites.toggleFavorite('full', { path: 'team', tool: 'extra' })).toBe('added')
    unsubscribe()
  })

  it('存储被禁用时可在当前会话内添加和取消', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    const tool = { path: '', tool: 'help' }
    expect(favorites.toggleFavorite('memory', tool)).toBe('added')
    expect(favorites.loadFavorites('memory')).toEqual([tool])
    expect(favorites.toggleFavorite('memory', tool)).toBe('removed')
  })
})
