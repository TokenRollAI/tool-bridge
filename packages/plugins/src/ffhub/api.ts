/**
 * FFHub 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/ffhub/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * FFHub 的响应用 snake_case,出参契约用 camelCase,`normalizeTask` 是这层重映射的唯一实现。
 * 契约里绝大多数字段是 **nullable 而非 optional**:字段缺席与"上游明确说没有"在这里被统一
 * 成 `null`(上游 `readNullableString`/`readNullableInteger` 的语义),故不能省键。
 *
 * 上游错误映射带一个 `phase` 轴(校验凭证阶段把 401/403 压成 400),还把 404 压成 400 ——
 * 后者会让"任务不存在"看起来像"参数写错了"。两者都不保留,交给 `upstreamError` 归一。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { createFfmpegTaskInput, getFfmpegTaskInput, listFfmpegTasksInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'ffhub'
const API_BASE = 'https://api.ffhub.io/v1/'

type Json = Record<string, unknown>

interface OutputFile {
  filename: string
  metadata: Json | null
  size: number | null
  url: string
}

interface Task {
  createdAt: string | null
  elapsed: string | null
  error: string | null
  finishedAt: string | null
  outputs: OutputFile[]
  progress: number | null
  status: string
  taskId: string
  totalElapsed: string | null
  userId: string | null
}

/** 上游 `optionalString`:非字符串、或去空白后为空,一律当作"没给"。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 丢掉值为 undefined 的键(上游 `compactObject`);值类型透传给调用点。 */
function compact<T>(input: Record<string, T | undefined>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, T] => entry[1] !== undefined),
  )
}

/** 契约说好是对象;不是就是上游出问题,不是调用方的错(502 → unavailable)。 */
function requireObject(value: unknown, label: string): Json {
  const object = record(value)
  if (object === undefined) throw upstreamError(502, `${label} response is not an object`)
  return object
}

function requireText(value: unknown, label: string): string {
  const result = text(value)
  if (result === undefined) throw upstreamError(502, `${label} is missing`)
  return result
}

function requireInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw upstreamError(502, `${label} is missing`)
  return value
}

/** null / 缺席 / 类型不对,三种都收敛成 `null` —— 契约把这些字段声明成 nullable 而非 optional。 */
function nullableText(value: unknown): string | null {
  return value === undefined || value === null ? null : (text(value) ?? null)
}

function nullableInt(value: unknown): number | null {
  if (value === undefined || value === null) return null
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function normalizeOutputs(value: unknown, label: string): OutputFile[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw upstreamError(502, `${label} outputs is invalid`)
  return value.map((item, index) => {
    const file = requireObject(item, `${label} output ${index}`)
    return {
      filename: requireText(file.filename, `${label} output ${index} filename`),
      url: requireText(file.url, `${label} output ${index} url`),
      size: nullableInt(file.size),
      metadata: record(file.metadata) ?? null,
    }
  })
}

function normalizeTask(value: unknown, label: string): Task {
  const task = requireObject(value, label)
  return {
    taskId: requireText(task.task_id, `${label} task_id`),
    userId: nullableText(task.user_id),
    status: requireText(task.status, `${label} status`),
    progress: nullableInt(task.progress),
    error: nullableText(task.error),
    elapsed: nullableText(task.elapsed),
    totalElapsed: nullableText(task.total_elapsed),
    createdAt: nullableText(task.created_at),
    finishedAt: nullableText(task.finished_at),
    outputs: normalizeOutputs(task.outputs, label),
  }
}

/** FFHub 的错误体是 `{message}` 或 `{error}`;拿不到就退回状态行。 */
function errorMessage(payload: unknown, response: Response): string {
  const body = record(payload)
  return text(body?.message)
    ?? text(body?.error)
    // 上游退回裸 `statusText`,而它可以是空串;这里再兜一层带状态码的消息。
    ?? text(response.statusText)
    ?? `ffhub request failed with ${response.status}`
}

interface RequestInput {
  body?: Json
  method?: 'GET' | 'POST'
  query?: Record<string, boolean | number | string | undefined>
}

async function request(ctx: ProviderContext, path: string, input: RequestInput = {}): Promise<unknown> {
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  const response = await guardedFetch(url.toString(), {
    method: input.method ?? 'GET',
    headers,
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  })

  // 空体读成 null、非 JSON 读成原文:FFHub 的错误路径两种都出现过。
  const raw = await response.text().catch(() => '')
  let payload: unknown = null
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = raw
    }
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response))
  return payload
}

/** 纯空白的必填串能过 Zod 的 `min(1)`,打到上游就是一次必然失败的调用,先挡下。 */
function requireInput(value: string | undefined, field: string): string {
  if (value === undefined) throw new TBError('invalid_argument', `${field} is required`)
  return value
}

export async function createFfmpegTask(
  input: z.infer<typeof createFfmpegTaskInput>,
  ctx: ProviderContext,
): Promise<{ taskId: string }> {
  const payload = await request(ctx, 'tasks', {
    method: 'POST',
    // command 过一道 text():schema 只挡住长度 0,纯空白仍能通过,而它会变成一条空的
    // FFmpeg 命令。webhook 同理:空白串不该被当成"配了回调"。
    body: compact({
      command: requireInput(text(input.command), 'command'),
      webhook: text(input.webhook),
      with_metadata: input.withMetadata,
    }),
  })
  const body = requireObject(payload, 'ffhub create_ffmpeg_task')
  return { taskId: requireText(body.task_id, 'ffhub create_ffmpeg_task task_id') }
}

export async function getFfmpegTask(
  input: z.infer<typeof getFfmpegTaskInput>,
  ctx: ProviderContext,
): Promise<{ task: Task }> {
  const taskId = requireInput(text(input.taskId), 'taskId')
  const payload = await request(ctx, `tasks/${encodeURIComponent(taskId)}`)
  return { task: normalizeTask(payload, 'ffhub get_ffmpeg_task') }
}

export async function listFfmpegTasks(
  input: z.infer<typeof listFfmpegTasksInput>,
  ctx: ProviderContext,
): Promise<{ tasks: Task[], total: number }> {
  const payload = await request(ctx, 'tasks', {
    query: compact({
      user_id: text(input.userId),
      status: input.status,
      limit: input.limit,
      offset: input.offset,
    }),
  })

  const body = requireObject(payload, 'ffhub list_ffmpeg_tasks')
  if (!Array.isArray(body.tasks)) throw upstreamError(502, 'ffhub list_ffmpeg_tasks response.tasks is invalid')
  return {
    tasks: body.tasks.map((task, index) => normalizeTask(task, `ffhub list_ffmpeg_tasks task ${index}`)),
    total: requireInt(body.total, 'ffhub list_ffmpeg_tasks total'),
  }
}
