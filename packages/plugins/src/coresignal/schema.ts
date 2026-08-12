/**
 * Coresignal 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const searchBaseCompaniesInput = z.strictObject({
  name: z.string().min(1).describe('Company name or name expression to search for using Coresignal search filters.').optional(),
  website: z.string().min(1).describe('Company website value to search for, such as example.com or https://www.example.com.').optional(),
  exact_website: z.string().min(1).describe('Exact company website value to search for.').optional(),
  size: z.string().min(1).describe('Company size category based on headcount.').optional(),
  industry: z.string().min(1).describe('Industry value or expression to search for.').optional(),
  country: z.string().min(1).describe('Country value or expression to search for.').optional(),
  location: z.string().min(1).describe('Location value or expression to search for.').optional(),
  created_at_gte: z.string().min(1).describe('Record creation timestamp lower bound using the Coresignal format.').optional(),
  created_at_lte: z.string().min(1).describe('Record creation timestamp upper bound using the Coresignal format.').optional(),
  last_updated_gte: z.string().min(1).describe('Record last-updated timestamp lower bound using the Coresignal format.').optional(),
  last_updated_lte: z.string().min(1).describe('Record last-updated timestamp upper bound using the Coresignal format.').optional(),
  deleted: z.boolean().describe('Whether to include deleted or private company records.').optional(),
  employees_count_gte: z.int().min(0).describe('Minimum visible employee count.').optional(),
  employees_count_lte: z.int().min(0).describe('Maximum visible employee count.').optional(),
  source_id: z.int().min(0).describe('Company identifier assigned by the source.').optional(),
  founded_year_gte: z.int().min(0).describe('Minimum company founding year.').optional(),
  founded_year_lte: z.int().min(0).describe('Maximum company founding year.').optional(),
  funding_total_rounds_count_gte: z.int().min(0).describe('Minimum total funding round count.').optional(),
  funding_total_rounds_count_lte: z.int().min(0).describe('Maximum total funding round count.').optional(),
  funding_last_round_type: z.string().min(1).describe('Last funding round type.').optional(),
  funding_last_round_date_gte: z.string().min(1).describe('Last funding round date lower bound using the yyyy-mm-dd format.').optional(),
  funding_last_round_date_lte: z.string().min(1).describe('Last funding round date upper bound using the yyyy-mm-dd format.').optional(),
}).describe('Coresignal Base Company search filter request.')

export const searchBaseCompaniesOutput = z.strictObject({
  ids: z.array(z.int().min(1).describe('Company ID.')).describe('Company IDs matching the search filters.'),
}).describe('Coresignal Base Company search ID result.')

export const previewBaseCompaniesInput = z.strictObject({
  name: z.string().min(1).describe('Company name or name expression to search for using Coresignal search filters.').optional(),
  website: z.string().min(1).describe('Company website value to search for, such as example.com or https://www.example.com.').optional(),
  exact_website: z.string().min(1).describe('Exact company website value to search for.').optional(),
  size: z.string().min(1).describe('Company size category based on headcount.').optional(),
  industry: z.string().min(1).describe('Industry value or expression to search for.').optional(),
  country: z.string().min(1).describe('Country value or expression to search for.').optional(),
  location: z.string().min(1).describe('Location value or expression to search for.').optional(),
  created_at_gte: z.string().min(1).describe('Record creation timestamp lower bound using the Coresignal format.').optional(),
  created_at_lte: z.string().min(1).describe('Record creation timestamp upper bound using the Coresignal format.').optional(),
  last_updated_gte: z.string().min(1).describe('Record last-updated timestamp lower bound using the Coresignal format.').optional(),
  last_updated_lte: z.string().min(1).describe('Record last-updated timestamp upper bound using the Coresignal format.').optional(),
  deleted: z.boolean().describe('Whether to include deleted or private company records.').optional(),
  employees_count_gte: z.int().min(0).describe('Minimum visible employee count.').optional(),
  employees_count_lte: z.int().min(0).describe('Maximum visible employee count.').optional(),
  source_id: z.int().min(0).describe('Company identifier assigned by the source.').optional(),
  founded_year_gte: z.int().min(0).describe('Minimum company founding year.').optional(),
  founded_year_lte: z.int().min(0).describe('Maximum company founding year.').optional(),
  funding_total_rounds_count_gte: z.int().min(0).describe('Minimum total funding round count.').optional(),
  funding_total_rounds_count_lte: z.int().min(0).describe('Maximum total funding round count.').optional(),
  funding_last_round_type: z.string().min(1).describe('Last funding round type.').optional(),
  funding_last_round_date_gte: z.string().min(1).describe('Last funding round date lower bound using the yyyy-mm-dd format.').optional(),
  funding_last_round_date_lte: z.string().min(1).describe('Last funding round date upper bound using the yyyy-mm-dd format.').optional(),
  page: z.int().min(1).describe('Preview result page number.').optional(),
}).describe('Coresignal Base Company search preview request.')

export const previewBaseCompaniesOutput = z.strictObject({
  records: z.array(z.looseObject({
    id: z.int().min(1).describe('Coresignal company ID.').optional(),
    name: z.string().describe('Company name.').optional(),
    canonical_url: z.string().describe('Most recent company profile URL.').optional(),
    website: z.string().describe('Company website.').optional(),
    size: z.string().describe('Company size category.').optional(),
    industry: z.string().describe('Company industry.').optional(),
    headquarters_country_parsed: z.string().describe('Parsed headquarters country.').optional(),
    _score: z.number().describe('Search relevance score.').optional(),
  }).describe('A Base Company preview record.')).describe('Preview records matching the search filters.'),
}).describe('Coresignal Base Company preview result.')

export const collectBaseCompanyInput = z.strictObject({
  companyIdentifier: z.union([z.int().min(1).describe('Coresignal company ID returned by search endpoints.'), z.string().min(1).describe('Coresignal profile URL or shorthand name.')]).describe('Company ID, profile URL, or shorthand name to collect.'),
  fields: z.array(z.string().min(1).describe('A Base Company field name to request.')).min(1).describe('Optional list of fields to return from the Base Company record.').optional(),
}).describe('Request parameters for collecting a Base Company record.')

export const collectBaseCompanyOutput = z.strictObject({
  company: z.looseObject({}).describe('The raw Base Company record returned by Coresignal.'),
}).describe('Coresignal Base Company collect result.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const coresignalActions = {
  search_base_companies: {
    description: 'Search Coresignal Base Company records with documented search filters and return matching company IDs for follow-up collection.',
    effect: 'read',
    inputSchema: searchBaseCompaniesInput,
    outputSchema: z.toJSONSchema(searchBaseCompaniesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  preview_base_companies: {
    description: 'Preview top Coresignal Base Company matches with compact company profile fields using documented search filters.',
    effect: 'write',
    inputSchema: previewBaseCompaniesInput,
    outputSchema: z.toJSONSchema(previewBaseCompaniesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  collect_base_company: {
    description: 'Collect a Coresignal Base Company record by company ID, profile URL, or shorthand name, optionally selecting specific fields.',
    effect: 'write',
    inputSchema: collectBaseCompanyInput,
    outputSchema: z.toJSONSchema(collectBaseCompanyOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
