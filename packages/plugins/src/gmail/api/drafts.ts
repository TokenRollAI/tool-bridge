/**
 * 发信、回信与草稿(上游 executors.ts 的 send / reply / drafts 一族)。
 *
 * 这一族是整个 provider 里语义最绕的部分,四处上游细节决定了这里的形状:
 * - **`update_draft` 是"就地合并",不是"整体覆盖"**:没给的字段从草稿现有的头部回填(收件人、
 *   主题、正文、发信别名)。区分"给了空串"与"没给"靠 `Object.hasOwn` —— 用 `?? ''` 判会把
 *   "把正文清空"当成"没提正文",于是清不掉。Zod 解析后未给的可选字段是**缺席**而不是
 *   `undefined` 值,故 `hasOwn` 在这一层仍然有效。
 * - **回复的 Subject 由原信决定**,`reply_to_thread` 的入参虽然收 `subject`,上游从不用它 ——
 *   改主题会让邮件客户端把回信断成新会话。这里照抄(`fromEmail` 同理:回信不发 From 头)。
 * - **`reply_email` 的出参只有 messageId**:上游内层算出了 threadId 却在外层丢掉了,保留这个
 *   差异 —— 出参声明里也没有 threadId,补上就是改契约。
 * - **正文的两个字段名**:`body` 与 `messageBody`。`send_email` / `create_*_draft` 取
 *   `body || messageBody`,`reply_to_thread` 取 `messageBody || body` —— 优先级是反的,不是笔误。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createDraftInput,
  createEmailDraftInput,
  deleteDraftInput,
  getDraftInput,
  listDraftsInput,
  replyEmailInput,
  replyToThreadInput,
  sendDraftInput,
  sendEmailInput,
  updateDraftInput,
} from '../schema'
import type { ProviderContext } from '../../_runtime/plugin'
import {
  buildRecipients,
  encodeMimeMessage,
  extractBodyContent,
  firstAddress,
  normalizeGmailMessage,
  normalizeMessageId,
  normalizeThreadId,
  parseAddressList,
  readHeader,
  resolveReplyHeaders,
} from './message'
import {
  hydrateInBatches,
  type Json,
  normalizeFormat,
  optionalString,
  record,
  recordArray,
  requestEmpty,
  requestJson,
  requireRecord,
  trimmedString,
} from './shared'
import { getDraftResource, getMessageResource, getThreadResource } from './resources'

/** 发信/回信共用的出参形状:Gmail 回 `{id, threadId?}`。 */
type SentMessage = {
  id: string
  threadId: string | undefined
}

/** 草稿创建/更新的出参形状:Gmail 回 `{id, message:{id, threadId}}`。 */
type DraftMutation = {
  draftId: string
  messageId: string
  threadId: string
}

function asSentMessage(payload: unknown): SentMessage {
  const value = requireRecord(payload, 'send 响应')
  if (typeof value.id !== 'string') {
    throw new TBError('unavailable', 'Gmail 的 send 响应缺 id', { retryable: true })
  }
  return { id: value.id, threadId: optionalString(value.threadId) }
}

function asDraftMutation(payload: unknown): DraftMutation {
  const draft = requireRecord(payload, 'draft 响应')
  const message = record(draft.message)
  if (typeof draft.id !== 'string') {
    throw new TBError('unavailable', 'Gmail 的 draft 响应缺 id', { retryable: true })
  }
  return {
    draftId: draft.id,
    messageId: optionalString(message?.id) ?? '',
    threadId: optionalString(message?.threadId) ?? '',
  }
}

/** 回信必须带 `threadId` 一起发,否则 Gmail 会把它当成一封新信另起会话。 */
async function sendThreadMessage(ctx: ProviderContext, threadId: string, raw: string): Promise<SentMessage> {
  return asSentMessage(await requestJson(ctx, {
    method: 'POST',
    path: ['messages', 'send'],
    body: { threadId, raw },
  }))
}

/** `create_draft` / `create_email_draft` 共用:两者只差出参裁剪。 */
async function createDraftResource(input: {
  bcc?: string | string[]
  body?: string
  cc?: string | string[]
  extraRecipients?: string[]
  fromEmail?: string
  isHtml?: boolean
  messageBody?: string
  recipientEmail?: string
  subject?: string
  threadId?: string
  to?: string
}, ctx: ProviderContext): Promise<DraftMutation> {
  const recipients = buildRecipients(input)
  return asDraftMutation(await requestJson(ctx, {
    method: 'POST',
    path: ['drafts'],
    body: {
      message: {
        raw: encodeMimeMessage({
          to: recipients.to,
          cc: recipients.cc,
          bcc: recipients.bcc,
          subject: trimmedString(input.subject),
          body: trimmedString(input.body) || trimmedString(input.messageBody),
          isHtml: input.isHtml === true,
          from: trimmedString(input.fromEmail),
        }),
        threadId: trimmedString(input.threadId) ? normalizeThreadId(input.threadId) : undefined,
      },
    },
  }))
}

export async function sendEmail(input: z.infer<typeof sendEmailInput>, ctx: ProviderContext): Promise<Json> {
  const recipients = buildRecipients(input)
  const sent = asSentMessage(await requestJson(ctx, {
    method: 'POST',
    path: ['messages', 'send'],
    body: {
      raw: encodeMimeMessage({
        to: recipients.to,
        cc: recipients.cc,
        bcc: recipients.bcc,
        subject: trimmedString(input.subject),
        body: trimmedString(input.body) || trimmedString(input.messageBody),
        isHtml: input.isHtml === true,
        from: trimmedString(input.fromEmail),
      }),
    },
  }))
  return { messageId: sent.id }
}

export async function replyEmail(input: z.infer<typeof replyEmailInput>, ctx: ProviderContext): Promise<Json> {
  const message = await getMessageResource(ctx, normalizeMessageId(input.messageId), 'full')
  const replyHeaders = resolveReplyHeaders(message)
  // 会话锚点优先用原信自己报的 threadId;入参里的那个只在原信没报时兜底。
  const threadId = normalizeThreadId(message.threadId || input.threadId)
  const sent = await sendThreadMessage(ctx, threadId, encodeMimeMessage({
    to: [replyHeaders.to],
    subject: replyHeaders.subject,
    body: trimmedString(input.body),
    inReplyTo: replyHeaders.inReplyTo,
    references: replyHeaders.references,
  }))
  return { messageId: sent.id }
}

export async function replyToThread(
  input: z.infer<typeof replyToThreadInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const thread = await getThreadResource(ctx, normalizeThreadId(input.threadId), 'full')
  const target = thread.messages?.at(-1)
  if (target === undefined) {
    // 空会话没有可回复的对象,也没有可继承的 Message-ID:这是调用方给错了 threadId。
    throw new TBError('invalid_argument', 'thread 里没有任何消息,无法回复')
  }

  const recipients = buildRecipients(input)
  const replyHeaders = resolveReplyHeaders(target)
  const sent = await sendThreadMessage(ctx, thread.id, encodeMimeMessage({
    to: recipients.to.length > 0 ? recipients.to : [replyHeaders.to],
    cc: recipients.cc,
    bcc: recipients.bcc,
    subject: replyHeaders.subject,
    body: trimmedString(input.messageBody) || trimmedString(input.body),
    isHtml: input.isHtml === true,
    inReplyTo: replyHeaders.inReplyTo,
    references: replyHeaders.references,
  }))
  return { messageId: sent.id, threadId: sent.threadId ?? thread.id }
}

export async function createDraft(input: z.infer<typeof createDraftInput>, ctx: ProviderContext): Promise<Json> {
  const { draftId } = await createDraftResource(input, ctx)
  return { draftId }
}

export async function createEmailDraft(
  input: z.infer<typeof createEmailDraftInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { ...await createDraftResource(input, ctx) }
}

export async function listDrafts(input: z.infer<typeof listDraftsInput>, ctx: ProviderContext): Promise<Json> {
  const payload = requireRecord(await requestJson(ctx, {
    path: ['drafts'],
    query: { pageToken: input.pageToken, maxResults: input.maxResults },
  }), 'drafts 响应')
  const drafts = recordArray(payload.drafts, 'drafts')
  const nextPageToken = optionalString(payload.nextPageToken) ?? null

  if (input.verbose === true) {
    const hydrated = await hydrateInBatches(drafts, draft =>
      getDraftResource(ctx, String(draft.id), 'full'))
    return {
      drafts: hydrated.map(draft => ({ id: draft.id, message: normalizeGmailMessage(draft.message) })),
      nextPageToken,
    }
  }

  return {
    drafts: drafts.map(draft => ({
      id: String(draft.id),
      // 非 verbose 时列表接口只回 id 对,其余字段一律缺席 —— 用空串而不是 null 占位,
      // 与出参声明(message 的字段都是 string)对齐。
      message: {
        messageId: optionalString(record(draft.message)?.id) ?? '',
        threadId: optionalString(record(draft.message)?.threadId) ?? '',
      },
    })),
    nextPageToken,
  }
}

export async function getDraft(input: z.infer<typeof getDraftInput>, ctx: ProviderContext): Promise<Json> {
  const draft = await getDraftResource(
    ctx,
    normalizeMessageId(input.draftId),
    normalizeFormat(input.format, 'full'),
  )
  return { id: draft.id, message: normalizeGmailMessage(draft.message) }
}

export async function updateDraft(input: z.infer<typeof updateDraftInput>, ctx: ProviderContext): Promise<Json> {
  const draftId = normalizeMessageId(input.draftId)
  const existing = await getDraftResource(ctx, draftId, 'full')
  const headers = existing.message.payload?.headers ?? []

  // 每一族收件人各自决定"用新的还是留旧的":给了非空表就整族替换,没给就从原草稿的头部解析回来。
  const next = buildRecipients(input)
  const recipients = buildRecipients({
    to: next.to.length > 0 ? next.to : parseAddressList(readHeader(headers, 'To')),
    cc: next.cc.length > 0 ? next.cc : parseAddressList(readHeader(headers, 'Cc')),
    bcc: next.bcc.length > 0 ? next.bcc : parseAddressList(readHeader(headers, 'Bcc')),
  })

  const existingBody = extractBodyContent(existing.message.payload ?? null)
  const body = Object.hasOwn(input, 'body')
    ? trimmedString(input.body)
    : Object.hasOwn(input, 'messageBody')
      ? trimmedString(input.messageBody)
      : existingBody.body
  const threadId = trimmedString(input.threadId) || existing.message.threadId

  const mutation = asDraftMutation(await requestJson(ctx, {
    method: 'PUT',
    path: ['drafts', draftId],
    body: {
      id: draftId,
      message: {
        raw: encodeMimeMessage({
          to: recipients.to,
          cc: recipients.cc,
          bcc: recipients.bcc,
          subject: trimmedString(input.subject) || readHeader(headers, 'Subject'),
          body,
          // 没显式给 isHtml 就沿用原草稿的正文类型,免得一次改标题把 HTML 信降成纯文本。
          isHtml: typeof input.isHtml === 'boolean' ? input.isHtml : existingBody.isHtml,
          from: trimmedString(input.fromEmail) || firstAddress(readHeader(headers, 'From')),
        }),
        threadId: threadId ? normalizeThreadId(threadId) : undefined,
      },
    },
  }))
  return { ...mutation }
}

export async function sendDraft(input: z.infer<typeof sendDraftInput>, ctx: ProviderContext): Promise<Json> {
  const sent = asSentMessage(await requestJson(ctx, {
    method: 'POST',
    path: ['drafts', 'send'],
    body: { id: normalizeMessageId(input.draftId) },
  }))
  return { messageId: sent.id, threadId: sent.threadId ?? null }
}

export async function deleteDraft(input: z.infer<typeof deleteDraftInput>, ctx: ProviderContext): Promise<Json> {
  await requestEmpty(ctx, { method: 'DELETE', path: ['drafts', normalizeMessageId(input.draftId)] })
  return { success: true }
}
