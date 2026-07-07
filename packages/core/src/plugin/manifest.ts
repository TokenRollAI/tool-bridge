/**
 * PluginManifest 校验。
 *
 * 类型原样转写规范;校验失败统一抛 TBError invalid_argument。
 * endpoint 与上游 provider 同规则:https:// 强制,`allowInsecureHttp`
 * (宿主由 env `TB_ALLOW_INSECURE_HTTP=true` 注入)放行本地 http;
 * `binding:<name>` 为平台内 service binding。
 */

import { z } from 'zod'
import { TBError } from '../errors'
import { assertSecureUrl } from '../tool/upstreamError'

export type PluginKind = 'tool-provider' | 'context-provider'

export const PLUGIN_KINDS: readonly PluginKind[] = ['tool-provider', 'context-provider']

export type PluginAuth = { kind: 'platform-token' } | { kind: 'bearer'; secretRef: string }

export interface PluginManifest {
  id: string
  kind: PluginKind
  /** "tool-provider/v1" | "context-provider/v1";前缀必须与 kind 一致。 */
  interfaceVersion: string
  /** https:// 或 `binding:<name>`(平台内 service binding)。 */
  endpoint: string
  auth: PluginAuth
  /** 如 "/healthz";必须以 '/' 开头。 */
  healthPath: string
  enabled: boolean
}

/** pluginToken 仅注册响应出现一次。 */
export interface PluginRegistration extends PluginManifest {
  pluginToken?: string
}

// id 进 KV key `plugin:<id>` 且经 config.provider 被树节点引用:
// 限 path-segment 安全字符(不含 '/'、':'、空白、'~' 前缀)。
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const INTERFACE_VERSION_RE = /^(tool-provider|context-provider)\/v\d+$/
const BINDING_RE = /^binding:[A-Za-z0-9_-]+$/

const authSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('platform-token') }),
  z.object({ kind: z.literal('bearer'), secretRef: z.string().min(1) }),
])

const manifestSchema = z.object({
  id: z.string().regex(ID_RE, 'id 须为 path-segment 安全字符([A-Za-z0-9._-],不以标点开头)'),
  kind: z.enum(PLUGIN_KINDS as [PluginKind, ...PluginKind[]]),
  interfaceVersion: z
    .string()
    .regex(INTERFACE_VERSION_RE, 'interfaceVersion 须形如 <kind>/v<major>'),
  endpoint: z.string().min(1),
  auth: authSchema,
  healthPath: z.string().regex(/^\//, "healthPath 须以 '/' 开头"),
  enabled: z.boolean(),
})

export interface ParsePluginManifestOptions {
  /** 放行 http:// endpoint(仅本地开发;宿主按 env `TB_ALLOW_INSECURE_HTTP=true` 注入)。 */
  allowInsecureHttp?: boolean
}

/**
 * 校验并构造 PluginManifest:
 * - 字段形状经 zod(未知字段剥离 = 忽略);
 * - interfaceVersion 前缀必须等于 kind;
 * - endpoint 为 `binding:<name>` 或过 {@link assertSecureUrl} 的 URL。
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

  if (!manifest.interfaceVersion.startsWith(`${manifest.kind}/`)) {
    throw new TBError(
      'invalid_argument',
      `interfaceVersion '${manifest.interfaceVersion}' 与 kind '${manifest.kind}' 不一致`,
    )
  }

  if (!BINDING_RE.test(manifest.endpoint)) {
    if (manifest.endpoint.startsWith('binding:')) {
      throw new TBError('invalid_argument', `非法 service binding 名:'${manifest.endpoint}'`)
    }
    const err = assertSecureUrl(manifest.endpoint, opts.allowInsecureHttp ?? false)
    if (err) throw err
  }

  return manifest
}
