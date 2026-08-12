/**
 * Semantic Scholar 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getPaperInput = z.strictObject({
  paperId: z.string().min(1).regex(new RegExp('\\S')).describe('The Semantic Scholar paper ID, CorpusId, DOI:<doi>, ARXIV:<id>, MAG:<id>, ACL:<id>, PMID:<id>, or PMCID:<id>.'),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Semantic Scholar fields to return, using dot notation for nested fields when needed.').optional(),
}).describe('The input payload for retrieving a Semantic Scholar paper.')

export const getPaperOutput = z.strictObject({
  paper: z.looseObject({}).describe('The paper object returned by Semantic Scholar.').optional(),
}).describe('The response returned when retrieving a Semantic Scholar paper.')

export const getPapersInput = z.strictObject({
  paperIds: z.array(z.string().min(1).regex(new RegExp('\\S')).describe('The Semantic Scholar paper ID, CorpusId, DOI:<doi>, ARXIV:<id>, MAG:<id>, ACL:<id>, PMID:<id>, or PMCID:<id>.')).min(1).max(500).describe('The paper IDs to request.'),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Semantic Scholar fields to return, using dot notation for nested fields when needed.').optional(),
}).describe('The input payload for retrieving multiple Semantic Scholar papers.')

export const getPapersOutput = z.strictObject({
  papers: z.array(z.looseObject({}).describe('The paper object returned by Semantic Scholar.').nullable()).describe('The papers returned in the same order as the requested IDs.').optional(),
}).describe('The response returned when retrieving multiple Semantic Scholar papers.')

export const searchPapersInput = z.strictObject({
  query: z.string().min(1).regex(new RegExp('\\S')).describe('The plain-text search query. Semantic Scholar does not support special query syntax.'),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Semantic Scholar fields to return, using dot notation for nested fields when needed.').optional(),
  limit: z.int().min(1).max(100).describe('The maximum number of results to return.').optional(),
  offset: z.int().min(0).describe('The zero-based pagination offset.').optional(),
  year: z.string().min(1).regex(new RegExp('\\S')).describe('The publication year or inclusive year range, such as 2019, 2016-2020, 2010-, or -2015.').optional(),
  venue: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of publication venues to filter by, using full names or abbreviations.').optional(),
  fieldsOfStudy: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of fields of study to filter by.').optional(),
  publicationTypes: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of publication types to filter by, such as Review, JournalArticle, or Conference.').optional(),
  publicationDateOrYear: z.string().min(1).regex(new RegExp('\\S')).describe('The publication date or year filter, such as 2019, 2020-06, 2016-03-05:2020-06-06, 1981-08-25:, or :2015-01.').optional(),
  minCitationCount: z.int().min(0).describe('The minimum number of citations a paper must have.').optional(),
  openAccessPdf: z.boolean().describe('Whether to restrict results to papers with a public PDF available.').optional(),
}).describe('The input payload for searching Semantic Scholar papers by relevance.')

export const searchPapersOutput = z.strictObject({
  total: z.int().describe('The total result count when Semantic Scholar returns it.').nullable().optional(),
  offset: z.int().describe('The returned result offset when Semantic Scholar returns it.').nullable().optional(),
  next: z.int().describe('The next offset when Semantic Scholar returns it.').nullable().optional(),
  token: z.string().describe('The continuation token when Semantic Scholar returns it.').nullable().optional(),
  papers: z.array(z.looseObject({}).describe('The paper object returned by Semantic Scholar.')).describe('The papers returned by Semantic Scholar.').optional(),
  raw: z.looseObject({}).describe('The raw Semantic Scholar response payload.').optional(),
}).describe('A Semantic Scholar paper list response.')

export const bulkSearchPapersInput = z.strictObject({
  query: z.string().min(1).regex(new RegExp('\\S')).describe('The plain-text search query. Semantic Scholar does not support special query syntax.'),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Semantic Scholar fields to return, using dot notation for nested fields when needed.').optional(),
  limit: z.int().min(1).max(100).describe('The maximum number of results to return.').optional(),
  token: z.string().min(1).regex(new RegExp('\\S')).describe('The continuation token returned by Semantic Scholar.').optional(),
  year: z.string().min(1).regex(new RegExp('\\S')).describe('The publication year or inclusive year range, such as 2019, 2016-2020, 2010-, or -2015.').optional(),
  venue: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of publication venues to filter by, using full names or abbreviations.').optional(),
  fieldsOfStudy: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of fields of study to filter by.').optional(),
  publicationTypes: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of publication types to filter by, such as Review, JournalArticle, or Conference.').optional(),
  publicationDateOrYear: z.string().min(1).regex(new RegExp('\\S')).describe('The publication date or year filter, such as 2019, 2020-06, 2016-03-05:2020-06-06, 1981-08-25:, or :2015-01.').optional(),
  minCitationCount: z.int().min(0).describe('The minimum number of citations a paper must have.').optional(),
  openAccessPdf: z.boolean().describe('Whether to restrict results to papers with a public PDF available.').optional(),
}).describe('The input payload for bulk-searching Semantic Scholar papers.')

export const bulkSearchPapersOutput = z.strictObject({
  total: z.int().describe('The total result count when Semantic Scholar returns it.').nullable().optional(),
  offset: z.int().describe('The returned result offset when Semantic Scholar returns it.').nullable().optional(),
  next: z.int().describe('The next offset when Semantic Scholar returns it.').nullable().optional(),
  token: z.string().describe('The continuation token when Semantic Scholar returns it.').nullable().optional(),
  papers: z.array(z.looseObject({}).describe('The paper object returned by Semantic Scholar.')).describe('The papers returned by Semantic Scholar.').optional(),
  raw: z.looseObject({}).describe('The raw Semantic Scholar response payload.').optional(),
}).describe('A Semantic Scholar paper list response.')

export const matchPaperTitleInput = z.strictObject({
  query: z.string().min(1).regex(new RegExp('\\S')).describe('The plain-text search query. Semantic Scholar does not support special query syntax.'),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Semantic Scholar fields to return, using dot notation for nested fields when needed.').optional(),
}).describe('The input payload for matching a Semantic Scholar paper title.')

export const matchPaperTitleOutput = z.strictObject({
  paper: z.looseObject({}).describe('The paper object returned by Semantic Scholar.').nullable().optional(),
  raw: z.looseObject({}).describe('The raw Semantic Scholar response payload.').optional(),
}).describe('The response returned when matching a Semantic Scholar paper title.')

export const autocompletePapersInput = z.strictObject({
  query: z.string().min(1).regex(new RegExp('\\S')).describe('The plain-text search query. Semantic Scholar does not support special query syntax.'),
  limit: z.int().min(1).max(100).describe('The maximum number of results to return.').optional(),
}).describe('The input payload for Semantic Scholar paper autocomplete.')

export const autocompletePapersOutput = z.strictObject({
  completions: z.array(z.looseObject({}).describe('One autocomplete suggestion returned by Semantic Scholar.')).describe('The autocomplete suggestions returned by Semantic Scholar.').optional(),
  raw: z.looseObject({}).describe('The raw Semantic Scholar response payload.').optional(),
}).describe('The response returned by Semantic Scholar paper autocomplete.')

export const getPaperAuthorsInput = z.strictObject({
  paperId: z.string().min(1).regex(new RegExp('\\S')).describe('The Semantic Scholar paper ID, CorpusId, DOI:<doi>, ARXIV:<id>, MAG:<id>, ACL:<id>, PMID:<id>, or PMCID:<id>.'),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Semantic Scholar fields to return, using dot notation for nested fields when needed.').optional(),
  limit: z.int().min(1).max(100).describe('The maximum number of results to return.').optional(),
  offset: z.int().min(0).describe('The zero-based pagination offset.').optional(),
}).describe('The input payload for listing Semantic Scholar paper authors.')

export const getPaperAuthorsOutput = z.strictObject({
  total: z.int().describe('The total result count when Semantic Scholar returns it.').nullable().optional(),
  offset: z.int().describe('The returned result offset when Semantic Scholar returns it.').nullable().optional(),
  next: z.int().describe('The next offset when Semantic Scholar returns it.').nullable().optional(),
  authors: z.array(z.looseObject({}).describe('The author object returned by Semantic Scholar.')).describe('The authors returned by Semantic Scholar.').optional(),
  raw: z.looseObject({}).describe('The raw Semantic Scholar response payload.').optional(),
}).describe('A Semantic Scholar author list response.')

export const getPaperCitationsInput = z.strictObject({
  paperId: z.string().min(1).regex(new RegExp('\\S')).describe('The Semantic Scholar paper ID, CorpusId, DOI:<doi>, ARXIV:<id>, MAG:<id>, ACL:<id>, PMID:<id>, or PMCID:<id>.'),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Semantic Scholar fields to return, using dot notation for nested fields when needed.').optional(),
  limit: z.int().min(1).max(100).describe('The maximum number of results to return.').optional(),
  offset: z.int().min(0).describe('The zero-based pagination offset.').optional(),
}).describe('The input payload for listing Semantic Scholar paper citations.')

export const getPaperCitationsOutput = z.strictObject({
  total: z.int().describe('The total edge count when Semantic Scholar returns it.').nullable().optional(),
  offset: z.int().describe('The returned result offset when Semantic Scholar returns it.').nullable().optional(),
  next: z.int().describe('The next offset when Semantic Scholar returns it.').nullable().optional(),
  data: z.array(z.looseObject({}).describe('One paper edge returned by Semantic Scholar.')).describe('The citation or reference edges returned by Semantic Scholar.').optional(),
  raw: z.looseObject({}).describe('The raw Semantic Scholar response payload.').optional(),
}).describe('A Semantic Scholar paper edge list response.')

export const getPaperReferencesInput = z.strictObject({
  paperId: z.string().min(1).regex(new RegExp('\\S')).describe('The Semantic Scholar paper ID, CorpusId, DOI:<doi>, ARXIV:<id>, MAG:<id>, ACL:<id>, PMID:<id>, or PMCID:<id>.'),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Semantic Scholar fields to return, using dot notation for nested fields when needed.').optional(),
  limit: z.int().min(1).max(100).describe('The maximum number of results to return.').optional(),
  offset: z.int().min(0).describe('The zero-based pagination offset.').optional(),
}).describe('The input payload for listing Semantic Scholar paper references.')

export const getPaperReferencesOutput = z.strictObject({
  total: z.int().describe('The total edge count when Semantic Scholar returns it.').nullable().optional(),
  offset: z.int().describe('The returned result offset when Semantic Scholar returns it.').nullable().optional(),
  next: z.int().describe('The next offset when Semantic Scholar returns it.').nullable().optional(),
  data: z.array(z.looseObject({}).describe('One paper edge returned by Semantic Scholar.')).describe('The citation or reference edges returned by Semantic Scholar.').optional(),
  raw: z.looseObject({}).describe('The raw Semantic Scholar response payload.').optional(),
}).describe('A Semantic Scholar paper edge list response.')

export const searchAuthorsInput = z.strictObject({
  query: z.string().min(1).regex(new RegExp('\\S')).describe('The plain-text search query. Semantic Scholar does not support special query syntax.'),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Semantic Scholar fields to return, using dot notation for nested fields when needed.').optional(),
  limit: z.int().min(1).max(100).describe('The maximum number of results to return.').optional(),
  offset: z.int().min(0).describe('The zero-based pagination offset.').optional(),
}).describe('The input payload for searching Semantic Scholar authors.')

export const searchAuthorsOutput = z.strictObject({
  total: z.int().describe('The total result count when Semantic Scholar returns it.').nullable().optional(),
  offset: z.int().describe('The returned result offset when Semantic Scholar returns it.').nullable().optional(),
  next: z.int().describe('The next offset when Semantic Scholar returns it.').nullable().optional(),
  authors: z.array(z.looseObject({}).describe('The author object returned by Semantic Scholar.')).describe('The authors returned by Semantic Scholar.').optional(),
  raw: z.looseObject({}).describe('The raw Semantic Scholar response payload.').optional(),
}).describe('A Semantic Scholar author list response.')

export const getAuthorInput = z.strictObject({
  authorId: z.string().min(1).regex(new RegExp('\\S')).describe('The Semantic Scholar author ID.'),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Semantic Scholar fields to return, using dot notation for nested fields when needed.').optional(),
}).describe('The input payload for retrieving a Semantic Scholar author.')

export const getAuthorOutput = z.strictObject({
  author: z.looseObject({}).describe('The author object returned by Semantic Scholar.').optional(),
}).describe('The response returned when retrieving a Semantic Scholar author.')

export const getAuthorsInput = z.strictObject({
  authorIds: z.array(z.string().min(1).regex(new RegExp('\\S')).describe('The Semantic Scholar author ID.')).min(1).max(1000).describe('The author IDs to request.'),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Semantic Scholar fields to return, using dot notation for nested fields when needed.').optional(),
}).describe('The input payload for retrieving multiple Semantic Scholar authors.')

export const getAuthorsOutput = z.strictObject({
  authors: z.array(z.looseObject({}).describe('The author object returned by Semantic Scholar.').nullable()).describe('The authors returned in the same order as the requested IDs.').optional(),
}).describe('The response returned when retrieving multiple Semantic Scholar authors.')

export const getAuthorPapersInput = z.strictObject({
  authorId: z.string().min(1).regex(new RegExp('\\S')).describe('The Semantic Scholar author ID.'),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Semantic Scholar fields to return, using dot notation for nested fields when needed.').optional(),
  limit: z.int().min(1).max(100).describe('The maximum number of results to return.').optional(),
  offset: z.int().min(0).describe('The zero-based pagination offset.').optional(),
}).describe('The input payload for listing Semantic Scholar author papers.')

export const getAuthorPapersOutput = z.strictObject({
  total: z.int().describe('The total result count when Semantic Scholar returns it.').nullable().optional(),
  offset: z.int().describe('The returned result offset when Semantic Scholar returns it.').nullable().optional(),
  next: z.int().describe('The next offset when Semantic Scholar returns it.').nullable().optional(),
  token: z.string().describe('The continuation token when Semantic Scholar returns it.').nullable().optional(),
  papers: z.array(z.looseObject({}).describe('The paper object returned by Semantic Scholar.')).describe('The papers returned by Semantic Scholar.').optional(),
  raw: z.looseObject({}).describe('The raw Semantic Scholar response payload.').optional(),
}).describe('A Semantic Scholar paper list response.')

export const searchSnippetsInput = z.strictObject({
  query: z.string().min(1).regex(new RegExp('\\S')).describe('The plain-text search query. Semantic Scholar does not support special query syntax.'),
  limit: z.int().min(1).max(100).describe('The maximum number of results to return.').optional(),
}).describe('The input payload for searching Semantic Scholar text snippets.')

export const searchSnippetsOutput = z.strictObject({
  total: z.int().describe('The total result count when Semantic Scholar returns it.').nullable().optional(),
  offset: z.int().describe('The returned result offset when Semantic Scholar returns it.').nullable().optional(),
  next: z.int().describe('The next offset when Semantic Scholar returns it.').nullable().optional(),
  snippets: z.array(z.looseObject({}).describe('The text snippet object returned by Semantic Scholar.')).describe('The snippets returned by Semantic Scholar.').optional(),
  raw: z.looseObject({}).describe('The raw Semantic Scholar response payload.').optional(),
}).describe('The response returned by Semantic Scholar text snippet search.')

export const recommendForPaperInput = z.strictObject({
  paperId: z.string().min(1).regex(new RegExp('\\S')).describe('The Semantic Scholar paper ID, CorpusId, DOI:<doi>, ARXIV:<id>, MAG:<id>, ACL:<id>, PMID:<id>, or PMCID:<id>.'),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Semantic Scholar fields to return, using dot notation for nested fields when needed.').optional(),
  limit: z.int().min(1).max(500).describe('The maximum number of recommendations to return.').optional(),
}).describe('The input payload for recommending papers from one Semantic Scholar paper.')

export const recommendForPaperOutput = z.strictObject({
  total: z.int().describe('The total result count when Semantic Scholar returns it.').nullable().optional(),
  offset: z.int().describe('The returned result offset when Semantic Scholar returns it.').nullable().optional(),
  next: z.int().describe('The next offset when Semantic Scholar returns it.').nullable().optional(),
  token: z.string().describe('The continuation token when Semantic Scholar returns it.').nullable().optional(),
  papers: z.array(z.looseObject({}).describe('The paper object returned by Semantic Scholar.')).describe('The papers returned by Semantic Scholar.').optional(),
  raw: z.looseObject({}).describe('The raw Semantic Scholar response payload.').optional(),
}).describe('A Semantic Scholar paper list response.')

export const recommendPapersInput = z.strictObject({
  positivePaperIds: z.array(z.string().min(1).regex(new RegExp('\\S')).describe('The Semantic Scholar paper ID, CorpusId, DOI:<doi>, ARXIV:<id>, MAG:<id>, ACL:<id>, PMID:<id>, or PMCID:<id>.')).min(1).max(500).describe('The paper IDs that represent positive examples.'),
  negativePaperIds: z.array(z.string().min(1).regex(new RegExp('\\S')).describe('The Semantic Scholar paper ID, CorpusId, DOI:<doi>, ARXIV:<id>, MAG:<id>, ACL:<id>, PMID:<id>, or PMCID:<id>.')).min(1).max(500).describe('The paper IDs that represent negative examples.').optional(),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Semantic Scholar fields to return, using dot notation for nested fields when needed.').optional(),
  limit: z.int().min(1).max(500).describe('The maximum number of recommendations to return.').optional(),
}).describe('The input payload for recommending Semantic Scholar papers from example paper IDs.')

export const recommendPapersOutput = z.strictObject({
  total: z.int().describe('The total result count when Semantic Scholar returns it.').nullable().optional(),
  offset: z.int().describe('The returned result offset when Semantic Scholar returns it.').nullable().optional(),
  next: z.int().describe('The next offset when Semantic Scholar returns it.').nullable().optional(),
  token: z.string().describe('The continuation token when Semantic Scholar returns it.').nullable().optional(),
  papers: z.array(z.looseObject({}).describe('The paper object returned by Semantic Scholar.')).describe('The papers returned by Semantic Scholar.').optional(),
  raw: z.looseObject({}).describe('The raw Semantic Scholar response payload.').optional(),
}).describe('A Semantic Scholar paper list response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const semanticScholarActions = {
  get_paper: {
    description: 'Get details for a Semantic Scholar paper by paper ID or external identifier.',
    effect: 'read',
    inputSchema: getPaperInput,
    outputSchema: z.toJSONSchema(getPaperOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_papers: {
    description: 'Get details for multiple Semantic Scholar papers at once.',
    effect: 'read',
    inputSchema: getPapersInput,
    outputSchema: z.toJSONSchema(getPapersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_papers: {
    description: 'Search Semantic Scholar papers by relevance with optional publication filters.',
    effect: 'read',
    inputSchema: searchPapersInput,
    outputSchema: z.toJSONSchema(searchPapersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  bulk_search_papers: {
    description: 'Bulk-search Semantic Scholar papers and page through large result sets with tokens.',
    effect: 'write',
    inputSchema: bulkSearchPapersInput,
    outputSchema: z.toJSONSchema(bulkSearchPapersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  match_paper_title: {
    description: 'Find the best Semantic Scholar paper match for a paper title.',
    effect: 'write',
    inputSchema: matchPaperTitleInput,
    outputSchema: z.toJSONSchema(matchPaperTitleOutput, { io: 'output', unrepresentable: 'any' }),
  },
  autocomplete_papers: {
    description: 'Suggest Semantic Scholar paper query completions.',
    effect: 'write',
    inputSchema: autocompletePapersInput,
    outputSchema: z.toJSONSchema(autocompletePapersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_paper_authors: {
    description: 'List authors for a Semantic Scholar paper.',
    effect: 'read',
    inputSchema: getPaperAuthorsInput,
    outputSchema: z.toJSONSchema(getPaperAuthorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_paper_citations: {
    description: 'List papers that cite a Semantic Scholar paper.',
    effect: 'read',
    inputSchema: getPaperCitationsInput,
    outputSchema: z.toJSONSchema(getPaperCitationsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_paper_references: {
    description: 'List papers referenced by a Semantic Scholar paper.',
    effect: 'read',
    inputSchema: getPaperReferencesInput,
    outputSchema: z.toJSONSchema(getPaperReferencesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_authors: {
    description: 'Search Semantic Scholar authors by name.',
    effect: 'read',
    inputSchema: searchAuthorsInput,
    outputSchema: z.toJSONSchema(searchAuthorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_author: {
    description: 'Get details for a Semantic Scholar author.',
    effect: 'read',
    inputSchema: getAuthorInput,
    outputSchema: z.toJSONSchema(getAuthorOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_authors: {
    description: 'Get details for multiple Semantic Scholar authors at once.',
    effect: 'read',
    inputSchema: getAuthorsInput,
    outputSchema: z.toJSONSchema(getAuthorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_author_papers: {
    description: 'List papers written by a Semantic Scholar author.',
    effect: 'read',
    inputSchema: getAuthorPapersInput,
    outputSchema: z.toJSONSchema(getAuthorPapersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_snippets: {
    description: 'Search text snippets in Semantic Scholar papers.',
    effect: 'read',
    inputSchema: searchSnippetsInput,
    outputSchema: z.toJSONSchema(searchSnippetsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  recommend_for_paper: {
    description: 'Get recommended Semantic Scholar papers for one positive example paper.',
    effect: 'write',
    inputSchema: recommendForPaperInput,
    outputSchema: z.toJSONSchema(recommendForPaperOutput, { io: 'output', unrepresentable: 'any' }),
  },
  recommend_papers: {
    description: 'Get recommended Semantic Scholar papers from positive and optional negative examples.',
    effect: 'write',
    inputSchema: recommendPapersInput,
    outputSchema: z.toJSONSchema(recommendPapersOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
