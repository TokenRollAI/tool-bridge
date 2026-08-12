/**
 * Memos `update_memo` 的手写 schema。
 *
 * 为什么不走生成:上游用顶层 `anyOf: [{required:['content']},{required:['visibility']},…]`
 * 表达"六个可改字段里至少要给一个",这个组合约束与 `type`/`properties`/`required` 同级共存。
 * Zod 侧只能写成 `.refine()`,而 refine **无法反推进 JSON Schema** —— 自动生成的话等价闸门
 * 判不了它,契约会悄悄变宽。codegen 在这种形状上硬失败,把它交到这里(见 handwritten.json)。
 *
 * 代价是 `~help` 里露出的 JSON Schema 不含这条约束(JSON Schema 能表达,Zod 的反推不能)。
 * 故 description 里写清楚,让 agent 读得到;运行期由 refine 真正拦住。
 *
 * `location` 是**可空**的:给 `null` 表示"抹掉这条备注上的位置",与"不传 location"
 * (保持原样)是两回事 —— api.ts 的 updateMask 也按这个区分。
 */

import { z } from 'zod/v4'

/** 六个可改字段;与 api.ts 里 updateMask 的取值来源是同一份清单。 */
const UPDATABLE = ['content', 'visibility', 'pinned', 'state', 'createTime', 'location'] as const

export const updateMemoInput = z.strictObject({
  name: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.'),
  content: z.string().describe('The replacement memo content. Provide at least one updatable field.').optional(),
  visibility: z.enum(['PRIVATE', 'PROTECTED', 'PUBLIC'])
    .describe('The memo visibility. Provide at least one updatable field.').optional(),
  pinned: z.boolean().describe('Whether the memo should be pinned. Provide at least one updatable field.').optional(),
  state: z.enum(['NORMAL', 'ARCHIVED']).describe('The memo state. Provide at least one updatable field.').optional(),
  createTime: z.iso.datetime({ offset: true })
    .describe('The replacement memo creation time. Provide at least one updatable field.').optional(),
  location: z.strictObject({
    placeholder: z.string().describe('The location label.').optional(),
    latitude: z.number().describe('The latitude in decimal degrees.').optional(),
    longitude: z.number().describe('The longitude in decimal degrees.').optional(),
  }).describe('A geographic location to attach to a memo; null clears it. Provide at least one updatable field.')
    .nullable().optional(),
}).refine(
  // 按"键在不在"判,不是"值是不是 undefined":显式给 `location: null` 也算"要改这个字段"。
  input => UPDATABLE.some(field => Object.hasOwn(input, field)),
  {
    message: `at least one of ${UPDATABLE.join(', ')} is required`,
    path: ['content'],
  },
).describe('Input parameters for updating selected memo fields.')

export const updateMemoOutput = z.strictObject({
  memo: z.looseObject({
    name: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.').optional(),
    state: z.string().describe('The memo state returned by Memos.').optional(),
    creator: z.string().min(7).describe('The Memos user resource name in the format users/{user}.').optional(),
    createTime: z.iso.datetime({ offset: true }).describe('The memo creation time.').optional(),
    updateTime: z.iso.datetime({ offset: true }).describe('The memo update time.').optional(),
    content: z.string().describe('The memo Markdown content.').optional(),
    visibility: z.string().describe('The memo visibility returned by Memos.').optional(),
    tags: z.array(z.string().describe('An extracted memo tag.')).describe('Tags extracted from the memo content.').optional(),
    pinned: z.boolean().describe('Whether the memo is pinned.').optional(),
    attachments: z.array(z.looseObject({
      name: z.string().min(13).describe('The Memos attachment resource name in the format attachments/{attachment}.').optional(),
      createTime: z.iso.datetime({ offset: true }).describe('The attachment creation time.').optional(),
      filename: z.string().describe('The attachment filename.').optional(),
      externalLink: z.string().describe('The external storage URL when returned by Memos.').optional(),
      type: z.string().describe('The attachment MIME type.').optional(),
      size: z.string().describe('The attachment size in bytes, encoded as a string by the Memos API.').optional(),
      memo: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.').optional(),
    }).describe('Memos attachment metadata.')).describe('Attachments associated with the memo.').optional(),
    parent: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.').optional(),
    snippet: z.string().describe('A plain-text preview of the memo content.').optional(),
    location: z.looseObject({
      placeholder: z.string().describe('The location label.').optional(),
      latitude: z.number().describe('The latitude in decimal degrees.').optional(),
      longitude: z.number().describe('The longitude in decimal degrees.').optional(),
    }).describe('A geographic location attached to a memo.').optional(),
    property: z.looseObject({}).describe('Computed memo properties.').optional(),
  }).describe('A Memos memo resource.'),
}).describe('The updated memo response.')
