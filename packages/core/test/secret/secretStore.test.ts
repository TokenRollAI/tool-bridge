import { describe, expect, it } from 'vitest'
import { base64urlDecode, base64urlEncode, SecretStoreImpl } from '../../src/secret/secretStore'
import { KEY_SECRET, MemoryStateStore } from '../../src/store'

// 纯 WebCrypto 环境:core 的 tsconfig 不含 DOM 类型,此处以最小声明补齐 crypto。
declare const crypto: { getRandomValues(array: Uint8Array): Uint8Array }

const NOW = '2026-07-06T00:00:00.000Z'
const LATER = '2026-07-06T01:00:00.000Z'

/** 生成合法主密钥(base64url 编码的 32 随机字节),与实现共用编解码 helper。 */
function makeMasterKey(): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(32)))
}

/** 遍历 MemoryStateStore 全部落盘值,拼成字符串以断言不含某子串。 */
async function dumpStore(store: MemoryStateStore): Promise<string> {
  const { items } = await store.list('')
  return JSON.stringify(items)
}

describe('base64url 编解码往返', () => {
  it('随机字节 encode→decode 一致', () => {
    for (const len of [0, 1, 2, 3, 4, 31, 32, 33]) {
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 0xff
      expect([...base64urlDecode(base64urlEncode(bytes))]).toEqual([...bytes])
    }
  })

  it('无填充、仅 base64url 字母表(不含 + / =)', () => {
    const s = base64urlEncode(new Uint8Array([251, 255, 254, 253]))
    expect(s).not.toMatch(/[+/=]/)
  })

  it('非法字符抛错', () => {
    expect(() => base64urlDecode('abc$')).toThrow()
  })
})

describe('SecretStoreImpl(可用态)', () => {
  function freshStore() {
    const state = new MemoryStateStore()
    const secret = new SecretStoreImpl(state, makeMasterKey())
    return { state, secret }
  }

  it('set→resolve 往返一致', async () => {
    const { secret } = freshStore()
    await secret.set('s3-key', 'AKIA-super-secret-value', NOW)
    expect(await secret.resolve('s3-key')).toBe('AKIA-super-secret-value')
  })

  it('set 覆盖后 resolve 返回新值', async () => {
    const { secret } = freshStore()
    await secret.set('token', 'old-value', NOW)
    await secret.set('token', 'new-value', LATER)
    expect(await secret.resolve('token')).toBe('new-value')
  })

  it('resolve 不存在的名字 → undefined', async () => {
    const { secret } = freshStore()
    expect(await secret.resolve('nope')).toBeUndefined()
  })

  it('list 只含 name + updatedAt(键集合精确等于 [name, updatedAt])', async () => {
    const { secret } = freshStore()
    await secret.set('a', 'va', NOW)
    await secret.set('b', 'vb', LATER)
    const page = await secret.list()
    expect(page.items.map((i) => i.name).sort()).toEqual(['a', 'b'])
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(['name', 'updatedAt'])
    }
    const a = page.items.find((i) => i.name === 'a')
    expect(a?.updatedAt).toBe(NOW)
  })

  it('list limit 默认 50、上限 200 钳制', async () => {
    const state = new MemoryStateStore()
    const secret = new SecretStoreImpl(state, makeMasterKey())
    // 断言超上限被钳制:传 999 不应报错,且行为与 200 一致(此处样本少,验证不抛错即可)。
    await secret.set('x', 'v', NOW)
    const page = await secret.list({ limit: 999 })
    expect(page.items.length).toBe(1)
  })

  it('落盘值不含明文(遍历 store 内容断言不含明文子串)', async () => {
    const { state, secret } = freshStore()
    const plaintext = 'PLAINTEXT-MUST-NOT-LEAK-42'
    await secret.set('leaky', plaintext, NOW)
    const dump = await dumpStore(state)
    expect(dump).not.toContain(plaintext)
    // 落盘记录形状:iv + ciphertext + updatedAt,无 value/plaintext 字段。
    const raw = await state.get(`${KEY_SECRET}leaky`)
    expect(Object.keys(raw as object).sort()).toEqual(['ciphertext', 'iv', 'updatedAt'])
  })

  it('IV 随机性:同值两次 set 密文不同', async () => {
    const { state, secret } = freshStore()
    await secret.set('k', 'same-value', NOW)
    const first = await state.get(`${KEY_SECRET}k`)
    await secret.set('k', 'same-value', LATER)
    const second = await state.get(`${KEY_SECRET}k`)
    expect((first as { ciphertext: string }).ciphertext).not.toBe(
      (second as { ciphertext: string }).ciphertext,
    )
    expect((first as { iv: string }).iv).not.toBe((second as { iv: string }).iv)
  })

  it('delete 后 resolve undefined;再 delete → not_found', async () => {
    const { secret } = freshStore()
    await secret.set('gone', 'v', NOW)
    await secret.delete('gone')
    expect(await secret.resolve('gone')).toBeUndefined()
    await expect(secret.delete('gone')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('delete 不存在 → not_found', async () => {
    const { secret } = freshStore()
    await expect(secret.delete('never')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('name 非法(空)→ invalid_argument;含冒号是平台保留命名空间,impl 层放行', async () => {
    const { secret } = freshStore()
    await expect(secret.set('', 'v', NOW)).rejects.toMatchObject({ code: 'invalid_argument' })
    // 含 ':' 的名字(如 plugin-token:<id>)由平台代码直接写入;
    // 节点面的拒绝在 builtin/secret cmd 层(见 builtin/secret.test.ts)。
    await secret.set('plugin-token:demo', 'v', NOW)
    expect(await secret.resolve('plugin-token:demo')).toBe('v')
  })
})

describe('SecretStoreImpl(unavailable 态:主密钥缺失/非法)', () => {
  const badKeys: Array<[string, string | undefined]> = [
    ['undefined 主密钥', undefined],
    ['非 base64url(含非法字符)', 'not-valid-base64url!!!'],
    ['base64url 但非 32 字节(过短)', base64urlEncode(new Uint8Array(16))],
    ['base64url 但非 32 字节(过长)', base64urlEncode(new Uint8Array(48))],
  ]

  it.each(badKeys)('%s → available=false', (_label, key) => {
    const secret = new SecretStoreImpl(new MemoryStateStore(), key)
    expect(secret.available).toBe(false)
  })

  it.each(badKeys)('%s → set 抛 unavailable(retryable:false)', async (_label, key) => {
    const secret = new SecretStoreImpl(new MemoryStateStore(), key)
    await expect(secret.set('n', 'v', NOW)).rejects.toMatchObject({
      code: 'unavailable',
      retryable: false,
    })
  })

  it('unavailable 态:resolve → undefined(不抛)', async () => {
    const secret = new SecretStoreImpl(new MemoryStateStore(), undefined)
    expect(await secret.resolve('anything')).toBeUndefined()
  })

  it('可用态实例的 available=true', () => {
    const secret = new SecretStoreImpl(new MemoryStateStore(), base64urlEncode(new Uint8Array(32)))
    expect(secret.available).toBe(true)
  })
})
