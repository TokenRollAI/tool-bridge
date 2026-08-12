/**
 * Chatwork 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/chatwork/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Chatwork 的两个特点决定了这里的形状:
 * - 凭证走 `X-ChatWorkToken` 头,不是 Authorization;
 * - 写操作的请求体是 **form-encoded**,布尔选项要发成 `1`(不发即为关),
 *   `assigneeAccountIds` 之类的多值要拼成逗号串。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createTaskInput,
  deleteMessageInput,
  getMessageInput,
  getRoomInput,
  getTaskInput,
  listMyTasksInput,
  listRoomMembersInput,
  listRoomMessagesInput,
  listRoomTasksInput,
  postMessageInput,
  updateMessageInput,
  updateTaskStatusInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'chatwork'
const API_BASE = 'https://api.chatwork.com/v2'

type Json = Record<string, unknown>
type FormValue = number | string | undefined

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

/** 上游响应形状不符合契约:不是调用方能修的问题。 */
function upstreamBroken(what: string): TBError {
  return new TBError('unavailable', what, { retryable: true })
}

interface RequestOptions {
  form?: Record<string, FormValue>
  method?: 'DELETE' | 'GET' | 'POST' | 'PUT'
  query?: Record<string, FormValue>
}

/** 只保留有值的项(上游 `queryParams` 的语义:undefined/null/空串一律跳过)。 */
function pairs(input: Record<string, FormValue>): Array<[string, string]> {
  return Object.entries(input)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => [key, String(value)])
}

async function requestPayload(
  ctx: ProviderContext,
  path: string,
  options: RequestOptions = {},
): Promise<unknown> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of pairs(options.query ?? {})) url.searchParams.set(key, value)

  const body = options.form === undefined
    ? undefined
    : new URLSearchParams(pairs(options.form)).toString()

  const response = await guardedFetch(url.toString(), {
    method: options.method ?? 'GET',
    headers: {
      'accept': 'application/json',
      'x-chatworktoken': requireApiKey(ctx, SERVICE),
      ...(body === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
    },
    ...(body === undefined ? {} : { body }),
  })

  const raw = await response.text()
  let payload: unknown = null
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw)
    } catch {
      // 失败响应允许是纯文本(Chatwork 的网关层会这么回),成功响应必须是 JSON。
      if (response.ok) throw upstreamBroken('Chatwork 返回了非法 JSON')
      payload = raw
    }
  }

  if (!response.ok) {
    const object = record(payload)
    const errors = Array.isArray(object?.errors) ? object.errors.join(', ') : undefined
    const message = errors ?? text(object?.message) ?? text(payload) ?? response.statusText
      ?? `Chatwork request failed with HTTP ${response.status}`
    throw upstreamError(response.status, message)
  }
  return payload
}

async function requestObject(
  ctx: ProviderContext,
  path: string,
  options: RequestOptions = {},
): Promise<Json> {
  const object = record(await requestPayload(ctx, path, options))
  if (object === undefined) throw upstreamBroken('Chatwork 返回了非对象响应')
  return object
}

async function requestArray(
  ctx: ProviderContext,
  path: string,
  options: RequestOptions = {},
): Promise<unknown[]> {
  const payload = await requestPayload(ctx, path, options)
  if (!Array.isArray(payload)) throw upstreamBroken('Chatwork 返回了非数组响应')
  return payload
}

/** 上游返回的正整数 id;拿不到说明响应破损。 */
function upstreamPositive(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isInteger(parsed) || parsed <= 0) throw upstreamBroken(`Chatwork 返回的 ${field} 非法`)
  return parsed
}

// —— handlers ——

export async function getMe(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return { profile: await requestObject(ctx, '/me') }
}

export async function getContacts(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return { contacts: await requestArray(ctx, '/contacts') }
}

export async function listRooms(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return { rooms: await requestArray(ctx, '/rooms') }
}

export async function getRoom(
  input: z.infer<typeof getRoomInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { room: await requestObject(ctx, `/rooms/${input.roomId}`) }
}

export async function listRoomMembers(
  input: z.infer<typeof listRoomMembersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { members: await requestArray(ctx, `/rooms/${input.roomId}/members`) }
}

export async function listRoomMessages(
  input: z.infer<typeof listRoomMessagesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestPayload(ctx, `/rooms/${input.roomId}/messages`, {
    query: { force: input.force === true ? 1 : undefined },
  })
  // 没有新消息时 Chatwork 回 204 空体,不是数组 —— 归成空列表而不是报错。
  return { messages: Array.isArray(payload) ? payload : [] }
}

export async function getMessage(
  input: z.infer<typeof getMessageInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/rooms/${input.roomId}/messages/${encodeURIComponent(input.messageId)}`
  return { message: await requestObject(ctx, path) }
}

export async function postMessage(
  input: z.infer<typeof postMessageInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestObject(ctx, `/rooms/${input.roomId}/messages`, {
    method: 'POST',
    form: { body: input.body, self_unread: input.selfUnread === true ? 1 : undefined },
  })
  const messageId = text(payload.message_id)
  if (messageId === undefined) throw upstreamBroken('Chatwork 返回的 message_id 非法')
  return { messageId }
}

export async function updateMessage(
  input: z.infer<typeof updateMessageInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/rooms/${input.roomId}/messages/${encodeURIComponent(input.messageId)}`
  const payload = record(await requestPayload(ctx, path, { method: 'PUT', form: { body: input.body } }))
  // 上游有时不回 message_id;退回入参的那个,调用方总能拿到一个可用的 id。
  return { messageId: text(payload?.message_id) ?? input.messageId }
}

export async function deleteMessage(
  input: z.infer<typeof deleteMessageInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/rooms/${input.roomId}/messages/${encodeURIComponent(input.messageId)}`
  const payload = record(await requestPayload(ctx, path, { method: 'DELETE' }))
  return { messageId: text(payload?.message_id) ?? input.messageId }
}

export async function listMyTasks(
  input: z.infer<typeof listMyTasksInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return {
    tasks: await requestArray(ctx, '/my/tasks', {
      query: { assigned_by_account_id: input.assignedByAccountId, status: input.status },
    }),
  }
}

export async function listRoomTasks(
  input: z.infer<typeof listRoomTasksInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return {
    tasks: await requestArray(ctx, `/rooms/${input.roomId}/tasks`, {
      query: {
        account_id: input.accountId,
        assigned_by_account_id: input.assignedByAccountId,
        status: input.status,
      },
    }),
  }
}

export async function getTask(
  input: z.infer<typeof getTaskInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { task: await requestObject(ctx, `/rooms/${input.roomId}/tasks/${input.taskId}`) }
}

export async function createTask(
  input: z.infer<typeof createTaskInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const form: Record<string, FormValue> = {
    body: input.body,
    to_ids: input.assigneeAccountIds.join(','),
  }
  if (input.limitTime !== undefined) {
    // limit_type 只在给了 limit 时才有意义;上游默认 'time'。
    form.limit = input.limitTime
    form.limit_type = input.limitType ?? 'time'
  }
  const payload = await requestObject(ctx, `/rooms/${input.roomId}/tasks`, { method: 'POST', form })
  return {
    taskIds: Array.isArray(payload.task_ids)
      ? payload.task_ids.map(value => upstreamPositive(value, 'task_ids'))
      : [],
  }
}

export async function updateTaskStatus(
  input: z.infer<typeof updateTaskStatusInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestObject(ctx, `/rooms/${input.roomId}/tasks/${input.taskId}/status`, {
    method: 'PUT',
    // 状态值走 form 里的 body 字段 —— Chatwork 这个端点的参数名就叫 body。
    form: { body: input.status },
  })
  return {
    taskId: payload.task_id == null ? input.taskId : upstreamPositive(payload.task_id, 'task_id'),
  }
}
