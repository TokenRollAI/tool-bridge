/**
 * Crustdata 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const identifyCompaniesInput = z.strictObject({
  domains: z.array(z.string().min(1).describe('One company domain.')).min(1).describe('The company domains to resolve or enrich.').optional(),
  professionalNetworkProfileUrls: z.array(z.string().min(1).describe('One company profile URL.')).min(1).describe('The company profile URLs to resolve or enrich.').optional(),
  names: z.array(z.string().min(1).describe('One company name.')).min(1).describe('The company names to resolve or enrich.').optional(),
  crustdataCompanyIds: z.array(z.int().describe('One Crustdata company ID.')).min(1).describe('The Crustdata company IDs to enrich.').optional(),
  fields: z.array(z.string().min(1).describe('One field or section name accepted by the Crustdata API.')).min(1).describe('The response fields or sections to request from Crustdata.').optional(),
  exactMatch: z.boolean().describe('Whether Crustdata should enforce strict domain matching.').optional(),
}).describe('Input parameters for identifying or enriching companies with Crustdata. Provide exactly one identifier array.')

export const identifyCompaniesOutput = z.strictObject({
  results: z.array(z.strictObject({
    matchedOn: z.string().describe('The identifier Crustdata matched on.'),
    matchType: z.string().describe('The identifier type Crustdata reports for this result.'),
    matches: z.array(z.strictObject({
      confidenceScore: z.number().describe('The Crustdata confidence score for this match.'),
      companyData: z.looseObject({
        crustdata_company_id: z.int().describe('The Crustdata company ID when present.').optional(),
        basic_info: z.looseObject({
          name: z.string().describe('The company name returned by Crustdata.').optional(),
          primary_domain: z.string().describe('The primary domain returned by Crustdata.').optional(),
        }).describe('The `basic_info` section returned by Crustdata.').optional(),
        metadata: z.record(z.string(), z.union([z.string().describe('A string response value.'), z.int().describe('An integer response value.'), z.number().describe('A numeric response value.'), z.boolean().describe('A boolean response value.'), z.strictObject({}).describe('An empty object response value.')]).describe('One primitive Crustdata response value.')).describe('Additional metadata returned by Crustdata.').optional(),
      }).describe('The upstream Crustdata company payload.'),
    }).describe('One Crustdata company match.')).describe('The ranked company matches returned by Crustdata.'),
  }).describe('One normalized Crustdata identify or enrich result.')).describe('The normalized identify results for each submitted identifier.'),
}).describe('The normalized Crustdata identify response.')

export const enrichCompaniesInput = z.strictObject({
  domains: z.array(z.string().min(1).describe('One company domain.')).min(1).describe('The company domains to resolve or enrich.').optional(),
  professionalNetworkProfileUrls: z.array(z.string().min(1).describe('One company profile URL.')).min(1).describe('The company profile URLs to resolve or enrich.').optional(),
  names: z.array(z.string().min(1).describe('One company name.')).min(1).describe('The company names to resolve or enrich.').optional(),
  crustdataCompanyIds: z.array(z.int().describe('One Crustdata company ID.')).min(1).describe('The Crustdata company IDs to enrich.').optional(),
  fields: z.array(z.string().min(1).describe('One field or section name accepted by the Crustdata API.')).min(1).describe('The response fields or sections to request from Crustdata.').optional(),
  exactMatch: z.boolean().describe('Whether Crustdata should enforce strict domain matching.').optional(),
}).describe('Input parameters for identifying or enriching companies with Crustdata. Provide exactly one identifier array.')

export const enrichCompaniesOutput = z.strictObject({
  results: z.array(z.strictObject({
    matchedOn: z.string().describe('The identifier Crustdata matched on.'),
    matchType: z.string().describe('The identifier type Crustdata reports for this result.'),
    matches: z.array(z.strictObject({
      confidenceScore: z.number().describe('The Crustdata confidence score for this match.'),
      companyData: z.looseObject({
        crustdata_company_id: z.int().describe('The Crustdata company ID when present.').optional(),
        basic_info: z.looseObject({
          name: z.string().describe('The company name returned by Crustdata.').optional(),
          primary_domain: z.string().describe('The primary domain returned by Crustdata.').optional(),
        }).describe('The `basic_info` section returned by Crustdata.').optional(),
        metadata: z.record(z.string(), z.union([z.string().describe('A string response value.'), z.int().describe('An integer response value.'), z.number().describe('A numeric response value.'), z.boolean().describe('A boolean response value.'), z.strictObject({}).describe('An empty object response value.')]).describe('One primitive Crustdata response value.')).describe('Additional metadata returned by Crustdata.').optional(),
      }).describe('The upstream Crustdata company payload.'),
    }).describe('One Crustdata company match.')).describe('The ranked company matches returned by Crustdata.'),
  }).describe('One normalized Crustdata identify or enrich result.')).describe('The normalized enrich results for each submitted identifier.'),
}).describe('The normalized Crustdata enrich response.')

export const searchCompaniesInput = z.strictObject({
  filters: z.looseObject({
    field: z.string().min(1).describe('The searchable field name to filter on.').optional(),
    operator: z.enum(['=', '!=', '>', '<', '=>', '=<', 'in', 'not_in', 'is_null', 'is_not_null', '(.)', '[.]']).describe('The official Crustdata filter operator. Use `=>` and `=<` instead of `>=` and `<=`.').optional(),
    value: z.union([z.string().min(1).describe('A string filter value.'), z.int().describe('An integer filter value.'), z.number().describe('A numeric filter value.'), z.boolean().describe('A boolean filter value.'), z.array(z.union([z.string().min(1).describe('A string array item.'), z.int().describe('An integer array item.'), z.number().describe('A numeric array item.'), z.boolean().describe('A boolean array item.')]).describe('One array item for a Crustdata filter value.')).min(1).describe('An array filter value accepted by the Crustdata API.')]).describe('One supported Crustdata filter value.').optional(),
    and: z.array(z.looseObject({}).describe('One nested filter condition or group.')).min(1).describe('A list of nested filter conditions or groups combined with logical AND.').optional(),
    or: z.array(z.looseObject({}).describe('One nested filter condition or group.')).min(1).describe('A list of nested filter conditions or groups combined with logical OR.').optional(),
  }).describe('A Crustdata filter condition or nested group using `and` or `or` arrays.').optional(),
  fields: z.array(z.string().min(1).describe('One field or section name accepted by the Crustdata API.')).min(1).describe('The response fields or sections to request from Crustdata.').optional(),
  sorts: z.array(z.strictObject({
    column: z.string().min(1).describe('The sortable field name to order by.'),
    order: z.enum(['asc', 'desc']).describe('The sort order for one Crustdata sort rule.'),
  }).describe('One Crustdata sort rule.')).min(1).describe('The ordered sort rules for a company search request.').optional(),
  limit: z.int().min(1).max(1000).describe('The number of companies to return per page.').optional(),
  cursor: z.string().min(1).describe('The pagination cursor returned by a previous search response.').optional(),
}).describe('Input parameters for searching companies with Crustdata.')

export const searchCompaniesOutput = z.strictObject({
  companies: z.array(z.looseObject({
    crustdata_company_id: z.int().describe('The Crustdata company ID when present.').optional(),
    basic_info: z.looseObject({
      name: z.string().describe('The company name returned by Crustdata.').optional(),
      primary_domain: z.string().describe('The primary domain returned by Crustdata.').optional(),
    }).describe('The `basic_info` section returned by Crustdata.').optional(),
    metadata: z.record(z.string(), z.union([z.string().describe('A string response value.'), z.int().describe('An integer response value.'), z.number().describe('A numeric response value.'), z.boolean().describe('A boolean response value.'), z.strictObject({}).describe('An empty object response value.')]).describe('One primitive Crustdata response value.')).describe('Additional metadata returned by Crustdata.').optional(),
  }).describe('The upstream Crustdata company payload.')).describe('The company search results returned by Crustdata.'),
  nextCursor: z.string().describe('The cursor for the next company search page, or null when no further page exists.').nullable(),
  totalCount: z.int().describe('The total number of matching companies when Crustdata returns it.').nullable(),
}).describe('The normalized Crustdata company search response.')

export const autocompleteCompaniesInput = z.strictObject({
  field: z.string().min(1).describe('The searchable field to autocomplete.'),
  query: z.string().describe('The partial text to match. Use an empty string for common values.'),
  limit: z.int().min(1).max(100).describe('The maximum number of suggestions to return.').optional(),
  filters: z.looseObject({
    field: z.string().min(1).describe('The searchable field name to filter on.').optional(),
    operator: z.enum(['=', '!=', '>', '<', '=>', '=<', 'in', 'not_in', 'is_null', 'is_not_null', '(.)', '[.]']).describe('The official Crustdata filter operator. Use `=>` and `=<` instead of `>=` and `<=`.').optional(),
    value: z.union([z.string().min(1).describe('A string filter value.'), z.int().describe('An integer filter value.'), z.number().describe('A numeric filter value.'), z.boolean().describe('A boolean filter value.'), z.array(z.union([z.string().min(1).describe('A string array item.'), z.int().describe('An integer array item.'), z.number().describe('A numeric array item.'), z.boolean().describe('A boolean array item.')]).describe('One array item for a Crustdata filter value.')).min(1).describe('An array filter value accepted by the Crustdata API.')]).describe('One supported Crustdata filter value.').optional(),
    and: z.array(z.looseObject({}).describe('One nested filter condition or group.')).min(1).describe('A list of nested filter conditions or groups combined with logical AND.').optional(),
    or: z.array(z.looseObject({}).describe('One nested filter condition or group.')).min(1).describe('A list of nested filter conditions or groups combined with logical OR.').optional(),
  }).describe('A Crustdata filter condition or nested group using `and` or `or` arrays.').optional(),
}).describe('Input parameters for requesting Crustdata company autocomplete suggestions.')

export const autocompleteCompaniesOutput = z.strictObject({
  suggestions: z.array(z.strictObject({
    value: z.string().describe('The exact field value to reuse in a later search filter.'),
  }).describe('One autocomplete suggestion.')).describe('The ordered autocomplete suggestions returned by Crustdata.'),
}).describe('The normalized Crustdata company autocomplete response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const crustdataActions = {
  identify_companies: {
    description: 'Resolve companies from domains, profile URLs, names, or Crustdata company IDs and return ranked matches.',
    effect: 'read',
    inputSchema: identifyCompaniesInput,
    outputSchema: z.toJSONSchema(identifyCompaniesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  enrich_companies: {
    description: 'Enrich companies from one identifier family and optional field sections, returning ranked company matches with detailed profiles.',
    effect: 'write',
    inputSchema: enrichCompaniesInput,
    outputSchema: z.toJSONSchema(enrichCompaniesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_companies: {
    description: 'Search companies with Crustdata filters, optional field selection, sorting, and cursor pagination.',
    effect: 'read',
    inputSchema: searchCompaniesInput,
    outputSchema: z.toJSONSchema(searchCompaniesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  autocomplete_companies: {
    description: 'Return exact field values to reuse in Crustdata company search filters.',
    effect: 'write',
    inputSchema: autocompleteCompaniesInput,
    outputSchema: z.toJSONSchema(autocompleteCompaniesOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
