/**
 * Confluence 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const searchContentInput = z.strictObject({
  cql: z.string().min(1).describe('The Confluence Query Language string to execute.'),
  limit: z.int().min(1).max(100).describe('Maximum number of items to return.').optional(),
  cursor: z.string().min(1).describe('Opaque pagination cursor returned by Confluence.').optional(),
}).describe('Input parameters for searching Confluence content.')

export const searchContentOutput = z.strictObject({
  results: z.array(z.looseObject({
    id: z.string().describe('The Confluence content ID when returned.').optional(),
    type: z.string().describe('The Confluence content type when returned.').optional(),
    title: z.string().describe('The Confluence content title when returned.').optional(),
    url: z.string().describe('The Confluence web URL when returned.').optional(),
    excerpt: z.string().describe('The Confluence search excerpt when returned.').optional(),
    containerTitle: z.string().describe('The Confluence container title when returned.').optional(),
    raw: z.looseObject({}).describe('Provider-specific Confluence payload fields.').optional(),
  }).describe('A Confluence search result.')).describe('The matching Confluence search results.').optional(),
  pagination: z.strictObject({
    nextCursor: z.string().describe('Cursor for the next Confluence page, or null when no next page is available.').nullable().optional(),
  }).describe('Confluence pagination metadata.').optional(),
}).describe('The normalized Confluence search response.')

export const listSpacesInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('Maximum number of items to return.').optional(),
  cursor: z.string().min(1).describe('Opaque pagination cursor returned by Confluence.').optional(),
  type: z.enum(['global', 'personal']).describe('Filter spaces by Confluence space type.').optional(),
  status: z.enum(['current', 'archived']).describe('Filter spaces by Confluence space status.').optional(),
}).describe('Input parameters for listing Confluence spaces.')

export const listSpacesOutput = z.strictObject({
  spaces: z.array(z.looseObject({
    id: z.string().describe('The Confluence space ID.').optional(),
    key: z.string().describe('The Confluence space key.').optional(),
    name: z.string().describe('The Confluence space name.').optional(),
    type: z.string().describe('The Confluence space type.').optional(),
    status: z.string().describe('The Confluence space status.').optional(),
    homepageId: z.string().describe('The ID of the space homepage, or null when unavailable.').nullable().optional(),
    raw: z.looseObject({}).describe('Provider-specific Confluence payload fields.').optional(),
  }).describe('A Confluence space.')).describe('The Confluence spaces returned by the request.').optional(),
  pagination: z.strictObject({
    nextCursor: z.string().describe('Cursor for the next Confluence page, or null when no next page is available.').nullable().optional(),
  }).describe('Confluence pagination metadata.').optional(),
}).describe('The normalized Confluence spaces response.')

export const getPageInput = z.strictObject({
  pageId: z.string().min(1).describe('The Confluence page ID.'),
  bodyFormat: z.enum(['storage', 'atlas_doc_format', 'view', 'export_view', 'styled_view']).describe('The body representation to include.').optional(),
}).describe('Input parameters for retrieving a Confluence page.')

export const getPageOutput = z.strictObject({
  page: z.looseObject({
    id: z.string().describe('The Confluence page ID.').optional(),
    status: z.string().describe('The Confluence page status.').optional(),
    title: z.string().describe('The Confluence page title.').optional(),
    spaceId: z.string().describe('The Confluence space ID containing the page.').optional(),
    parentId: z.string().describe('The parent page ID, or null when unavailable.').nullable().optional(),
    createdAt: z.string().describe('The Confluence page creation timestamp.').optional(),
    version: z.looseObject({
      number: z.int().describe('The Confluence page version number.').optional(),
      message: z.string().describe('The Confluence page version message.').optional(),
      minorEdit: z.boolean().describe('Whether this version is marked as a minor edit.').optional(),
    }).describe('A Confluence page version.').nullable().optional(),
    body: z.looseObject({}).describe('Provider-specific Confluence payload fields.').nullable().optional(),
    raw: z.looseObject({}).describe('Provider-specific Confluence payload fields.').optional(),
  }).describe('A Confluence page.').optional(),
}).describe('The normalized Confluence page response.')

export const createPageInput = z.strictObject({
  spaceId: z.string().min(1).describe('The Confluence space ID where the page will be created.'),
  title: z.string().min(1).describe('The title for the new Confluence page.'),
  body: z.string().min(1).describe('The page body value for the selected representation.'),
  bodyRepresentation: z.enum(['storage', 'atlas_doc_format']).describe('The representation used for the page body.').optional(),
  parentId: z.string().min(1).describe('The parent Confluence page ID.').optional(),
  status: z.enum(['current', 'draft']).describe('The Confluence page status to create.').optional(),
}).describe('Input parameters for creating a Confluence page.')

export const createPageOutput = z.strictObject({
  page: z.looseObject({
    id: z.string().describe('The Confluence page ID.').optional(),
    status: z.string().describe('The Confluence page status.').optional(),
    title: z.string().describe('The Confluence page title.').optional(),
    spaceId: z.string().describe('The Confluence space ID containing the page.').optional(),
    parentId: z.string().describe('The parent page ID, or null when unavailable.').nullable().optional(),
    createdAt: z.string().describe('The Confluence page creation timestamp.').optional(),
    version: z.looseObject({
      number: z.int().describe('The Confluence page version number.').optional(),
      message: z.string().describe('The Confluence page version message.').optional(),
      minorEdit: z.boolean().describe('Whether this version is marked as a minor edit.').optional(),
    }).describe('A Confluence page version.').nullable().optional(),
    body: z.looseObject({}).describe('Provider-specific Confluence payload fields.').nullable().optional(),
    raw: z.looseObject({}).describe('Provider-specific Confluence payload fields.').optional(),
  }).describe('A Confluence page.').optional(),
}).describe('The normalized Confluence create page response.')

export const updatePageInput = z.strictObject({
  pageId: z.string().min(1).describe('The Confluence page ID.'),
  title: z.string().min(1).describe('The updated Confluence page title.'),
  versionNumber: z.int().min(1).describe('The next Confluence page version number.'),
  body: z.string().min(1).describe('The updated page body value for the selected representation.').optional(),
  bodyRepresentation: z.enum(['storage', 'atlas_doc_format']).describe('The representation used for the page body.').optional(),
  status: z.enum(['current', 'draft']).describe('The updated Confluence page status.').optional(),
  versionMessage: z.string().min(1).describe('A message stored with the new Confluence page version.').optional(),
  minorEdit: z.boolean().describe('Whether the update should be marked as a minor edit.').optional(),
}).describe('Input parameters for updating a Confluence page.')

export const updatePageOutput = z.strictObject({
  page: z.looseObject({
    id: z.string().describe('The Confluence page ID.').optional(),
    status: z.string().describe('The Confluence page status.').optional(),
    title: z.string().describe('The Confluence page title.').optional(),
    spaceId: z.string().describe('The Confluence space ID containing the page.').optional(),
    parentId: z.string().describe('The parent page ID, or null when unavailable.').nullable().optional(),
    createdAt: z.string().describe('The Confluence page creation timestamp.').optional(),
    version: z.looseObject({
      number: z.int().describe('The Confluence page version number.').optional(),
      message: z.string().describe('The Confluence page version message.').optional(),
      minorEdit: z.boolean().describe('Whether this version is marked as a minor edit.').optional(),
    }).describe('A Confluence page version.').nullable().optional(),
    body: z.looseObject({}).describe('Provider-specific Confluence payload fields.').nullable().optional(),
    raw: z.looseObject({}).describe('Provider-specific Confluence payload fields.').optional(),
  }).describe('A Confluence page.').optional(),
}).describe('The normalized Confluence update page response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const confluenceActions = {
  search_content: {
    description: 'Search Confluence content with CQL and return normalized result metadata plus pagination.',
    effect: 'read',
    inputSchema: searchContentInput,
    outputSchema: z.toJSONSchema(searchContentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_spaces: {
    description: 'List Confluence spaces and return normalized space metadata plus pagination.',
    effect: 'read',
    inputSchema: listSpacesInput,
    outputSchema: z.toJSONSchema(listSpacesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_page: {
    description: 'Get a Confluence page by ID and optionally include its body representation.',
    effect: 'read',
    inputSchema: getPageInput,
    outputSchema: z.toJSONSchema(getPageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_page: {
    description: 'Create a Confluence page using a JSON-friendly body value and return the created page.',
    effect: 'write',
    inputSchema: createPageInput,
    outputSchema: z.toJSONSchema(createPageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_page: {
    description: 'Update a Confluence page title, body, or status using an explicit next version number.',
    effect: 'write',
    inputSchema: updatePageInput,
    outputSchema: z.toJSONSchema(updatePageOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
