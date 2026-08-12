import { MemoryStateStore } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { getTools, peekToolCache } from '../src/index'

describe('tool cache canonical boundary', () => {
  it('caches provider snapshots larger than the optional search projection', async () => {
    const store = new MemoryStateStore()
    const path = 'providers/large-mcp'
    const tools = Array.from({ length: 125 }, (_, index) => ({
      name: `tool_${index}`,
      description: 'x'.repeat(200),
    }))

    await expect(getTools(store, path, async () => tools, {
      now: '2026-08-11T00:00:00.000Z',
      refresh: true,
      ttl: 300,
    })).resolves.toEqual(tools)
    await expect(peekToolCache(store, path)).resolves.toEqual(tools)
  })
})
