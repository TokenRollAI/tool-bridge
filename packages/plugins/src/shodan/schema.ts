/**
 * Shodan 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getApiInfoInput = z.strictObject({}).describe('Input parameters for retrieving Shodan API account information.')

export const getApiInfoOutput = z.strictObject({
  plan: z.string().min(1).describe('Subscription plan name returned by Shodan.'),
  https: z.boolean().describe('Whether HTTPS scanning access is enabled for the API key.').optional(),
  monitored_ips: z.int().min(0).describe('Number of monitored IP addresses currently tracked by the account.'),
  query_credits: z.int().min(0).describe('Remaining query credits available to the API key.'),
  scan_credits: z.int().min(0).describe('Remaining scan credits available to the API key.'),
  telnet: z.boolean().describe('Whether telnet access is enabled for the API key.').optional(),
  unlocked: z.boolean().describe('Whether unlocked search filters are enabled for the API key.').optional(),
  unlocked_left: z.int().min(0).describe('Remaining unlocked query credits available to the API key.').optional(),
  usage_limits: z.looseObject({}).describe('Raw JSON object returned by Shodan.').optional(),
}).describe('API account information returned by Shodan.')

export const searchHostsInput = z.strictObject({
  query: z.string().min(1).describe('Search query string passed to the Shodan host search endpoint.'),
  facets: z.string().min(1).describe('Facet aggregation string such as org:5,country:3.').optional(),
  page: z.int().min(1).describe('1-based results page to request from Shodan.').optional(),
  minify: z.boolean().describe('Whether to request minified banner results from Shodan.').optional(),
}).describe('Input parameters for searching hosts in Shodan.')

export const searchHostsOutput = z.strictObject({
  matches: z.array(z.looseObject({}).describe('Raw JSON object returned by Shodan.')).describe('List of raw JSON objects returned by Shodan.'),
  total: z.int().min(0).describe('Total number of matching hosts.'),
  facets: z.looseObject({}).describe('Raw JSON object returned by Shodan.').optional(),
}).describe('Normalized host search results returned by Shodan.')

export const countSearchResultsInput = z.strictObject({
  query: z.string().min(1).describe('Search query string passed to the Shodan host count endpoint.'),
  facets: z.string().min(1).describe('Facet aggregation string such as org:5,country:3.').optional(),
}).describe('Input parameters for counting Shodan host search results.')

export const countSearchResultsOutput = z.strictObject({
  total: z.int().min(0).describe('Total number of matching hosts.'),
  facets: z.looseObject({}).describe('Raw JSON object returned by Shodan.').optional(),
}).describe('Normalized host count results returned by Shodan.')

export const getHostInput = z.strictObject({
  ip: z.string().min(1).describe('IPv4 or IPv6 address to inspect in Shodan.'),
  history: z.boolean().describe('Whether to include historical banners for the host.').optional(),
  minify: z.boolean().describe('Whether to request a minified host payload from Shodan.').optional(),
}).describe('Input parameters for retrieving Shodan host details.')

export const getHostOutput = z.strictObject({
  host: z.looseObject({}).describe('Raw JSON object returned by Shodan.').optional(),
}).describe('Normalized host details returned by Shodan.')

export const getDomainInfoInput = z.strictObject({
  domain: z.string().min(1).describe('Domain name to inspect in the Shodan DNS endpoint.').optional(),
}).describe('Input parameters for retrieving Shodan domain information.')

export const getDomainInfoOutput = z.strictObject({
  domain: z.string().min(1).describe('Domain name returned by Shodan.').optional(),
  tags: z.array(z.string().min(1).describe('One tag returned by Shodan for the requested domain.')).describe('Tags returned by Shodan for the requested domain.').optional(),
  data: z.array(z.looseObject({}).describe('Raw JSON object returned by Shodan.')).describe('List of raw JSON objects returned by Shodan.').optional(),
  subdomains: z.array(z.string().min(1).describe('One subdomain label returned by Shodan.')).describe('Known subdomain labels returned by Shodan.').optional(),
  more: z.boolean().describe('Whether Shodan has additional subdomain data beyond the current payload.').optional(),
}).describe('Normalized domain information returned by Shodan.')

export const resolveHostnamesInput = z.strictObject({
  hostnames: z.array(z.string().min(1).describe('One hostname to resolve in Shodan.')).min(1).describe('Hostnames to resolve with Shodan.').optional(),
}).describe('Input parameters for resolving hostnames with Shodan.')

export const resolveHostnamesOutput = z.strictObject({
  results: z.record(z.string(), z.string().min(1).describe('Resolved IP address returned by Shodan.')).describe('Mapping of hostname to resolved IP address returned by Shodan.').optional(),
}).describe('Normalized hostname resolution results returned by Shodan.')

export const reverseDnsLookupInput = z.strictObject({
  ips: z.array(z.string().min(1).describe('One IP address to reverse-resolve in Shodan.')).min(1).describe('IP addresses to reverse-resolve with Shodan.').optional(),
}).describe('Input parameters for reverse-resolving IP addresses with Shodan.')

export const reverseDnsLookupOutput = z.strictObject({
  results: z.record(z.string(), z.array(z.string().min(1).describe('One hostname returned by Shodan for the IP address.')).describe('Hostnames returned by Shodan for one IP address.')).describe('Mapping of IP address to hostnames returned by Shodan.').optional(),
}).describe('Normalized reverse DNS results returned by Shodan.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const shodanActions = {
  get_api_info: {
    description: 'Get API account information and remaining credits from Shodan.',
    effect: 'read',
    inputSchema: getApiInfoInput,
    outputSchema: z.toJSONSchema(getApiInfoOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_hosts: {
    description: 'Search Shodan hosts with a query string and optional facet aggregation.',
    effect: 'read',
    inputSchema: searchHostsInput,
    outputSchema: z.toJSONSchema(searchHostsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  count_search_results: {
    description: 'Count Shodan hosts matching a query and optionally return facet aggregations.',
    effect: 'read',
    inputSchema: countSearchResultsInput,
    outputSchema: z.toJSONSchema(countSearchResultsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_host: {
    description: 'Get Shodan host details for one IP address.',
    effect: 'read',
    inputSchema: getHostInput,
    outputSchema: z.toJSONSchema(getHostOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_domain_info: {
    description: 'Get DNS domain information and known subdomains from Shodan.',
    effect: 'read',
    inputSchema: getDomainInfoInput,
    outputSchema: z.toJSONSchema(getDomainInfoOutput, { io: 'output', unrepresentable: 'any' }),
  },
  resolve_hostnames: {
    description: 'Resolve hostnames to IP addresses with the Shodan DNS resolve endpoint.',
    effect: 'write',
    inputSchema: resolveHostnamesInput,
    outputSchema: z.toJSONSchema(resolveHostnamesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  reverse_dns_lookup: {
    description: 'Reverse-resolve IP addresses to hostnames with the Shodan DNS reverse endpoint.',
    effect: 'write',
    inputSchema: reverseDnsLookupInput,
    outputSchema: z.toJSONSchema(reverseDnsLookupOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
