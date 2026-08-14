/**
 * 内置插件目录(catalog)与 integration 解析。
 *
 * **catalog 是编译期常量,不是运行时状态**:内置插件的 descriptor 由构建期求值
 * `/~describe` 生成(`@tool-bridge/plugins` 的 `catalog.generated.ts`),与插件代码同一份
 * 构建产物 —— 故不可能陈旧,也不需要落 KV。
 *
 * 这里定的是**解析函数的能力边界**。此前 `requirePluginExport` 拿的是 `deps`
 * (含可写 `state`),于是 help/call 这类读操作也能写库:`manifest ??= autoRegisterBinding(…)`
 * 让"删掉一个 plugin 后随便读一次就复活",而 7 个调用点里传 `deps` 还是传裸 store
 * 是随手决定的 —— 同一个语义在四条链上有四种行为。
 *
 * 修法不是"约定读路径要传只读的东西",而是**让解析函数结构上拿不到写能力**:
 * 下面三个函数的入参只有 catalog(纯值)与 {@link ReadOnlyStore}(只有 get)。
 * 想在这里写库得先改签名,而那是 code review 能看见的事。
 */

import {
  type PluginDescribe,
  type PluginExport,
  resolvePluginExport,
} from './contract'
import { KEY_PLUGIN, KEY_PLUGIN_META } from '../store'
import { type PluginManifest } from './manifest'
import { TBError } from '../errors'

/**
 * 只读存储视图。`StateStore` 的 `put`/`delete` **刻意不在这里** —— 这个类型的全部意义
 * 就是"拿到它的代码写不了库"。`StateStore` 结构上满足它,调用点直接传即可。
 */
export interface ReadOnlyStore {
  get(key: string): Promise<unknown>
}

/**
 * descriptor 的 canonical JSON:键序固定、`undefined` 剔除。digest 拿它算,所以"稳定"是
 * 硬要求 —— 键序漂移会让 digest 无意义地翻动,把"目录变了"的信号淹掉。
 */
export function canonicalCatalogJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize)
    if (input === null || typeof input !== 'object') return input
    const source = input as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) out[key] = normalize(source[key])
    }
    return out
  }
  return JSON.stringify(normalize(value))
}

// core 是 lib: ["ES2023"](无 DOM):Web 标准全局按本仓惯例就地声明最小形状,
// 与 secretStore.ts / envelope.ts 同姿势。
declare const crypto: {
  subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> }
}
declare const TextEncoder: { new (): { encode(input: string): Uint8Array } }

/**
 * canonical JSON 的 sha256(hex 小写)。用 WebCrypto 而非 node:crypto —— 生成脚本、
 * 宿主中立的测试与运行时对拍要用同一份实现,而 core 不许有 Node 依赖。
 */
export async function catalogDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalCatalogJson(value))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 目录级 digest:只覆盖 (id, per-entry digest) 对。
 *
 * 两级分开是有意的:三宿主对拍要的是"装配的是同一个目录",而不是"每个 provider 的文案
 * 逐字相同"。单级全量 digest 会让任一 provider 改一行 description 就翻动全局值,
 * 于是"构建期断言三宿主一致"退化成噪声,红灯没人看。
 */
export async function catalogSetDigest(catalog: BuiltinCatalog): Promise<string> {
  const pairs = Object.keys(catalog)
    .sort()
    .map(id => ({ id, digest: catalog[id]!.digest }))
  return await catalogDigest(pairs)
}

/** 一个内置目录项:插件声明了什么,以及它的 descriptor 指纹。 */
export interface BuiltinCatalogEntry {
  /** 求值出的 `~describe`。 */
  describe: PluginDescribe
  /** descriptor 的 canonical JSON 的 sha256(hex);三宿主对拍与升级检测用。 */
  digest: string
  /** 恒为 `binding:<id>`。 */
  endpoint: string
  id: string
  kind: 'builtin'
}

/** binding 名 → 目录项。 */
export type BuiltinCatalog = Record<string, BuiltinCatalogEntry>

/** 解析结果:选中的 export,以及调用它需要的 manifest。 */
export interface ResolvedIntegration {
  export: PluginExport
  manifest: PluginManifest
  /** 目录项(builtin)还是注册记录(external)—— 错误消息与刷新策略据此分流。 */
  source: 'builtin' | 'external'
}

/**
 * builtin 目录项的 manifest。**由 id 现算,只活在这次调用的内存里,不落库**:
 * endpoint 恒为 `binding:<id>`、healthPath 恒为 `/healthz`、永远 enabled ——
 * 代码在进程里,不存在"连不上"也不存在"被禁用"。
 *
 * `auth.kind` 用 `'platform-token'` 而**不新增 `'none'` 变体**:`PluginAuth` 同时是 external
 * 注册面的入参形状(`parsePluginManifest`),给它加一个"无鉴权"变体等于让公网 endpoint 也能
 * 声明不校验 token —— 那是放宽安全边界,代价远大于这里少一个精确的枚举值。
 *
 * 而 binding + platform-token 缺席已经是**既有的、有测试的**路径:`pluginAuthorization`
 * 解不出 `plugin-token:<id>` 且 endpoint 是 `binding:` 时不发 Authorization 头。
 * 对进程内直调这是正确行为 —— 调用方就是平台自己,mint 一个双方都不验的 token
 * (plugin-sdk 见 `TB_PLUGIN_IN_PROCESS` 即跳过校验)只是徒增一份要轮转的凭证。
 */
function builtinManifestOf(id: string): PluginManifest {
  return {
    id,
    protocolVersion: 'plugin/v2',
    endpoint: `binding:${id}`,
    auth: { kind: 'platform-token' },
    healthPath: '/healthz',
    enabled: true,
  }
}

/**
 * 从内置目录解析 export。**无 store 参数** —— 结构上不可能读库,更不可能写库。
 *
 * @throws invalid_argument 目录里没有这个 id,或 export 选不出/kind 不符。
 */
export function resolveBuiltinExport(
  catalog: BuiltinCatalog,
  id: string,
  nodeKind: 'tool' | 'context',
  what: 'context' | 'tool',
  exportId?: string,
): ResolvedIntegration {
  const entry = catalog[id]
  if (entry === undefined) {
    throw new TBError('invalid_argument', `未知 ${what} provider:'${id}'`)
  }
  const chosen = resolvePluginExport(entry.describe, {
    nodeKind,
    pluginId: id,
    ...(exportId !== undefined ? { exportId } : {}),
  })
  return { manifest: builtinManifestOf(id), export: chosen, source: 'builtin' }
}

/**
 * 从注册记录解析 external plugin 的 export(只读)。
 *
 * @throws invalid_argument 未注册 / 已禁用 / 缺 `~describe` 缓存 / export 选不出。
 */
export async function resolveExternalExport(
  store: ReadOnlyStore,
  id: string,
  nodeKind: 'tool' | 'context',
  what: 'context' | 'tool',
  exportId?: string,
): Promise<ResolvedIntegration> {
  const manifest = (await store.get(KEY_PLUGIN + id)) as PluginManifest | null
  if (manifest === null) {
    throw new TBError('invalid_argument', `未知 ${what} provider:'${id}'`)
  }
  if (manifest.enabled !== true) {
    throw new TBError('invalid_argument', `plugin '${id}' 已禁用`)
  }
  const describe = (await store.get(KEY_PLUGIN_META + id)) as PluginDescribe | null
  if (describe === null) {
    throw new TBError('invalid_argument', `plugin '${id}' 缺少 ~describe 缓存,请重新注册`)
  }
  const chosen = resolvePluginExport(describe, {
    nodeKind,
    pluginId: id,
    ...(exportId !== undefined ? { exportId } : {}),
  })
  return { manifest, export: chosen, source: 'external' }
}

/**
 * 唯一分发入口:**外挂注册记录优先**,内置目录兜底。
 *
 * 顺序是有意的:注册是用户的显式动作,同名时该赢过平台自带的目录项(比如用户想用自己
 * 部署的 `github` 插件覆盖内置那个)。反过来会让"我明明注册了却没生效"变成无解的困惑。
 *
 * **但 `binding:` endpoint 的注册记录例外:catalog 赢。** 那种记录有两个来源,两者都该让
 * 编译期目录优先:
 *
 * - 已删除的 `autoRegisterBinding` 在存量部署里写下的 —— 升级后它们还在 KV 里,而它们的
 *   `pluginmeta:` 快照**只在注册那一刻抓过一次**。若让它们赢,A3(契约永久陈旧)就在
 *   升级过的部署里原样复活:改了插件的 export 声明,平台仍按老快照校验挂载。
 * - 用户显式 `system/plugin write` 一个 `binding:` 插件 —— 那条路仍受理,但它指向的
 *   代码就是本进程里的同一份,catalog 的 descriptor 与它同源同构建,不可能更旧。
 *
 * 换句话说:**endpoint 决定契约的真源**。`binding:` 的真源是这份构建产物,https 的真源
 * 才是注册时抓的快照。两条路都只读。
 */
export async function resolveIntegration(
  store: ReadOnlyStore,
  catalog: BuiltinCatalog,
  id: string,
  nodeKind: 'tool' | 'context',
  what: 'context' | 'tool',
  exportId?: string,
): Promise<ResolvedIntegration> {
  const manifest = (await store.get(KEY_PLUGIN + id)) as PluginManifest | null
  const isBinding = manifest?.endpoint.startsWith('binding:') === true
  if (manifest !== null && !(isBinding && catalog[id] !== undefined)) {
    return await resolveExternalExport(store, id, nodeKind, what, exportId)
  }
  return resolveBuiltinExport(catalog, id, nodeKind, what, exportId)
}
