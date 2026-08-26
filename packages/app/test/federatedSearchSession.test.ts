import { MemoryStateStore, type StateStore, TBError } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import {
  FEDERATED_SEARCH_HANDLE_LENGTH,
  FEDERATED_SEARCH_SESSION_KEY_PREFIX,
  type FederatedSearchSessionCreate,
  federatedSearchSessionStateKey,
  FederatedSearchSessionStore,
  isFederatedSearchSessionHandle,
} from '../src/search/federatedSession'

const START = Date.parse('2030-01-01T00:00:00.000Z')

function sessionInput(
  overrides: Partial<FederatedSearchSessionCreate> = {},
): FederatedSearchSessionCreate {
  return {
    actorKeyId: 'actor-key-1',
    excludedStatuses: [{ sourceId: 'remote-b', status: 'timeout' }],
    expiresAt: new Date(START + 60_000).toISOString(),
    federationPolicy: { mode: 'recursive', maxHops: 3 },
    generation: 0,
    nextHandle: null,
    page: { items: [{ path: 'tools/calendar', name: 'find_events' }] },
    rankingVersion: 'keyword-v2',
    requestDigest: 'request-digest-1',
    sourceContinuations: [{ sourceId: 'local', cursor: 'local-cursor' }],
    topologyDigest: 'topology-digest-1',
    ...overrides,
  }
}

class NoCasStateStore implements StateStore {
  constructor(private readonly inner = new MemoryStateStore()) {}

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

  async put(key: string, value: unknown): Promise<void> { await this.inner.put(key, value) }
}

describe('FederatedSearchSessionStore', () => {
  it('issues fixed-size opaque handles and stores only their SHA-256 digest in the key', async () => {
    const state = new MemoryStateStore()
    const store = new FederatedSearchSessionStore(state, {
      now: () => START,
      randomBytes: length => new Uint8Array(length).fill(7),
    })

    const { handle, record } = await store.createNew(sessionInput())
    expect(handle).toHaveLength(FEDERATED_SEARCH_HANDLE_LENGTH)
    expect(handle).toMatch(/^fsc1_[A-Za-z0-9_-]{32}$/u)
    expect(isFederatedSearchSessionHandle(handle)).toBe(true)
    expect(record.sessionId).toBe(handle)
    expect(record.revision).toBe(0)

    const page = await state.list(FEDERATED_SEARCH_SESSION_KEY_PREFIX)
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.key).toMatch(/^fsearch:session:v1:[0-9a-f]{64}$/u)
    expect(page.items[0]?.key).not.toContain(handle)
    expect(page.items[0]?.key).toBe(await federatedSearchSessionStateKey(handle))
  })

  it('rejects malformed, tampered and unknown handles without exposing state', async () => {
    const store = new FederatedSearchSessionStore(new MemoryStateStore(), { now: () => START })
    const handle = store.issueHandle()
    const binding = { actorKeyId: 'actor-key-1', requestDigest: 'request-digest-1' }

    await expect(store.read('fsc1_short', binding)).rejects.toBeInstanceOf(TBError)
    await expect(store.read(handle, binding)).rejects.toMatchObject({ code: 'invalid_argument' })

    await store.create(handle, sessionInput())
    const last = handle.at(-1)
    const tampered = handle.slice(0, -1) + (last === 'A' ? 'B' : 'A')
    expect(isFederatedSearchSessionHandle(tampered)).toBe(true)
    await expect(store.read(tampered, binding)).rejects.toMatchObject({
      code: 'invalid_argument',
    })
  })

  it('strictly parses records and rejects unknown fields or non-zero revisions', async () => {
    const state = new MemoryStateStore()
    const store = new FederatedSearchSessionStore(state, { now: () => START })
    const handle = store.issueHandle()
    const binding = { actorKeyId: 'actor-key-1', requestDigest: 'request-digest-1' }
    await store.create(handle, sessionInput())
    const key = await federatedSearchSessionStateKey(handle)
    const raw = await state.get(key)

    await state.put(key, { ...(raw as Record<string, unknown>), unexpected: true })
    await expect(store.read(handle, binding)).rejects.toMatchObject({ code: 'internal' })

    await state.put(key, { ...(raw as Record<string, unknown>), revision: 1 })
    await expect(store.read(handle, binding)).rejects.toMatchObject({ code: 'internal' })
  })

  it('validates absolute expiry and actor/request bindings on every read', async () => {
    let now = START
    const store = new FederatedSearchSessionStore(new MemoryStateStore(), { now: () => now })
    const { handle } = await store.createNew(sessionInput())

    await expect(store.read(handle, {
      actorKeyId: 'actor-key-2',
      requestDigest: 'request-digest-1',
    })).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(store.read(handle, {
      actorKeyId: 'actor-key-1',
      requestDigest: 'request-digest-2',
    })).rejects.toMatchObject({ code: 'invalid_argument' })

    now = START + 60_000
    await expect(store.read(handle, {
      actorKeyId: 'actor-key-1',
      requestDigest: 'request-digest-1',
    })).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(store.create(store.issueHandle(), sessionInput()))
      .rejects.toMatchObject({ code: 'invalid_argument' })
  })

  it('fails closed at construction when StateStore has no atomic CAS', () => {
    expect(() => new FederatedSearchSessionStore(new NoCasStateStore())).toThrowError(TBError)
  })

  it('uses create-only CAS so concurrent retries return one immutable winner', async () => {
    const state = new MemoryStateStore()
    const store = new FederatedSearchSessionStore(state, { now: () => START })
    const handle = store.issueHandle()
    const firstInput = sessionInput({ page: { items: ['first'] } })
    const secondInput = sessionInput({ page: { items: ['other'] } })

    const [first, second] = await Promise.all([
      store.create(handle, firstInput),
      store.create(handle, secondInput),
    ])
    expect(first).toEqual(second)
    expect(first.generation).toBe(0)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.page)).toBe(true)

    const readAgain = await store.read(handle, firstInput)
    expect(readAgain).toEqual(first)
    expect(readAgain).not.toBe(first)

    const overwrite = await store.create(handle, sessionInput({
      generation: 99,
      page: { items: ['must-not-overwrite'] },
    }))
    expect(overwrite).toEqual(first)
    expect(overwrite.generation).not.toBe(99)
  })

  it('does not persist credentials, endpoint configuration or full schemas in opaque fields', async () => {
    const state = new MemoryStateStore()
    const store = new FederatedSearchSessionStore(state, { now: () => START })
    const forbidden = [
      { page: { authorization: 'Bearer opaque' } },
      { sourceContinuations: [{ baseUrl: 'https://remote.example.test' }] },
      { page: { tool: { inputSchema: { type: 'object' } } } },
      { federationPolicy: { credential: 'tbk_secret-material' } },
    ]

    for (const override of forbidden) {
      await expect(store.create(store.issueHandle(), sessionInput(override)))
        .rejects.toMatchObject({ code: 'invalid_argument' })
    }
    expect((await state.list(FEDERATED_SEARCH_SESSION_KEY_PREFIX)).items).toHaveLength(0)
  })

  it('allows credential-shaped words inside public tool descriptions', async () => {
    const store = new FederatedSearchSessionStore(new MemoryStateStore(), { now: () => START })
    await expect(store.createNew(sessionInput({
      page: {
        items: [{
          tool: {
            description: 'Bearer token introspection for tbk_format documentation',
            name: 'describe_token_format',
          },
        }],
      },
    }))).resolves.toMatchObject({ record: { generation: 0 } })
  })

  it('enforces record and actor/global quotas while lazily deleting expired rows', async () => {
    let now = START
    const state = new MemoryStateStore()
    const store = new FederatedSearchSessionStore(state, {
      maxRecordBytes: 2_000,
      maxSessionsGlobal: 2,
      maxSessionsPerActor: 1,
      now: () => now,
    })
    await store.createNew(sessionInput())
    await expect(store.createNew(sessionInput())).rejects.toMatchObject({
      code: 'rate_limited',
    })
    await store.createNew(sessionInput({ actorKeyId: 'actor-key-2' }))
    await expect(store.createNew(sessionInput({ actorKeyId: 'actor-key-3' })))
      .rejects.toMatchObject({ code: 'rate_limited' })

    now = START + 60_001
    await store.createNew(sessionInput({
      actorKeyId: 'actor-key-3',
      expiresAt: new Date(now + 60_000).toISOString(),
    }))
    expect((await state.list(FEDERATED_SEARCH_SESSION_KEY_PREFIX)).items).toHaveLength(1)

    const small = new FederatedSearchSessionStore(new MemoryStateStore(), {
      maxRecordBytes: 200,
      now: () => START,
    })
    await expect(small.createNew(sessionInput({ page: { text: 'x'.repeat(500) } })))
      .rejects.toMatchObject({ code: 'rate_limited' })
  })

  it('atomically counts session chains instead of generation rows', async () => {
    const state = new MemoryStateStore()
    const store = new FederatedSearchSessionStore(state, {
      maxSessionsGlobal: 1,
      maxSessionsPerActor: 1,
      now: () => START,
    })
    const firstHandle = store.issueHandle()
    await store.create(firstHandle, sessionInput())

    await store.create(store.issueHandle(), sessionInput({
      generation: 1,
      sessionId: firstHandle,
    }))

    const competing = await Promise.allSettled([
      store.createNew(sessionInput({ actorKeyId: 'actor-key-2' })),
      store.createNew(sessionInput({ actorKeyId: 'actor-key-3' })),
    ])
    expect(competing).toHaveLength(2)
    expect(competing.every(result => result.status === 'rejected')).toBe(true)
    for (const result of competing) {
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ code: 'rate_limited' })
      }
    }
  })

  it('admits at most one of two concurrent chains at a global quota of one', async () => {
    const state = new MemoryStateStore()
    const store = new FederatedSearchSessionStore(state, {
      maxSessionsGlobal: 1,
      maxSessionsPerActor: 1,
      now: () => START,
    })

    const results = await Promise.allSettled([
      store.createNew(sessionInput({ actorKeyId: 'actor-key-1' })),
      store.createNew(sessionInput({ actorKeyId: 'actor-key-2' })),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejection = results.find(result => result.status === 'rejected')
    expect(rejection).toMatchObject({
      reason: { code: 'rate_limited' },
      status: 'rejected',
    })
  })

  it('bounds generations and cumulative bytes within one session chain', async () => {
    const state = new MemoryStateStore()
    const store = new FederatedSearchSessionStore(state, {
      maxBytesPerSession: 2_000,
      maxGenerationsPerSession: 2,
      now: () => START,
    })
    const firstHandle = store.issueHandle()
    await store.create(firstHandle, sessionInput())
    await store.create(store.issueHandle(), sessionInput({
      generation: 1,
      sessionId: firstHandle,
    }))
    await expect(store.create(store.issueHandle(), sessionInput({
      generation: 2,
      sessionId: firstHandle,
    }))).rejects.toMatchObject({ code: 'rate_limited' })

    const bytes = new FederatedSearchSessionStore(new MemoryStateStore(), {
      maxBytesPerSession: 700,
      now: () => START,
    })
    const byteHandle = bytes.issueHandle()
    await bytes.create(byteHandle, sessionInput())
    await expect(bytes.create(bytes.issueHandle(), sessionInput({
      generation: 1,
      page: { items: ['x'.repeat(300)] },
      sessionId: byteHandle,
    }))).rejects.toMatchObject({ code: 'rate_limited' })
  })
})
