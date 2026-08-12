/**
 * 注册时契约校验(plugin/v2)。
 *
 * 输入 = manifest + 平台抓取的 `/~describe` JSON;纯逻辑,抓取本身在宿主。
 *
 * **v2 的 `~describe` 返回 exports 列表**,每个 export 声明自己的 `profile`
 * (tools/v1 或 context/v1)与实际提供的操作:
 *
 * ```json
 * { "protocolVersion": "plugin/v2",
 *   "exports": [
 *     { "id": "actions",   "profile": "tools/v1",   "description": "Feishu actions" },
 *     { "id": "documents", "profile": "context/v1", "methods": ["Get","List","Search"] } ] }
 * ```
 *
 * v1 需要额外抓 `~help` 来数方法,是因为方法集合无处声明;v2 由 export 自报 `methods`,
 * 校验不再依赖 `~help` 抓取(少一次往返,也不再受 help 表现形态影响)。
 *
 * context/v1 的 `methods` 与 Round 7 的「按 handler 存在性推导能力」同一套语义:
 * 声明多少就是多少,平台只调用声明过的动词。
 */

import { z } from 'zod'
import type { PluginManifest } from './manifest'
import { CONTEXT_METHODS } from '../context/capabilities'
import { TBError } from '../errors'

/** export 的语义档位。 */
export type PluginProfile = 'tools/v1' | 'context/v1'

export const PLUGIN_PROFILES: readonly PluginProfile[] = ['tools/v1', 'context/v1']

/** profile → 可挂载的树节点 kind(挂载校验用)。 */
export const NODE_KIND_BY_PROFILE: Record<PluginProfile, 'tool' | 'context'> = {
  'tools/v1': 'tool',
  'context/v1': 'context',
}

/**
 * capability 基名 → 可选方法名(context/v1)。
 * 限定词(如 `search:semantic`)按 ':' 前的基名判定;未知基名忽略(向前兼容)。
 */
const OPTIONAL_METHOD_BY_CAPABILITY: Record<string, string> = {
  search: 'Search',
  delete: 'Delete',
}

/**
 * capabilities → 已声明的可选方法名集合(去重;未知基名忽略)。
 * 挂载后 `~help` 只列"核心动词 + 已声明可选方法"的过滤依据。
 */
export function optionalMethodsForCapabilities(capabilities: readonly string[]): Set<string> {
  const methods = new Set<string>()
  for (const capability of capabilities) {
    const base = capability.split(':', 1)[0] ?? capability
    const method = OPTIONAL_METHOD_BY_CAPABILITY[base]
    if (method !== undefined) methods.add(method)
  }
  return methods
}

// export id 与 plugin id 同规则:会进挂载配置并被路径化引用。
const EXPORT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const exportSchema = z.object({
  id: z.string().regex(EXPORT_ID_RE, 'export id 须为 [A-Za-z0-9._-] 且不以标点开头'),
  profile: z.enum(PLUGIN_PROFILES),
  description: z.string().optional(),
  /** context/v1:实际提供的动词;tools/v1 由运行时 List 发现,可省。 */
  methods: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
})

const describeSchema = z.object({
  protocolVersion: z.string().min(1),
  exports: z.array(exportSchema).min(1, '至少声明一个 export'),
})

/** 单个 export 的声明。 */
export interface PluginExport {
  capabilities?: string[]
  description?: string
  id: string
  methods?: string[]
  profile: PluginProfile
}

/** `/~describe` 响应形状(v2)。 */
export interface PluginDescribe {
  exports: PluginExport[]
  protocolVersion: string
}

export interface PluginContractInput {
  /** 抓取到的 `/~describe` JSON(已 parse 的值)。 */
  describe: unknown
  manifest: PluginManifest
}

/** 契约校验入口;通过则返回解析后的 ~describe(exports 缓存供挂载与 ~help 使用)。 */
export function validatePluginContract(input: PluginContractInput): PluginDescribe {
  const { manifest } = input

  const parsed = describeSchema.safeParse(input.describe)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new TBError(
      'invalid_argument',
      `plugin '${manifest.id}' 的 ~describe 形状非法(需 {protocolVersion, exports[]}):`
      + `${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`,
    )
  }
  const describe = parsed.data

  if (describe.protocolVersion !== manifest.protocolVersion) {
    throw new TBError(
      'invalid_argument',
      `plugin '${manifest.id}' 的 ~describe.protocolVersion '${describe.protocolVersion}' `
      + `与 manifest '${manifest.protocolVersion}' 不符`,
    )
  }

  const seen = new Set<string>()
  for (const exported of describe.exports) {
    if (seen.has(exported.id)) {
      throw new TBError('invalid_argument', `plugin '${manifest.id}' 的 export id 重复:'${exported.id}'`)
    }
    seen.add(exported.id)

    if (exported.profile === 'context/v1') {
      const known = new Set<string>(CONTEXT_METHODS)
      const unknown = (exported.methods ?? []).filter(m => !known.has(m))
      if (unknown.length > 0) {
        throw new TBError(
          'invalid_argument',
          `plugin '${manifest.id}' export '${exported.id}' 声明了未知动词:${unknown.join(', ')}`,
        )
      }
      // 声明了可选能力就必须同时把对应动词列进 methods —— 否则平台永远不会调用它,
      // 属于自相矛盾的声明(与 v1 "capability 必须有对应 cmd" 同一意图)。
      if (exported.methods !== undefined) {
        const declared = new Set(exported.methods)
        for (const capability of exported.capabilities ?? []) {
          const base = capability.split(':', 1)[0] ?? capability
          const method = OPTIONAL_METHOD_BY_CAPABILITY[base]
          if (method !== undefined && !declared.has(method)) {
            throw new TBError(
              'invalid_argument',
              `plugin '${manifest.id}' export '${exported.id}' 声明 capability '${capability}' `
              + `但 methods 未含 '${method}'`,
            )
          }
        }
      }
    }
  }

  return describe
}

/**
 * 按挂载配置选出目标 export。
 * - 显式 `exportId`:必须存在,且 profile 与节点 kind 相符;
 * - 省略且**恰好一个** export:取它(单 export plugin 的挂载不必写 export);
 * - 省略但有多个:invalid_argument(要求显式指定,不猜)。
 */
export function resolvePluginExport(
  describe: PluginDescribe,
  opts: { exportId?: string, nodeKind: 'tool' | 'context', pluginId: string },
): PluginExport {
  const { exports } = describe
  let chosen: PluginExport | undefined
  if (opts.exportId !== undefined) {
    chosen = exports.find(e => e.id === opts.exportId)
    if (chosen === undefined) {
      throw new TBError(
        'invalid_argument',
        `plugin '${opts.pluginId}' 无 export '${opts.exportId}'(现有:${exports.map(e => e.id).join(', ')})`,
      )
    }
  } else if (exports.length === 1) {
    chosen = exports[0]
  } else {
    throw new TBError(
      'invalid_argument',
      `plugin '${opts.pluginId}' 有多个 export(${exports.map(e => e.id).join(', ')}),挂载须指定 config.export`,
    )
  }
  if (chosen === undefined) {
    throw new TBError('invalid_argument', `plugin '${opts.pluginId}' 无可用 export`)
  }
  if (NODE_KIND_BY_PROFILE[chosen.profile] !== opts.nodeKind) {
    throw new TBError(
      'invalid_argument',
      `plugin '${opts.pluginId}' 的 export '${chosen.id}' 是 ${chosen.profile},`
      + `不能挂成 kind:'${opts.nodeKind}' 节点`,
    )
  }
  return chosen
}
