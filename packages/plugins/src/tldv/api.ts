/**
 * tl;dv 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/tldv/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * tl;dv 的 API 主机是 `pasta.tldv.io`(不是 tldv.io),版本段 `v1alpha1` 拼在每条路径前;
 * 凭证走 `x-api-key` 头而非 Bearer。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getMeetingInput,
  getNotesInput,
  getTranscriptInput,
  importMeetingInput,
  listMeetingsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'tldv'
const API_BASE = 'https://pasta.tldv.io'
const API_VERSION = 'v1alpha1'

type Json = Record<string, unknown>

/**
 * schema 把 `meetingId` 标成可选(生成器按上游 action 定义照搬,而上游那边靠 executor 里的
 * `requiredString` 兜底),所以这道必填检查不能省 —— 否则会打出 `/meetings/undefined`。
 */
function meetingPath(meetingId: string | undefined, suffix = ''): string {
  if (meetingId === undefined || meetingId.trim() === '') {
    throw new TBError('invalid_argument', 'meetingId 不能为空')
  }
  return `/meetings/${encodeURIComponent(meetingId)}${suffix}`
}

/** 上游 `extractProviderErrorMessage` 的口径:按这串键名依次找第一个非空字符串。 */
function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Json
    for (const key of ['message', 'Message', 'error', 'Error', 'detail', 'Detail', 'title', 'Title']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim() !== '') return value
    }
  }
  return `tl;dv request failed with HTTP ${status}`
}

interface RequestInput {
  body?: Json
  method?: 'GET' | 'POST'
  query?: Record<string, boolean | number | string | undefined>
}

async function request(ctx: ProviderContext, path: string, init: RequestInput = {}): Promise<unknown> {
  const url = new URL(`/${API_VERSION}${path}`, API_BASE)
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    'accept': 'application/json',
    'x-api-key': requireApiKey(ctx, SERVICE),
  }
  const body = init.body === undefined ? undefined : JSON.stringify(init.body)
  if (body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(url.toString(), {
      method: init.method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      ...(body === undefined ? {} : { body }),
    })
    const text = await response.text()
    payload = text.trim() === '' ? null : JSON.parse(text)
  } catch (error) {
    // 传输层失败与非法 JSON 在上游都归为 502;这里同口径(unavailable + retryable)。
    const message = error instanceof Error ? error.message : String(error)
    throw upstreamError(502, `tl;dv request failed: ${message}`)
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  return payload
}

export async function listMeetings(
  input: z.infer<typeof listMeetingsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/meetings', {
    query: {
      query: input.query,
      page: input.page,
      limit: input.limit,
      from: input.from,
      to: input.to,
      onlyParticipated: input.onlyParticipated,
      meetingType: input.meetingType,
    },
  })
}

export async function getMeeting(
  input: z.infer<typeof getMeetingInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, meetingPath(input.meetingId))
}

export async function getTranscript(
  input: z.infer<typeof getTranscriptInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, meetingPath(input.meetingId, '/transcript'))
}

export async function getNotes(
  input: z.infer<typeof getNotesInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, meetingPath(input.meetingId, '/notes'))
}

export async function importMeeting(
  input: z.infer<typeof importMeetingInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/meetings/import', {
    method: 'POST',
    body: {
      name: input.name,
      url: input.url,
      ...(input.happenedAt === undefined ? {} : { happenedAt: input.happenedAt }),
      ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
      ...(input.participants === undefined ? {} : { participants: input.participants }),
    },
  })
}
