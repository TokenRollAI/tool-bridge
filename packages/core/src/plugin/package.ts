/**
 * 插件包(可安装分发单位)的索引条目校验与 bundle 完整性校验。
 *
 * 一个"插件包" = 单文件 Worker bundle(ESM)+ 本条目元数据;索引是条目数组
 * (社区仓库托管的 JSON)。安装器按 bundleUrl 拉 bundle、经 sha256 锁定内容,
 * 部署进用户自己的 CF 账户后走既有注册流程(探活 + 契约校验)。
 * 校验失败统一抛 TBError invalid_argument;sha256 的 I/O 无关纯计算用
 * WebCrypto(Workers 与 Node 同源可用)。
 */

import { z } from 'zod'
import { TBError } from '../errors'
import { assertSecureUrl } from '../tool/upstreamError'
import { PLUGIN_KINDS, type PluginKind } from './manifest'

declare const crypto: {
  subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> }
}

/** bundle 体积上限(索引条目声明的远端文件;超限拒安装)。 */
export const PLUGIN_BUNDLE_MAX_BYTES = 5 * 1024 * 1024

export interface PluginPackage {
  /** 安装后的默认 plugin id;与 manifest id 同字符集约束。 */
  name: string
  version: string
  /** 单文件 ESM Worker bundle 的下载地址(https 强制)。 */
  bundleUrl: string
  /** bundle 内容的 sha256(hex 小写);安装时逐字节校验。 */
  sha256: string
  kind: PluginKind
  interfaceVersion: string
  healthPath: string
  description?: string
  /** 安装时向用户收集的配置(JSON Schema);值全部注入为插件 Worker 的 secrets。 */
  configSchema?: Record<string, unknown>
  /** 每挂载配置(JSON Schema);挂载时校验节点 config.providerConfig。 */
  mountConfigSchema?: Record<string, unknown>
}

// 与 manifest.ts 的 ID_RE 同一约束(name 直接用作 plugin id 与 Worker script 名成分)。
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const INTERFACE_VERSION_RE = /^(tool-provider|context-provider)\/v\d+$/
const SHA256_HEX_RE = /^[0-9a-f]{64}$/
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+.][A-Za-z0-9.-]+)?$/

const packageSchema = z.object({
  name: z.string().regex(NAME_RE, 'name 须为 path-segment 安全字符([A-Za-z0-9._-],不以标点开头)'),
  version: z.string().regex(VERSION_RE, 'version 须为 semver(如 1.2.3)'),
  bundleUrl: z.string().min(1),
  sha256: z.string().regex(SHA256_HEX_RE, 'sha256 须为 64 位 hex 小写'),
  kind: z.enum(PLUGIN_KINDS as [PluginKind, ...PluginKind[]]),
  interfaceVersion: z
    .string()
    .regex(INTERFACE_VERSION_RE, 'interfaceVersion 须形如 <kind>/v<major>'),
  healthPath: z.string().regex(/^\//, "healthPath 须以 '/' 开头"),
  description: z.string().optional(),
  configSchema: z.record(z.unknown()).optional(),
  mountConfigSchema: z.record(z.unknown()).optional(),
})

export interface ParsePluginPackageOptions {
  /** 放行 http:// bundleUrl(仅本地开发;宿主按 env `TB_ALLOW_INSECURE_HTTP=true` 注入)。 */
  allowInsecureHttp?: boolean
}

/**
 * 校验并构造 PluginPackage(未知字段剥离 = 忽略):
 * interfaceVersion 前缀必须等于 kind;bundleUrl 过 {@link assertSecureUrl}。
 */
export function parsePluginPackage(
  value: unknown,
  opts: ParsePluginPackageOptions = {},
): PluginPackage {
  const parsed = packageSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new TBError(
      'invalid_argument',
      `非法插件包条目:${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`,
    )
  }
  const pkg = parsed.data
  if (!pkg.interfaceVersion.startsWith(`${pkg.kind}/`)) {
    throw new TBError(
      'invalid_argument',
      `interfaceVersion '${pkg.interfaceVersion}' 与 kind '${pkg.kind}' 不一致`,
    )
  }
  const err = assertSecureUrl(pkg.bundleUrl, opts.allowInsecureHttp ?? false)
  if (err) throw err
  return pkg
}

/** 索引 = 条目数组;逐条校验,任一非法即拒(索引是受信分发面,不做部分容忍)。 */
export function parsePluginIndex(
  value: unknown,
  opts: ParsePluginPackageOptions = {},
): PluginPackage[] {
  if (!Array.isArray(value)) {
    throw new TBError('invalid_argument', '插件索引须为条目数组')
  }
  return value.map((entry) => parsePluginPackage(entry, opts))
}

/** sha256(hex 小写)。 */
export async function bytesSha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * bundle 完整性守卫:体积 ≤ {@link PLUGIN_BUNDLE_MAX_BYTES} 且 sha256 逐字一致,
 * 不符 → invalid_argument(供应链锁定:索引声明什么就只接受什么)。
 */
export async function assertBundleIntegrity(bytes: Uint8Array, expected: string): Promise<void> {
  if (bytes.byteLength > PLUGIN_BUNDLE_MAX_BYTES) {
    throw new TBError(
      'invalid_argument',
      `bundle 超限:${bytes.byteLength} 字节 > ${PLUGIN_BUNDLE_MAX_BYTES}`,
    )
  }
  const actual = await bytesSha256Hex(bytes)
  if (actual !== expected) {
    throw new TBError('invalid_argument', `bundle sha256 不符:预期 ${expected},实际 ${actual}`)
  }
}
