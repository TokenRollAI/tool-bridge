/**
 * Store Leads 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getDomainInput = z.strictObject({
  domain: z.string().min(1).regex(new RegExp('\\S')).describe('The public DNS domain or platform domain to retrieve.'),
  follow_redirects: z.boolean().describe('Whether Store Leads should automatically follow domain redirects.').optional(),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Store Leads response fields to include.').optional(),
}).describe('Input for retrieving one Store Leads domain.')

export const getDomainOutput = z.strictObject({
  domain: z.looseObject({
    name: z.string().describe('The public DNS domain name.').optional(),
    platform: z.string().describe('The ecommerce platform detected for the domain.').optional(),
    state: z.string().describe('The current Store Leads state for the domain.').optional(),
    merchant_name: z.string().describe('The merchant name when Store Leads has one.').optional(),
  }).describe('A Store Leads domain object.'),
}).describe('Store Leads domain response.')

export const listDomainsInput = z.strictObject({
  cursor: z.string().min(1).regex(new RegExp('\\S')).describe('The Store Leads cursor used to retrieve the next page.').optional(),
  aq: z.string().min(1).regex(new RegExp('\\S')).describe('An advanced Store Leads domain search expression.').optional(),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Store Leads response fields to include.').optional(),
  page_size: z.int().min(1).max(50).describe('The number of records to return in one page. Store Leads caps this at 50.').optional(),
}).describe('Input for listing Store Leads domains.')

export const listDomainsOutput = z.strictObject({
  domains: z.array(z.looseObject({
    name: z.string().describe('The public DNS domain name.').optional(),
    platform: z.string().describe('The ecommerce platform detected for the domain.').optional(),
    state: z.string().describe('The current Store Leads state for the domain.').optional(),
    merchant_name: z.string().describe('The merchant name when Store Leads has one.').optional(),
  }).describe('A Store Leads domain object.')).describe('Domains returned by Store Leads.'),
  next_cursor: z.string().describe('The cursor for the next result page.').nullable(),
}).describe('Store Leads domains list response.')

export const getAppInput = z.strictObject({
  app_id: z.string().min(1).regex(new RegExp('\\S')).describe('The Store Leads app identifier, such as "shopify.marsello".'),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Store Leads response fields to include.').optional(),
}).describe('Input for retrieving one Store Leads app.')

export const getAppOutput = z.strictObject({
  app: z.looseObject({
    id: z.string().describe('The Store Leads app identifier.').optional(),
    token: z.string().describe('The platform-specific app token.').optional(),
    platform: z.string().describe('The ecommerce platform for the app.').optional(),
    name: z.string().describe('The app name.').optional(),
    installs: z.int().describe('The number of active stores that have the app installed.').optional(),
  }).describe('A Store Leads app object.'),
}).describe('Store Leads app response.')

export const listAppsInput = z.strictObject({
  page: z.int().min(0).describe('The zero-based page of results to return.').optional(),
  page_size: z.int().min(1).max(50).describe('The number of records to return in one page. Store Leads caps this at 50.').optional(),
  sort: z.string().min(1).regex(new RegExp('\\S')).describe('A Store Leads sort expression.').optional(),
  q: z.string().min(1).regex(new RegExp('\\S')).describe('A text query used to filter apps by name or description.').optional(),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Store Leads response fields to include.').optional(),
  platform: z.enum(['custom', 'shopify', 'wix', 'woocommerce']).describe('The ecommerce platform used to filter apps.').optional(),
  categories: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of app categories.').optional(),
}).describe('Input for listing Store Leads apps.')

export const listAppsOutput = z.strictObject({
  apps: z.array(z.looseObject({
    id: z.string().describe('The Store Leads app identifier.').optional(),
    token: z.string().describe('The platform-specific app token.').optional(),
    platform: z.string().describe('The ecommerce platform for the app.').optional(),
    name: z.string().describe('The app name.').optional(),
    installs: z.int().describe('The number of active stores that have the app installed.').optional(),
  }).describe('A Store Leads app object.')).describe('Apps returned by Store Leads.'),
}).describe('Store Leads apps list response.')

export const getTechnologyInput = z.strictObject({
  technology: z.string().min(1).regex(new RegExp('\\S')).describe('The Store Leads technology name to retrieve.'),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Store Leads response fields to include.').optional(),
}).describe('Input for retrieving one Store Leads technology.')

export const getTechnologyOutput = z.strictObject({
  technology: z.looseObject({
    name: z.string().describe('The technology name.').optional(),
    description: z.string().describe('The technology description.').optional(),
    vendor_url: z.string().describe('The technology vendor URL.').optional(),
    icon_url: z.string().describe('The technology icon URL.').optional(),
    installs: z.int().describe('The number of domains where Store Leads detected the technology.').optional(),
  }).describe('A Store Leads technology object.'),
}).describe('Store Leads technology response.')

export const listTechnologiesInput = z.strictObject({
  page: z.int().min(0).describe('The zero-based page of results to return.').optional(),
  page_size: z.int().min(1).max(50).describe('The number of records to return in one page. Store Leads caps this at 50.').optional(),
  sort: z.string().min(1).regex(new RegExp('\\S')).describe('A Store Leads sort expression.').optional(),
  q: z.string().min(1).regex(new RegExp('\\S')).describe('A text query used to filter technologies.').optional(),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('A comma-separated list of Store Leads response fields to include.').optional(),
}).describe('Input for listing Store Leads technologies.')

export const listTechnologiesOutput = z.strictObject({
  technologies: z.array(z.looseObject({
    name: z.string().describe('The technology name.').optional(),
    description: z.string().describe('The technology description.').optional(),
    vendor_url: z.string().describe('The technology vendor URL.').optional(),
    icon_url: z.string().describe('The technology icon URL.').optional(),
    installs: z.int().describe('The number of domains where Store Leads detected the technology.').optional(),
  }).describe('A Store Leads technology object.')).describe('Technologies returned by Store Leads.'),
}).describe('Store Leads technologies list response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const storeLeadsActions = {
  get_domain: {
    description: 'Retrieve Store Leads details for one ecommerce domain name.',
    effect: 'read',
    inputSchema: getDomainInput,
    outputSchema: z.toJSONSchema(getDomainOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_domains: {
    description: 'List Store Leads domains with optional advanced search and cursor pagination.',
    effect: 'read',
    inputSchema: listDomainsInput,
    outputSchema: z.toJSONSchema(listDomainsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_app: {
    description: 'Retrieve Store Leads details for one ecommerce app.',
    effect: 'read',
    inputSchema: getAppInput,
    outputSchema: z.toJSONSchema(getAppOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_apps: {
    description: 'List Store Leads ecommerce apps with optional filters and page pagination.',
    effect: 'read',
    inputSchema: listAppsInput,
    outputSchema: z.toJSONSchema(listAppsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_technology: {
    description: 'Retrieve Store Leads details for one detected technology.',
    effect: 'read',
    inputSchema: getTechnologyInput,
    outputSchema: z.toJSONSchema(getTechnologyOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_technologies: {
    description: 'List Store Leads technologies with optional search and page pagination.',
    effect: 'read',
    inputSchema: listTechnologiesInput,
    outputSchema: z.toJSONSchema(listTechnologiesOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
