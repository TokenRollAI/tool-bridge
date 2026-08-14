import { describe, expect, it } from 'vitest'
import {
  type BuiltinCatalog,
  canonicalCatalogJson,
  catalogDigest,
  catalogSetDigest,
  KEY_PLUGIN,
  KEY_PLUGIN_META,
  MemoryStateStore,
  type PluginDescribe,
  resolveBuiltinExport,
  resolveExternalExport,
  resolveIntegration,
} from '../../src/index'

/**
 * catalog 解析的语义。重点不是"能不能解析出来",而是**解析函数拿不到写能力**——
 * 此前 `requirePluginExport` 收 `deps`(含可写 state),于是 help/call 这类读操作会写库:
 * 删掉一个 plugin 后随便读一次就复活,且 7 个调用点里传 deps 还是传裸 store 是随手决定的。
 */

const TOOLS_DESCRIBE: PluginDescribe = {
  protocolVersion: 'plugin/v2',
  exports: [{ id: 'actions', profile: 'tools/v1', description: 'demo' }],
}

const MULTI_DESCRIBE: PluginDescribe = {
  protocolVersion: 'plugin/v2',
  exports: [
    { id: 'actions', profile: 'tools/v1' },
    { id: 'documents', profile: 'context/v1', methods: ['Get', 'List'] },
  ],
}

async function catalogOf(entries: Record<string, PluginDescribe>): Promise<BuiltinCatalog> {
  const catalog: BuiltinCatalog = {}
  for (const [id, describe] of Object.entries(entries)) {
    catalog[id] = {
      id,
      kind: 'builtin',
      endpoint: `binding:${id}`,
      digest: await catalogDigest(describe),
      describe,
    }
  }
  return catalog
}

describe('resolveBuiltinExport', () => {
  it('从目录解析出 export 与现算的 manifest(不落库)', async () => {
    const catalog = await catalogOf({ demo: TOOLS_DESCRIBE })
    const resolved = resolveBuiltinExport(catalog, 'demo', 'tool', 'tool')
    expect(resolved.source).toBe('builtin')
    expect(resolved.export.id).toBe('actions')
    expect(resolved.manifest).toEqual({
      id: 'demo',
      protocolVersion: 'plugin/v2',
      endpoint: 'binding:demo',
      auth: { kind: 'platform-token' },
      healthPath: '/healthz',
      enabled: true,
    })
  })

  it('目录里没有 → invalid_argument,且消息不泄露目录内容', async () => {
    const catalog = await catalogOf({ demo: TOOLS_DESCRIBE })
    expect(() => resolveBuiltinExport(catalog, 'ghost', 'tool', 'tool'))
      .toThrow(/未知 tool provider:'ghost'/)
  })

  it('多 export 必须显式指定(沿用 resolvePluginExport 的语义)', async () => {
    const catalog = await catalogOf({ demo: MULTI_DESCRIBE })
    expect(() => resolveBuiltinExport(catalog, 'demo', 'tool', 'tool'))
      .toThrow(/有多个 export/)
    expect(resolveBuiltinExport(catalog, 'demo', 'tool', 'tool', 'actions').export.id)
      .toBe('actions')
  })

  it('profile 与节点 kind 不符 → 拒(context export 挂不成 tool 节点)', async () => {
    const catalog = await catalogOf({ demo: MULTI_DESCRIBE })
    expect(() => resolveBuiltinExport(catalog, 'demo', 'tool', 'tool', 'documents'))
      .toThrow(/不能挂成 kind:'tool' 节点/)
  })
})

describe('resolveExternalExport', () => {
  it('读注册记录 + describe 缓存', async () => {
    const store = new MemoryStateStore()
    await store.put(`${KEY_PLUGIN}ext`, {
      id: 'ext',
      protocolVersion: 'plugin/v2',
      endpoint: 'https://ext.example.com',
      auth: { kind: 'platform-token' },
      healthPath: '/healthz',
      enabled: true,
    })
    await store.put(`${KEY_PLUGIN_META}ext`, TOOLS_DESCRIBE)
    const resolved = await resolveExternalExport(store, 'ext', 'tool', 'tool')
    expect(resolved.source).toBe('external')
    expect(resolved.manifest.endpoint).toBe('https://ext.example.com')
  })

  it('禁用 / 缺 describe 缓存分别有各自的消息', async () => {
    const store = new MemoryStateStore()
    await store.put(`${KEY_PLUGIN}off`, {
      id: 'off',
      protocolVersion: 'plugin/v2',
      endpoint: 'https://off.example.com',
      auth: { kind: 'platform-token' },
      healthPath: '/healthz',
      enabled: false,
    })
    await expect(resolveExternalExport(store, 'off', 'tool', 'tool')).rejects.toThrow(/已禁用/)

    await store.put(`${KEY_PLUGIN}bare`, {
      id: 'bare',
      protocolVersion: 'plugin/v2',
      endpoint: 'https://bare.example.com',
      auth: { kind: 'platform-token' },
      healthPath: '/healthz',
      enabled: true,
    })
    await expect(resolveExternalExport(store, 'bare', 'tool', 'tool'))
      .rejects.toThrow(/缺少 ~describe 缓存/)
  })
})

describe('resolveIntegration', () => {
  it('显式注册记录优先于同名内置目录项', async () => {
    const catalog = await catalogOf({ demo: TOOLS_DESCRIBE })
    const store = new MemoryStateStore()
    await store.put(`${KEY_PLUGIN}demo`, {
      id: 'demo',
      protocolVersion: 'plugin/v2',
      endpoint: 'https://mine.example.com',
      auth: { kind: 'platform-token' },
      healthPath: '/healthz',
      enabled: true,
    })
    await store.put(`${KEY_PLUGIN_META}demo`, TOOLS_DESCRIBE)
    const resolved = await resolveIntegration(store, catalog, 'demo', 'tool', 'tool')
    expect(resolved.source).toBe('external')
    expect(resolved.manifest.endpoint).toBe('https://mine.example.com')
  })

  it('无注册记录时落到内置目录', async () => {
    const catalog = await catalogOf({ demo: TOOLS_DESCRIBE })
    const resolved = await resolveIntegration(new MemoryStateStore(), catalog, 'demo', 'tool', 'tool')
    expect(resolved.source).toBe('builtin')
  })

  /**
   * **A3 在升级过的部署里不复活**:已删除的 `autoRegisterBinding` 在存量库里留下
   * `plugin:<id>`(endpoint 是 `binding:`)+ 一份只在注册那刻抓过的 `pluginmeta:` 快照。
   * 若让注册记录赢,改了插件声明后平台仍按老快照校验挂载 —— 那正是 catalog 要消灭的陈旧。
   * endpoint 决定契约真源:`binding:` 的真源是构建产物,不是 KV 快照。
   */
  it('binding: 的存量注册记录不覆盖 catalog(陈旧快照不赢构建产物)', async () => {
    const catalog = await catalogOf({ demo: MULTI_DESCRIBE })
    const store = new MemoryStateStore()
    await store.put(`${KEY_PLUGIN}demo`, {
      id: 'demo',
      protocolVersion: 'plugin/v2',
      endpoint: 'binding:demo',
      auth: { kind: 'platform-token' },
      healthPath: '/healthz',
      enabled: true,
    })
    // 陈旧快照:只有一个 export,而当前代码(catalog)已经有两个。
    await store.put(`${KEY_PLUGIN_META}demo`, TOOLS_DESCRIBE)

    const resolved = await resolveIntegration(store, catalog, 'demo', 'context', 'context', 'documents')
    // 按陈旧快照解析会报"无 export 'documents'";走 catalog 才解析得出。
    expect(resolved.source).toBe('builtin')
    expect(resolved.export.id).toBe('documents')
  })

  it('binding: 记录但 catalog 里没有该 id → 仍走注册记录(宿主没装配那个插件)', async () => {
    const store = new MemoryStateStore()
    await store.put(`${KEY_PLUGIN}gone`, {
      id: 'gone',
      protocolVersion: 'plugin/v2',
      endpoint: 'binding:gone',
      auth: { kind: 'platform-token' },
      healthPath: '/healthz',
      enabled: true,
    })
    await store.put(`${KEY_PLUGIN_META}gone`, TOOLS_DESCRIBE)
    const resolved = await resolveIntegration(store, {}, 'gone', 'tool', 'tool')
    expect(resolved.source).toBe('external')
  })

  it('https 注册记录仍然优先(用户自建的覆盖同名内置项)', async () => {
    const catalog = await catalogOf({ github: TOOLS_DESCRIBE })
    const store = new MemoryStateStore()
    await store.put(`${KEY_PLUGIN}github`, {
      id: 'github',
      protocolVersion: 'plugin/v2',
      endpoint: 'https://my-github-plugin.example.com',
      auth: { kind: 'platform-token' },
      healthPath: '/healthz',
      enabled: true,
    })
    await store.put(`${KEY_PLUGIN_META}github`, TOOLS_DESCRIBE)
    const resolved = await resolveIntegration(store, catalog, 'github', 'tool', 'tool')
    expect(resolved.source).toBe('external')
    expect(resolved.manifest.endpoint).toBe('https://my-github-plugin.example.com')
  })

  /**
   * A1 的**结构性**回归:解析一次内置 provider 后,store 必须一个键都没多。
   * 此前这条路会写 `plugin:` 与 `pluginmeta:`,于是"删除即复活"。
   */
  it('解析内置 provider 零写库(删除即复活的结构性防线)', async () => {
    const catalog = await catalogOf({ demo: TOOLS_DESCRIBE })
    const store = new MemoryStateStore()
    const writes: string[] = []
    const spied = {
      get: (key: string) => store.get(key),
      put: (key: string, value: unknown) => {
        writes.push(key)
        return store.put(key, value)
      },
    }
    await resolveIntegration(spied, catalog, 'demo', 'tool', 'tool')
    expect(writes).toEqual([])
    expect((await store.list('')).items).toEqual([])
  })
})

describe('digest', () => {
  it('canonical JSON 键序无关', () => {
    expect(canonicalCatalogJson({ b: 1, a: 2 })).toBe(canonicalCatalogJson({ a: 2, b: 1 }))
  })

  it('undefined 字段不参与 digest(可缺省字段加了又删不算漂移)', async () => {
    expect(await catalogDigest({ a: 1, b: undefined })).toBe(await catalogDigest({ a: 1 }))
  })

  it('目录级 digest 只看 (id, digest) 对', async () => {
    const one = await catalogOf({ demo: TOOLS_DESCRIBE })
    const two = await catalogOf({ demo: TOOLS_DESCRIBE })
    expect(await catalogSetDigest(two)).toBe(await catalogSetDigest(one))
    const three = await catalogOf({ demo: MULTI_DESCRIBE })
    expect(await catalogSetDigest(three)).not.toBe(await catalogSetDigest(one))
  })
})
