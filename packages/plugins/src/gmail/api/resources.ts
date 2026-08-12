/**
 * Gmail 三种资源(message / thread / draft)的取用与形状断言。
 *
 * 上游 `getMessageResource` / `getThreadResource` / `getDraftResource` 直接把 `response.json()`
 * 强转成资源类型,一旦上游改了形状,错误会在整形函数深处以 `undefined is not a function` 的
 * 形态冒出来。这里在入口处断言一次:少了 `id` / `threadId` 就是**上游形状不符契约**,按
 * `unavailable` + retryable 归一,而不是伪装成调用方的错。
 */

import { TBError } from '@tool-bridge/plugin-sdk'
import type { GmailDraftResource, GmailMessageResource, GmailThreadResource } from './message'
import type { ProviderContext } from '../../_runtime/plugin'
import { type Json, requestJson, requireRecord } from './shared'

function shapeError(label: string, detail: string): TBError {
  return new TBError('unavailable', `Gmail 的 ${label} ${detail}`, { retryable: true })
}

export function asMessageResource(payload: unknown, label: string): GmailMessageResource {
  const value: Json = requireRecord(payload, label)
  if (typeof value.id !== 'string' || typeof value.threadId !== 'string') {
    throw shapeError(label, '缺 id 或 threadId')
  }
  return value as unknown as GmailMessageResource
}

export function asThreadResource(payload: unknown, label: string): GmailThreadResource {
  const value: Json = requireRecord(payload, label)
  if (typeof value.id !== 'string') throw shapeError(label, '缺 id')
  return value as unknown as GmailThreadResource
}

export function asDraftResource(payload: unknown, label: string): GmailDraftResource {
  const value: Json = requireRecord(payload, label)
  if (typeof value.id !== 'string') throw shapeError(label, '缺 id')
  // 草稿的 message 一定在:后面的整形(收件人回填、正文提取)全靠它。
  asMessageResource(value.message, `${label} 的 message`)
  return value as unknown as GmailDraftResource
}

export async function getMessageResource(
  ctx: ProviderContext,
  messageId: string,
  format: string,
): Promise<GmailMessageResource> {
  return asMessageResource(
    await requestJson(ctx, { path: ['messages', messageId], query: { format } }),
    'message 响应',
  )
}

export async function getThreadResource(
  ctx: ProviderContext,
  threadId: string,
  format: string,
): Promise<GmailThreadResource> {
  return asThreadResource(
    await requestJson(ctx, { path: ['threads', threadId], query: { format } }),
    'thread 响应',
  )
}

export async function getDraftResource(
  ctx: ProviderContext,
  draftId: string,
  format: string,
): Promise<GmailDraftResource> {
  return asDraftResource(
    await requestJson(ctx, { path: ['drafts', draftId], query: { format } }),
    'draft 响应',
  )
}
