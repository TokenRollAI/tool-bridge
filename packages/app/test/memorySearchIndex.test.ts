import { describe, expect, it } from 'vitest'
import { TBError } from '@tool-bridge/core'
import { MemorySearchIndex } from './memorySearchIndex'

async function populatedIndex(): Promise<MemorySearchIndex> {
  const index = new MemorySearchIndex()
  await index.replace('home/home-assistant', [
    {
      name: 'get_live_context',
      description: 'Read current temperature and entity state',
      effect: 'read',
    },
    {
      name: 'set_temperature',
      description: 'Set current target temperature',
      effect: 'write',
    },
    {
      name: 'temperature_diagnostics',
      description: 'Inspect temperature diagnostics',
    },
  ])
  await index.replace('device/phone', [{
    name: 'read_temperature',
    description: 'Read current home temperature from the phone',
    effect: 'read',
  }])
  return index
}

describe('MemorySearchIndex keyword-v2 fixture', () => {
  it('ranks distinct logical-term coverage first and pages one best band at a time', async () => {
    const index = await populatedIndex()

    const first = await index.search('read current home temperature')
    expect(first.items).toEqual([
      expect.objectContaining({
        coverage: 1,
        matchedTermCount: 4,
        name: 'read_temperature',
        path: 'device/phone',
        totalTermCount: 4,
      }),
      expect.objectContaining({
        coverage: 1,
        matchedTermCount: 4,
        name: 'get_live_context',
        path: 'home/home-assistant',
        totalTermCount: 4,
      }),
    ])
    expect(first.cursor).toEqual(expect.any(String))

    const second = await index.search('read current home temperature', {
      cursor: first.cursor,
    })
    expect(second.items).toEqual([
      expect.objectContaining({
        coverage: 0.75,
        matchedTermCount: 3,
        name: 'set_temperature',
        totalTermCount: 4,
      }),
    ])
    expect(second.cursor).toEqual(expect.any(String))
  })

  it('normalizes all/coverage/path/effect constraints before filtering candidates', async () => {
    const index = await populatedIndex()

    const allReadAtHome = await index.search('read current home temperature', {
      effects: ['read', 'read'],
      matching: 'all',
      pathPrefix: '/home/',
    })
    expect(allReadAtHome.items.map(item => item.name)).toEqual(['get_live_context'])
    expect(allReadAtHome.items[0]).toMatchObject({
      coverage: 1,
      matchedTermCount: 4,
      totalTermCount: 4,
    })

    const writeAtHome = await index.search('read current home temperature', {
      effects: ['write'],
      minCoverage: 0.75,
      pathPrefix: 'home',
    })
    expect(writeAtHome.items).toEqual([
      expect.objectContaining({
        coverage: 0.75,
        matchedTermCount: 3,
        name: 'set_temperature',
        totalTermCount: 4,
      }),
    ])
  })

  it('binds both native and hydration cursors to the normalized option fingerprint', async () => {
    const index = await populatedIndex()
    const opts = { effects: ['read', 'unknown'] as const, limit: 1, pathPrefix: 'home' }
    const first = await index.search('temperature', {
      ...opts,
      effects: [...opts.effects],
    })
    expect(first.items).toHaveLength(1)
    expect(first.cursor).toEqual(expect.any(String))

    await expect(index.search('temperature', {
      cursor: first.cursor,
      effects: ['unknown', 'read', 'read'],
      limit: 1,
      pathPrefix: '/home/',
    })).resolves.toMatchObject({ items: [expect.any(Object)] })

    const hydrationCursor = await index.cursorFor('temperature', first.items[0]!)
    await expect(index.search('temperature', {
      cursor: hydrationCursor,
      effects: ['read', 'unknown'],
      limit: 1,
      pathPrefix: 'home',
    })).resolves.toMatchObject({ items: [expect.any(Object)] })
    await expect(index.search('temperature', {
      cursor: hydrationCursor,
      effects: ['write'],
      limit: 1,
      pathPrefix: 'home',
    })).rejects.toBeInstanceOf(TBError)
  })
})
