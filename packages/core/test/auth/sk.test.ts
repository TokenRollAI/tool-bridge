import { beforeEach, describe, expect, it } from 'vitest'
import type { SecretKey, SecretKeyInput } from '../../src/types'
import {
  adminBootstrapInput,
  generateSecret,
  identify,
  isKeyActive,
  mintKey,
  projectKey,
  sha256Hex,
  SKRegistryStore,
} from '../../src/auth/sk'
import { KEY_SK_HASH, KEY_SK_ID, MemoryStateStore } from '../../src/store'
import { isTBError } from '../../src/errors'

const NOW = '2026-07-06T00:00:00.000Z'
const PAST = '2026-07-05T00:00:00.000Z'
const FUTURE = '2026-07-07T00:00:00.000Z'

const input = (over: Partial<SecretKeyInput> = {}): SecretKeyInput => ({
  owner: 'user:alice',
  scopes: [{ pattern: 'docs/**', actions: ['read'] }],
  ...over,
})

describe('sha256Hex(WebCrypto,无宿主依赖)', () => {
  it('与已知向量一致(空串)', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('确定性:同输入同输出', async () => {
    expect(await sha256Hex('abc')).toBe(await sha256Hex('abc'))
    expect(await sha256Hex('abc')).not.toBe(await sha256Hex('abd'))
  })
})

describe('generateSecret', () => {
  it('带 tbk_ 前缀且每次不同', () => {
    const a = generateSecret()
    const b = generateSecret()
    expect(a.startsWith('tbk_')).toBe(true)
    expect(a).not.toBe(b)
  })

  it('熵段为 base64url 字符集', () => {
    const body = generateSecret().slice('tbk_'.length)
    expect(body).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(body.length).toBeGreaterThanOrEqual(21)
  })
})

describe('mintKey / projectKey', () => {
  it('mintKey:hash = sha256(secret),createdAt = now', async () => {
    const { key, secret } = await mintKey(input(), NOW)
    expect(key.hash).toBe(await sha256Hex(secret))
    expect(key.createdAt).toBe(NOW)
    expect(key.owner).toBe('user:alice')
    expect(key.id).toBeTypeOf('string')
  })

  it('mintKey:透传 registerPaths/description/expiresAt', async () => {
    const { key } = await mintKey(
      input({ registerPaths: ['device/x'], description: 'd', expiresAt: FUTURE }),
      NOW,
    )
    expect(key.registerPaths).toEqual(['device/x'])
    expect(key.description).toBe('d')
    expect(key.expiresAt).toBe(FUTURE)
  })

  it('projectKey:剥离 hash,保留其余字段', async () => {
    const { key } = await mintKey(input(), NOW)
    const projected = projectKey(key)
    expect('hash' in projected).toBe(false)
    expect(projected.id).toBe(key.id)
    expect(projected.owner).toBe(key.owner)
  })
})

describe('adminBootstrapInput(Case 1)', () => {
  it('owner user:admin,全动作 ** scope', () => {
    const boot = adminBootstrapInput()
    expect(boot.owner).toBe('user:admin')
    expect(boot.scopes).toEqual([
      { pattern: '**', actions: ['read', 'write', 'call', 'register', 'admin'] },
    ])
  })
})

describe('isKeyActive(disabled / expiresAt 过期视同禁用)', () => {
  const base: SecretKey = {
    id: 'k',
    hash: 'h',
    owner: 'user:alice',
    scopes: [],
    createdAt: PAST,
  }

  it('未禁用未过期 → true', () => {
    expect(isKeyActive(base, NOW)).toBe(true)
    expect(isKeyActive({ ...base, expiresAt: FUTURE }, NOW)).toBe(true)
  })

  it('disabled:true → false', () => {
    expect(isKeyActive({ ...base, disabled: true }, NOW)).toBe(false)
  })

  it('expiresAt 已过 → false', () => {
    expect(isKeyActive({ ...base, expiresAt: PAST }, NOW)).toBe(false)
  })
})

describe('SKRegistryStore(SKRegistry 语义)', () => {
  let store: MemoryStateStore
  let reg: SKRegistryStore

  beforeEach(() => {
    store = new MemoryStateStore()
    reg = new SKRegistryStore(store)
  })

  it('write:返回无 hash 的 key + 一次性 secret;两条 KV 记录写入', async () => {
    const { key, secret } = await reg.write(input(), NOW)
    expect('hash' in key).toBe(false)
    expect(secret.startsWith('tbk_')).toBe(true)
    const hashRec = (await store.get(KEY_SK_HASH + (await sha256Hex(secret)))) as SecretKey
    expect(hashRec.id).toBe(key.id)
    expect(await store.get(KEY_SK_ID + key.id)).toBe(await sha256Hex(secret))
  })

  it('write:明文 secret 不落任何 store 记录(仅一次)', async () => {
    const { secret } = await reg.write(input(), NOW)
    const all = await store.list('')
    for (const { value } of all.items) {
      expect(JSON.stringify(value)).not.toContain(secret)
    }
  })

  it('get:存在返回投影(无 hash);不存在 → not_found', async () => {
    const { key } = await reg.write(input(), NOW)
    const got = await reg.get(key.id)
    expect(got.id).toBe(key.id)
    expect('hash' in got).toBe(false)
    await expect(reg.get('nope')).rejects.toSatisfy(e => isTBError(e) && e.code === 'not_found')
  })

  it('list:枚举已签发 key(裁掉 hash)', async () => {
    await reg.write(input({ owner: 'user:a' }), NOW)
    await reg.write(input({ owner: 'user:b' }), NOW)
    const page = await reg.list()
    expect(page.items.length).toBe(2)
    for (const k of page.items) expect('hash' in k).toBe(false)
  })

  it('update:disabled patch 后 identify 返回 null', async () => {
    const { key, secret } = await reg.write(input(), NOW)
    expect(await identify(store, secret, NOW)).not.toBeNull()
    await reg.update(key.id, { disabled: true })
    expect(await identify(store, secret, NOW)).toBeNull()
  })

  it('update:scopes / expiresAt patch 生效', async () => {
    const { key } = await reg.write(input(), NOW)
    const updated = await reg.update(key.id, {
      scopes: [{ pattern: '**', actions: ['admin'] }],
      expiresAt: FUTURE,
    })
    expect(updated.scopes).toEqual([{ pattern: '**', actions: ['admin'] }])
    expect(updated.expiresAt).toBe(FUTURE)
  })

  it('update:注入 hash/id/createdAt 被忽略,原 secret 仍可 identify(不可变字段)', async () => {
    const { key, secret } = await reg.write(input(), NOW)
    const origHash = await sha256Hex(secret)
    // patch 携带不可变字段(hash/id/createdAt):update 只覆盖白名单字段,三者应被丢弃。
    const updated = await reg.update(key.id, {
      description: 'patched',
      hash: 'forged-hash',
      id: 'forged-id',
      createdAt: FUTURE,
    } as never)
    expect(updated.id).toBe(key.id)
    expect(updated.createdAt).toBe(NOW)
    expect(updated.description).toBe('patched')
    // 原 secret 的 identify 仍成立:hash 未被伪造值改写(仍以 origHash 落库)。
    expect(await store.get(KEY_SK_HASH + origHash)).not.toBeNull()
    expect(await store.get(`${KEY_SK_HASH}forged-hash`)).toBeNull()
    const ctx = await identify(store, secret, NOW)
    expect(ctx?.keyId).toBe(key.id)
  })

  it('update:不存在 → not_found', async () => {
    await expect(reg.update('nope', { disabled: true })).rejects.toSatisfy(
      e => isTBError(e) && e.code === 'not_found',
    )
  })

  it('delete:两条记录都删除,之后 identify 返回 null', async () => {
    const { key, secret } = await reg.write(input(), NOW)
    await reg.delete(key.id)
    expect(await store.get(KEY_SK_ID + key.id)).toBeNull()
    expect(await store.get(KEY_SK_HASH + (await sha256Hex(secret)))).toBeNull()
    expect(await identify(store, secret, NOW)).toBeNull()
  })
})

describe('identify(mint→identify 往返,CallContext)', () => {
  let store: MemoryStateStore
  let reg: SKRegistryStore

  beforeEach(() => {
    store = new MemoryStateStore()
    reg = new SKRegistryStore(store)
  })

  it('有效 SK → CallContext(keyId/owner/scopes/traceId)', async () => {
    const { key, secret } = await reg.write(input(), NOW)
    const ctx = await identify(store, secret, NOW)
    expect(ctx).not.toBeNull()
    expect(ctx?.keyId).toBe(key.id)
    expect(ctx?.owner).toBe('user:alice')
    expect(ctx?.scopes).toEqual(input().scopes)
    expect(ctx?.traceId).toBeTypeOf('string')
  })

  it('剥离 Authorization 的 "Bearer " 前缀', async () => {
    const { secret } = await reg.write(input(), NOW)
    expect(await identify(store, `Bearer ${secret}`, NOW)).not.toBeNull()
  })

  it('缺失 bearer → null', async () => {
    expect(await identify(store, undefined, NOW)).toBeNull()
    expect(await identify(store, '', NOW)).toBeNull()
  })

  it('查无此 SK → null', async () => {
    expect(await identify(store, 'tbk_unknown', NOW)).toBeNull()
  })

  it('过期 SK → null', async () => {
    const { secret } = await reg.write(input({ expiresAt: PAST }), NOW)
    expect(await identify(store, secret, NOW)).toBeNull()
  })
})
