/**
 * PluginManifest(plugin/v2)校验。
 *
 * **v2 的核心变化:`kind` 从 manifest 移走。** v1 把「这个 plugin 是什么」绑在了部署身份上,
 * 一个 plugin 只能有一个隐式 export —— 无法同时导出 tools 和 context,也无法把若干组能力
 * 分开挂载。v2 让 manifest 只描述**部署与生命周期**(在哪、怎么鉴权、健康检查、是否启用),
 * 「提供什么」下沉到 `/~describe` 的 exports 列表(见 contract.ts)。
 *
 * 三层职责因此清晰:
 *   Plugin(本文件)  部署、鉴权、健康检查、版本
 *   Export(describe) 声明 tools 或 context 语义(profile)
 *   Operation(注册表)名称、schema、权限、副作用、handler
 *
 * endpoint 与上游 provider 同规则:https:// 强制,`allowInsecureHttp`
 * (宿主由 env `TB_ALLOW_INSECURE_HTTP=true` 注入)放行本地 http。`binding:` 用于宿主
 * 显式装配的进程内插件传输；内置目录无需注册即可直接挂载。
 */

import { z } from 'zod'
import { assertSecureUrl } from '../tool/upstreamError'
import { TBError } from '../errors'

/** 当前 Plugin 传输协议版本。 */
export const PLUGIN_PROTOCOL_VERSION = 'plugin/v2'

export type PluginAuth = { kind: 'platform-token' } | { kind: 'bearer', secretRef: string }

export interface PluginManifest {
  auth: PluginAuth
  enabled: boolean
  /** https://、本地开发 http://，或宿主进程内 `binding:<name>`。 */
  endpoint: string
  /** 如 "/healthz";必须以 '/' 开头。 */
  healthPath: string
  id: string
  /** 传输协议版本;当前仅 "plugin/v2"。 */
  protocolVersion: string
}

// id 进 KV key `plugin:<id>` 且经 config.provider 被树节点引用:
// 限 path-segment 安全字符(不含 '/'、':'、空白、'~' 前缀)。
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const BINDING_RE = /^binding:[A-Za-z0-9_-]+$/
const authSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('platform-token') }),
  z.object({ kind: z.literal('bearer'), secretRef: z.string().min(1) }),
])

const manifestSchema = z.object({
  id: z.string().regex(ID_RE, 'id 须为 path-segment 安全字符([A-Za-z0-9._-],不以标点开头)'),
  protocolVersion: z
    .string()
    .refine(v => v === PLUGIN_PROTOCOL_VERSION, {
      error: `protocolVersion 须为 '${PLUGIN_PROTOCOL_VERSION}'`,
    }),
  endpoint: z.string().min(1),
  auth: authSchema,
  healthPath: z.string().regex(/^\//, 'healthPath 须以 \'/\' 开头'),
  enabled: z.boolean(),
}).strict()

export interface ParsePluginManifestOptions {
  /** 放行 http:// endpoint(仅本地开发;宿主按 env `TB_ALLOW_INSECURE_HTTP=true` 注入)。 */
  allowInsecureHttp?: boolean
}

/**
 * 校验并构造 PluginManifest:
 * - 字段形状经严格 zod 校验，未知/旧版字段直接拒绝；
 * - endpoint 为合法 `binding:<name>`，或必须通过 {@link assertSecureUrl}。
 * 任何不符 → TBError invalid_argument。
 */
export function parsePluginManifest(
  value: unknown,
  opts: ParsePluginManifestOptions = {},
): PluginManifest {
  const parsed = manifestSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new TBError(
      'invalid_argument',
      `非法 PluginManifest:${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`,
    )
  }
  const manifest = parsed.data

  if (!BINDING_RE.test(manifest.endpoint)) {
    if (manifest.endpoint.startsWith('binding:')) {
      throw new TBError('invalid_argument', `非法 service binding 名:'${manifest.endpoint}'`)
    }
    const err = assertSecureUrl(manifest.endpoint, opts.allowInsecureHttp ?? false)
    if (err) throw err
  }

  return manifest
}
