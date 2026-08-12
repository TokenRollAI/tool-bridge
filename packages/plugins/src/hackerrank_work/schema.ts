/**
 * HackerRank Work 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listTestsInput = z.strictObject({
  limit: z.int().min(1).describe('The maximum number of records to return.').optional(),
  offset: z.int().min(0).describe('The zero-based offset used for pagination.').optional(),
}).describe('Pagination options for listing HackerRank tests.')

export const listTestsOutput = z.strictObject({
  tests: z.array(z.looseObject({
    id: z.string().min(1).describe('The HackerRank resource identifier.'),
    unique_id: z.string().describe('The public candidate-facing unique identifier for the test.').optional(),
    name: z.string().describe('The display name of the test.').optional(),
    state: z.string().describe('The current state of the test.').optional(),
    duration: z.int().describe('The test duration in minutes.').optional(),
    starttime: z.string().describe('The earliest time when candidates may log in to the test.').optional(),
    endtime: z.string().describe('The latest time when new candidate logins are accepted.').optional(),
    created_at: z.string().describe('When the test was created.').optional(),
    languages: z.array(z.string().min(1)).describe('The languages enabled for the test, when HackerRank returns them.').optional(),
    candidate_details: z.array(z.unknown().describe('A candidate detail configuration object returned by HackerRank.')).describe('The candidate detail fields configured for the test.').optional(),
    tags: z.array(z.string().min(1)).describe('The tags associated with the test.').optional(),
  }).describe('A HackerRank test object.')).describe('The tests returned by HackerRank.'),
  pagination: z.strictObject({
    page_total: z.int().describe('The number of items returned in the current page.').optional(),
    offset: z.int().describe('The zero-based offset for the current page.').optional(),
    previous: z.string().describe('The previous page URL returned by HackerRank.').optional(),
    next: z.string().describe('The next page URL returned by HackerRank.').optional(),
    first: z.string().describe('The first page URL returned by HackerRank.').optional(),
    last: z.string().describe('The last page URL returned by HackerRank.').optional(),
    total: z.string().describe('The total item count returned by HackerRank for the query.').optional(),
  }).describe('Pagination metadata returned by HackerRank list endpoints.'),
}).describe('The list of HackerRank tests plus pagination metadata.')

export const getTestInput = z.strictObject({
  id: z.string().min(1).describe('The HackerRank resource identifier.'),
  additional_fields: z.array(z.string().min(1).describe('An additional HackerRank field name to request in detail.')).min(1).describe('Additional HackerRank fields to request as the additional_fields query parameter.').optional(),
}).describe('The HackerRank test identifier and optional additional_fields list.')

export const getTestOutput = z.strictObject({
  test: z.looseObject({
    id: z.string().min(1).describe('The HackerRank resource identifier.'),
    unique_id: z.string().describe('The public candidate-facing unique identifier for the test.').optional(),
    name: z.string().describe('The display name of the test.').optional(),
    state: z.string().describe('The current state of the test.').optional(),
    duration: z.int().describe('The test duration in minutes.').optional(),
    starttime: z.string().describe('The earliest time when candidates may log in to the test.').optional(),
    endtime: z.string().describe('The latest time when new candidate logins are accepted.').optional(),
    created_at: z.string().describe('When the test was created.').optional(),
    languages: z.array(z.string().min(1)).describe('The languages enabled for the test, when HackerRank returns them.').optional(),
    candidate_details: z.array(z.unknown().describe('A candidate detail configuration object returned by HackerRank.')).describe('The candidate detail fields configured for the test.').optional(),
    tags: z.array(z.string().min(1)).describe('The tags associated with the test.').optional(),
  }).describe('A HackerRank test object.'),
}).describe('The requested HackerRank test.')

export const listTestCandidatesInput = z.strictObject({
  test_id: z.string().min(1).describe('The HackerRank resource identifier.'),
  limit: z.int().min(1).describe('The maximum number of records to return.').optional(),
  offset: z.int().min(0).describe('The zero-based offset used for pagination.').optional(),
}).describe('The HackerRank test identifier and pagination options for listing candidates.')

export const listTestCandidatesOutput = z.strictObject({
  candidates: z.array(z.looseObject({
    id: z.string().min(1).describe('The HackerRank resource identifier.'),
    full_name: z.string().describe('The full name of the candidate.').optional(),
    email: z.string().describe('The email address of the candidate.').optional(),
    score: z.number().describe('The raw score of the candidate, when available.').optional(),
    percentage_score: z.number().describe('The percentage score of the candidate, when available.').optional(),
    status: z.int().describe('The HackerRank candidate status code.').optional(),
    integrity_status: z.string().describe('The integrity status summary for the candidate attempt.').nullable().optional(),
    integrity_summary: z.string().describe('The integrity summary text returned by HackerRank.').nullable().optional(),
    report_url: z.string().describe('The report URL for the candidate.').optional(),
    authenticated_report_url: z.string().describe('The authenticated report URL for the candidate.').optional(),
    pdf_url: z.string().describe('The PDF report URL for the candidate.').optional(),
    candidate_details: z.array(z.unknown().describe('A candidate detail item returned by HackerRank.')).describe('The custom candidate details returned for the candidate.').optional(),
    questions: z.unknown().describe('The expanded questions payload, when requested.').optional(),
    tags: z.array(z.string().min(1).describe('A tag associated with the candidate.')).describe('The tags associated with the candidate.').optional(),
  }).describe('A HackerRank test candidate object.')).describe('The candidates returned by HackerRank.'),
  pagination: z.strictObject({
    page_total: z.int().describe('The number of items returned in the current page.').optional(),
    offset: z.int().describe('The zero-based offset for the current page.').optional(),
    previous: z.string().describe('The previous page URL returned by HackerRank.').optional(),
    next: z.string().describe('The next page URL returned by HackerRank.').optional(),
    first: z.string().describe('The first page URL returned by HackerRank.').optional(),
    last: z.string().describe('The last page URL returned by HackerRank.').optional(),
    total: z.string().describe('The total item count returned by HackerRank for the query.').optional(),
  }).describe('Pagination metadata returned by HackerRank list endpoints.'),
}).describe('The list of HackerRank test candidates plus pagination metadata.')

export const searchTestCandidatesInput = z.strictObject({
  test_id: z.string().min(1).describe('The HackerRank resource identifier.'),
  search: z.string().min(1).describe('The name or email text used to search candidates.'),
  limit: z.int().min(1).describe('The maximum number of records to return.').optional(),
  offset: z.int().min(0).describe('The zero-based offset used for pagination.').optional(),
}).describe('The search input for HackerRank test candidates.')

export const searchTestCandidatesOutput = z.strictObject({
  candidates: z.array(z.looseObject({
    id: z.string().min(1).describe('The HackerRank resource identifier.'),
    full_name: z.string().describe('The full name of the candidate.').optional(),
    email: z.string().describe('The email address of the candidate.').optional(),
    score: z.number().describe('The raw score of the candidate, when available.').optional(),
    percentage_score: z.number().describe('The percentage score of the candidate, when available.').optional(),
    status: z.int().describe('The HackerRank candidate status code.').optional(),
    integrity_status: z.string().describe('The integrity status summary for the candidate attempt.').nullable().optional(),
    integrity_summary: z.string().describe('The integrity summary text returned by HackerRank.').nullable().optional(),
    report_url: z.string().describe('The report URL for the candidate.').optional(),
    authenticated_report_url: z.string().describe('The authenticated report URL for the candidate.').optional(),
    pdf_url: z.string().describe('The PDF report URL for the candidate.').optional(),
    candidate_details: z.array(z.unknown().describe('A candidate detail item returned by HackerRank.')).describe('The custom candidate details returned for the candidate.').optional(),
    questions: z.unknown().describe('The expanded questions payload, when requested.').optional(),
    tags: z.array(z.string().min(1).describe('A tag associated with the candidate.')).describe('The tags associated with the candidate.').optional(),
  }).describe('A HackerRank test candidate object.')).describe('The candidates returned by the search.'),
  pagination: z.strictObject({
    page_total: z.int().describe('The number of items returned in the current page.').optional(),
    offset: z.int().describe('The zero-based offset for the current page.').optional(),
    previous: z.string().describe('The previous page URL returned by HackerRank.').optional(),
    next: z.string().describe('The next page URL returned by HackerRank.').optional(),
    first: z.string().describe('The first page URL returned by HackerRank.').optional(),
    last: z.string().describe('The last page URL returned by HackerRank.').optional(),
    total: z.string().describe('The total item count returned by HackerRank for the query.').optional(),
  }).describe('Pagination metadata returned by HackerRank list endpoints.'),
}).describe('The HackerRank candidate search results plus pagination metadata.')

export const getTestCandidateInput = z.strictObject({
  test_id: z.string().min(1).describe('The HackerRank resource identifier.'),
  candidate_id: z.string().min(1).describe('The HackerRank resource identifier.'),
  additional_fields: z.array(z.string().min(1).describe('An additional HackerRank field name to request in detail.')).min(1).describe('Additional HackerRank fields to request as the additional_fields query parameter.').optional(),
}).describe('The identifiers required to fetch one HackerRank test candidate.')

export const getTestCandidateOutput = z.strictObject({
  candidate: z.looseObject({
    id: z.string().min(1).describe('The HackerRank resource identifier.'),
    full_name: z.string().describe('The full name of the candidate.').optional(),
    email: z.string().describe('The email address of the candidate.').optional(),
    score: z.number().describe('The raw score of the candidate, when available.').optional(),
    percentage_score: z.number().describe('The percentage score of the candidate, when available.').optional(),
    status: z.int().describe('The HackerRank candidate status code.').optional(),
    integrity_status: z.string().describe('The integrity status summary for the candidate attempt.').nullable().optional(),
    integrity_summary: z.string().describe('The integrity summary text returned by HackerRank.').nullable().optional(),
    report_url: z.string().describe('The report URL for the candidate.').optional(),
    authenticated_report_url: z.string().describe('The authenticated report URL for the candidate.').optional(),
    pdf_url: z.string().describe('The PDF report URL for the candidate.').optional(),
    candidate_details: z.array(z.unknown().describe('A candidate detail item returned by HackerRank.')).describe('The custom candidate details returned for the candidate.').optional(),
    questions: z.unknown().describe('The expanded questions payload, when requested.').optional(),
    tags: z.array(z.string().min(1).describe('A tag associated with the candidate.')).describe('The tags associated with the candidate.').optional(),
  }).describe('A HackerRank test candidate object.'),
}).describe('The requested HackerRank test candidate.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const hackerrankWorkActions = {
  list_tests: {
    description: 'List the HackerRank tests available to the authenticated account.',
    effect: 'read',
    inputSchema: listTestsInput,
    outputSchema: z.toJSONSchema(listTestsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_test: {
    description: 'Retrieve one HackerRank test by id.',
    effect: 'read',
    inputSchema: getTestInput,
    outputSchema: z.toJSONSchema(getTestOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_test_candidates: {
    description: 'List the candidates invited to or associated with a HackerRank test.',
    effect: 'read',
    inputSchema: listTestCandidatesInput,
    outputSchema: z.toJSONSchema(listTestCandidatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_test_candidates: {
    description: 'Search HackerRank test candidates by name or email.',
    effect: 'read',
    inputSchema: searchTestCandidatesInput,
    outputSchema: z.toJSONSchema(searchTestCandidatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_test_candidate: {
    description: 'Retrieve one HackerRank candidate from a specific test.',
    effect: 'read',
    inputSchema: getTestCandidateInput,
    outputSchema: z.toJSONSchema(getTestCandidateOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
