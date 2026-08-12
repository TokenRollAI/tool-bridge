/**
 * Latchshot 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/latchshot/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 两个 action 的处境不同,见各自 handler 上的说明:`get_usage` 完整迁移,
 * `capture_page` 依赖平台没有的本地文件存储,只能显式 501。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { getUsageInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'latchshot'
const API_BASE = 'https://latchshot.fly.dev'
const USAGE_PATH = '/v1/usage'
/** 上游对 usage/错误体设的上限;超了就断流,别让对端决定插件吃多少内存。 */
const JSON_MAX_BYTES = 64 * 1024

type Json = Record<string, unknown>

interface UsageResult {
  customer: { name: string, plan: string }
  links: Record<string, string>
  upgradeRequest: Json | null
  usage: Json
}

function asRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined
}

/** 上游 `optionalString` 的语义:先 trim,空则视为缺失。 */
function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * 边读边计数,超限立刻断流 —— 先 `text()` 再判大小等于把上限交给对端决定,
 * 一个谎报 content-length 的响应就能让插件把内存吃干。
 */
async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isSafeInteger(declared) && declared > JSON_MAX_BYTES) {
    throw upstreamError(502, `Latchshot 响应超过 ${JSON_MAX_BYTES} 字节上限`)
  }
  if (response.body === null) return response.text()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > JSON_MAX_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw upstreamError(502, `Latchshot 响应超过 ${JSON_MAX_BYTES} 字节上限`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/** 错误体多半是 JSON,但边缘层会回纯文本;两种都收,文本截断到 500 字免得刷日志。 */
function errorMessage(text: string): string | undefined {
  if (text.trim() === '') return undefined
  try {
    const record = asRecord(JSON.parse(text) as unknown)
    return optionalText(asRecord(record?.error)?.message) ?? optionalText(record?.message)
  } catch {
    return text.trim().slice(0, 500)
  }
}

/** 响应里契约要求的字段;取不到是**上游**破了契约,不是调用方的错。 */
function responseRecord(value: unknown, message: string): Json {
  const record = asRecord(value)
  if (record === undefined) throw upstreamError(502, message)
  return record
}

function responseText(value: unknown, field: string): string {
  const text = optionalText(value)
  if (text === undefined) throw upstreamError(502, `Latchshot 响应的 ${field} 无效`)
  return text
}

function responseInteger(value: unknown, field: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || (positive ? value <= 0 : value < 0)) {
    throw upstreamError(502, `Latchshot 响应的 ${field} 无效`)
  }
  return value
}

function normalizeUpgradeRequest(value: unknown): Json | null {
  if (value === null || value === undefined) return null
  const request = responseRecord(value, 'Latchshot 的 upgradeRequest 不是对象')
  return {
    id: responseInteger(request.id, 'upgradeRequest.id', true),
    keyId: responseInteger(request.keyId, 'upgradeRequest.keyId', true),
    requestedPlan: responseText(request.requestedPlan, 'upgradeRequest.requestedPlan'),
    // note 用原样字符串:上游这里刻意不 trim,空串与 null 对它是两种状态。
    note: typeof request.note === 'string' ? request.note : null,
    status: responseText(request.status, 'upgradeRequest.status'),
    createdAt: responseText(request.createdAt, 'upgradeRequest.createdAt'),
    updatedAt: responseText(request.updatedAt, 'upgradeRequest.updatedAt'),
  }
}

export async function getUsage(
  _input: z.infer<typeof getUsageInput>,
  ctx: ProviderContext,
): Promise<UsageResult> {
  const apiKey = requireApiKey(ctx, SERVICE)

  let response: Response
  try {
    response = await guardedFetch(new URL(USAGE_PATH, API_BASE).toString(), {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障,还丢掉唯一有诊断价值的那句消息。
    throw upstreamError(
      502,
      error instanceof Error ? `Latchshot 请求失败: ${error.message}` : 'Latchshot 请求失败',
    )
  }

  const text = await readBoundedText(response)
  if (!response.ok) {
    throw upstreamError(
      response.status,
      errorMessage(text) ?? `Latchshot 请求失败(HTTP ${response.status})`,
    )
  }

  let payload: unknown
  try {
    payload = JSON.parse(text) as unknown
  } catch {
    throw upstreamError(502, 'Latchshot 返回了无效的 usage 响应')
  }

  const record = responseRecord(payload, 'Latchshot 的 usage 响应不是对象')
  const customer = responseRecord(record.customer, 'Latchshot 的 usage 响应缺少 customer')
  const usage = responseRecord(record.usage, 'Latchshot 的 usage 响应缺少 usage')

  return {
    customer: {
      name: responseText(customer.name, 'customer.name'),
      plan: responseText(customer.plan, 'customer.plan'),
    },
    usage: {
      period: responseText(usage.period, 'usage.period'),
      plan: responseText(usage.plan, 'usage.plan'),
      limit: responseInteger(usage.limit, 'usage.limit'),
      remaining: responseInteger(usage.remaining, 'usage.remaining'),
      resetAt: responseText(usage.resetAt, 'usage.resetAt'),
      successful: responseInteger(usage.successful, 'usage.successful'),
      failed: responseInteger(usage.failed, 'usage.failed'),
      reserved: responseInteger(usage.reserved, 'usage.reserved'),
      outputBytes: responseInteger(usage.outputBytes, 'usage.outputBytes'),
      renderMs: responseInteger(usage.renderMs, 'usage.renderMs'),
      updatedAt: usage.updatedAt === null ? null : responseText(usage.updatedAt, 'usage.updatedAt'),
    },
    upgradeRequest: normalizeUpgradeRequest(record.upgradeRequest),
    links: (() => {
      const links = responseRecord(record.links, 'Latchshot 的 usage 响应缺少 links')
      return {
        plans: responseText(links.plans, 'links.plans'),
        requestPaidPlan: responseText(links.requestPaidPlan, 'links.requestPaidPlan'),
        requestPaidPlanDocs: responseText(links.requestPaidPlanDocs, 'links.requestPaidPlanDocs'),
      }
    })(),
  }
}

/**
 * `capture_page` 暂不可用 —— 这是**平台能力缺口**,不是迁移偷懒。
 *
 * 上游把渲染出的 PNG/JPEG/PDF 字节写进它的 local transit storage,再把
 * `{fileId, downloadUrl, sizeBytes}` 回给调用方;`capturePageOutput` 里这三个字段是
 * **必填**的。tool-bridge 的 ProviderContext 没有等价存储,也没有能托管下载 URL 的地方,
 * 拿不到这个产物就凑不出合法的返回值。
 *
 * 之所以在**打上游之前**就拒绝:Latchshot 的渲染按次计费且计入月度配额,先渲染再承认
 * 交付不了,等于白烧调用方的额度。等平台补上 transit storage(或给 schema 加一条
 * "回 base64 内容"的形态)再把渲染逻辑填进来。
 *
 * 不声明形参:入参与 ctx 一个都用不上,写出来只是给 lint 添堵。入参形状仍由规格表里的
 * `capturePageInput` 把关,平台照样先校验再进这里(故非法 url 得到的是 400 而非 501)。
 */
export function capturePage(): Promise<never> {
  return Promise.reject(TBError.unimplemented(
    'capture_page 需要平台侧的 transit 文件存储来承载渲染产物,tool-bridge 尚未提供;'
    + '当前可用的是 get_usage',
  ))
}
