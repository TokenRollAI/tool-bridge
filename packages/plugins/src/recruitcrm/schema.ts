/**
 * Recruit CRM 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listCandidatesInput = z.strictObject({
  page: z.int().min(1).describe('One-based page number to request from Recruit CRM.').optional(),
  limit: z.int().min(1).describe('Maximum number of records to return from Recruit CRM.').optional(),
}).describe('Query parameters for listing Recruit CRM records.')

export const listCandidatesOutput = z.strictObject({
  candidates: z.array(z.looseObject({}).describe('A Recruit CRM candidate object.')).describe('Candidate records returned by Recruit CRM.').optional(),
  pagination: z.unknown().describe('Pagination metadata returned by Recruit CRM, or null.').optional(),
  raw: z.unknown().describe('The raw Recruit CRM API response.').optional(),
}).describe('A Recruit CRM candidate list response.')

export const getCandidateInput = z.strictObject({
  candidate: z.string().min(1).describe('The Recruit CRM candidate slug or path identifier to retrieve.').optional(),
}).describe('Path parameters for fetching a Recruit CRM candidate.')

export const getCandidateOutput = z.strictObject({
  candidate: z.looseObject({}).describe('A Recruit CRM candidate object.').optional(),
  raw: z.unknown().describe('The raw Recruit CRM API response.').optional(),
}).describe('A Recruit CRM candidate detail response.')

export const listContactsInput = z.strictObject({
  page: z.int().min(1).describe('One-based page number to request from Recruit CRM.').optional(),
  limit: z.int().min(1).describe('Maximum number of records to return from Recruit CRM.').optional(),
}).describe('Query parameters for listing Recruit CRM records.')

export const listContactsOutput = z.strictObject({
  contacts: z.array(z.looseObject({}).describe('A Recruit CRM contact object.')).describe('Contact records returned by Recruit CRM.').optional(),
  pagination: z.unknown().describe('Pagination metadata returned by Recruit CRM, or null.').optional(),
  raw: z.unknown().describe('The raw Recruit CRM API response.').optional(),
}).describe('A Recruit CRM contact list response.')

export const getContactInput = z.strictObject({
  contact: z.string().min(1).describe('The Recruit CRM contact slug or path identifier to retrieve.').optional(),
}).describe('Path parameters for fetching a Recruit CRM contact.')

export const getContactOutput = z.strictObject({
  contact: z.looseObject({}).describe('A Recruit CRM contact object.').optional(),
  raw: z.unknown().describe('The raw Recruit CRM API response.').optional(),
}).describe('A Recruit CRM contact detail response.')

export const listCompaniesInput = z.strictObject({
  page: z.int().min(1).describe('One-based page number to request from Recruit CRM.').optional(),
  limit: z.int().min(1).describe('Maximum number of records to return from Recruit CRM.').optional(),
}).describe('Query parameters for listing Recruit CRM records.')

export const listCompaniesOutput = z.strictObject({
  companies: z.array(z.looseObject({}).describe('A Recruit CRM company object.')).describe('Company records returned by Recruit CRM.').optional(),
  pagination: z.unknown().describe('Pagination metadata returned by Recruit CRM, or null.').optional(),
  raw: z.unknown().describe('The raw Recruit CRM API response.').optional(),
}).describe('A Recruit CRM company list response.')

export const getCompanyInput = z.strictObject({
  company: z.string().min(1).describe('The Recruit CRM company slug or path identifier to retrieve.').optional(),
}).describe('Path parameters for fetching a Recruit CRM company.')

export const getCompanyOutput = z.strictObject({
  company: z.looseObject({}).describe('A Recruit CRM company object.').optional(),
  raw: z.unknown().describe('The raw Recruit CRM API response.').optional(),
}).describe('A Recruit CRM company detail response.')

export const listJobsInput = z.strictObject({
  page: z.int().min(1).describe('One-based page number to request from Recruit CRM.').optional(),
  limit: z.int().min(1).describe('Maximum number of records to return from Recruit CRM.').optional(),
}).describe('Query parameters for listing Recruit CRM records.')

export const listJobsOutput = z.strictObject({
  jobs: z.array(z.looseObject({}).describe('A Recruit CRM job object.')).describe('Job records returned by Recruit CRM.').optional(),
  pagination: z.unknown().describe('Pagination metadata returned by Recruit CRM, or null.').optional(),
  raw: z.unknown().describe('The raw Recruit CRM API response.').optional(),
}).describe('A Recruit CRM job list response.')

export const getJobInput = z.strictObject({
  job: z.string().min(1).describe('The Recruit CRM job slug or path identifier to retrieve.').optional(),
}).describe('Path parameters for fetching a Recruit CRM job.')

export const getJobOutput = z.strictObject({
  job: z.looseObject({}).describe('A Recruit CRM job object.').optional(),
  raw: z.unknown().describe('The raw Recruit CRM API response.').optional(),
}).describe('A Recruit CRM job detail response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const recruitcrmActions = {
  list_candidates: {
    description: 'List candidates from Recruit CRM using the official Recruit CRM API with optional pagination.',
    effect: 'read',
    inputSchema: listCandidatesInput,
    outputSchema: z.toJSONSchema(listCandidatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_candidate: {
    description: 'Fetch one Recruit CRM candidate by slug or path identifier.',
    effect: 'read',
    inputSchema: getCandidateInput,
    outputSchema: z.toJSONSchema(getCandidateOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_contacts: {
    description: 'List contacts from Recruit CRM using the official Recruit CRM API with optional pagination.',
    effect: 'read',
    inputSchema: listContactsInput,
    outputSchema: z.toJSONSchema(listContactsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_contact: {
    description: 'Fetch one Recruit CRM contact by slug or path identifier.',
    effect: 'read',
    inputSchema: getContactInput,
    outputSchema: z.toJSONSchema(getContactOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_companies: {
    description: 'List companies from Recruit CRM using the official Recruit CRM API with optional pagination.',
    effect: 'read',
    inputSchema: listCompaniesInput,
    outputSchema: z.toJSONSchema(listCompaniesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_company: {
    description: 'Fetch one Recruit CRM company by slug or path identifier.',
    effect: 'read',
    inputSchema: getCompanyInput,
    outputSchema: z.toJSONSchema(getCompanyOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_jobs: {
    description: 'List jobs from Recruit CRM using the official Recruit CRM API with optional pagination.',
    effect: 'read',
    inputSchema: listJobsInput,
    outputSchema: z.toJSONSchema(listJobsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_job: {
    description: 'Fetch one Recruit CRM job by slug or path identifier.',
    effect: 'read',
    inputSchema: getJobInput,
    outputSchema: z.toJSONSchema(getJobOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
