/**
 * 标签的增删改查(上游 executors.ts 的 labels 一族)。
 *
 * 一处上游细节决定了这里的形状:**请求体就是入参本身**去掉 `userId` 与 `labelId` 之后的部分
 * (上游 `buildLabelPayload`)。这意味着新加的 schema 字段会自动跟着发出去,不需要逐个搬 ——
 * 但也意味着 `userId` / `labelId` 必须显式滤掉,它们是路径上的东西,进请求体 Gmail 会 400。
 *
 * `patch_label` 与 `update_label` 打同一个 URL,只差 PATCH / PUT:PUT 是整体替换(没给的字段
 * 会被清空),PATCH 只改给了的字段。上游把两者都保留下来了,这里照抄。
 */

import type { z } from 'zod/v4'
import type {
  createLabelInput,
  deleteLabelInput,
  getLabelInput,
  patchLabelInput,
  updateLabelInput,
} from '../schema'
import type { ProviderContext } from '../../_runtime/plugin'
import { bodyFromInput, type Json, recordArray, requestEmpty, requestRecord } from './shared'
import { normalizeMessageId } from './message'

export async function listLabels(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await requestRecord(ctx, { path: ['labels'] }, 'labels 响应')
  return { labels: recordArray(payload.labels, 'labels') }
}

export async function getLabel(input: z.infer<typeof getLabelInput>, ctx: ProviderContext): Promise<Json> {
  return requestRecord(ctx, { path: ['labels', normalizeMessageId(input.labelId)] }, 'label 响应')
}

export async function createLabel(input: z.infer<typeof createLabelInput>, ctx: ProviderContext): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: ['labels'],
    body: bodyFromInput(input, ['labelId']),
  }, 'label 响应')
}

export async function patchLabel(input: z.infer<typeof patchLabelInput>, ctx: ProviderContext): Promise<Json> {
  return requestRecord(ctx, {
    method: 'PATCH',
    path: ['labels', normalizeMessageId(input.labelId)],
    body: bodyFromInput(input, ['labelId']),
  }, 'label 响应')
}

export async function updateLabel(input: z.infer<typeof updateLabelInput>, ctx: ProviderContext): Promise<Json> {
  return requestRecord(ctx, {
    method: 'PUT',
    path: ['labels', normalizeMessageId(input.labelId)],
    body: bodyFromInput(input, ['labelId']),
  }, 'label 响应')
}

export async function deleteLabel(input: z.infer<typeof deleteLabelInput>, ctx: ProviderContext): Promise<Json> {
  await requestEmpty(ctx, { method: 'DELETE', path: ['labels', normalizeMessageId(input.labelId)] })
  return { success: true }
}
