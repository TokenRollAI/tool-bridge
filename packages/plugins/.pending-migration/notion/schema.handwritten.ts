/**
 * Notion `create_page` / `move_page` 的手写 schema。
 *
 * 为什么不走生成:两个 action 的 `parent` 字段是 `oneOf` 三分支(页面父级 / 数据源父级 /
 * 工作区父级),每个分支各带自己的 `type` 判别常量、必填字段与 description。Zod 侧写成
 * discriminated union 后**反推不回等价的 JSON Schema** —— 分支级 description 会丢,
 * 判别式的形状也对不上,等价闸门因此判不了它(见 handwritten.json)。
 *
 * 注意 workspace 分支**没有** `type` 判别键(它靠 `workspace: true` 本身标识),所以这里
 * 不能用 `z.discriminatedUnion` —— 那要求所有分支共享同一个判别键。用普通 `z.union`,
 * 三个分支都是 strictObject,Zod 会按结构逐个试。
 *
 * 上游语义保留:`parent` 在 create_page 里是可选的(可以改用简化的 `parentId` + `title`),
 * 在 move_page 里必填。两者的 required 都照抄上游,不做收紧。
 */

import { z } from 'zod/v4'

/** Notion 官方 parent 对象:三种父级形态,分支间互斥。 */
const pageParent = z.union([
  z.strictObject({
    page_id: z.string().min(1).describe('The parent page ID.'),
    type: z.literal('page_id').describe('Always page_id.').optional(),
  }).describe('Page parent.'),
  z.strictObject({
    data_source_id: z.string().min(1).describe('The parent data source ID.'),
    type: z.literal('data_source_id').describe('Always data_source_id.').optional(),
  }).describe('Data source parent.'),
  z.strictObject({
    workspace: z.literal(true).describe('Create a private workspace page.'),
  }).describe('Workspace parent.'),
]).describe('The official Notion parent object.')

/** 上游把 Notion API 的自由字段一律记成"任意 JSON 值",这里同构。 */
const notionObject = z.record(z.string(), z.unknown().describe('A Notion API field value.'))
  .describe('A Notion API object.')

const pageOutput = z.looseObject({
  object: z.literal('page').describe('The Notion object type.').optional(),
  id: z.string().describe('The page ID.').optional(),
  created_time: z.iso.datetime().describe('The time when the page was created.').optional(),
  last_edited_time: z.iso.datetime().describe('The time when the page was last edited.').optional(),
  parent: notionObject.optional(),
  properties: notionObject.optional(),
  url: z.string().describe('The page URL.').optional(),
  archived: z.boolean().describe('Whether the page is archived.').optional(),
  in_trash: z.boolean().describe('Whether the page is in the trash.').optional(),
}).describe('The output payload for this action.')

export const createPageInput = z.strictObject({
  parent: pageParent.optional(),
  parentId: z.string().describe('Simple parent page ID.').optional(),
  title: z.string().describe('Simple page title used with parentId.').optional(),
  properties: notionObject.describe('Notion properties keyed by property name.').optional(),
  children: z.array(notionObject).describe('Child blocks to create with the page.').optional(),
  markdown: z.string().describe('Enhanced Markdown content for the page.').optional(),
  icon: notionObject.optional(),
  cover: notionObject.optional(),
  template: notionObject.optional(),
}).describe('The input payload for this action.')

export const createPageOutput = pageOutput

export const movePageInput = z.strictObject({
  pageId: z.string().min(1).describe('The page ID to move.'),
  parent: pageParent,
}).describe('The input payload for this action.')

export const movePageOutput = pageOutput
