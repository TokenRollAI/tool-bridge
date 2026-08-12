/**
 * Outline `get_document` 的手写 schema。
 *
 * 为什么不走生成:上游用 `anyOf: [{required:['id']},{required:['shareId']}]` 表达"文档 id 与
 * 分享 id 至少给一个",这个组合约束与 `type`/`properties` 同级共存。Zod 侧只能写成
 * `.refine()`,而 refine **无法反推进 JSON Schema** —— 自动生成的话等价闸门判不了它,
 * 契约会悄悄变宽。codegen 在这种形状上硬失败,把它交到这里(见 handwritten.json)。
 *
 * 代价是 `~help` 里露出的 JSON Schema 不含这条二选一约束。故 description 里写清楚,让 agent
 * 读得到;运行期由 refine 真正拦住。
 *
 * 出参形状与 `schema.ts` 里 `list_documents` / `search_documents` 的元素一致(上游同一个
 * `documentSchema`)。这里重复一份而不是从 `schema.ts` 导入:`schema.ts` 要 import 本文件,
 * 反向再引一次就成了循环依赖。
 */

import { z } from 'zod/v4'

const outlineUser = z.strictObject({
  id: z.uuid().describe('The unique identifier for the user.'),
  name: z.string().min(1).describe('The display name of the user.'),
  avatarUrl: z.url().describe('The avatar URL for the user.').optional(),
  email: z.email().describe('The email address for the user.').optional(),
  role: z.enum(['admin', 'member', 'viewer', 'guest']).describe('The Outline user role.').optional(),
  isSuspended: z.boolean().describe('Whether the user is suspended.').optional(),
  lastActiveAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the user was last active.').optional(),
  createdAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the user was created.').optional(),
}).describe('One Outline user returned inside auth or document metadata.')

const outlineDocument = z.strictObject({
  id: z.uuid().describe('The unique identifier for the document.'),
  collectionId: z.uuid().describe('The unique identifier for the associated collection.').optional(),
  parentDocumentId: z.uuid().describe('The unique identifier for the parent document, or null when the document is at the root level.').nullable().optional(),
  title: z.string().describe('The document title.'),
  fullWidth: z.boolean().describe('Whether the document is displayed in full width.').optional(),
  emoji: z.string().describe('The emoji associated with the document, or null when not set.').nullable().optional(),
  text: z.string().describe('The markdown document body returned by Outline.').optional(),
  urlId: z.string().describe('The short document URL identifier returned by Outline.').optional(),
  pinned: z.boolean().describe('Whether the document is pinned.').optional(),
  templateId: z.uuid().describe('The template identifier when the document was created from a template, or null when not set.').nullable().optional(),
  revision: z.number().describe('The current document revision number.').optional(),
  createdAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the document was created.').optional(),
  createdBy: outlineUser.optional(),
  updatedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the document was last updated.').optional(),
  updatedBy: outlineUser.optional(),
  publishedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the document was published, or null when it is a draft.').nullable().optional(),
  dataAttributes: z.array(z.strictObject({
    dataAttributeId: z.uuid().describe('The unique identifier for the associated data attribute.'),
    value: z.union([z.string().describe('A string data attribute value.'), z.boolean().describe('A boolean data attribute value.'), z.number().describe('A numeric data attribute value.')]).describe('A data attribute value returned by Outline, which may be string, boolean, or number.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when this data attribute value was last updated.'),
  }).describe('One document data attribute returned by Outline.')).describe('The data attributes attached to the document.').nullable().optional(),
  archivedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the document was archived, or null when active.').nullable().optional(),
  deletedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the document was deleted, or null when active.').nullable().optional(),
  raw: z.looseObject({}).describe('The raw document object returned by Outline.').optional(),
}).describe('One Outline document returned by document endpoints.')

export const getDocumentInput = z.strictObject({
  id: z.string().min(1).describe('The document UUID or short urlId accepted by Outline. Provide at least one of id or shareId.').optional(),
  shareId: z.string().min(1).describe('The share UUID used to resolve a shared document. Provide at least one of id or shareId.').optional(),
}).refine(
  input => input.id !== undefined || input.shareId !== undefined,
  { message: 'at least one of id or shareId is required', path: ['id'] },
).describe('Input parameters for retrieving one Outline document.')

export const getDocumentOutput = z.strictObject({
  document: outlineDocument,
}).describe('The single Outline document response.')
