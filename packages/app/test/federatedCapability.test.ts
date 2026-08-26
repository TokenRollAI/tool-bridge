import {
  MemoryStateStore,
  type SearchIndex,
  SecretStoreImpl,
  type StateStore,
} from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import type { TbAppDeps } from '../src/deps'
import { createRouteEnv } from '../src/routes/env'

function searchIndex(withRevision = true): SearchIndex {
  return {
    capabilities: ['search'],
    cursorFor: async () => 'cursor',
    search: async () => ({ items: [] }),
    ...(withRevision ? { revision: async () => 1 } : {}),
  }
}

function withoutCompareAndSwap(source: StateStore): StateStore {
  return {
    delete: source.delete.bind(source),
    get: source.get.bind(source),
    getMany: source.getMany.bind(source),
    list: source.list.bind(source),
    put: source.put.bind(source),
    ...(source.putIfAbsent === undefined
      ? {}
      : { putIfAbsent: source.putIfAbsent.bind(source) }),
  }
}

function deps(opts: {
  instanceId?: string
  search: SearchIndex
  state?: StateStore
}): TbAppDeps {
  const state = opts.state ?? new MemoryStateStore()
  return {
    allowInsecureHttp: false,
    remote: {
      allowInsecure: false,
      allowlist: [],
      maxHops: 4,
      ...(opts.instanceId === undefined ? {} : { instanceId: opts.instanceId }),
    },
    search: opts.search,
    secrets: new SecretStoreImpl(state, undefined),
    state,
    version: 'test',
  }
}

describe('search:federated capability gate', () => {
  it('只在稳定 instanceId、SearchIndex revision 与 StateStore CAS 同时存在时开放', () => {
    const capable = deps({ instanceId: 'edge-a', search: searchIndex() })
    expect(createRouteEnv(capable).globalSearchCapabilities())
      .toEqual(['search', 'search:federated'])

    expect(createRouteEnv(deps({ search: searchIndex() })).globalSearchCapabilities())
      .toEqual(['search'])

    expect(createRouteEnv(deps({ instanceId: 'edge-a', search: searchIndex(false) }))
      .globalSearchCapabilities()).toEqual(['search'])

    const stateWithoutCas = withoutCompareAndSwap(new MemoryStateStore())
    expect(createRouteEnv(deps({
      instanceId: 'edge-a',
      search: searchIndex(),
      state: stateWithoutCas,
    })).globalSearchCapabilities()).toEqual(['search'])
  })
})
