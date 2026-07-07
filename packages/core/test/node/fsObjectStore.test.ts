import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createObjectContextProvider } from '../../src/context/objectProvider'
import { type ObjectMeta, readStreamText } from '../../src/context/objectStore'
import { isTBError } from '../../src/errors'
import { FsObjectStore } from '../../src/node/fsObjectStore'

/** 执行并返回 TBError code(未抛/正常完成 → null)。 */
async function codeOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (e) {
    return isTBError(e) ? e.code : `非TBError:${String(e)}`
  }
}

let base: string
let rootA: string // basename: roota
let rootB: string // basename: rootb
let outside: string // 根外目录(symlink 逃逸目标)

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'tb-fsstore-'))
  rootA = join(base, 'roota')
  rootB = join(base, 'rootb')
  outside = join(base, 'outside')
  await mkdir(rootA, { recursive: true })
  await mkdir(rootB, { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(outside, 'secret.txt'), 'secret')
})

afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('构造', () => {
  it('根 basename 冲突 → invalid_argument(正常应由 hello 校验先拒)', async () => {
    const other = join(base, 'nested', 'roota')
    await mkdir(other, { recursive: true })
    expect(await codeOf(async () => new FsObjectStore([rootA, other]))).toBe('invalid_argument')
  })

  it('空 roots → invalid_argument', async () => {
    expect(await codeOf(async () => new FsObjectStore([]))).toBe('invalid_argument')
  })
})

describe('put/head/get/delete 往返(真实文件系统)', () => {
  it('put → head/get:key 首段 = root basename,etag put 后稳定', async () => {
    const store = new FsObjectStore([rootA])
    const meta = await store.put('roota/docs/a.md', 'hello')
    expect(meta.key).toBe('roota/docs/a.md')
    expect(meta.size).toBe(5)
    expect(meta.metadata).toEqual({})
    const head = await store.head('roota/docs/a.md')
    expect(head?.etag).toBe(meta.etag) // mtime+size 派生:put 后 stat 即稳定
    const got = await store.get('roota/docs/a.md')
    expect(got?.meta.etag).toBe(meta.etag)
    if (got === null) throw new Error('expected object')
    expect(await readStreamText(got.body)).toBe('hello')
  })

  it('覆写(内容不同)→ etag 变化', async () => {
    const store = new FsObjectStore([rootA])
    const first = await store.put('roota/etag.txt', 'v1')
    const second = await store.put('roota/etag.txt', 'v2-longer')
    expect(second.etag).not.toBe(first.etag)
  })

  it('ifMatchEtag:匹配放行、不匹配/不存在 → conflict', async () => {
    const store = new FsObjectStore([rootA])
    const meta = await store.put('roota/cas.txt', 'v1')
    await store.put('roota/cas.txt', 'v2!!', { ifMatchEtag: meta.etag })
    expect(await codeOf(() => store.put('roota/cas.txt', 'v3', { ifMatchEtag: meta.etag }))).toBe(
      'conflict',
    )
    expect(await codeOf(() => store.put('roota/none.txt', 'x', { ifMatchEtag: 'nope' }))).toBe(
      'conflict',
    )
  })

  it('不存在 → head/get null;delete 幂等;目录不是对象', async () => {
    const store = new FsObjectStore([rootA])
    expect(await store.head('roota/nope.txt')).toBeNull()
    expect(await store.get('roota/nope.txt')).toBeNull()
    await store.delete('roota/nope.txt') // 不抛
    await store.put('roota/dir/f.txt', 'x')
    expect(await store.head('roota/dir')).toBeNull() // 目录
    await store.delete('roota/dir') // no-op
    expect(await store.head('roota/dir/f.txt')).not.toBeNull()
  })

  it('未知根 / 只有根段:读 null、写 invalid_argument', async () => {
    const store = new FsObjectStore([rootA])
    expect(await store.head('unknown/x.txt')).toBeNull()
    expect(await store.head('roota')).toBeNull()
    expect(await codeOf(() => store.put('unknown/x.txt', 'x'))).toBe('invalid_argument')
    expect(await codeOf(() => store.put('roota', 'x'))).toBe('invalid_argument')
  })
})

describe('穿越与 symlink 逃逸拒绝', () => {
  it('字面穿越 → invalid_argument(normalizeEntryPath)', async () => {
    const store = new FsObjectStore([rootA])
    for (const key of ['roota/../outside/secret.txt', '../x', '/abs', 'roota/%2e%2e/x']) {
      expect(await codeOf(() => store.get(key)), `应拒绝:'${key}'`).toBe('invalid_argument')
      expect(await codeOf(() => store.put(key, 'x')), `应拒绝:'${key}'`).toBe('invalid_argument')
    }
  })

  it('symlink 文件指向根外 → invalid_argument(读/写/删全拒)', async () => {
    const store = new FsObjectStore([rootA])
    await symlink(join(outside, 'secret.txt'), join(rootA, 'leak.txt'))
    expect(await codeOf(() => store.head('roota/leak.txt'))).toBe('invalid_argument')
    expect(await codeOf(() => store.get('roota/leak.txt'))).toBe('invalid_argument')
    expect(await codeOf(() => store.put('roota/leak.txt', 'x'))).toBe('invalid_argument')
    expect(await codeOf(() => store.delete('roota/leak.txt'))).toBe('invalid_argument')
  })

  it('symlink 目录指向根外 → 目录下条目全拒(含不存在的写目标)', async () => {
    const store = new FsObjectStore([rootA])
    await symlink(outside, join(rootA, 'leakdir'))
    expect(await codeOf(() => store.get('roota/leakdir/secret.txt'))).toBe('invalid_argument')
    expect(await codeOf(() => store.put('roota/leakdir/new.txt', 'x'))).toBe('invalid_argument')
  })

  it('根内 symlink(不逃逸)放行', async () => {
    const store = new FsObjectStore([rootA])
    await store.put('roota/real.txt', 'inside')
    await symlink(join(rootA, 'real.txt'), join(rootA, 'alias.txt'))
    const got = await store.get('roota/alias.txt')
    if (got === null) throw new Error('expected object')
    expect(await readStreamText(got.body)).toBe('inside')
  })

  it('list 静默跳过逃逸 symlink', async () => {
    const store = new FsObjectStore([rootA])
    const { items } = await store.list('roota/leak')
    const keys = items.map((i) => ('key' in i ? i.key : i.prefix))
    expect(keys).toEqual([]) // leak.txt / leakdir 均被跳过
  })
})

describe('contentType 按扩展名推断(objectProvider 内联判定依赖)', () => {
  const cases: Array<[string, string]> = [
    ['a.txt', 'text/plain'],
    ['a.md', 'text/markdown'],
    ['a.json', 'application/json'],
    ['a.js', 'text/javascript'],
    ['a.ts', 'text/x-typescript'],
    ['a.html', 'text/html'],
    ['a.css', 'text/css'],
    ['a.xml', 'text/xml'],
    ['a.yaml', 'text/yaml'],
    ['a.yml', 'text/yaml'],
    ['a.csv', 'text/csv'],
  ]

  it('已知文本扩展名 → 对应 mime(head/get/list 一致;扩展名大小写不敏感)', async () => {
    const store = new FsObjectStore([rootA])
    for (const [name, expected] of cases) {
      const key = `roota/ct/${name}`
      const meta = await store.put(key, 'x')
      expect(meta.contentType, key).toBe(expected)
      expect((await store.head(key))?.contentType, key).toBe(expected)
      expect((await store.get(key))?.meta.contentType, key).toBe(expected)
    }
    const upper = await store.put('roota/ct/UPPER.TXT', 'x')
    expect(upper.contentType).toBe('text/plain')
    const { items } = await store.list('roota/ct/')
    for (const item of items) {
      if (!('key' in item)) continue
      expect(item.contentType, item.key).toBeDefined()
    }
  })

  it('未知扩展名 / 无扩展名 / dotfile → application/octet-stream', async () => {
    const store = new FsObjectStore([rootA])
    for (const name of ['blob.bin', 'noext', '.dotfile']) {
      const meta = await store.put(`roota/ct2/${name}`, 'x')
      expect(meta.contentType, name).toBe('application/octet-stream')
    }
  })

  it('回归:文本文件经 objectProvider Get 走内联(不判 $ref → 设备场景不再 503)', async () => {
    const store = new FsObjectStore([rootA])
    await store.put('roota/inline/note.txt', 'hello inline')
    await store.put('roota/inline/data.json', '{"n":1}')
    const provider = createObjectContextProvider(store, { nsPath: 'device/d1/fs' })
    const txt = await provider.Get('roota/inline/note.txt')
    expect(txt.content).toBe('hello inline') // 内联原文,而非 { $ref } / unavailable
    const json = await provider.Get('roota/inline/data.json')
    expect(json.content).toEqual({ n: 1 }) // application/json → 解析后内联
  })
})

describe('list:多根、delimiter 折叠、分页', () => {
  async function seededStore(): Promise<FsObjectStore> {
    const store = new FsObjectStore([rootA, rootB])
    await store.put('roota/list/a.txt', '1')
    await store.put('roota/list/sub/b.txt', '2')
    await store.put('rootb/c.txt', '3')
    return store
  }

  it('多根命名空间:prefix "" 走全部根;根缺文件视同空', async () => {
    const store = await seededStore()
    const { items } = await store.list('')
    const keys = items.filter((i): i is ObjectMeta => 'key' in i).map((i) => i.key)
    expect(keys).toContain('roota/list/a.txt')
    expect(keys).toContain('rootb/c.txt')
  })

  it('delimiter 折叠共同子前缀', async () => {
    const store = await seededStore()
    const { items } = await store.list('roota/list/', { delimiter: '/' })
    expect(items).toEqual([
      expect.objectContaining({ key: 'roota/list/a.txt' }),
      { prefix: 'roota/list/sub/' },
    ])
  })

  it('cursor 分页遍历完整且不重复', async () => {
    const store = await seededStore()
    const first = await store.list('roota/list/', { limit: 1 })
    expect(first.items).toHaveLength(1)
    expect(first.cursor).toBeDefined()
    const second = await store.list('roota/list/', { limit: 5, cursor: first.cursor })
    const all = [...first.items, ...second.items].map((i) => ('key' in i ? i.key : i.prefix))
    expect(all).toEqual(['roota/list/a.txt', 'roota/list/sub/b.txt'])
    expect(second.cursor).toBeUndefined()
  })

  it('根目录不存在 → 空结果(不抛)', async () => {
    const missing = join(base, 'ghost')
    const store = new FsObjectStore([missing])
    expect((await store.list('')).items).toEqual([])
    expect(await codeOf(() => store.head('ghost/x'))).toBe('unavailable')
  })

  it('list 结果 key 与真实路径一致(realpath 根下)', async () => {
    // mkdtemp 在 macOS 返回 /var/...(/private/var 的 symlink):校验 realpath 归一不误伤
    expect(await realpath(rootA)).toBeTruthy()
    const store = await seededStore()
    const { items } = await store.list('rootb/')
    expect(items).toEqual([expect.objectContaining({ key: 'rootb/c.txt' })])
  })
})
