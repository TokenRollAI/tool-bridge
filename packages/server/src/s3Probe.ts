import type { S3StoreConfig } from '@tool-bridge/app'
import { isTBError, readStreamText } from '@tool-bridge/core'
import { randomUUID } from 'node:crypto'
import { createS3ObjectStore, type S3ObjectStoreOptions } from './s3Objects'

export interface S3ProbeResult {
  checks: Record<string, boolean>
  cleanupSucceeded: boolean
}

/** Destructive only inside a fresh, unguessable probe namespace in the selected bucket. */
export async function probeS3ObjectStore(
  config: S3StoreConfig,
  options: S3ObjectStoreOptions = {},
): Promise<S3ProbeResult> {
  const checks: Record<string, boolean> = {
    readWrite: false,
    metadata: false,
    createOnly: false,
    ifMatch: false,
    pagination: false,
    specialKeys: false,
    emptyObject: false,
    streaming: false,
  }
  const prefix = `__tool_bridge_internal__/probe/${randomUUID()}/`
  const keys = new Set<string>()
  let store: ReturnType<typeof createS3ObjectStore>
  try {
    store = createS3ObjectStore(config, options)
  } catch {
    return { checks, cleanupSucceeded: true }
  }
  const key = (name: string) => {
    const result = prefix + name
    keys.add(result)
    return result
  }
  async function check(
    name: string,
    run: () => Promise<boolean>,
  ): Promise<void> {
    try {
      checks[name] = await run()
    } catch {
      checks[name] = false
    }
  }
  async function read(name: string): Promise<string | undefined> {
    const object = await store.get(name)
    return object ? readStreamText(object.body) : undefined
  }
  let cleanupSucceeded = true
  try {
    const basic = key('basic')
    await check('readWrite', async () => {
      await store.put(basic, 'tool-bridge probe', {
        ifNoneMatch: '*',
        contentType: 'text/plain',
        metadata: { purpose: 'capability-test' },
      })
      return (await read(basic)) === 'tool-bridge probe'
    })
    await check('metadata', async () => {
      const result = await store.head(basic)
      return (
        result?.metadata?.purpose === 'capability-test'
        && result.contentType === 'text/plain'
      )
    })
    await check('createOnly', async () => {
      const target = key('race')
      const attempts = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          store.put(target, `candidate-${i}`, { ifNoneMatch: '*' }),
        ),
      )
      const successes = attempts.filter(
        result => result.status === 'fulfilled',
      )
      const conflicts = attempts.filter(
        result =>
          result.status === 'rejected'
          && isTBError(result.reason)
          && result.reason.code === 'conflict',
      )
      if (successes.length !== 1 || conflicts.length !== 7) return false
      const winner = attempts.findIndex(
        result => result.status === 'fulfilled',
      )
      return (await read(target)) === `candidate-${winner}`
    })
    await check('ifMatch', async () => {
      const target = key('etag')
      const initial = await store.put(target, 'first', { ifNoneMatch: '*' })
      let conflict = false
      try {
        await store.put(target, 'invalid', { ifMatchEtag: 'incorrect-etag' })
      } catch (error) {
        conflict = isTBError(error) && error.code === 'conflict'
      }
      if (!conflict || (await read(target)) !== 'first') return false
      const updates = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          store.put(target, `replacement-${i}`, { ifMatchEtag: initial.etag }),
        ),
      )
      const winner = updates.findIndex(
        result => result.status === 'fulfilled',
      )
      return (
        updates.filter(result => result.status === 'fulfilled').length
        === 1
        && updates.filter(
          result =>
            result.status === 'rejected'
            && isTBError(result.reason)
            && result.reason.code === 'conflict',
        ).length === 7
        && (await read(target)) === `replacement-${winner}`
      )
    })
    await check('emptyObject', async () => {
      const target = key('empty')
      await store.put(target, new Uint8Array(), { ifNoneMatch: '*' })
      return (
        (await store.head(target))?.size === 0 && (await read(target)) === ''
      )
    })
    await check('streaming', async () => {
      const target = key('stream')
      let index = 0
      await store.put(
        target,
        {
          getReader: () => ({
            read: async () =>
              index++ < 16
                ? {
                    done: false,
                    value: new TextEncoder().encode('stream-part'),
                  }
                : { done: true },
            releaseLock() {},
          }),
        },
        { ifNoneMatch: '*' },
      )
      return (await read(target)) === 'stream-part'.repeat(16)
    })
    await check('specialKeys', async () => {
      for (const name of [
        '特殊 空格+%?#&<>.txt',
        'encoded%2Fslash.txt',
        'quotes\'".txt',
      ]) {
        const target = key(`keys/${name}`)
        await store.put(target, name, { ifNoneMatch: '*' })
        if ((await read(target)) !== name) return false
      }
      return true
    })
    await check('pagination', async () => {
      const found = new Set<string>()
      const cursors = new Set<string>()
      let cursor: string | undefined
      do {
        const page = await store.list(prefix, { cursor, limit: 2 })
        for (const item of page.items) {
          if (!('key' in item) || found.has(item.key)) return false
          found.add(item.key)
        }
        cursor = page.cursor
        if (cursor) {
          if (cursors.has(cursor) || cursors.size > 100) return false
          cursors.add(cursor)
        }
      } while (cursor)
      return (
        found.size === keys.size
        && [...keys].every(item => found.has(item))
        && cursors.size > 0
      )
    })
  } finally {
    for (const target of keys) {
      try {
        await store.delete(target)
        if ((await store.head(target)) !== null) cleanupSucceeded = false
      } catch {
        cleanupSucceeded = false
      }
    }
    store.close()
  }
  return { checks, cleanupSucceeded }
}
