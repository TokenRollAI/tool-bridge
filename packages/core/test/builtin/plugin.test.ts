import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SKRegistryStore } from '../../src/auth/sk'
import {
  createPluginModule,
  type PluginHealthRecord,
  type PluginProbeResult,
  pluginTokenSecretName,
} from '../../src/builtin/plugin'
import type { BuiltinModule } from '../../src/builtin/types'
import { isTBError } from '../../src/errors'
import type { PluginManifest, PluginRegistration } from '../../src/plugin/manifest'
import { base64urlEncode, SecretStoreImpl } from '../../src/secret/secretStore'
import { KEY_PLUGIN, KEY_PLUGIN_HEALTH, KEY_PLUGIN_META, MemoryStateStore } from '../../src/store'
import type { CallContext } from '../../src/types'

const NOW = '2026-07-07T00:00:00.000Z'
const ctx: CallContext = { keyId: 'k', owner: 'user:admin', scopes: [], traceId: 't' }

declare const crypto: { getRandomValues(array: Uint8Array): Uint8Array }

const MANIFEST: PluginManifest = {
  id: 'feishu-docs',
  kind: 'context-provider',
  interfaceVersion: 'context-provider/v1',
  endpoint: 'https://plugin.example.com',
  auth: { kind: 'platform-token' },
  healthPath: '/healthz',
  enabled: true,
}

const DESCRIBE = {
  kind: 'context-provider',
  interfaceVersion: 'context-provider/v1',
  capabilities: ['search'],
}

const HELP = { cmds: ['List', 'Get', 'Update', 'Write', 'Search'].map((name) => ({ name })) }

function makeHarness(
  overrides: {
    probe?: (m: PluginManifest) => Promise<PluginProbeResult>
    describe?: unknown
    help?: unknown
  } = {},
) {
  const store = new MemoryStateStore()
  const sk = new SKRegistryStore(store)
  const secrets = new SecretStoreImpl(
    store,
    base64urlEncode(crypto.getRandomValues(new Uint8Array(32))),
  )
  const probe = vi.fn(overrides.probe ?? (async () => ({ healthy: true })))
  const fetchContract = vi.fn(async () => ({
    describe: overrides.describe ?? DESCRIBE,
    help: overrides.help ?? HELP,
  }))
  const mod: BuiltinModule = createPluginModule({
    store,
    sk,
    secrets,
    now: () => NOW,
    probe,
    fetchContract,
  })
  return { store, sk, secrets, probe, fetchContract, mod }
}

describe('builtin plugin 模块(Proto §8.1/§8.2)', () => {
  let h: ReturnType<typeof makeHarness>

  beforeEach(() => {
    h = makeHarness()
  })

  it('help():cmd 表 = list/get/write/update/delete/health,全 admin scope', () => {
    const help = h.mod.help('system/plugin')
    expect(help.cmds.map((c) => c.name).sort()).toEqual([
      'delete',
      'get',
      'health',
      'list',
      'update',
      'write',
    ])
    expect(help.cmds.every((c) => c.scope === 'admin')).toBe(true)
  })

  it('write 全流程:探活 → 契约校验 → mint pluginToken(platform-token)→ 存 manifest/meta/health', async () => {
    const reg = (await h.mod.dispatch('write', { ...MANIFEST }, ctx)) as PluginRegistration
    expect(reg.pluginToken).toMatch(/^tbk_/)
    expect(h.probe).toHaveBeenCalledTimes(1)
    expect(h.fetchContract).toHaveBeenCalledTimes(1)

    // manifest 落盘 + 内部 tokenSkId;明文进 SecretStore 保留名。
    const stored = (await h.store.get(KEY_PLUGIN + MANIFEST.id)) as { tokenSkId?: string }
    expect(typeof stored.tokenSkId).toBe('string')
    expect(await h.secrets.resolve(pluginTokenSecretName(MANIFEST.id))).toBe(reg.pluginToken)
    // mint 的 SK:owner plugin:<id>,scopes 空。
    const key = await h.sk.get(stored.tokenSkId as string)
    expect(key.owner).toBe(`plugin:${MANIFEST.id}`)
    expect(key.scopes).toEqual([])

    // ~describe 缓存与健康态。
    expect(await h.store.get(KEY_PLUGIN_META + MANIFEST.id)).toEqual(DESCRIBE)
    expect(await h.store.get(KEY_PLUGIN_HEALTH + MANIFEST.id)).toEqual({
      healthy: true,
      checkedAt: NOW,
      consecutiveFailures: 0,
    })
  })

  it('get/list 不回显 pluginToken 与 tokenSkId', async () => {
    await h.mod.dispatch('write', { ...MANIFEST }, ctx)
    const got = (await h.mod.dispatch('get', { id: MANIFEST.id }, ctx)) as Record<string, unknown>
    expect(got).toEqual(MANIFEST)
    const page = (await h.mod.dispatch('list', {}, ctx)) as { items: Record<string, unknown>[] }
    expect(page.items).toEqual([MANIFEST])
  })

  it('重注册换发 pluginToken 并吊销上一代 SK', async () => {
    const first = (await h.mod.dispatch('write', { ...MANIFEST }, ctx)) as PluginRegistration
    const firstSkId = ((await h.store.get(KEY_PLUGIN + MANIFEST.id)) as { tokenSkId: string })
      .tokenSkId
    const second = (await h.mod.dispatch('write', { ...MANIFEST }, ctx)) as PluginRegistration
    expect(second.pluginToken).not.toBe(first.pluginToken)
    await expect(h.sk.get(firstSkId)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'not_found',
    )
    expect(await h.secrets.resolve(pluginTokenSecretName(MANIFEST.id))).toBe(second.pluginToken)
  })

  it('bearer kind 不 mint token(pluginToken 缺省)', async () => {
    const manifest = { ...MANIFEST, auth: { kind: 'bearer', secretRef: 'feishu-cred' } }
    const reg = (await h.mod.dispatch('write', manifest, ctx)) as PluginRegistration
    expect(reg.pluginToken).toBeUndefined()
    expect(await h.secrets.resolve(pluginTokenSecretName(MANIFEST.id))).toBeUndefined()
  })

  it('探活失败 → unavailable(retryable)拒注册,不落盘', async () => {
    const failing = makeHarness({ probe: async () => ({ healthy: false, detail: 'HTTP 500' }) })
    await expect(failing.mod.dispatch('write', { ...MANIFEST }, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'unavailable' && e.retryable === true,
    )
    expect(await failing.store.get(KEY_PLUGIN + MANIFEST.id)).toBeNull()
    expect(failing.fetchContract).not.toHaveBeenCalled()
  })

  it('契约缺必需方法 → invalid_argument 拒注册', async () => {
    const missing = makeHarness({ help: { cmds: [{ name: 'List' }, { name: 'Get' }] } })
    await expect(missing.mod.dispatch('write', { ...MANIFEST }, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'invalid_argument' && e.message.includes('Update'),
    )
    expect(await missing.store.get(KEY_PLUGIN + MANIFEST.id)).toBeNull()
  })

  it('manifest 形状非法 → invalid_argument(不探活)', async () => {
    await expect(h.mod.dispatch('write', { ...MANIFEST, id: 'a/b' }, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'invalid_argument',
    )
    expect(h.probe).not.toHaveBeenCalled()
  })

  it('update:patch 合并后重校验;id 不可变;不回显 token', async () => {
    await h.mod.dispatch('write', { ...MANIFEST }, ctx)
    const updated = (await h.mod.dispatch(
      'update',
      { id: MANIFEST.id, patch: { enabled: false } },
      ctx,
    )) as PluginManifest
    expect(updated).toEqual({ ...MANIFEST, enabled: false })
    await expect(
      h.mod.dispatch('update', { id: MANIFEST.id, patch: { id: 'other' } }, ctx),
    ).rejects.toSatisfy((e) => isTBError(e) && e.code === 'invalid_argument')
    await expect(
      h.mod.dispatch('update', { id: MANIFEST.id, patch: { kind: 'tool-provider' } }, ctx),
    ).rejects.toSatisfy((e) => isTBError(e) && e.code === 'invalid_argument') // interfaceVersion 前缀不符
    await expect(h.mod.dispatch('update', { id: 'nope', patch: {} }, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'not_found',
    )
  })

  it('update:仅本地字段(enabled)变更不重探活/不重抓契约', async () => {
    await h.mod.dispatch('write', { ...MANIFEST }, ctx)
    h.probe.mockClear()
    h.fetchContract.mockClear()
    await h.mod.dispatch('update', { id: MANIFEST.id, patch: { enabled: false } }, ctx)
    expect(h.probe).not.toHaveBeenCalled()
    expect(h.fetchContract).not.toHaveBeenCalled()
  })

  it('update:endpoint 变更 → 重探活 + 重契约校验并刷新 meta/health', async () => {
    await h.mod.dispatch('write', { ...MANIFEST }, ctx)
    h.probe.mockClear()
    h.fetchContract.mockClear()
    const endpoint = 'https://plugin-v2.example.com'
    const updated = (await h.mod.dispatch(
      'update',
      { id: MANIFEST.id, patch: { endpoint } },
      ctx,
    )) as PluginManifest
    expect(updated.endpoint).toBe(endpoint)
    expect(h.probe).toHaveBeenCalledTimes(1)
    expect(h.fetchContract).toHaveBeenCalledTimes(1)
    // probe/fetchContract 收到的是 merge 后的 manifest(打向新 endpoint)。
    expect((h.probe.mock.calls[0]?.[0] as PluginManifest).endpoint).toBe(endpoint)
    expect(await h.store.get(KEY_PLUGIN_META + MANIFEST.id)).toEqual(DESCRIBE)
    expect(await h.store.get(KEY_PLUGIN_HEALTH + MANIFEST.id)).toEqual({
      healthy: true,
      checkedAt: NOW,
      consecutiveFailures: 0,
    })
  })

  it('update:endpoint 变更探活失败 → unavailable 拒更新,不落库', async () => {
    await h.mod.dispatch('write', { ...MANIFEST }, ctx)
    h.probe.mockImplementation(async () => ({ healthy: false, detail: 'HTTP 502' }))
    await expect(
      h.mod.dispatch(
        'update',
        { id: MANIFEST.id, patch: { endpoint: 'https://dead.example.com' } },
        ctx,
      ),
    ).rejects.toSatisfy((e) => isTBError(e) && e.code === 'unavailable' && e.retryable === true)
    const stored = (await h.store.get(KEY_PLUGIN + MANIFEST.id)) as PluginManifest
    expect(stored.endpoint).toBe(MANIFEST.endpoint)
  })

  it('update:auth platform-token → bearer 吊销旧 SK 与明文', async () => {
    await h.mod.dispatch('write', { ...MANIFEST }, ctx)
    const skId = ((await h.store.get(KEY_PLUGIN + MANIFEST.id)) as { tokenSkId: string }).tokenSkId
    const updated = (await h.mod.dispatch(
      'update',
      { id: MANIFEST.id, patch: { auth: { kind: 'bearer', secretRef: 'feishu-cred' } } },
      ctx,
    )) as Record<string, unknown>
    expect(updated.pluginToken).toBeUndefined()
    await expect(h.sk.get(skId)).rejects.toSatisfy((e) => isTBError(e) && e.code === 'not_found')
    expect(await h.secrets.resolve(pluginTokenSecretName(MANIFEST.id))).toBeUndefined()
    expect(
      ((await h.store.get(KEY_PLUGIN + MANIFEST.id)) as { tokenSkId?: string }).tokenSkId,
    ).toBeUndefined()
  })

  it('update:auth bearer → platform-token mint 新 token(仅本响应一次)', async () => {
    await h.mod.dispatch(
      'write',
      { ...MANIFEST, auth: { kind: 'bearer', secretRef: 'feishu-cred' } },
      ctx,
    )
    const updated = (await h.mod.dispatch(
      'update',
      { id: MANIFEST.id, patch: { auth: { kind: 'platform-token' } } },
      ctx,
    )) as PluginRegistration
    expect(updated.pluginToken).toMatch(/^tbk_/)
    expect(await h.secrets.resolve(pluginTokenSecretName(MANIFEST.id))).toBe(updated.pluginToken)
    const stored = (await h.store.get(KEY_PLUGIN + MANIFEST.id)) as { tokenSkId: string }
    const key = await h.sk.get(stored.tokenSkId)
    expect(key.owner).toBe(`plugin:${MANIFEST.id}`)
    // get 不回显。
    const got = (await h.mod.dispatch('get', { id: MANIFEST.id }, ctx)) as Record<string, unknown>
    expect(got.pluginToken).toBeUndefined()
  })

  it('delete:清理 manifest/health/meta/token,幂等静默', async () => {
    await h.mod.dispatch('write', { ...MANIFEST }, ctx)
    const skId = ((await h.store.get(KEY_PLUGIN + MANIFEST.id)) as { tokenSkId: string }).tokenSkId
    await h.mod.dispatch('delete', { id: MANIFEST.id }, ctx)
    expect(await h.store.get(KEY_PLUGIN + MANIFEST.id)).toBeNull()
    expect(await h.store.get(KEY_PLUGIN_HEALTH + MANIFEST.id)).toBeNull()
    expect(await h.store.get(KEY_PLUGIN_META + MANIFEST.id)).toBeNull()
    expect(await h.secrets.resolve(pluginTokenSecretName(MANIFEST.id))).toBeUndefined()
    await expect(h.sk.get(skId)).rejects.toSatisfy((e) => isTBError(e) && e.code === 'not_found')
    // 重复 delete 幂等。
    await expect(h.mod.dispatch('delete', { id: MANIFEST.id }, ctx)).resolves.toEqual({ ok: true })
  })

  it('health:按需探活,累计 consecutiveFailures,返回 { id, healthy, checkedAt }', async () => {
    let healthy = true
    const flappy = makeHarness({ probe: async () => ({ healthy }) })
    await flappy.mod.dispatch('write', { ...MANIFEST }, ctx)

    healthy = false
    const down = await flappy.mod.dispatch('health', { id: MANIFEST.id }, ctx)
    expect(down).toEqual({ id: MANIFEST.id, healthy: false, checkedAt: NOW })
    await flappy.mod.dispatch('health', { id: MANIFEST.id }, ctx)
    let record = (await flappy.store.get(KEY_PLUGIN_HEALTH + MANIFEST.id)) as PluginHealthRecord
    expect(record.consecutiveFailures).toBe(2)

    healthy = true
    const up = await flappy.mod.dispatch('health', { id: MANIFEST.id }, ctx)
    expect(up).toEqual({ id: MANIFEST.id, healthy: true, checkedAt: NOW })
    record = (await flappy.store.get(KEY_PLUGIN_HEALTH + MANIFEST.id)) as PluginHealthRecord
    expect(record.consecutiveFailures).toBe(0)

    await expect(flappy.mod.dispatch('health', { id: 'nope' }, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'not_found',
    )
  })

  it('未知 cmd → invalid_argument', async () => {
    await expect(h.mod.dispatch('probe', {}, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'invalid_argument',
    )
  })
})
