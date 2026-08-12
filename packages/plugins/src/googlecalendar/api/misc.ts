/**
 * 颜色表、用户设置、ACL(访问控制)的 9 个 action。
 *
 * 迁移自 open-connector `src/providers/googlecalendar/executors.ts` 的对应段落。
 *
 * 两处上游细节:
 * - `list_acl` 的 `maxResults` **有本地默认值 100**(Google 侧不给默认就一次回全部)。
 *   其余 list 类不带默认值,故不要顺手给它们也补一个 —— 那会悄悄改变分页行为。
 * - ACL 规则的可写字段只有 `scope` 与 `role`:读回来的规则还带 `id` / `etag` / `kind`,
 *   原样 PUT 回去 Google 会 400。故 `update_acl_rule` 的读改写也走白名单。
 */

import type { z } from 'zod/v4'
import type {
  createAclRuleInput,
  deleteAclRuleInput,
  getAclRuleInput,
  getColorsInput,
  getSettingInput,
  listAclInput,
  listSettingsInput,
  patchAclRuleInput,
  updateAclRuleInput,
} from '../schema'
import {
  aclRuleUrl,
  API_BASE,
  bool,
  calendarUrl,
  compact,
  deleteWithSuccess,
  int,
  type Json,
  pickKnownFields,
  type ProviderContext,
  requestRecord,
  requireText,
  settingUrl,
  text,
} from './shared'

const ACL_RULE_WRITABLE_KEYS = ['scope', 'role'] as const
/** 上游给 `list_acl` 的本地默认页大小。 */
const DEFAULT_ACL_MAX_RESULTS = 100

function aclUrl(calendarId: string): string {
  return `${calendarUrl(calendarId)}/acl`
}

export async function getColors(_input: z.infer<typeof getColorsInput>, ctx: ProviderContext): Promise<Json> {
  // 颜色表是全局静态资源,没有任何入参。
  return requestRecord(ctx, { url: `${API_BASE}/colors` })
}

export async function listSettings(
  input: z.infer<typeof listSettingsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const query = compact({
    maxResults: int(input.maxResults),
    pageToken: text(input.pageToken),
    syncToken: text(input.syncToken),
  })
  return requestRecord(ctx, {
    url: `${API_BASE}/users/me/settings`,
    query,
    syncTokenAware: query.syncToken !== undefined,
  })
}

export async function getSetting(
  input: z.infer<typeof getSettingInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, { url: settingUrl(requireText(input.settingId, 'settingId')) })
}

export async function listAcl(input: z.infer<typeof listAclInput>, ctx: ProviderContext): Promise<Json> {
  const query = compact({
    maxResults: int(input.maxResults ?? DEFAULT_ACL_MAX_RESULTS),
    pageToken: text(input.pageToken),
    syncToken: text(input.syncToken),
    showDeleted: bool(input.showDeleted),
  })
  return requestRecord(ctx, {
    url: aclUrl(requireText(input.calendarId, 'calendarId')),
    query,
    syncTokenAware: query.syncToken !== undefined,
  })
}

export async function getAclRule(
  input: z.infer<typeof getAclRuleInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    url: aclRuleUrl(requireText(input.calendarId, 'calendarId'), requireText(input.ruleId, 'ruleId')),
  })
}

export async function createAclRule(
  input: z.infer<typeof createAclRuleInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    url: aclUrl(requireText(input.calendarId, 'calendarId')),
    body: pickKnownFields(input.rule, ACL_RULE_WRITABLE_KEYS),
  })
}

export async function updateAclRule(
  input: z.infer<typeof updateAclRuleInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const url = aclRuleUrl(requireText(input.calendarId, 'calendarId'), requireText(input.ruleId, 'ruleId'))
  const current = await requestRecord(ctx, { url })
  return requestRecord(ctx, {
    url,
    method: 'PUT',
    body: {
      ...pickKnownFields(current, ACL_RULE_WRITABLE_KEYS),
      ...pickKnownFields(input.rule, ACL_RULE_WRITABLE_KEYS),
    },
  })
}

export async function patchAclRule(
  input: z.infer<typeof patchAclRuleInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    url: aclRuleUrl(requireText(input.calendarId, 'calendarId'), requireText(input.ruleId, 'ruleId')),
    method: 'PATCH',
    body: pickKnownFields(input.rule, ACL_RULE_WRITABLE_KEYS),
  })
}

export async function deleteAclRule(
  input: z.infer<typeof deleteAclRuleInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return deleteWithSuccess(
    ctx,
    aclRuleUrl(requireText(input.calendarId, 'calendarId'), requireText(input.ruleId, 'ruleId')),
  )
}
