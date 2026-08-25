import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import {
  DEFAULT_STORE_DRIVER_KEY_ROOT,
  type ObjectBodyStream,
  readStreamText,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDataObjectStore } from '../src/objects'

const cleanups: string[] = []

afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-object-store-'))
  cleanups.push(dir)
  return dir
}

function deferred(): { promise: Promise<void>, resolve: () => void } {
  let resolve = () => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }
  throw lastError
}

describe('createDataObjectStore 流式原子写', () => {
  it('逐块背压写同目录临时文件，完整前最终 key 不可见', async () => {
    const dataDir = tempDataDir()
    const store = createDataObjectStore(dataDir)
    const continueRead = deferred()
    const first = new Uint8Array(1024 * 1024).fill(0x61)
    const second = new Uint8Array(1024 * 1024).fill(0x62)
    let reads = 0
    const stream: ObjectBodyStream = {
      getReader() {
        return {
          async read() {
            reads++
            if (reads === 1) return { done: false, value: first }
            if (reads === 2) {
              await continueRead.promise
              return { done: false, value: second }
            }
            return { done: true }
          },
          releaseLock() {},
        }
      },
    }

    const writing = store.put('video/large.bin', stream)
    const parent = join(dataDir, 'objects', 'video')
    await eventually(() => {
      const names = readdirSync(parent)
      expect(names).toHaveLength(1)
      expect(names[0]).toMatch(/^\.tb-object-upload-.*\.tmp$/)
      expect(statSync(join(parent, names[0] as string)).size).toBe(first.byteLength)
      expect(names).not.toContain('large.bin')
    })

    // 若先 readStreamBytes 聚合，这里不会先出现已写入首块的临时文件；
    // 不约束事件循环此刻是否已经发起下一次 read()。
    expect(reads).toBeGreaterThanOrEqual(1)
    expect(await store.head('video/large.bin')).toBeNull()
    continueRead.resolve()

    const meta = await writing
    expect(meta.size).toBe(first.byteLength + second.byteLength)
    expect(readdirSync(parent)).toEqual(['large.bin'])
  })

  it('Store 写入使用独立 staging 目录，提交后才原子落位', async () => {
    const dataDir = tempDataDir()
    const store = createDataObjectStore(dataDir)
    const continueRead = deferred()
    let reads = 0
    const objectKey = `${DEFAULT_STORE_DRIVER_KEY_ROOT}/aa/object-id`
    const writing = store.put(objectKey, {
      getReader() {
        return {
          async read() {
            reads++
            if (reads === 1) return { done: false, value: new Uint8Array([1, 2]) }
            if (reads === 2) await continueRead.promise
            return { done: true }
          },
          releaseLock() {},
        }
      },
    }, { ifNoneMatch: '*' })
    const staging = join(dataDir, 'objects', '.tb-store-staging-v1')
    await eventually(() => {
      expect(readdirSync(staging)).toHaveLength(1)
    })
    expect(await store.head(objectKey)).toBeNull()
    continueRead.resolve()
    await writing
    expect(readdirSync(staging)).toHaveLength(0)
    expect((await store.head(objectKey))?.size).toBe(2)
  })

  it('get 对大对象返回逐块文件流，不把整段视频先读进内存', async () => {
    const store = createDataObjectStore(tempDataDir())
    const bytes = new Uint8Array(2 * 1024 * 1024).fill(0x61)
    await store.put('video/read.bin', bytes)

    const got = await store.get('video/read.bin')
    expect(got?.meta.size).toBe(bytes.byteLength)
    const reader = got!.body.getReader()
    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(first.value?.byteLength).toBeGreaterThan(0)
    expect(first.value?.byteLength).toBeLessThan(bytes.byteLength)
    await reader.cancel?.()
    reader.releaseLock()
  })

  it('流读取失败会关闭并清除临时文件，不留下半成品', async () => {
    const dataDir = tempDataDir()
    const store = createDataObjectStore(dataDir)
    let reads = 0
    let released = false
    const stream: ObjectBodyStream = {
      getReader() {
        return {
          async read() {
            reads++
            if (reads === 1) return { done: false, value: new Uint8Array([1, 2, 3]) }
            throw new Error('upstream disconnected')
          },
          releaseLock() {
            released = true
          },
        }
      },
    }

    await expect(store.put('failed/blob.bin', stream)).rejects.toThrow('upstream disconnected')
    expect(released).toBe(true)
    expect(await store.head('failed/blob.bin')).toBeNull()
    expect(readdirSync(join(dataDir, 'objects', 'failed'))).toEqual([])
  })

  it('并发 create-only 原子竞争只有一个成功，默认写仍明确覆盖', async () => {
    const store = createDataObjectStore(tempDataDir())
    const createOnly = { ifNoneMatch: '*' } as const
    const results = await Promise.allSettled([
      store.put('captures/photo.jpg', new Uint8Array([1]), createOnly),
      store.put('captures/photo.jpg', new Uint8Array([2]), createOnly),
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected')
    expect(rejected).toMatchObject({ reason: { code: 'conflict' } })

    const created = await store.get('captures/photo.jpg')
    expect(created).not.toBeNull()
    expect([String.fromCharCode(1), String.fromCharCode(2)]).toContain(
      await readStreamText(created!.body),
    )

    await store.put('captures/photo.jpg', 'overwritten')
    const overwritten = await store.get('captures/photo.jpg')
    expect(await readStreamText(overwritten!.body)).toBe('overwritten')
  })

  it('string、Uint8Array 与 ArrayBuffer 保持兼容', async () => {
    const store = createDataObjectStore(tempDataDir())
    await store.put('compat/string.txt', 'hello')
    await store.put('compat/bytes.bin', new Uint8Array([1, 2, 3]))
    await store.put('compat/buffer.bin', new Uint8Array([4, 5, 6]).buffer)

    expect(await readStreamText((await store.get('compat/string.txt'))!.body)).toBe('hello')
    expect((await store.head('compat/bytes.bin'))?.size).toBe(3)
    expect((await store.head('compat/buffer.bin'))?.size).toBe(3)
  })

  it('mkdir 前拒绝 symlink 逃逸，不在根外创建目录或临时文件', async () => {
    const dataDir = tempDataDir()
    const outside = tempDataDir()
    const store = createDataObjectStore(dataDir)
    symlinkSync(outside, join(dataDir, 'objects', 'escape'), 'dir')

    await expect(store.put('escape/nested/blob.bin', 'nope')).rejects.toMatchObject({
      code: 'invalid_argument',
    })
    expect(existsSync(join(outside, 'nested'))).toBe(false)
  })

  it('cleanupStaging 只扫独立 Store staging，不递归遍历对象树', async () => {
    const dataDir = tempDataDir()
    const store = createDataObjectStore(dataDir)
    const staging = join(dataDir, 'objects', '.tb-store-staging-v1')
    const shard = join(dataDir, 'objects', ...DEFAULT_STORE_DRIVER_KEY_ROOT.split('/'), 'AA')
    mkdirSync(staging, { recursive: true })
    mkdirSync(shard, { recursive: true })
    const old = join(staging, '.tb-object-upload-00000000-0000-4000-8000-000000000001.tmp')
    const fresh = join(staging, '.tb-object-upload-00000000-0000-4000-8000-000000000002.tmp')
    const ordinary = join(shard, 'ordinary-object')
    writeFileSync(old, 'old')
    writeFileSync(fresh, 'fresh')
    writeFileSync(ordinary, 'ready')
    utimesSync(old, new Date('2026-08-25T00:00:00.000Z'), new Date('2026-08-25T00:00:00.000Z'))
    utimesSync(fresh, new Date('2026-08-25T00:02:00.000Z'), new Date('2026-08-25T00:02:00.000Z'))

    await expect(store.cleanupStaging?.(
      `${DEFAULT_STORE_DRIVER_KEY_ROOT}/`,
      '2026-08-25T00:01:00.000Z',
    )).resolves.toBe(1)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(ordinary)).toBe(true)
  })
})
