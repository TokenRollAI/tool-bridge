/**
 * Notion 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

// 手写豁免(见 handwritten.json):create_page, move_page

export const searchInput = z.strictObject({
  query: z.string().describe('The search query text.'),
  filter: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The filter object to narrow results.').optional(),
  sort: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The sort object to order results.').optional(),
  pageSize: z.int().min(1).max(100).describe('The number of results per page.').optional(),
  startCursor: z.string().describe('The cursor for pagination.').optional(),
}).describe('The input payload for this action.')

export const searchOutput = z.looseObject({
  object: z.literal('list').describe('The Notion object type.'),
  results: z.array(z.union([z.looseObject({
    object: z.literal('page').describe('The Notion object type.').optional(),
    id: z.string().describe('The page ID.').optional(),
    created_time: z.iso.datetime({ offset: true }).describe('The time when the page was created.').optional(),
    last_edited_time: z.iso.datetime({ offset: true }).describe('The time when the page was last edited.').optional(),
    parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
    properties: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('Notion properties keyed by property name.').optional(),
    url: z.url().describe('The canonical Notion URL for the page.').optional(),
    archived: z.boolean().describe('Whether the page is archived.').optional(),
    in_trash: z.boolean().describe('Whether the page is in the trash.').optional(),
  }).describe('A Notion page object.'), z.looseObject({
    object: z.literal('data_source').describe('The Notion object type.').optional(),
    id: z.string().describe('The data source ID.').optional(),
    title: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Notion rich text objects.').optional(),
    properties: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('Notion properties keyed by property name.').optional(),
    parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
    url: z.url().describe('The canonical Notion URL for the data source.').optional(),
    in_trash: z.boolean().describe('Whether the data source is in the trash.').optional(),
  }).describe('A Notion data source object.')])).describe('Returned Notion objects.'),
  next_cursor: z.string().describe('Cursor for the next page.').nullable().optional(),
  has_more: z.boolean().describe('Whether more results are available.'),
}).describe('Search results returned by Notion.')

export const getPageInput = z.strictObject({
  pageId: z.string().min(1).describe('The page ID to retrieve.'),
}).describe('The input payload for this action.')

export const getPageOutput = z.strictObject({
  page: z.looseObject({
    object: z.literal('page').describe('The Notion object type.').optional(),
    id: z.string().describe('The page ID.').optional(),
    created_time: z.iso.datetime({ offset: true }).describe('The time when the page was created.').optional(),
    last_edited_time: z.iso.datetime({ offset: true }).describe('The time when the page was last edited.').optional(),
    parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
    properties: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('Notion properties keyed by property name.').optional(),
    url: z.url().describe('The canonical Notion URL for the page.').optional(),
    archived: z.boolean().describe('Whether the page is archived.').optional(),
    in_trash: z.boolean().describe('Whether the page is in the trash.').optional(),
  }).describe('A Notion page object.'),
  block_children: z.looseObject({
    object: z.literal('list').describe('The Notion object type.'),
    results: z.array(z.looseObject({
      object: z.literal('block').describe('The Notion object type.').optional(),
      id: z.string().describe('The block ID.').optional(),
      parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
      type: z.string().describe('The block type.').optional(),
      has_children: z.boolean().describe('Whether this block has child blocks.').optional(),
      in_trash: z.boolean().describe('Whether the block is in the trash.').optional(),
    }).describe('A Notion block object.')).describe('Returned Notion objects.'),
    next_cursor: z.string().describe('Cursor for the next page.').nullable().optional(),
    has_more: z.boolean().describe('Whether more results are available.'),
  }).describe('First-level child blocks.'),
}).describe('Page with child block list.')

export const updatePageInput = z.strictObject({
  pageId: z.string().min(1).describe('The page ID to update.'),
  title: z.string().describe('The new page title.').optional(),
  properties: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('Notion properties keyed by property name.').optional(),
  icon: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.').optional(),
  cover: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.').optional(),
  template: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.').optional(),
  in_trash: z.boolean().describe('Whether the page is in the trash.').optional(),
  is_locked: z.boolean().describe('Whether the page is locked.').optional(),
  erase_content: z.boolean().describe('Whether to erase page content.').optional(),
}).describe('The input payload for this action.')

export const updatePageOutput = z.looseObject({
  object: z.literal('page').describe('The Notion object type.').optional(),
  id: z.string().describe('The page ID.').optional(),
  created_time: z.iso.datetime({ offset: true }).describe('The time when the page was created.').optional(),
  last_edited_time: z.iso.datetime({ offset: true }).describe('The time when the page was last edited.').optional(),
  parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
  properties: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('Notion properties keyed by property name.').optional(),
  url: z.url().describe('The canonical Notion URL for the page.').optional(),
  archived: z.boolean().describe('Whether the page is archived.').optional(),
  in_trash: z.boolean().describe('Whether the page is in the trash.').optional(),
}).describe('A Notion page object.')

export const appendBlockInput = z.strictObject({
  pageId: z.string().min(1).describe('The page ID to append to.'),
  text: z.string().min(1).describe('Paragraph text content.'),
}).describe('The input payload for this action.')

export const appendBlockOutput = z.looseObject({
  object: z.literal('list').describe('The Notion object type.'),
  results: z.array(z.looseObject({
    object: z.literal('block').describe('The Notion object type.').optional(),
    id: z.string().describe('The block ID.').optional(),
    parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
    type: z.string().describe('The block type.').optional(),
    has_children: z.boolean().describe('Whether this block has child blocks.').optional(),
    in_trash: z.boolean().describe('Whether the block is in the trash.').optional(),
  }).describe('A Notion block object.')).describe('Returned Notion objects.'),
  next_cursor: z.string().describe('Cursor for the next page.').nullable().optional(),
  has_more: z.boolean().describe('Whether more results are available.'),
}).describe('Appended block children response.')

export const retrievePageInput = z.strictObject({
  pageId: z.string().min(1).describe('The page ID to retrieve.'),
}).describe('The input payload for this action.')

export const retrievePageOutput = z.looseObject({
  object: z.literal('page').describe('The Notion object type.').optional(),
  id: z.string().describe('The page ID.').optional(),
  created_time: z.iso.datetime({ offset: true }).describe('The time when the page was created.').optional(),
  last_edited_time: z.iso.datetime({ offset: true }).describe('The time when the page was last edited.').optional(),
  parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
  properties: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('Notion properties keyed by property name.').optional(),
  url: z.url().describe('The canonical Notion URL for the page.').optional(),
  archived: z.boolean().describe('Whether the page is archived.').optional(),
  in_trash: z.boolean().describe('Whether the page is in the trash.').optional(),
}).describe('A Notion page object.')

export const retrievePageMarkdownInput = z.strictObject({
  pageId: z.string().min(1).describe('The page or block ID.'),
  includeTranscript: z.boolean().describe('Whether to include meeting note transcripts.').optional(),
}).describe('The input payload for this action.')

export const retrievePageMarkdownOutput = z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')

export const updatePageMarkdownInput = z.strictObject({
  pageId: z.string().min(1).describe('The page ID to update.'),
  type: z.string().min(1).describe('Markdown update operation type.'),
  insert_content: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.').optional(),
  replace_content_range: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.').optional(),
  update_content: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.').optional(),
  replace_content: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.').optional(),
}).describe('The input payload for this action.')

export const updatePageMarkdownOutput = z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')

export const retrievePagePropertyInput = z.strictObject({
  pageId: z.string().min(1).describe('The page ID.'),
  propertyId: z.string().min(1).describe('The property ID.'),
  pageSize: z.int().min(1).max(100).describe('The number of property items per page.').optional(),
  startCursor: z.string().describe('The cursor for pagination.').optional(),
}).describe('The input payload for this action.')

export const retrievePagePropertyOutput = z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')

export const listUsersInput = z.strictObject({
  pageSize: z.int().min(1).max(100).describe('The number of results per page.').optional(),
  startCursor: z.string().describe('The cursor for pagination.').optional(),
}).describe('The input payload for this action.')

export const listUsersOutput = z.looseObject({
  object: z.literal('list').describe('The Notion object type.'),
  results: z.array(z.looseObject({
    object: z.literal('user').describe('The Notion object type.').optional(),
    id: z.string().describe('The Notion user ID.').optional(),
    name: z.string().describe('The user\'s display name.').nullable().optional(),
    avatar_url: z.string().describe('The user\'s avatar URL.').nullable().optional(),
    type: z.enum(['person', 'bot']).describe('The user type.').optional(),
    person: z.looseObject({
      email: z.email().describe('The person\'s email address.').optional(),
    }).optional(),
    bot: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.').optional(),
  }).describe('A Notion user object.')).describe('Returned Notion objects.'),
  next_cursor: z.string().describe('Cursor for the next page.').nullable().optional(),
  has_more: z.boolean().describe('Whether more results are available.'),
}).describe('Workspace users returned by Notion.')

export const retrieveUserInput = z.strictObject({
  userId: z.string().min(1).describe('The user ID to retrieve.'),
}).describe('The input payload for this action.')

export const retrieveUserOutput = z.looseObject({
  object: z.literal('user').describe('The Notion object type.').optional(),
  id: z.string().describe('The Notion user ID.').optional(),
  name: z.string().describe('The user\'s display name.').nullable().optional(),
  avatar_url: z.string().describe('The user\'s avatar URL.').nullable().optional(),
  type: z.enum(['person', 'bot']).describe('The user type.').optional(),
  person: z.looseObject({
    email: z.email().describe('The person\'s email address.').optional(),
  }).optional(),
  bot: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.').optional(),
}).describe('A Notion user object.')

export const retrieveBlockInput = z.strictObject({
  blockId: z.string().min(1).describe('The block ID to retrieve.'),
}).describe('The input payload for this action.')

export const retrieveBlockOutput = z.looseObject({
  object: z.literal('block').describe('The Notion object type.').optional(),
  id: z.string().describe('The block ID.').optional(),
  parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
  type: z.string().describe('The block type.').optional(),
  has_children: z.boolean().describe('Whether this block has child blocks.').optional(),
  in_trash: z.boolean().describe('Whether the block is in the trash.').optional(),
}).describe('A Notion block object.')

export const listBlockChildrenInput = z.strictObject({
  blockId: z.string().min(1).describe('The parent block ID.'),
  pageSize: z.int().min(1).max(100).describe('The number of results per page.').optional(),
  startCursor: z.string().describe('The cursor for pagination.').optional(),
}).describe('The input payload for this action.')

export const listBlockChildrenOutput = z.looseObject({
  object: z.literal('list').describe('The Notion object type.'),
  results: z.array(z.looseObject({
    object: z.literal('block').describe('The Notion object type.').optional(),
    id: z.string().describe('The block ID.').optional(),
    parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
    type: z.string().describe('The block type.').optional(),
    has_children: z.boolean().describe('Whether this block has child blocks.').optional(),
    in_trash: z.boolean().describe('Whether the block is in the trash.').optional(),
  }).describe('A Notion block object.')).describe('Returned Notion objects.'),
  next_cursor: z.string().describe('Cursor for the next page.').nullable().optional(),
  has_more: z.boolean().describe('Whether more results are available.'),
}).describe('Child blocks returned by Notion.')

export const appendBlockChildrenInput = z.strictObject({
  blockId: z.string().min(1).describe('The parent block ID.'),
  children: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Child block objects to append.'),
  position: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.').optional(),
}).describe('The input payload for this action.')

export const appendBlockChildrenOutput = z.looseObject({
  object: z.literal('list').describe('The Notion object type.'),
  results: z.array(z.looseObject({
    object: z.literal('block').describe('The Notion object type.').optional(),
    id: z.string().describe('The block ID.').optional(),
    parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
    type: z.string().describe('The block type.').optional(),
    has_children: z.boolean().describe('Whether this block has child blocks.').optional(),
    in_trash: z.boolean().describe('Whether the block is in the trash.').optional(),
  }).describe('A Notion block object.')).describe('Returned Notion objects.'),
  next_cursor: z.string().describe('Cursor for the next page.').nullable().optional(),
  has_more: z.boolean().describe('Whether more results are available.'),
}).describe('Appended block children response.')

export const updateBlockInput = z.looseObject({
  blockId: z.string().min(1).describe('The block ID to update.'),
}).describe('The input payload for this action.')

export const updateBlockOutput = z.looseObject({
  object: z.literal('block').describe('The Notion object type.').optional(),
  id: z.string().describe('The block ID.').optional(),
  parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
  type: z.string().describe('The block type.').optional(),
  has_children: z.boolean().describe('Whether this block has child blocks.').optional(),
  in_trash: z.boolean().describe('Whether the block is in the trash.').optional(),
}).describe('A Notion block object.')

export const deleteBlockInput = z.strictObject({
  blockId: z.string().min(1).describe('The block ID to delete.'),
}).describe('The input payload for this action.')

export const deleteBlockOutput = z.looseObject({
  object: z.literal('block').describe('The Notion object type.').optional(),
  id: z.string().describe('The block ID.').optional(),
  parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
  type: z.string().describe('The block type.').optional(),
  has_children: z.boolean().describe('Whether this block has child blocks.').optional(),
  in_trash: z.boolean().describe('Whether the block is in the trash.').optional(),
}).describe('A Notion block object.')

export const createDatabaseInput = z.strictObject({
  parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.'),
  title: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Database title rich text objects.').optional(),
  description: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Database description rich text objects.').optional(),
  is_inline: z.boolean().describe('Whether the database is inline.').optional(),
  initial_data_source: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.').optional(),
  icon: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.').optional(),
  cover: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.').optional(),
}).describe('The input payload for this action.')

export const createDatabaseOutput = z.looseObject({
  object: z.literal('database').describe('The Notion object type.').optional(),
  id: z.string().describe('The database ID.').optional(),
  title: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Notion rich text objects.').optional(),
  description: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Notion rich text objects.').optional(),
  parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
  url: z.url().describe('The canonical Notion URL for the database.').optional(),
  in_trash: z.boolean().describe('Whether the database is in the trash.').optional(),
}).describe('A Notion database object.')

export const retrieveDatabaseInput = z.strictObject({
  databaseId: z.string().min(1).describe('The database ID to retrieve.'),
}).describe('The input payload for this action.')

export const retrieveDatabaseOutput = z.looseObject({
  object: z.literal('database').describe('The Notion object type.').optional(),
  id: z.string().describe('The database ID.').optional(),
  title: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Notion rich text objects.').optional(),
  description: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Notion rich text objects.').optional(),
  parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
  url: z.url().describe('The canonical Notion URL for the database.').optional(),
  in_trash: z.boolean().describe('Whether the database is in the trash.').optional(),
}).describe('A Notion database object.')

export const updateDatabaseInput = z.strictObject({
  databaseId: z.string().min(1).describe('The database ID to update.'),
  parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
  title: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Database title rich text objects.').optional(),
  description: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Database description rich text objects.').optional(),
  is_inline: z.boolean().describe('Whether the database is inline.').optional(),
  icon: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.').optional(),
  cover: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.').optional(),
  in_trash: z.boolean().describe('Whether the database is in the trash.').optional(),
  is_locked: z.boolean().describe('Whether the database is locked.').optional(),
}).describe('The input payload for this action.')

export const updateDatabaseOutput = z.looseObject({
  object: z.literal('database').describe('The Notion object type.').optional(),
  id: z.string().describe('The database ID.').optional(),
  title: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Notion rich text objects.').optional(),
  description: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Notion rich text objects.').optional(),
  parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
  url: z.url().describe('The canonical Notion URL for the database.').optional(),
  in_trash: z.boolean().describe('Whether the database is in the trash.').optional(),
}).describe('A Notion database object.')

export const createDataSourceInput = z.strictObject({
  parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.'),
  properties: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('Notion properties keyed by property name.'),
  title: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Data source title rich text objects.').optional(),
  icon: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.').optional(),
}).describe('The input payload for this action.')

export const createDataSourceOutput = z.looseObject({
  object: z.literal('data_source').describe('The Notion object type.').optional(),
  id: z.string().describe('The data source ID.').optional(),
  title: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Notion rich text objects.').optional(),
  properties: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('Notion properties keyed by property name.').optional(),
  parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
  url: z.url().describe('The canonical Notion URL for the data source.').optional(),
  in_trash: z.boolean().describe('Whether the data source is in the trash.').optional(),
}).describe('A Notion data source object.')

export const retrieveDataSourceInput = z.strictObject({
  dataSourceId: z.string().min(1).describe('The data source ID to retrieve.'),
}).describe('The input payload for this action.')

export const retrieveDataSourceOutput = z.looseObject({
  object: z.literal('data_source').describe('The Notion object type.').optional(),
  id: z.string().describe('The data source ID.').optional(),
  title: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Notion rich text objects.').optional(),
  properties: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('Notion properties keyed by property name.').optional(),
  parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
  url: z.url().describe('The canonical Notion URL for the data source.').optional(),
  in_trash: z.boolean().describe('Whether the data source is in the trash.').optional(),
}).describe('A Notion data source object.')

export const updateDataSourceInput = z.strictObject({
  dataSourceId: z.string().min(1).describe('The data source ID to update.'),
  title: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Data source title rich text objects.').optional(),
  description: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Data source description rich text objects.').optional(),
  icon: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.').optional(),
  properties: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('Notion properties keyed by property name.').optional(),
  parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
  in_trash: z.boolean().describe('Whether the data source is in the trash.').optional(),
}).describe('The input payload for this action.')

export const updateDataSourceOutput = z.looseObject({
  object: z.literal('data_source').describe('The Notion object type.').optional(),
  id: z.string().describe('The data source ID.').optional(),
  title: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Notion rich text objects.').optional(),
  properties: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('Notion properties keyed by property name.').optional(),
  parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
  url: z.url().describe('The canonical Notion URL for the data source.').optional(),
  in_trash: z.boolean().describe('Whether the data source is in the trash.').optional(),
}).describe('A Notion data source object.')

export const queryDataSourceInput = z.strictObject({
  dataSourceId: z.string().min(1).describe('The data source ID to query.'),
  filter: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The filter object to narrow results.').optional(),
  sorts: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('The sorts to apply.').optional(),
  pageSize: z.int().min(1).max(100).describe('The number of results per page.').optional(),
  startCursor: z.string().describe('The cursor for pagination.').optional(),
  filterProperties: z.array(z.string().min(1)).describe('Property IDs to include.').optional(),
  in_trash: z.boolean().describe('Whether to query trashed pages.').optional(),
  result_type: z.string().describe('The Notion result type filter.').optional(),
}).describe('The input payload for this action.')

export const queryDataSourceOutput = z.looseObject({
  object: z.literal('list').describe('The Notion object type.'),
  results: z.array(z.looseObject({
    object: z.literal('page').describe('The Notion object type.').optional(),
    id: z.string().describe('The page ID.').optional(),
    created_time: z.iso.datetime({ offset: true }).describe('The time when the page was created.').optional(),
    last_edited_time: z.iso.datetime({ offset: true }).describe('The time when the page was last edited.').optional(),
    parent: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('The official Notion parent object.').optional(),
    properties: z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('Notion properties keyed by property name.').optional(),
    url: z.url().describe('The canonical Notion URL for the page.').optional(),
    archived: z.boolean().describe('Whether the page is archived.').optional(),
    in_trash: z.boolean().describe('Whether the page is in the trash.').optional(),
  }).describe('A Notion page object.')).describe('Returned Notion objects.'),
  next_cursor: z.string().describe('Cursor for the next page.').nullable().optional(),
  has_more: z.boolean().describe('Whether more results are available.'),
}).describe('Data source query results returned by Notion.')

export const listDataSourceTemplatesInput = z.strictObject({
  dataSourceId: z.string().min(1).describe('The data source ID whose templates should be listed.'),
  pageSize: z.int().min(1).max(100).describe('The number of results per page.').optional(),
  startCursor: z.string().describe('The cursor for pagination.').optional(),
}).describe('The input payload for this action.')

export const listDataSourceTemplatesOutput = z.looseObject({
  object: z.literal('list').describe('The Notion object type.'),
  results: z.array(z.record(z.string(), z.unknown().describe('A Notion API field value.')).describe('A Notion API object.')).describe('Returned Notion objects.'),
  next_cursor: z.string().describe('Cursor for the next page.').nullable().optional(),
  has_more: z.boolean().describe('Whether more results are available.'),
}).describe('Data source templates returned by Notion.')

import { createPageInput, createPageOutput, movePageInput, movePageOutput } from './schema.handwritten'

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const notionActions = {
  search: {
    description: 'Search Notion pages and data sources with optional filter, sort, and pagination controls.',
    effect: 'write',
    inputSchema: searchInput,
    outputSchema: z.toJSONSchema(searchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_page: {
    description: 'Get a Notion page together with its first-level child blocks. This is an aggregate helper over page retrieval plus block-children listing.',
    effect: 'read',
    inputSchema: getPageInput,
    outputSchema: z.toJSONSchema(getPageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_page: {
    description: 'Create a Notion page under a parent page, data source, or workspace-level private area.',
    effect: 'write',
    inputSchema: createPageInput,
    outputSchema: z.toJSONSchema(createPageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_page: {
    description: 'Update a Notion page\'s properties, title, icon, cover, trash status, or locked state.',
    effect: 'write',
    inputSchema: updatePageInput,
    outputSchema: z.toJSONSchema(updatePageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  move_page: {
    description: 'Move a Notion page under another page or data source.',
    effect: 'write',
    inputSchema: movePageInput,
    outputSchema: z.toJSONSchema(movePageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  append_block: {
    description: 'Append a single paragraph block to a Notion page.',
    effect: 'write',
    inputSchema: appendBlockInput,
    outputSchema: z.toJSONSchema(appendBlockOutput, { io: 'output', unrepresentable: 'any' }),
  },
  retrieve_page: {
    description: 'Retrieve a Notion page\'s properties and metadata by page ID.',
    effect: 'read',
    inputSchema: retrievePageInput,
    outputSchema: z.toJSONSchema(retrievePageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  retrieve_page_markdown: {
    description: 'Retrieve a Notion page or block subtree rendered as enhanced Markdown.',
    effect: 'read',
    inputSchema: retrievePageMarkdownInput,
    outputSchema: z.toJSONSchema(retrievePageMarkdownOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_page_markdown: {
    description: 'Update a Notion page\'s content as enhanced Markdown.',
    effect: 'write',
    inputSchema: updatePageMarkdownInput,
    outputSchema: z.toJSONSchema(updatePageMarkdownOutput, { io: 'output', unrepresentable: 'any' }),
  },
  retrieve_page_property: {
    description: 'Retrieve a specific property item from a Notion page.',
    effect: 'read',
    inputSchema: retrievePagePropertyInput,
    outputSchema: z.toJSONSchema(retrievePagePropertyOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_users: {
    description: 'List users in the Notion workspace with pagination.',
    effect: 'read',
    inputSchema: listUsersInput,
    outputSchema: z.toJSONSchema(listUsersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  retrieve_user: {
    description: 'Retrieve a Notion user by user ID.',
    effect: 'read',
    inputSchema: retrieveUserInput,
    outputSchema: z.toJSONSchema(retrieveUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  retrieve_block: {
    description: 'Retrieve a Notion block by block ID.',
    effect: 'read',
    inputSchema: retrieveBlockInput,
    outputSchema: z.toJSONSchema(retrieveBlockOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_block_children: {
    description: 'List the direct child blocks under a Notion block with pagination.',
    effect: 'read',
    inputSchema: listBlockChildrenInput,
    outputSchema: z.toJSONSchema(listBlockChildrenOutput, { io: 'output', unrepresentable: 'any' }),
  },
  append_block_children: {
    description: 'Append raw Notion child blocks to an existing parent block.',
    effect: 'write',
    inputSchema: appendBlockChildrenInput,
    outputSchema: z.toJSONSchema(appendBlockChildrenOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_block: {
    description: 'Update a Notion block using raw block fields.',
    effect: 'write',
    inputSchema: updateBlockInput,
    outputSchema: z.toJSONSchema(updateBlockOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_block: {
    description: 'Archive a Notion block through the official delete endpoint.',
    effect: 'destructive',
    inputSchema: deleteBlockInput,
    outputSchema: z.toJSONSchema(deleteBlockOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_database: {
    description: 'Create a Notion database container under a parent page or workspace.',
    effect: 'write',
    inputSchema: createDatabaseInput,
    outputSchema: z.toJSONSchema(createDatabaseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  retrieve_database: {
    description: 'Retrieve a Notion database\'s metadata and schema by database ID.',
    effect: 'read',
    inputSchema: retrieveDatabaseInput,
    outputSchema: z.toJSONSchema(retrieveDatabaseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_database: {
    description: 'Update a Notion database container.',
    effect: 'write',
    inputSchema: updateDatabaseInput,
    outputSchema: z.toJSONSchema(updateDatabaseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_data_source: {
    description: 'Create a Notion data source under a parent database.',
    effect: 'write',
    inputSchema: createDataSourceInput,
    outputSchema: z.toJSONSchema(createDataSourceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  retrieve_data_source: {
    description: 'Retrieve a Notion data source by data source ID.',
    effect: 'read',
    inputSchema: retrieveDataSourceInput,
    outputSchema: z.toJSONSchema(retrieveDataSourceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_data_source: {
    description: 'Update a Notion data source\'s title, icon, properties schema, parent, or trash status.',
    effect: 'write',
    inputSchema: updateDataSourceInput,
    outputSchema: z.toJSONSchema(updateDataSourceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  query_data_source: {
    description: 'Query a Notion data source with filters, sorts, pagination, and optional property filtering.',
    effect: 'write',
    inputSchema: queryDataSourceInput,
    outputSchema: z.toJSONSchema(queryDataSourceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_data_source_templates: {
    description: 'List templates available on a Notion data source.',
    effect: 'read',
    inputSchema: listDataSourceTemplatesInput,
    outputSchema: z.toJSONSchema(listDataSourceTemplatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
