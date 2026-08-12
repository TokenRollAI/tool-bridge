/**
 * Alt Text Generator AI 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/alt_text_generator_ai/executors.ts`,
 * 语义等价、写法本地化:凭证从 `ctx.upstreamAuth` 取(平台注入,插件不自持),
 * 出站走 `guardedFetch`,错误抛 `TBError` 七码。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { generateAltTextInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'alt_text_generator_ai'
const BASE_URL = 'https://alttextgeneratorai.com'

/** 上游只回纯文本(有时是一个 JSON 字符串字面量),两种都收。 */
function unwrapText(body: string): string | undefined {
  const trimmed = body.trim()
  if (trimmed === '') return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === 'string' && parsed.trim() !== '') return parsed.trim()
  } catch {
    // 不是 JSON,就按纯文本用。
  }
  return trimmed
}

export async function generateAltText(
  input: z.infer<typeof generateAltTextInput>,
  ctx: ProviderContext,
): Promise<{ altText: string }> {
  const response = await guardedFetch(`${BASE_URL}/api/wp`, {
    method: 'POST',
    headers: { 'accept': 'text/plain', 'content-type': 'application/json' },
    body: JSON.stringify({ image: input.imageUrl ?? '', wpkey: requireApiKey(ctx, SERVICE) }),
  })

  const body = await response.text()
  if (!response.ok) {
    throw upstreamError(response.status, body.trim() || `Alt Text Generator AI 返回 HTTP ${response.status}`)
  }

  const altText = unwrapText(body)
  if (altText === undefined) {
    throw new TBError('unavailable', 'Alt Text Generator AI 返回了空结果', { retryable: true })
  }
  return { altText }
}
