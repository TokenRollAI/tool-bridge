/**
 * Outline 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

// 手写豁免(见 handwritten.json):get_document

export const listCollectionsInput = z.strictObject({
  offset: z.int().min(0).describe('The zero-based result offset to request.').optional(),
  limit: z.int().min(1).describe('The maximum number of results to request.').optional(),
  sort: z.string().min(1).describe('The field used to sort collection list results.').optional(),
  direction: z.enum(['ASC', 'DESC']).describe('The sort direction applied by Outline.').optional(),
  query: z.string().min(1).describe('Optional collection name query filter.').optional(),
  statusFilter: z.array(z.enum(['archived']).describe('One collection status filter accepted by Outline.')).describe('Optional collection statuses to include in the results.').optional(),
}).describe('Input parameters for listing Outline collections.')

export const listCollectionsOutput = z.strictObject({
  collections: z.array(z.strictObject({
    id: z.uuid().describe('The unique identifier for the collection.'),
    urlId: z.string().min(1).describe('The short collection URL identifier.').optional(),
    name: z.string().min(1).describe('The collection name.'),
    description: z.string().describe('The collection description, which may contain markdown.').optional(),
    sort: z.strictObject({
      field: z.string().describe('The collection sort field.'),
      direction: z.enum(['asc', 'desc']).describe('The collection sort direction returned by Outline.'),
    }).describe('The collection sort metadata returned by Outline.').optional(),
    index: z.string().describe('The sidebar index for the collection.').optional(),
    color: z.string().describe('The HEX color associated with the collection.').optional(),
    icon: z.string().describe('The icon or emoji associated with the collection.').optional(),
    permission: z.enum(['read', 'read_write']).describe('The collection permission returned by Outline.').optional(),
    sharing: z.boolean().describe('Whether sharing is enabled for the collection.').optional(),
    createdAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the collection was created.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the collection was last updated.'),
    archivedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the collection was archived, or null when active.').nullable().optional(),
    deletedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the collection was deleted, or null when active.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw collection object returned by Outline.').optional(),
  }).describe('One Outline collection returned by collection endpoints.')).describe('The collections returned by Outline.'),
  pagination: z.strictObject({
    offset: z.int().min(0).describe('The zero-based result offset.'),
    limit: z.int().min(1).describe('The maximum number of results requested.'),
  }).describe('The pagination object returned by Outline list endpoints.'),
}).describe('The paginated Outline collection list response.')

export const getCollectionInput = z.strictObject({
  id: z.uuid().describe('The unique identifier for the collection.'),
}).describe('Input parameters for retrieving one Outline collection.')

export const getCollectionOutput = z.strictObject({
  collection: z.strictObject({
    id: z.uuid().describe('The unique identifier for the collection.'),
    urlId: z.string().min(1).describe('The short collection URL identifier.').optional(),
    name: z.string().min(1).describe('The collection name.'),
    description: z.string().describe('The collection description, which may contain markdown.').optional(),
    sort: z.strictObject({
      field: z.string().describe('The collection sort field.'),
      direction: z.enum(['asc', 'desc']).describe('The collection sort direction returned by Outline.'),
    }).describe('The collection sort metadata returned by Outline.').optional(),
    index: z.string().describe('The sidebar index for the collection.').optional(),
    color: z.string().describe('The HEX color associated with the collection.').optional(),
    icon: z.string().describe('The icon or emoji associated with the collection.').optional(),
    permission: z.enum(['read', 'read_write']).describe('The collection permission returned by Outline.').optional(),
    sharing: z.boolean().describe('Whether sharing is enabled for the collection.').optional(),
    createdAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the collection was created.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the collection was last updated.'),
    archivedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the collection was archived, or null when active.').nullable().optional(),
    deletedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the collection was deleted, or null when active.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw collection object returned by Outline.').optional(),
  }).describe('One Outline collection returned by collection endpoints.'),
}).describe('The single Outline collection response.')

export const listCollectionDocumentsInput = z.strictObject({
  id: z.uuid().describe('The unique identifier for the collection.'),
}).describe('Input parameters for retrieving one Outline collection document tree.')

export const listCollectionDocumentsOutput = z.strictObject({
  tree: z.array(z.strictObject({
    id: z.uuid().describe('The unique identifier for the document.'),
    title: z.string().min(1).describe('The document title.'),
    url: z.string().describe('The document URL path returned by Outline.'),
    children: z.array(z.looseObject({}).describe('One child navigation node.')).describe('The child nodes nested under this document.'),
  }).describe('One node in the Outline collection document tree.')).describe('The document tree returned for the collection.'),
}).describe('The Outline collection document tree response.')

export const listDocumentsInput = z.strictObject({
  offset: z.int().min(0).describe('The zero-based result offset to request.').optional(),
  limit: z.int().min(1).describe('The maximum number of results to request.').optional(),
  sort: z.string().min(1).describe('The field used to sort document list results.').optional(),
  direction: z.enum(['ASC', 'DESC']).describe('The sort direction applied by Outline.').optional(),
  collectionId: z.uuid().describe('Optional collection UUID used to restrict the document list.').optional(),
  userId: z.uuid().describe('Optional user UUID used to restrict the document list.').optional(),
  backlinkDocumentId: z.uuid().describe('Optional document UUID used to filter documents that backlink to the specified document.').optional(),
  parentDocumentId: z.uuid().describe('Optional parent document UUID used to list direct child documents.').optional(),
  statusFilter: z.array(z.enum(['draft', 'archived', 'published']).describe('One document status filter accepted by Outline.')).describe('Optional document statuses to include in the results.').optional(),
}).describe('Input parameters for listing Outline documents.')

export const listDocumentsOutput = z.strictObject({
  documents: z.array(z.strictObject({
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
    createdBy: z.strictObject({
      id: z.uuid().describe('The unique identifier for the user.'),
      name: z.string().min(1).describe('The display name of the user.'),
      avatarUrl: z.url().describe('The avatar URL for the user.').optional(),
      email: z.email().describe('The email address for the user.').optional(),
      role: z.enum(['admin', 'member', 'viewer', 'guest']).describe('The Outline user role.').optional(),
      isSuspended: z.boolean().describe('Whether the user is suspended.').optional(),
      lastActiveAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the user was last active.').optional(),
      createdAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the user was created.').optional(),
    }).describe('One Outline user returned inside auth or document metadata.').optional(),
    updatedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the document was last updated.').optional(),
    updatedBy: z.strictObject({
      id: z.uuid().describe('The unique identifier for the user.'),
      name: z.string().min(1).describe('The display name of the user.'),
      avatarUrl: z.url().describe('The avatar URL for the user.').optional(),
      email: z.email().describe('The email address for the user.').optional(),
      role: z.enum(['admin', 'member', 'viewer', 'guest']).describe('The Outline user role.').optional(),
      isSuspended: z.boolean().describe('Whether the user is suspended.').optional(),
      lastActiveAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the user was last active.').optional(),
      createdAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the user was created.').optional(),
    }).describe('One Outline user returned inside auth or document metadata.').optional(),
    publishedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the document was published, or null when it is a draft.').nullable().optional(),
    dataAttributes: z.array(z.strictObject({
      dataAttributeId: z.uuid().describe('The unique identifier for the associated data attribute.'),
      value: z.union([z.string().describe('A string data attribute value.'), z.boolean().describe('A boolean data attribute value.'), z.number().describe('A numeric data attribute value.')]).describe('A data attribute value returned by Outline, which may be string, boolean, or number.'),
      updatedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when this data attribute value was last updated.'),
    }).describe('One document data attribute returned by Outline.')).describe('The data attributes attached to the document.').nullable().optional(),
    archivedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the document was archived, or null when active.').nullable().optional(),
    deletedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the document was deleted, or null when active.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw document object returned by Outline.').optional(),
  }).describe('One Outline document returned by document endpoints.')).describe('The documents returned by Outline.'),
  pagination: z.strictObject({
    offset: z.int().min(0).describe('The zero-based result offset.'),
    limit: z.int().min(1).describe('The maximum number of results requested.'),
  }).describe('The pagination object returned by Outline list endpoints.'),
}).describe('The paginated Outline document list response.')

export const searchDocumentsInput = z.strictObject({
  offset: z.int().min(0).describe('The zero-based result offset to request.').optional(),
  limit: z.int().min(1).describe('The maximum number of results to request.').optional(),
  query: z.string().min(1).describe('The keyword query used to search documents.'),
  userId: z.uuid().describe('Optional user UUID used to filter by editor.').optional(),
  collectionId: z.uuid().describe('Optional collection UUID used to restrict search scope.').optional(),
  documentId: z.uuid().describe('Optional document UUID used to search within a document subtree.').optional(),
  statusFilter: z.array(z.enum(['draft', 'archived', 'published']).describe('One document status filter accepted by Outline.')).describe('Optional document statuses to include in the search results.').optional(),
  dateFilter: z.enum(['day', 'week', 'month', 'year']).describe('The recency filter applied by Outline search.').optional(),
  shareId: z.string().min(1).describe('Optional share identifier used to restrict search to a shared collection or document.').optional(),
  snippetMinWords: z.int().min(0).describe('The minimum number of words to include in result snippets.').optional(),
  snippetMaxWords: z.int().min(0).describe('The maximum number of words to include in result snippets.').optional(),
  sort: z.enum(['relevance', 'createdAt', 'updatedAt', 'title']).describe('The sorting mode applied by Outline document search.').optional(),
  direction: z.enum(['ASC', 'DESC']).describe('The sort direction applied by Outline.').optional(),
}).describe('Input parameters for searching Outline documents.')

export const searchDocumentsOutput = z.strictObject({
  documents: z.array(z.strictObject({
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
    createdBy: z.strictObject({
      id: z.uuid().describe('The unique identifier for the user.'),
      name: z.string().min(1).describe('The display name of the user.'),
      avatarUrl: z.url().describe('The avatar URL for the user.').optional(),
      email: z.email().describe('The email address for the user.').optional(),
      role: z.enum(['admin', 'member', 'viewer', 'guest']).describe('The Outline user role.').optional(),
      isSuspended: z.boolean().describe('Whether the user is suspended.').optional(),
      lastActiveAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the user was last active.').optional(),
      createdAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the user was created.').optional(),
    }).describe('One Outline user returned inside auth or document metadata.').optional(),
    updatedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the document was last updated.').optional(),
    updatedBy: z.strictObject({
      id: z.uuid().describe('The unique identifier for the user.'),
      name: z.string().min(1).describe('The display name of the user.'),
      avatarUrl: z.url().describe('The avatar URL for the user.').optional(),
      email: z.email().describe('The email address for the user.').optional(),
      role: z.enum(['admin', 'member', 'viewer', 'guest']).describe('The Outline user role.').optional(),
      isSuspended: z.boolean().describe('Whether the user is suspended.').optional(),
      lastActiveAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the user was last active.').optional(),
      createdAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the user was created.').optional(),
    }).describe('One Outline user returned inside auth or document metadata.').optional(),
    publishedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the document was published, or null when it is a draft.').nullable().optional(),
    dataAttributes: z.array(z.strictObject({
      dataAttributeId: z.uuid().describe('The unique identifier for the associated data attribute.'),
      value: z.union([z.string().describe('A string data attribute value.'), z.boolean().describe('A boolean data attribute value.'), z.number().describe('A numeric data attribute value.')]).describe('A data attribute value returned by Outline, which may be string, boolean, or number.'),
      updatedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when this data attribute value was last updated.'),
    }).describe('One document data attribute returned by Outline.')).describe('The data attributes attached to the document.').nullable().optional(),
    archivedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the document was archived, or null when active.').nullable().optional(),
    deletedAt: z.iso.datetime({ offset: true }).describe('The ISO timestamp when the document was deleted, or null when active.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw document object returned by Outline.').optional(),
  }).describe('One Outline document returned by document endpoints.')).describe('The matching documents returned by Outline search.'),
  pagination: z.strictObject({
    offset: z.int().min(0).describe('The zero-based result offset.'),
    limit: z.int().min(1).describe('The maximum number of results requested.'),
  }).describe('The pagination object returned by Outline list endpoints.'),
}).describe('The paginated Outline document search response.')

import { getDocumentInput, getDocumentOutput } from './schema.handwritten'

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const outlineActions = {
  list_collections: {
    description: 'List Outline collections the authenticated user can access, with optional search, status filtering, pagination, and sorting.',
    effect: 'read',
    inputSchema: listCollectionsInput,
    outputSchema: z.toJSONSchema(listCollectionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_collection: {
    description: 'Retrieve one Outline collection by its UUID.',
    effect: 'read',
    inputSchema: getCollectionInput,
    outputSchema: z.toJSONSchema(getCollectionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_collection_documents: {
    description: 'Retrieve the document tree for one Outline collection by UUID.',
    effect: 'read',
    inputSchema: listCollectionDocumentsInput,
    outputSchema: z.toJSONSchema(listCollectionDocumentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_documents: {
    description: 'List Outline documents visible to the authenticated user with optional collection, user, parent, status, pagination, and sorting filters.',
    effect: 'read',
    inputSchema: listDocumentsInput,
    outputSchema: z.toJSONSchema(listDocumentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_documents: {
    description: 'Search Outline documents by keyword with optional scope, recency, snippet, pagination, and sorting controls.',
    effect: 'read',
    inputSchema: searchDocumentsInput,
    outputSchema: z.toJSONSchema(searchDocumentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_document: {
    description: 'Retrieve one Outline document by UUID or urlId, or by shareId when reading through a share link context.',
    effect: 'read',
    inputSchema: getDocumentInput,
    outputSchema: z.toJSONSchema(getDocumentOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
