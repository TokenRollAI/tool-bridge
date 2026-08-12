/**
 * 邮箱级的读写:profile、history、filters、settings、停止推送(上游 executors.ts 的余下部分)。
 *
 * 三处上游细节决定了这里的形状:
 * - **filters 列表的字段名是 `filter`(单数)**:Gmail 的 `settings.filters.list` 回
 *   `{filter: [...]}`,不是 `{filters: [...]}`。抄成复数会永远得到空表,而且不报错。
 * - **空列表 Gmail 回 `null` 而不是 `{}`**:filters 与 forwardingAddresses 都这样。`null` 是
 *   "一条都没有",不是故障,故先折成 `{}` 再取字段(上游 `normalizeNullableObjectResponse`)。
 * - **settings 的更新是"入参即请求体"**:去掉 `userId` 与未给的字段之后直接 PUT。Gmail 的
 *   settings PUT 是整体替换,没给的字段会被清成默认值 —— 这是上游的语义,照抄,不擅自改成合并。
 */

import type { z } from 'zod/v4'
import type {
  createFilterInput,
  deleteFilterInput,
  getFilterInput,
  listHistoryInput,
  updateImapSettingsInput,
  updateLanguageSettingsInput,
  updatePopSettingsInput,
  updateVacationSettingsInput,
} from '../schema'
import type { ProviderContext } from '../../_runtime/plugin'
import {
  asObject,
  bodyFromInput,
  type Json,
  nullableRecord,
  optionalString,
  recordArray,
  requestEmpty,
  requestJson,
  requestRecord,
  requireRecord,
  toStringArray,
} from './shared'
import { normalizeMessageId } from './message'

/** Gmail settings 资源名(URL 段),与 action 名不是一一对应的关系。 */
const SETTINGS_AUTO_FORWARDING = 'autoForwarding'
const SETTINGS_IMAP = 'imap'
const SETTINGS_LANGUAGE = 'language'
const SETTINGS_POP = 'pop'
const SETTINGS_VACATION = 'vacation'

function getSettings(resource: string, ctx: ProviderContext): Promise<Json> {
  return requestRecord(ctx, { path: ['settings', resource] }, `settings/${resource} 响应`)
}

function updateSettings(resource: string, input: object, ctx: ProviderContext): Promise<Json> {
  return requestRecord(ctx, {
    method: 'PUT',
    path: ['settings', resource],
    body: bodyFromInput(input),
  }, `settings/${resource} 响应`)
}

export async function getProfile(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return requestRecord(ctx, { path: ['profile'] }, 'profile 响应')
}

export async function listHistory(input: z.infer<typeof listHistoryInput>, ctx: ProviderContext): Promise<Json> {
  const startHistoryId = normalizeMessageId(input.startHistoryId)
  const historyTypes = toStringArray(input.historyTypes)
  const payload = requireRecord(await requestJson(ctx, {
    path: ['history'],
    query: {
      startHistoryId,
      pageToken: input.pageToken,
      maxResults: input.maxResults,
      labelId: input.labelId,
      historyTypes: historyTypes.length > 0 ? historyTypes : undefined,
    },
  }), 'history 响应')

  return {
    history: recordArray(payload.history, 'history'),
    // 没有变更时 Gmail 不回 historyId;把入参那个原样报回去,调用方下一轮才有可用的水位。
    historyId: optionalString(payload.historyId) ?? startHistoryId,
    nextPageToken: optionalString(payload.nextPageToken) ?? null,
  }
}

export async function listFilters(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = nullableRecord(
    await requestJson(ctx, { path: ['settings', 'filters'] }),
    'filters 响应',
  )
  return { filters: recordArray(payload.filter, 'filters') }
}

export async function getFilter(input: z.infer<typeof getFilterInput>, ctx: ProviderContext): Promise<Json> {
  return requestRecord(
    ctx,
    { path: ['settings', 'filters', normalizeMessageId(input.filterId)] },
    'filter 响应',
  )
}

export async function createFilter(input: z.infer<typeof createFilterInput>, ctx: ProviderContext): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: ['settings', 'filters'],
    // 只发 criteria 与 action 两个键:filters.create 不认别的字段(userId 尤其会被拒)。
    body: { criteria: asObject(input.criteria), action: asObject(input.action) },
  }, 'filter 响应')
}

export async function deleteFilter(input: z.infer<typeof deleteFilterInput>, ctx: ProviderContext): Promise<Json> {
  await requestEmpty(ctx, {
    method: 'DELETE',
    path: ['settings', 'filters', normalizeMessageId(input.filterId)],
  })
  return { success: true }
}

export async function listForwardingAddresses(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = nullableRecord(
    await requestJson(ctx, { path: ['settings', 'forwardingAddresses'] }),
    'forwardingAddresses 响应',
  )
  return { forwardingAddresses: recordArray(payload.forwardingAddresses, 'forwardingAddresses') }
}

export function getLanguageSettings(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return getSettings(SETTINGS_LANGUAGE, ctx)
}

export function updateLanguageSettings(
  input: z.infer<typeof updateLanguageSettingsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return updateSettings(SETTINGS_LANGUAGE, input, ctx)
}

export function getVacationSettings(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return getSettings(SETTINGS_VACATION, ctx)
}

export function updateVacationSettings(
  input: z.infer<typeof updateVacationSettingsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return updateSettings(SETTINGS_VACATION, input, ctx)
}

export function getAutoForwarding(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return getSettings(SETTINGS_AUTO_FORWARDING, ctx)
}

export function settingsGetImap(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return getSettings(SETTINGS_IMAP, ctx)
}

export function updateImapSettings(
  input: z.infer<typeof updateImapSettingsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return updateSettings(SETTINGS_IMAP, input, ctx)
}

export function settingsGetPop(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return getSettings(SETTINGS_POP, ctx)
}

export function updatePopSettings(
  input: z.infer<typeof updatePopSettingsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return updateSettings(SETTINGS_POP, input, ctx)
}

export async function stopWatch(_input: unknown, ctx: ProviderContext): Promise<Json> {
  await requestEmpty(ctx, { method: 'POST', path: ['stop'] })
  return { success: true }
}
