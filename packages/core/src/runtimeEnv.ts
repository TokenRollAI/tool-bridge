/**
 * Node 与 Workers 宿主共用的运行时环境变量解析。
 *
 * 数值配置沿用历史兼容语义：缺失、空值和非法值均返回 undefined，由宿主应用自己的
 * 安全默认值；小数向下取整。只有明确标为 fail-closed 的安全配置会抛错。
 */

import { z } from 'zod'
import { PRESIGN_TTL_SEC_MAX } from './context/objectProvider'
import { normalizeCanonicalOrigin } from './origin'

export const DEFAULT_MAX_HOPS = 4

const optionalPositiveIntSchema = z.string()
  .min(1)
  .transform(Number)
  .pipe(z.number().finite().positive())
  .transform(Math.floor)
  .optional()
  .catch(undefined)

const optionalNonNegativeIntSchema = z.string()
  .min(1)
  .transform(Number)
  .pipe(z.number().finite().int().nonnegative())
  .optional()
  .catch(undefined)

const optionalPortSchema = z.string()
  .min(1)
  .transform(Number)
  .pipe(z.number().int().min(0).max(65_535))
  .optional()
  .catch(undefined)

const optionalStringSchema = z.string().optional()

const positiveEnvKeys = [
  'TB_DEVICE_RECLAIM_SEC', 'TB_MAX_HOPS', 'TB_REF_THRESHOLD_BYTES', 'TB_REF_TTL_SEC',
  'TB_STORE_CALL_MAX_BYTES', 'TB_STORE_CALL_MAX_OBJECT_BYTES', 'TB_STORE_CALL_MAX_OBJECTS',
  'TB_STORE_CLEANUP_INTERVAL_SEC', 'TB_STORE_MAX_OBJECT_BYTES', 'TB_STORE_READ_TTL_SEC',
  'TB_STORE_RELAY_MAX_BYTES', 'TB_STORE_SHARE_TTL_SEC', 'TB_STORE_UPLOAD_TTL_SEC',
  'TB_TOOL_CACHE_TTL', 'TB_UPLOAD_GRANT_TTL_SEC',
] as const

const positiveEnvShape = Object.fromEntries(
  positiveEnvKeys.map(key => [key, optionalPositiveIntSchema]),
) as { [K in typeof positiveEnvKeys[number]]: typeof optionalPositiveIntSchema }

const runtimeEnvSchema = z.object({
  ...positiveEnvShape,
  TB_ALLOW_INSECURE_HTTP: optionalStringSchema,
  TB_CANONICAL_ORIGIN: optionalStringSchema,
  TB_INSTANCE_ID: optionalStringSchema,
  TB_REMOTE_ALLOWLIST: optionalStringSchema,
  TB_STORE_CALL_ALLOWED_CONTENT_TYPES: optionalStringSchema,
  TB_STORE_TOKEN_SECRET: z.union([
    z.literal('').transform(() => undefined),
    z.string().min(16, 'TB_STORE_TOKEN_SECRET 至少需要 16 个字符'),
  ]).optional(),
})

export interface RuntimeRemoteSettings {
  allowInsecure: boolean
  allowlist: string[]
  instanceId?: string
  maxHops: number
}

type RuntimeOptionalNumberKey
  = | 'deviceReclaimSec' | 'refThresholdBytes' | 'refTtlSec'
    | 'storeCallMaxBytes' | 'storeCallMaxObjectBytes' | 'storeCallMaxObjects'
    | 'storeCleanupIntervalSec' | 'storeMaxObjectBytes' | 'storeReadTtlSec'
    | 'storeRelayMaxBytes' | 'storeShareTtlSec' | 'storeUploadTtlSec'
    | 'toolCacheTtlSec' | 'uploadGrantTtlSec'

export type RuntimeEnvConfig = {
  allowInsecureHttp: boolean
  remote: RuntimeRemoteSettings
  storeCallAllowedContentTypes?: string[]
} & Partial<Record<RuntimeOptionalNumberKey, number>>
& Partial<Record<'canonicalOrigin' | 'storeTokenSecret', string>>

function setDefined<K extends keyof RuntimeEnvConfig>(
  target: RuntimeEnvConfig,
  key: K,
  value: RuntimeEnvConfig[K] | undefined,
): void {
  if (value !== undefined) target[key] = value
}

/** 非法/缺失值返回 undefined；保留历史 Number + floor 语义。 */
export function parsePositiveIntEnv(value: string | undefined): number | undefined {
  return optionalPositiveIntSchema.parse(value)
}

/** 非法/缺失值返回 undefined；0 合法。 */
export function parseNonNegativeIntEnv(value: string | undefined): number | undefined {
  return optionalNonNegativeIntSchema.parse(value)
}

/** 非法/缺失值返回 undefined；0 表示由系统分配端口。 */
export function parsePortEnv(value: string | undefined): number | undefined {
  return optionalPortSchema.parse(value)
}

/** 解析 Node/Workers 共用配置；未知宿主 binding 会被 Zod 忽略。 */
export function parseRuntimeEnv(env: object): RuntimeEnvConfig {
  const parsed = runtimeEnvSchema.parse(env)
  const allowInsecureHttp = parsed.TB_ALLOW_INSECURE_HTTP === 'true'
  const allowlist = (parsed.TB_REMOTE_ALLOWLIST ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  const allowedContentTypes = (parsed.TB_STORE_CALL_ALLOWED_CONTENT_TYPES ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  const presignTtl = (value: number | undefined): number | undefined =>
    value === undefined ? undefined : Math.min(value, PRESIGN_TTL_SEC_MAX)
  const result: RuntimeEnvConfig = {
    allowInsecureHttp,
    remote: {
      allowInsecure: allowInsecureHttp,
      allowlist,
      maxHops: parsed.TB_MAX_HOPS ?? DEFAULT_MAX_HOPS,
      ...(parsed.TB_INSTANCE_ID ? { instanceId: parsed.TB_INSTANCE_ID } : {}),
    },
  }
  setDefined(result, 'canonicalOrigin', normalizeCanonicalOrigin(parsed.TB_CANONICAL_ORIGIN))
  const directNumbers = [
    ['deviceReclaimSec', 'TB_DEVICE_RECLAIM_SEC'],
    ['toolCacheTtlSec', 'TB_TOOL_CACHE_TTL'],
    ['refThresholdBytes', 'TB_REF_THRESHOLD_BYTES'],
    ['storeMaxObjectBytes', 'TB_STORE_MAX_OBJECT_BYTES'],
    ['storeRelayMaxBytes', 'TB_STORE_RELAY_MAX_BYTES'],
    ['storeCallMaxBytes', 'TB_STORE_CALL_MAX_BYTES'],
    ['storeCallMaxObjectBytes', 'TB_STORE_CALL_MAX_OBJECT_BYTES'],
    ['storeCallMaxObjects', 'TB_STORE_CALL_MAX_OBJECTS'],
    ['storeCleanupIntervalSec', 'TB_STORE_CLEANUP_INTERVAL_SEC'],
  ] as const
  for (const [output, input] of directNumbers) setDefined(result, output, parsed[input])
  const presignTtls = [
    ['refTtlSec', 'TB_REF_TTL_SEC'],
    ['uploadGrantTtlSec', 'TB_UPLOAD_GRANT_TTL_SEC'],
    ['storeUploadTtlSec', 'TB_STORE_UPLOAD_TTL_SEC'],
    ['storeShareTtlSec', 'TB_STORE_SHARE_TTL_SEC'],
    ['storeReadTtlSec', 'TB_STORE_READ_TTL_SEC'],
  ] as const
  for (const [output, input] of presignTtls) setDefined(result, output, presignTtl(parsed[input]))
  setDefined(result, 'storeTokenSecret', parsed.TB_STORE_TOKEN_SECRET)
  if (allowedContentTypes.length > 0) result.storeCallAllowedContentTypes = allowedContentTypes
  return result
}
