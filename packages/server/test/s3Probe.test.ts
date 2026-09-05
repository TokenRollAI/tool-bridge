import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryObjectStore, TBError } from '@tool-bridge/core'
import { createS3ObjectStore, type S3ObjectStore } from '../src/s3Objects'
import { probeS3ObjectStore } from '../src/s3Probe'

vi.mock('../src/s3Objects', () => ({ createS3ObjectStore: vi.fn() }))

const config = {
  endpoint: 'https://objects.example.com',
  bucket: 'probe-tests',
  accessKeyId: 'test-access',
  secretAccessKey: 'test-secret',
}

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}))
afterEach(() => vi.restoreAllMocks())

function fixture() {
  const memory = new MemoryObjectStore()
  // Serialize the memory fixture's read-check-write sequence to model atomic S3
  // conditions; MemoryObjectStore itself awaits body conversion before writing.
  let pending = Promise.resolve()
  const store = {
    head: vi.fn(memory.head.bind(memory)),
    get: vi.fn(memory.get.bind(memory)),
    list: vi.fn(memory.list.bind(memory)),
    delete: vi.fn(memory.delete.bind(memory)),
    close: vi.fn(),
    put: vi.fn<S3ObjectStore['put']>((...args) => {
      const result = pending.then(() => memory.put(...args))
      pending = result.then(() => {}, () => {})
      return result
    }),
  }
  vi.mocked(createS3ObjectStore).mockReturnValue(store)
  return { store, memory }
}

describe('S3 capability probe isolation and cleanup', () => {
  it('checks all capabilities and cleans every attempted object', async () => {
    const { store, memory } = fixture()
    const result = await probeS3ObjectStore(config)

    expect(Object.values(result.checks).every(Boolean)).toBe(true)
    expect(result.cleanupSucceeded).toBe(true)
    expect((await memory.list('')).items).toEqual([])
    expect(store.list).toHaveBeenCalledTimes(3)
    expect(store.close).toHaveBeenCalledOnce()
    expect(console.warn).not.toHaveBeenCalled()
  })

  it.each(['before-write', 'after-write'] as const)(
    'a streaming error %s cannot cause a false pagination failure',
    async (failurePoint) => {
      const { store, memory } = fixture()
      const put = store.put.getMockImplementation()!
      store.put.mockImplementation(async (...args) => {
        if (!args[0].endsWith('/stream')) return put(...args)
        if (failurePoint === 'after-write') await put(...args)
        throw new TBError('unavailable', 'S3 put failed')
      })

      const result = await probeS3ObjectStore(config)

      expect(result.checks.streaming).toBe(false)
      expect(result.checks.pagination).toBe(true)
      expect(result.cleanupSucceeded).toBe(true)
      const attempted = new Set(store.put.mock.calls.map(([key]) => key))
      expect(new Set(store.delete.mock.calls.map(([key]) => key))).toEqual(attempted)
      expect((await memory.list('')).items).toEqual([])
      expect(store.close).toHaveBeenCalledOnce()
    },
  )

  it('still rejects incomplete pagination', async () => {
    const { store, memory } = fixture()
    store.list.mockImplementation(async (prefix, options) => {
      const result = await memory.list(prefix, options)
      return { items: result.items }
    })

    const result = await probeS3ObjectStore(config)

    expect(result.checks.pagination).toBe(false)
    expect(console.warn).toHaveBeenCalledExactlyOnceWith('S3 capability probe check failed', {
      check: 'pagination', reason: 'unexpected_result',
    })
    expect(result.cleanupSucceeded).toBe(true)
    expect((await memory.list('')).items).toEqual([])
  })

  it('reports cleanup failure while continuing cleanup of all attempted objects', async () => {
    const { store, memory } = fixture()
    store.delete.mockImplementation(async (key) => {
      if (key.endsWith('/basic')) throw new TBError('permission_denied', 'S3 delete was denied')
      await memory.delete(key)
    })

    const result = await probeS3ObjectStore(config)

    expect(Object.values(result.checks).every(Boolean)).toBe(true)
    expect(result.cleanupSucceeded).toBe(false)
    const attempted = new Set(store.put.mock.calls.map(([key]) => key))
    expect(new Set(store.delete.mock.calls.map(([key]) => key))).toEqual(attempted)
    expect((await memory.list('')).items).toHaveLength(1)
    expect(store.close).toHaveBeenCalledOnce()
  })

  it.each([
    'S3 PUT failed (411)',
    'S3 HEAD failed (503)',
    'S3 GET was denied',
    'S3 LIST object not found',
    'S3 DELETE condition failed',
    'S3 GET deadline exceeded',
  ])('retains the normalized operation and HTTP status: %s', async (message) => {
    const { store } = fixture()
    const put = store.put.getMockImplementation()!
    store.put.mockImplementation(async (...args) => {
      if (args[0].endsWith('/stream')) throw new TBError('unavailable', message)
      return put(...args)
    })

    const result = await probeS3ObjectStore(config)

    expect(result.checks.streaming).toBe(false)
    expect(console.warn).toHaveBeenCalledExactlyOnceWith('S3 capability probe check failed', {
      check: 'streaming', reason: message,
    })
  })

  it.each([
    [new Error('test-secret upstream-private-host'), 'unexpected_error'],
    [new TBError('unavailable', 'test-secret upstream-private-host'), 'operation_failed'],
    [new TBError('unavailable', 'S3 PUT failed (411) test-secret'), 'operation_failed'],
    [new TBError('unavailable', 'S3 PUT failed (411)\n'), 'operation_failed'],
    [{ message: 'test-secret', endpoint: config.endpoint }, 'unexpected_error'],
  ])('never logs arbitrary exceptions or forged TBError details: %#', async (error, reason) => {
    const { store } = fixture()
    const put = store.put.getMockImplementation()!
    store.put.mockImplementation(async (...args) => {
      if (args[0].endsWith('/stream')) throw error
      return put(...args)
    })

    await probeS3ObjectStore(config)

    expect(console.warn).toHaveBeenCalledExactlyOnceWith('S3 capability probe check failed', {
      check: 'streaming', reason,
    })
    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls)
    for (const privateValue of [config.secretAccessKey, config.accessKeyId, config.endpoint, '__tool_bridge_internal__'])
      expect(logged).not.toContain(privateValue)
  })
})
