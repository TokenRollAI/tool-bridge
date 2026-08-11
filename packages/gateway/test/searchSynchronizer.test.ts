import {
  MemoryStateStore,
  type MutableSearchIndex,
  NodeRegistryStore,
  type StateStore,
  TOOL_SEARCH_AUDIT_NODE_LIMIT,
  type ToolSearchCandidate,
  type ToolSearchDocument,
  type ToolSpec,
} from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { SearchSynchronizer } from '../src/search/synchronizer'

class RecordingSearchIndex implements MutableSearchIndex {
  readonly capabilities = ['search'] as const
  documents: ToolSearchDocument[] = []
  rebuildCalls = 0
  replaceCalls = 0
  seeded = true

  async cursorFor(): Promise<string> { return 'cursor' }
  async initialized(): Promise<boolean> { return this.seeded }
  async rebuild(documents: readonly ToolSearchDocument[]): Promise<void> {
    this.rebuildCalls++
    this.documents = structuredClone([...documents])
    this.seeded = true
  }

  async remove(path: string): Promise<void> {
    this.documents = this.documents.filter(document => document.path !== path)
  }

  async removePrefix(path: string): Promise<void> {
    this.documents = this.documents.filter(document => (
      document.path !== path && !document.path.startsWith(`${path}/`)
    ))
  }

  async replace(path: string, tools: readonly ToolSpec[]): Promise<void> {
    this.replaceCalls++
    this.documents = [
      ...this.documents.filter(document => document.path !== path),
      ...tools.map(tool => ({ path, tool })),
    ]
  }

  async search(): Promise<{ items: ToolSearchCandidate[] }> { return { items: [] } }
}

class DelayedCanonicalStore implements StateStore {
  private remainingStaleLists: number

  constructor(
    private readonly inner: StateStore,
    private readonly key: string,
    private readonly staleValue: unknown,
    staleLists: number,
  ) {
    this.remainingStaleLists = staleLists
  }

  async delete(key: string): Promise<void> { await this.inner.delete(key) }
  async get(key: string): Promise<unknown | null> { return await this.inner.get(key) }
  async getMany(keys: readonly string[]): Promise<Map<string, unknown>> {
    return await this.inner.getMany(keys)
  }

  async list(
    prefix: string,
    opts?: { cursor?: string, limit?: number },
  ): Promise<{ cursor?: string, items: Array<{ key: string, value: unknown }> }> {
    const page = await this.inner.list(prefix, opts)
    if (!prefix.startsWith('node:') || this.remainingStaleLists === 0) return page
    const item = page.items.find(candidate => candidate.key === this.key)
    if (item !== undefined) {
      item.value = this.staleValue
      this.remainingStaleLists--
    }
    return page
  }

  async put(key: string, value: unknown): Promise<void> { await this.inner.put(key, value) }
}

class FailMarkerCommitStore implements StateStore {
  private failed = false

  constructor(private readonly inner: StateStore) {}

  async delete(key: string): Promise<void> { await this.inner.delete(key) }
  async get(key: string): Promise<unknown | null> { return await this.inner.get(key) }
  async getMany(keys: readonly string[]): Promise<Map<string, unknown>> {
    return await this.inner.getMany(keys)
  }

  async list(
    prefix: string,
    opts?: { cursor?: string, limit?: number },
  ): Promise<{ cursor?: string, items: Array<{ key: string, value: unknown }> }> {
    return await this.inner.list(prefix, opts)
  }

  async put(key: string, value: unknown): Promise<void> {
    if (
      !this.failed
      && key.startsWith('searchdirty:node:')
      && (value as { expectedDigest?: unknown }).expectedDigest !== undefined
    ) {
      this.failed = true
      throw new Error('injected marker commit failure')
    }
    await this.inner.put(key, value)
  }
}

function node(path: string, description: string): Parameters<NodeRegistryStore['write']>[0] {
  return {
    path,
    kind: 'http',
    description: 'Synchronizer fixture',
    config: {
      kind: 'http',
      endpoint: 'https://sync.example.test',
      tools: [{
        name: 'probe',
        description,
        method: 'GET',
        pathTemplate: '/probe',
      }],
    },
  }
}

async function dirtyFor(store: StateStore, path: string): Promise<unknown[]> {
  const page = await store.list('searchdirty:')
  return page.items.filter(item => (item.value as { path?: unknown }).path === path)
}

describe('SearchSynchronizer durable repair', () => {
  it('repairs and clears a pending marker after the marker commit put fails', async () => {
    const store = new FailMarkerCommitStore(new MemoryStateStore())
    const registry = new NodeRegistryStore(store)
    const index = new RecordingSearchIndex()
    const sync = new SearchSynchronizer(store, index)
    const path = 'search/sync/commit-failure'
    await registry.write(node(path, 'commitfailureunique'), 'system:test', new Date().toISOString())
    const marker = await sync.markNode(path)

    await sync.reconcileNodeQuietly(path, { marker })
    expect(await dirtyFor(store, path)).toHaveLength(1)
    await sync.ensureReady()
    expect(await dirtyFor(store, path)).toHaveLength(0)
    expect(index.documents[0]?.tool.description).toBe('commitfailureunique')
    await sync.ensureReady()
    expect(index.rebuildCalls).toBe(2)
  })

  it('audits canonical state after markers clear and repairs delayed KV propagation', async () => {
    const inner = new MemoryStateStore()
    const path = 'search/sync/delayed-propagation'
    const stale = node(path, 'snapshot A')
    const registry = new NodeRegistryStore(inner)
    const now = new Date().toISOString()
    await registry.write(node(path, 'snapshot A'), 'system:test', now)
    await registry.write(node(path, 'snapshot B'), 'system:test', now)

    const store = new DelayedCanonicalStore(inner, `node:${path}`, stale, 2)
    const index = new RecordingSearchIndex()
    const sync = new SearchSynchronizer(store, index)
    await sync.markNode(path)

    expect(await dirtyFor(store, path)).toHaveLength(1)
    await sync.ensureReady()
    expect(await dirtyFor(store, path)).toHaveLength(0)
    expect(index.documents[0]?.tool.description).toBe('snapshot A')
    await sync.ensureReady()
    expect(index.documents[0]?.tool.description).toBe('snapshot A')
    await sync.ensureReady()
    expect(index.documents[0]?.tool.description).toBe('snapshot B')
    expect(index.rebuildCalls).toBe(3)
  })

  it('preserves last-known-good when concurrent writes exceed the audit budget', async () => {
    const store = new MemoryStateStore()
    for (let i = 0; i <= TOOL_SEARCH_AUDIT_NODE_LIMIT; i++) {
      const path = `search/sync/over-budget/${i}`
      await store.put(`node:${path}`, node(path, 'over budget'))
    }
    const index = new RecordingSearchIndex()
    index.documents = [{ path: 'legitimate/provider', tool: { name: 'legitimate' } }]
    const sync = new SearchSynchronizer(store, index)

    await expect(sync.ensureReady()).resolves.toBeUndefined()
    expect(index.rebuildCalls).toBe(0)
    expect(index.documents).toEqual([
      { path: 'legitimate/provider', tool: { name: 'legitimate' } },
    ])
  })

  it('does not hot-grow the formal index or marker set after canonical overflow', async () => {
    const store = new MemoryStateStore()
    const registry = new NodeRegistryStore(store)
    const index = new RecordingSearchIndex()
    index.seeded = false
    const sync = new SearchSynchronizer(store, index)
    await sync.ensureSeeded()

    for (let i = 0; i <= TOOL_SEARCH_AUDIT_NODE_LIMIT; i++) {
      const path = `hot-cap-${i.toString().padStart(3, '0')}`
      await registry.write(node(path, 'hot cap'), 'system:test', new Date().toISOString())
      const marker = await sync.markNode(path)
      await sync.reconcileNode(path, { marker })
    }

    expect(index.documents).toHaveLength(TOOL_SEARCH_AUDIT_NODE_LIMIT)
    expect(index.replaceCalls).toBe(TOOL_SEARCH_AUDIT_NODE_LIMIT)
    expect((await store.list('searchdirty:')).items).toHaveLength(0)

    for (let i = 0; i < 100; i++) await sync.markNode(`overflow/${i}`)
    expect((await store.list('searchdirty:')).items).toHaveLength(1)
  })

  it('seeds once before the first canonical mutation and rejects an already-overflowed seed', async () => {
    const healthyStore = new MemoryStateStore()
    await healthyStore.put('node:search/sync/seed', node('search/sync/seed', 'seed'))
    const healthyIndex = new RecordingSearchIndex()
    healthyIndex.seeded = false
    const healthy = new SearchSynchronizer(healthyStore, healthyIndex)
    await Promise.all([healthy.ensureSeeded(), healthy.ensureSeeded()])
    expect(healthyIndex.rebuildCalls).toBe(1)

    const overflowStore = new MemoryStateStore()
    for (let i = 0; i <= TOOL_SEARCH_AUDIT_NODE_LIMIT; i++) {
      const path = `search/sync/unseeded-overflow/${i}`
      await overflowStore.put(`node:${path}`, node(path, 'overflow'))
    }
    const overflowIndex = new RecordingSearchIndex()
    overflowIndex.seeded = false
    const overflow = new SearchSynchronizer(overflowStore, overflowIndex)
    await expect(overflow.ensureSeeded()).rejects.toMatchObject({ code: 'rate_limited' })
    expect(overflowIndex.rebuildCalls).toBe(0)
  })

  it('indexes a long canonical ToolSpec without mutating or duplicating it', async () => {
    const store = new MemoryStateStore()
    const registry = new NodeRegistryStore(store)
    const path = 'search/sync/oversized'
    await registry.write(node(path, 'x'.repeat(25_000)), 'system:test', new Date().toISOString())
    const index = new RecordingSearchIndex()
    const sync = new SearchSynchronizer(store, index)

    await expect(sync.ensureReady()).resolves.toBeUndefined()
    expect(index.documents).toHaveLength(1)
    expect(index.documents[0]).toMatchObject({
      path,
      tool: { name: 'probe', description: 'x'.repeat(25_000) },
    })
    expect(await registry.get(path)).toMatchObject({ path })
  })
})
