/**
 * Genderize 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/genderize/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Genderize 的几个特点决定了这里的形状:
 * - **API key 是 `apikey` query 参数**,不走 header;单个查询与批量查询打的是**同一个端点**,
 *   区别只在 `name=` 还是重复的 `name[]=`。
 * - 402(余额不足)与 429 都归到 rate_limited:对调用方而言两者的处置一样(等/充值后重试)。
 * - 批量返回的**条数必须与请求一致**:Genderize 按下标对齐,少一条就意味着后面全部错位,
 *   与其把错位数据交给调用方,不如当成上游契约破损。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { predictGenderBatchInput, predictGenderInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'genderize'
const API_BASE = 'https://api.genderize.io'

type Json = Record<string, unknown>

async function request(
  ctx: ProviderContext,
  input: { country_id?: string, name?: string, names?: string[] },
): Promise<unknown> {
  const url = new URL(API_BASE)
  url.searchParams.set('apikey', requireApiKey(ctx, SERVICE))
  if (input.name !== undefined && input.name !== '') url.searchParams.set('name', input.name)
  for (const name of input.names ?? []) {
    if (name !== '') url.searchParams.append('name[]', name)
  }
  if (input.country_id !== undefined && input.country_id !== '') {
    url.searchParams.set('country_id', input.country_id)
  }

  let response: Response
  let text: string
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    text = await response.text()
  } catch (error) {
    if (error instanceof TBError) throw error
    throw new TBError(
      'unavailable',
      error instanceof Error ? `Genderize 请求失败: ${error.message}` : 'Genderize 请求失败',
      { retryable: true },
    )
  }

  // 上游在解析失败时把原文当 payload 用(错误消息可能就是那段文本),这里保持同样处理。
  let payload: unknown = null
  if (text !== '') {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      payload = text
    }
  }

  if (!response.ok) {
    const error = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Json).error
      : undefined
    const message = typeof error === 'string' && error.trim() !== ''
      ? error.trim()
      : (response.statusText || `Genderize 返回 HTTP ${response.status}`)
    // 402 是"额度用完",与 429 对调用方是同一种处置。
    throw upstreamError(response.status === 402 ? 429 : response.status, message)
  }
  return payload
}

/**
 * 归一一条预测。四个字段缺任何一个都当上游契约破损:
 * probability/count 用于判断预测可信度,拿不到就没法安全使用这条结果。
 */
function normalizePrediction(payload: unknown, label: string): Json {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TBError('unavailable', `Genderize 的 ${label} 响应不是 JSON 对象`, { retryable: true })
  }
  const record = payload as Json
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (name === '') {
    throw new TBError('unavailable', `Genderize 的 ${label} 响应缺 name`, { retryable: true })
  }
  const probability = record.probability
  if (typeof probability !== 'number' || !Number.isFinite(probability)) {
    throw new TBError('unavailable', `Genderize 的 ${label} 响应缺 probability`, { retryable: true })
  }
  const count = record.count
  if (typeof count !== 'number' || !Number.isInteger(count)) {
    throw new TBError('unavailable', `Genderize 的 ${label} 响应缺 count`, { retryable: true })
  }
  // gender 为 null 是合法结果(库里没这个名字),但其他取值说明契约变了。
  const gender = record.gender
  if (gender !== null && gender !== 'male' && gender !== 'female') {
    throw new TBError('unavailable', `Genderize 的 ${label} 响应里 gender 取值不支持`, { retryable: true })
  }

  const result: Json = { name, gender, probability, count }
  const countryId = typeof record.country_id === 'string' ? record.country_id.trim() : ''
  if (countryId !== '') result.country_id = countryId
  return result
}

export async function predictGender(
  input: z.infer<typeof predictGenderInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { name: input.name, country_id: input.country_id })
  return normalizePrediction(payload, 'predict_gender')
}

export async function predictGenderBatch(
  input: z.infer<typeof predictGenderBatchInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { names: input.names, country_id: input.country_id })
  if (!Array.isArray(payload)) {
    throw new TBError('unavailable', 'Genderize 的 predict_gender_batch 响应不是数组', { retryable: true })
  }
  const predictions = payload.map((item, index) =>
    normalizePrediction(item, `predict_gender_batch[${index}]`))
  if (predictions.length !== input.names.length) {
    // 结果按下标与入参对齐,条数不符意味着后面全部错位。
    throw new TBError(
      'unavailable',
      `Genderize 对 ${input.names.length} 个名字只返回了 ${predictions.length} 条预测`,
      { retryable: true },
    )
  }
  return { predictions }
}
