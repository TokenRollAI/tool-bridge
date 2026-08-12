/**
 * 消息与会话的读取、标签变更与回收站操作(上游 executors.ts 的 messages / threads 一族)。
 *
 * 两处最容易迁丢的地方,各配了一条测试钉住:
 * - **`fetch_emails` 的 detail 三档**:`ids` 只回列表接口拿到的 id 对(不再打详情),`summary`
 *   用 `format=metadata` 拉头部,`full` 用 `format=full` 拉正文。档位选错的后果不是报错,而是
 *   静默多打 N 次上游或静默丢掉正文。
 * - **`maxResults` 的默认值只在 `fetch_emails` 上有**(20):`list_threads` / `list_drafts` 不给就
 *   不发这个参数,由 Gmail 用它自己的默认值(100)。两者不能统一。
 */

import type { z } from 'zod/v4'
import type {
  addLabelToEmailInput,
  batchModifyMessagesInput,
  fetchEmailsInput,
  fetchMessageByMessageIdInput,
  fetchMessageByThreadIdInput,
  getMessageInput,
  listThreadsInput,
  modifyThreadLabelsInput,
  moveThreadToTrashInput,
  moveToTrashInput,
  searchThreadsInput,
  untrashMessageInput,
  untrashThreadInput,
} from '../schema'
import type { ProviderContext } from '../../_runtime/plugin'
import {
  hydrateInBatches,
  type Json,
  labelMutationPayload,
  normalizeFormat,
  optionalString,
  recordArray,
  requestEmpty,
  requestJson,
  requireRecord,
  toStringArray,
  trimmedString,
} from './shared'
import {
  type GmailThreadResource,
  normalizeGmailMessage,
  normalizeMessageId,
  normalizeThreadId,
  readHeader,
  summarizeGmailMessage,
} from './message'
import { asMessageResource, asThreadResource, getMessageResource, getThreadResource } from './resources'

/** 只有 `fetch_emails` 有默认页大小;别的列表 action 不给就交给 Gmail 的默认值。 */
const DEFAULT_FETCH_EMAILS_MAX_RESULTS = 20

type ThreadListResult = {
  nextPageToken: string | null
  resultSizeEstimate: unknown
  threads: Json[]
}

/** 出参里的 thread 摘要(verbose 时再挂上 messages)。 */
function threadSummary(thread: GmailThreadResource): Json {
  return {
    threadId: thread.id,
    snippet: thread.snippet ?? '',
    historyId: thread.historyId ?? null,
    messages: (thread.messages ?? []).map(message => normalizeGmailMessage(message)),
  }
}

/**
 * `list_threads` 与 `search_threads` 共用的这一段。`verbose` 才逐个拉全文 —— 一页 100 个会话
 * 各带十几封信,不设这个开关的话默认调用就是上百次上游请求。
 */
async function listThreads(
  input: { maxResults?: number, pageToken?: string, query?: string, verbose?: boolean },
  ctx: ProviderContext,
): Promise<ThreadListResult> {
  const query = trimmedString(input.query)
  const payload = requireRecord(await requestJson(ctx, {
    path: ['threads'],
    query: {
      q: query === '' ? undefined : query,
      pageToken: input.pageToken,
      maxResults: input.maxResults,
    },
  }), 'threads 响应')
  const threads = recordArray(payload.threads, 'threads')
  const nextPageToken = optionalString(payload.nextPageToken) ?? null

  if (input.verbose === true) {
    const hydrated = await hydrateInBatches(threads, thread =>
      getThreadResource(ctx, String(thread.id), 'full'))
    return {
      threads: hydrated.map(thread => threadSummary(thread)),
      nextPageToken,
      resultSizeEstimate: payload.resultSizeEstimate ?? hydrated.length,
    }
  }

  return {
    threads: threads.map(thread => ({
      threadId: String(thread.id),
      snippet: optionalString(thread.snippet) ?? '',
      historyId: optionalString(thread.historyId) ?? null,
    })),
    nextPageToken,
    resultSizeEstimate: payload.resultSizeEstimate ?? threads.length,
  }
}

export async function searchThreads(
  input: z.infer<typeof searchThreadsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const output = await listThreads(input, ctx)
  // search 的出参只留 threadId + snippet:它是"给 agent 挑一个会话"用的,不是分页遍历用的
  // (故连 nextPageToken 都不透出 —— 要翻页就用 list_threads)。
  return {
    threads: output.threads.map(thread => ({
      threadId: thread.threadId,
      snippet: thread.snippet,
    })),
  }
}

export async function listThreadsAction(
  input: z.infer<typeof listThreadsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { ...await listThreads(input, ctx) }
}

export async function fetchEmails(input: z.infer<typeof fetchEmailsInput>, ctx: ProviderContext): Promise<Json> {
  const query = trimmedString(input.query)
  const labelIds = toStringArray(input.labelIds)
  const payload = requireRecord(await requestJson(ctx, {
    path: ['messages'],
    query: {
      q: query === '' ? undefined : query,
      labelIds: labelIds.length > 0 ? labelIds : undefined,
      pageToken: input.pageToken,
      // 上游还做了一次 1..500 的范围校验;那层现在由 schema 的 `z.int().min(1).max(500)` 承担,
      // 越界在进 handler 前就已经是 invalid_argument 了。
      maxResults: input.maxResults ?? DEFAULT_FETCH_EMAILS_MAX_RESULTS,
      includeSpamTrash: input.includeSpamTrash,
    },
  }), 'messages 响应')
  const messages = recordArray(payload.messages, 'messages')
  const nextPageToken = optionalString(payload.nextPageToken) ?? null

  const detail = trimmedString(input.detail) || 'summary'
  if (detail === 'ids') {
    return {
      messages: messages.map(message => ({
        messageId: String(message.id),
        threadId: String(message.threadId),
      })),
      nextPageToken,
      resultSizeEstimate: payload.resultSizeEstimate ?? messages.length,
    }
  }

  const includeFullMessage = detail === 'full'
  const hydrated = await hydrateInBatches(messages, message =>
    getMessageResource(ctx, String(message.id), includeFullMessage ? 'full' : 'metadata'))

  return {
    messages: hydrated.map(message =>
      includeFullMessage ? normalizeGmailMessage(message) : summarizeGmailMessage(message)),
    nextPageToken,
    resultSizeEstimate: payload.resultSizeEstimate ?? hydrated.length,
  }
}

/** `get_message` 是 `fetch_message_by_message_id` 的简化出参版(平铺 6 个字段,不带 payload)。 */
export async function getMessage(input: z.infer<typeof getMessageInput>, ctx: ProviderContext): Promise<Json> {
  const message = await getMessageResource(ctx, normalizeMessageId(input.messageId), 'full')
  const output = normalizeGmailMessage(message)
  return {
    messageId: output.messageId,
    threadId: output.threadId,
    subject: output.subject,
    from: output.sender,
    to: output.to,
    // date 取的是原始 `Date` 头,而不是 normalize 出来的 ISO 时间戳 —— 两者是不同的东西。
    date: readHeader(message.payload?.headers ?? [], 'Date'),
    body: output.messageText,
  }
}

export async function fetchMessageByMessageId(
  input: z.infer<typeof fetchMessageByMessageIdInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const message = await getMessageResource(
    ctx,
    normalizeMessageId(input.messageId),
    normalizeFormat(input.format, 'full'),
  )
  return { ...normalizeGmailMessage(message) }
}

export async function fetchMessageByThreadId(
  input: z.infer<typeof fetchMessageByThreadIdInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const thread = await getThreadResource(ctx, normalizeThreadId(input.threadId), 'full')
  return {
    threadId: thread.id,
    historyId: thread.historyId ?? null,
    messages: (thread.messages ?? []).map(message => normalizeGmailMessage(message)),
  }
}

export async function addLabelToEmail(
  input: z.infer<typeof addLabelToEmailInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const message = asMessageResource(await requestJson(ctx, {
    method: 'POST',
    path: ['messages', normalizeMessageId(input.messageId), 'modify'],
    body: labelMutationPayload(input),
  }), 'message 响应')
  return { ...normalizeGmailMessage(message) }
}

export async function batchModifyMessages(
  input: z.infer<typeof batchModifyMessagesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // batchModify 回 204 空体,没有可整形的结果,故出参只是"做完了"。
  await requestEmpty(ctx, {
    method: 'POST',
    path: ['messages', 'batchModify'],
    body: { ids: toStringArray(input.messageIds), ...labelMutationPayload(input) },
  })
  return { success: true }
}

async function messageAction(messageId: unknown, action: string, ctx: ProviderContext): Promise<Json> {
  const message = asMessageResource(await requestJson(ctx, {
    method: 'POST',
    path: ['messages', normalizeMessageId(messageId), action],
  }), 'message 响应')
  return { ...normalizeGmailMessage(message) }
}

async function threadAction(
  threadId: unknown,
  action: string,
  ctx: ProviderContext,
  body?: Json,
): Promise<Json> {
  const thread = asThreadResource(await requestJson(ctx, {
    method: 'POST',
    path: ['threads', normalizeThreadId(threadId), action],
    body,
  }), 'thread 响应')
  return {
    threadId: thread.id,
    historyId: thread.historyId ?? null,
    messages: (thread.messages ?? []).map(message => normalizeGmailMessage(message)),
  }
}

export function moveToTrash(input: z.infer<typeof moveToTrashInput>, ctx: ProviderContext): Promise<Json> {
  // 入参收 addLabelIds/removeLabelIds 是历史包袱:trash 端点不吃请求体,那两个字段上游也不发。
  return messageAction(input.messageId, 'trash', ctx)
}

export function untrashMessage(input: z.infer<typeof untrashMessageInput>, ctx: ProviderContext): Promise<Json> {
  return messageAction(input.messageId, 'untrash', ctx)
}

export function modifyThreadLabels(
  input: z.infer<typeof modifyThreadLabelsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return threadAction(input.threadId, 'modify', ctx, labelMutationPayload(input))
}

export function moveThreadToTrash(
  input: z.infer<typeof moveThreadToTrashInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return threadAction(input.threadId, 'trash', ctx)
}

export function untrashThread(input: z.infer<typeof untrashThreadInput>, ctx: ProviderContext): Promise<Json> {
  return threadAction(input.threadId, 'untrash', ctx)
}
