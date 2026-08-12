/**
 * Readwise 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const createHighlightsInput = z.strictObject({
  highlights: z.array(z.strictObject({
    text: z.string().min(1).describe('The highlighted text to save in Readwise.'),
    title: z.string().min(1).describe('The title of the source document or book.'),
    author: z.string().min(1).describe('The author of the source document or book.').optional(),
    category: z.enum(['books', 'articles', 'tweets', 'podcasts', 'supplemental']).describe('The Readwise highlight category such as books, articles, tweets, podcasts, or supplemental.').optional(),
    source_type: z.string().min(1).describe('The source type associated with the highlight, such as kindle, pocket, instapaper, or api.').optional(),
    note: z.string().describe('An optional note attached to the highlight.').optional(),
    location: z.int().min(1).describe('The highlight location in the source when available.').optional(),
    location_type: z.string().min(1).describe('The Readwise location type, such as page or order.').optional(),
    highlighted_at: z.string().min(1).describe('An ISO 8601 datetime string accepted by Readwise.').optional(),
    url: z.url().describe('The URL of the highlighted source when available.').optional(),
  }).describe('A highlight object accepted by the Readwise create highlights API.')).min(1).describe('The highlights to create.').optional(),
}).describe('The input payload for creating Readwise highlights.')

export const createHighlightsOutput = z.strictObject({
  books: z.array(z.strictObject({
    id: z.int().describe('The Readwise book identifier.').nullable().optional(),
    title: z.string().describe('The source title.').nullable().optional(),
    author: z.string().describe('The source author.').nullable().optional(),
    category: z.string().describe('The Readwise source category.').nullable().optional(),
    source: z.string().describe('The source integration or origin returned by Readwise.').nullable().optional(),
    numHighlights: z.int().describe('The number of highlights in the source.').nullable().optional(),
    updatedAt: z.string().describe('The datetime when the source was last updated.').nullable().optional(),
    highlights: z.array(z.strictObject({
      id: z.int().describe('The Readwise highlight identifier.').nullable().optional(),
      text: z.string().describe('The highlighted text.').optional(),
      title: z.string().describe('The source title when Readwise returns it.').nullable().optional(),
      author: z.string().describe('The source author when Readwise returns it.').nullable().optional(),
      note: z.string().describe('The note attached to the highlight when present.').nullable().optional(),
      url: z.string().describe('The source URL when present.').nullable().optional(),
      highlightedAt: z.string().describe('The datetime when the text was highlighted.').nullable().optional(),
      updatedAt: z.string().describe('The datetime when the highlight was last updated.').nullable().optional(),
      raw: z.looseObject({}).describe('The raw highlight object returned by Readwise.').optional(),
    }).describe('A normalized Readwise highlight.')).describe('Highlights included with this source.').optional(),
    raw: z.looseObject({}).describe('The raw source object returned by Readwise.').optional(),
  }).describe('A normalized Readwise book or source.')).describe('The books, articles, or podcasts created or updated by Readwise.').optional(),
  raw: z.array(z.looseObject({}).describe('One raw source object returned by Readwise.')).describe('The raw list of books, articles, or podcasts returned by Readwise.').optional(),
}).describe('The response returned after creating Readwise highlights.')

export const exportHighlightsInput = z.strictObject({
  updatedAfter: z.string().min(1).describe('An ISO 8601 datetime string accepted by Readwise.').optional(),
  pageCursor: z.string().min(1).describe('The pagination cursor returned by a previous export response.').optional(),
}).describe('The input payload for exporting Readwise highlights.')

export const exportHighlightsOutput = z.strictObject({
  count: z.int().describe('The total number of matching source records when provided.').nullable().optional(),
  nextPageCursor: z.string().describe('The cursor to pass as pageCursor on the next request, or null when there are no more pages.').nullable().optional(),
  books: z.array(z.strictObject({
    id: z.int().describe('The Readwise book identifier.').nullable().optional(),
    title: z.string().describe('The source title.').nullable().optional(),
    author: z.string().describe('The source author.').nullable().optional(),
    category: z.string().describe('The Readwise source category.').nullable().optional(),
    source: z.string().describe('The source integration or origin returned by Readwise.').nullable().optional(),
    numHighlights: z.int().describe('The number of highlights in the source.').nullable().optional(),
    updatedAt: z.string().describe('The datetime when the source was last updated.').nullable().optional(),
    highlights: z.array(z.strictObject({
      id: z.int().describe('The Readwise highlight identifier.').nullable().optional(),
      text: z.string().describe('The highlighted text.').optional(),
      title: z.string().describe('The source title when Readwise returns it.').nullable().optional(),
      author: z.string().describe('The source author when Readwise returns it.').nullable().optional(),
      note: z.string().describe('The note attached to the highlight when present.').nullable().optional(),
      url: z.string().describe('The source URL when present.').nullable().optional(),
      highlightedAt: z.string().describe('The datetime when the text was highlighted.').nullable().optional(),
      updatedAt: z.string().describe('The datetime when the highlight was last updated.').nullable().optional(),
      raw: z.looseObject({}).describe('The raw highlight object returned by Readwise.').optional(),
    }).describe('A normalized Readwise highlight.')).describe('Highlights included with this source.').optional(),
    raw: z.looseObject({}).describe('The raw source object returned by Readwise.').optional(),
  }).describe('A normalized Readwise book or source.')).describe('The exported books or sources.').optional(),
  raw: z.looseObject({}).describe('The raw export response returned by Readwise.').optional(),
}).describe('The response returned when exporting Readwise highlights.')

export const listBooksInput = z.strictObject({
  page: z.int().min(1).describe('The page number to return.').optional(),
  pageSize: z.int().min(1).describe('The number of books to return per page.').optional(),
  category: z.enum(['books', 'articles', 'tweets', 'podcasts', 'supplemental']).describe('The Readwise highlight category such as books, articles, tweets, podcasts, or supplemental.').optional(),
  updatedAfter: z.string().min(1).describe('An ISO 8601 datetime string accepted by Readwise.').optional(),
  updatedBefore: z.string().min(1).describe('An ISO 8601 datetime string accepted by Readwise.').optional(),
}).describe('The input payload for listing Readwise books.')

export const listBooksOutput = z.strictObject({
  count: z.int().describe('The total number of matching books when provided.').nullable().optional(),
  next: z.string().describe('The URL for the next page, or null when there is no next page.').nullable().optional(),
  previous: z.string().describe('The URL for the previous page, or null when there is no previous page.').nullable().optional(),
  books: z.array(z.strictObject({
    id: z.int().describe('The Readwise book identifier.').nullable().optional(),
    title: z.string().describe('The source title.').nullable().optional(),
    author: z.string().describe('The source author.').nullable().optional(),
    category: z.string().describe('The Readwise source category.').nullable().optional(),
    source: z.string().describe('The source integration or origin returned by Readwise.').nullable().optional(),
    numHighlights: z.int().describe('The number of highlights in the source.').nullable().optional(),
    updatedAt: z.string().describe('The datetime when the source was last updated.').nullable().optional(),
    highlights: z.array(z.strictObject({
      id: z.int().describe('The Readwise highlight identifier.').nullable().optional(),
      text: z.string().describe('The highlighted text.').optional(),
      title: z.string().describe('The source title when Readwise returns it.').nullable().optional(),
      author: z.string().describe('The source author when Readwise returns it.').nullable().optional(),
      note: z.string().describe('The note attached to the highlight when present.').nullable().optional(),
      url: z.string().describe('The source URL when present.').nullable().optional(),
      highlightedAt: z.string().describe('The datetime when the text was highlighted.').nullable().optional(),
      updatedAt: z.string().describe('The datetime when the highlight was last updated.').nullable().optional(),
      raw: z.looseObject({}).describe('The raw highlight object returned by Readwise.').optional(),
    }).describe('A normalized Readwise highlight.')).describe('Highlights included with this source.').optional(),
    raw: z.looseObject({}).describe('The raw source object returned by Readwise.').optional(),
  }).describe('A normalized Readwise book or source.')).describe('The books returned by Readwise.').optional(),
  raw: z.looseObject({}).describe('The raw books response returned by Readwise.').optional(),
}).describe('The response returned when listing Readwise books.')

export const listDocumentsInput = z.strictObject({
  pageCursor: z.string().min(1).describe('The pagination cursor returned by a previous list response.').optional(),
  updatedAfter: z.string().min(1).describe('An ISO 8601 datetime string accepted by Readwise.').optional(),
  location: z.enum(['new', 'later', 'shortlist', 'archive', 'feed']).describe('The Reader location filter such as new, later, shortlist, archive, or feed.').optional(),
  category: z.string().min(1).describe('The Reader category filter such as article, email, rss, or pdf.').optional(),
  tag: z.string().min(1).describe('Only return documents with this tag.').optional(),
}).describe('The input payload for listing Readwise Reader documents.')

export const listDocumentsOutput = z.strictObject({
  count: z.int().describe('The total number of matching documents when provided.').nullable().optional(),
  nextPageCursor: z.string().describe('The cursor to pass as pageCursor on the next request, or null when there are no more pages.').nullable().optional(),
  documents: z.array(z.strictObject({
    id: z.string().describe('The Readwise Reader document identifier.').nullable().optional(),
    url: z.string().describe('The document URL.').nullable().optional(),
    sourceUrl: z.string().describe('The original source URL when Readwise returns it.').nullable().optional(),
    title: z.string().describe('The document title.').nullable().optional(),
    author: z.string().describe('The document author.').nullable().optional(),
    category: z.string().describe('The Reader category.').nullable().optional(),
    location: z.string().describe('The Reader location such as new, later, shortlist, archive, or feed.').nullable().optional(),
    tags: z.array(z.string().describe('A Reader tag.')).describe('The document tags returned by Readwise.').optional(),
    createdAt: z.string().describe('The datetime when the document was created.').nullable().optional(),
    updatedAt: z.string().describe('The datetime when the document was last updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw document object returned by Readwise.').optional(),
  }).describe('A normalized Readwise Reader document.')).describe('The Reader documents returned by Readwise.').optional(),
  raw: z.looseObject({}).describe('The raw list response returned by Readwise.').optional(),
}).describe('The response returned when listing Readwise Reader documents.')

export const saveDocumentInput = z.strictObject({
  url: z.url().describe('The URL to save into Readwise Reader.'),
  title: z.string().min(1).describe('An optional document title.').optional(),
  author: z.string().min(1).describe('An optional document author.').optional(),
  summary: z.string().min(1).describe('An optional document summary.').optional(),
  shouldCleanHtml: z.boolean().describe('Whether Readwise should clean the saved document HTML.').optional(),
  savedUsing: z.string().min(1).describe('A label describing the app or workflow that saved the document.').optional(),
  tags: z.array(z.string().min(1).describe('A document tag.')).min(1).describe('Tags to attach to the saved document.').optional(),
}).describe('The input payload for saving a Readwise Reader document.')

export const saveDocumentOutput = z.strictObject({
  document: z.strictObject({
    id: z.string().describe('The Readwise Reader document identifier.').nullable().optional(),
    url: z.string().describe('The document URL.').nullable().optional(),
    sourceUrl: z.string().describe('The original source URL when Readwise returns it.').nullable().optional(),
    title: z.string().describe('The document title.').nullable().optional(),
    author: z.string().describe('The document author.').nullable().optional(),
    category: z.string().describe('The Reader category.').nullable().optional(),
    location: z.string().describe('The Reader location such as new, later, shortlist, archive, or feed.').nullable().optional(),
    tags: z.array(z.string().describe('A Reader tag.')).describe('The document tags returned by Readwise.').optional(),
    createdAt: z.string().describe('The datetime when the document was created.').nullable().optional(),
    updatedAt: z.string().describe('The datetime when the document was last updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw document object returned by Readwise.').optional(),
  }).describe('A normalized Readwise Reader document.').optional(),
  raw: z.looseObject({}).describe('The raw save response returned by Readwise.').optional(),
}).describe('The response returned after saving a Readwise Reader document.')

export const updateDocumentInput = z.strictObject({
  documentId: z.string().min(1).describe('The Readwise Reader document identifier.'),
  location: z.enum(['new', 'later', 'shortlist', 'archive', 'feed']).describe('The Reader location to apply to the document.').optional(),
  title: z.string().min(1).describe('The updated document title.').optional(),
  author: z.string().min(1).describe('The updated document author.').optional(),
  summary: z.string().min(1).describe('The updated document summary.').optional(),
  tags: z.array(z.string().min(1).describe('A document tag.')).min(1).describe('The complete tag list to set on the document.').optional(),
}).describe('The input payload for updating a Readwise Reader document.')

export const updateDocumentOutput = z.strictObject({
  document: z.strictObject({
    id: z.string().describe('The Readwise Reader document identifier.').nullable().optional(),
    url: z.string().describe('The document URL.').nullable().optional(),
    sourceUrl: z.string().describe('The original source URL when Readwise returns it.').nullable().optional(),
    title: z.string().describe('The document title.').nullable().optional(),
    author: z.string().describe('The document author.').nullable().optional(),
    category: z.string().describe('The Reader category.').nullable().optional(),
    location: z.string().describe('The Reader location such as new, later, shortlist, archive, or feed.').nullable().optional(),
    tags: z.array(z.string().describe('A Reader tag.')).describe('The document tags returned by Readwise.').optional(),
    createdAt: z.string().describe('The datetime when the document was created.').nullable().optional(),
    updatedAt: z.string().describe('The datetime when the document was last updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw document object returned by Readwise.').optional(),
  }).describe('A normalized Readwise Reader document.').optional(),
  raw: z.looseObject({}).describe('The raw update response returned by Readwise.').optional(),
}).describe('The response returned after updating a Readwise Reader document.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const readwiseActions = {
  create_highlights: {
    description: 'Create one or more highlights in Readwise.',
    effect: 'write',
    inputSchema: createHighlightsInput,
    outputSchema: z.toJSONSchema(createHighlightsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  export_highlights: {
    description: 'Export Readwise books and highlights updated after an optional date cursor.',
    effect: 'read',
    inputSchema: exportHighlightsInput,
    outputSchema: z.toJSONSchema(exportHighlightsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_books: {
    description: 'List Readwise books or sources with optional category and update filters.',
    effect: 'read',
    inputSchema: listBooksInput,
    outputSchema: z.toJSONSchema(listBooksOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_documents: {
    description: 'List Readwise Reader documents with optional filters and pagination.',
    effect: 'read',
    inputSchema: listDocumentsInput,
    outputSchema: z.toJSONSchema(listDocumentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  save_document: {
    description: 'Save a URL into Readwise Reader with optional metadata.',
    effect: 'write',
    inputSchema: saveDocumentInput,
    outputSchema: z.toJSONSchema(saveDocumentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_document: {
    description: 'Update the location, tags, or metadata for a Readwise Reader document.',
    effect: 'write',
    inputSchema: updateDocumentInput,
    outputSchema: z.toJSONSchema(updateDocumentOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
