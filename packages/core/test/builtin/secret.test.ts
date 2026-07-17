import { beforeEach, describe, expect, it } from 'vitest'
import type { BuiltinModule } from '../../src/builtin/types'
import type { CallContext } from '../../src/types'
import { base64urlEncode, SecretStoreImpl } from '../../src/secret/secretStore'
import { createSecretModule } from '../../src/builtin/secret'
import { MemoryStateStore } from '../../src/store'
import { isTBError } from '../../src/errors'

const NOW = '2026-07-06T00:00:00.000Z'
const ctx: CallContext = { keyId: 'k', owner: 'user:admin', scopes: [], traceId: 't' }

// 纯 WebCrypto:core tsconfig 不含 DOM 类型,补最小声明。
declare const crypto: { getRandomValues(array: Uint8Array): Uint8Array }

function makeMasterKey(): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(32)))
}

describe('builtin secret 模块', () => {
  let store: MemoryStateStore
  let mod: BuiltinModule

  beforeEach(() => {
    store = new MemoryStateStore()
    mod = createSecretModule(new SecretStoreImpl(store, makeMasterKey()), () => NOW)
  })

  it('help() 只含 set/list/delete(resolve 不暴露为 cmd)且 scope=admin', () => {
    const help = mod.help('system/secret')
    expect(help.cmds.map(c => c.name).sort()).toEqual(['delete', 'list', 'set'])
    expect(help.cmds.some(c => c.name === 'resolve')).toBe(false)
    expect(help.cmds.every(c => c.scope === 'admin')).toBe(true)
  })

  it('set 返回不回显 value;set → list 只见 name + updatedAt;落盘不含明文(只进不出)', async () => {
    const SECRET_VALUE = 'super-secret-upstream-token-42'
    const ack = await mod.dispatch('set', { name: 'ctx7', value: SECRET_VALUE }, ctx)
    expect(JSON.stringify(ack)).not.toContain(SECRET_VALUE)

    const page = (await mod.dispatch('list', {}, ctx)) as {
      items: Array<{ name: string, updatedAt: string }>
    }
    expect(page.items).toEqual([{ name: 'ctx7', updatedAt: NOW }])
    // list 项只有 name + updatedAt,无 value/ciphertext 字段。
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(['name', 'updatedAt'])

    const dump = JSON.stringify((await store.list('')).items)
    expect(dump).not.toContain(SECRET_VALUE)
  })

  it('delete 后 list 为空', async () => {
    await mod.dispatch('set', { name: 'k1', value: 'v1' }, ctx)
    await mod.dispatch('delete', { name: 'k1' }, ctx)
    const page = (await mod.dispatch('list', {}, ctx)) as { items: unknown[] }
    expect(page.items).toHaveLength(0)
  })

  it('未知 cmd → invalid_argument', async () => {
    await expect(mod.dispatch('resolve', { name: 'x' }, ctx)).rejects.toSatisfy(
      e => isTBError(e) && e.code === 'invalid_argument',
    )
  })

  it('含 \':\' 的 name(平台保留命名空间)set/delete 一律拒(plugin-token:<id>)', async () => {
    await expect(
      mod.dispatch('set', { name: 'plugin-token:demo', value: 'v' }, ctx),
    ).rejects.toSatisfy(e => isTBError(e) && e.code === 'invalid_argument')
    await expect(mod.dispatch('delete', { name: 'plugin-token:demo' }, ctx)).rejects.toSatisfy(
      e => isTBError(e) && e.code === 'invalid_argument',
    )
  })

  it('未配置主密钥时 set → unavailable', async () => {
    const disabled = createSecretModule(new SecretStoreImpl(store, undefined), () => NOW)
    await expect(disabled.dispatch('set', { name: 'k', value: 'v' }, ctx)).rejects.toSatisfy(
      e => isTBError(e) && e.code === 'unavailable',
    )
  })
})
