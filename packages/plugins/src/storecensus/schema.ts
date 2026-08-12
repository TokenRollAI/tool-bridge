/**
 * StoreCensus 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getWebsiteInput = z.strictObject({
  domain: z.string().min(1).regex(new RegExp('\\S')).describe('The domain name or numeric StoreCensus lead ID to retrieve, such as example-store.com or 12345.'),
  sections: z.array(z.enum(['basic_info', 'contact_info', 'location_info', 'social_media', 'ecommerce_info', 'financial_info', 'traffic_analytics', 'technical_info', 'apps_integrations', 'activity_signals', 'crm', 'data_metadata']).describe('A StoreCensus response section to include.')).describe('StoreCensus response sections to include. Omit this field to request all sections.').optional(),
}).describe('The input payload for retrieving one StoreCensus website.')

export const getWebsiteOutput = z.strictObject({
  website: z.looseObject({
    basic_info: z.looseObject({}).describe('Basic website and company information.').optional(),
    contact_info: z.looseObject({}).describe('Store contact information.').optional(),
    location_info: z.looseObject({}).describe('Store location information.').optional(),
    social_media: z.looseObject({}).describe('Store social media profile information.').optional(),
    ecommerce_info: z.looseObject({}).describe('Ecommerce platform and catalog information.').optional(),
    financial_info: z.looseObject({}).describe('Estimated revenue and technology spend information.').optional(),
    traffic_analytics: z.looseObject({}).describe('Estimated traffic and audience analytics.').optional(),
    technical_info: z.looseObject({}).describe('Detected technology information.').optional(),
    apps_integrations: z.looseObject({}).describe('Detected Shopify app integration information.').optional(),
    activity_signals: z.looseObject({}).describe('Recent activity and growth signals.').optional(),
    crm: z.looseObject({}).describe('StoreCensus CRM fields for the store.').optional(),
    data_metadata: z.looseObject({}).describe('StoreCensus data metadata for the store.').optional(),
  }).describe('A StoreCensus ecommerce store record.').optional(),
}).describe('The response returned when retrieving one StoreCensus website.')

export const searchStoresInput = z.strictObject({
  filters: z.looseObject({}).describe('StoreCensus store filters, such as country, vertical, apps, estimatedVisits, or CRM filters.').optional(),
  sort: z.strictObject({
    column: z.string().min(1).regex(new RegExp('\\S')).describe('The StoreCensus column to sort by.'),
    direction: z.enum(['asc', 'desc']).describe('The sort direction.').optional(),
  }).describe('The StoreCensus sort configuration.').optional(),
  pageSize: z.int().min(1).max(500).describe('The number of stores to return. StoreCensus allows 50 to 500.').optional(),
  cursor: z.string().min(1).regex(new RegExp('\\S')).describe('The StoreCensus cursor returned by the previous page.').optional(),
  sections: z.array(z.enum(['basic_info', 'contact_info', 'location_info', 'social_media', 'ecommerce_info', 'financial_info', 'traffic_analytics', 'technical_info', 'apps_integrations', 'activity_signals', 'crm', 'data_metadata']).describe('A StoreCensus response section to include.')).describe('StoreCensus response sections to include. Omit this field to request all sections.').optional(),
}).describe('The input payload for searching StoreCensus stores.')

export const searchStoresOutput = z.strictObject({
  stores: z.array(z.looseObject({
    basic_info: z.looseObject({}).describe('Basic website and company information.').optional(),
    contact_info: z.looseObject({}).describe('Store contact information.').optional(),
    location_info: z.looseObject({}).describe('Store location information.').optional(),
    social_media: z.looseObject({}).describe('Store social media profile information.').optional(),
    ecommerce_info: z.looseObject({}).describe('Ecommerce platform and catalog information.').optional(),
    financial_info: z.looseObject({}).describe('Estimated revenue and technology spend information.').optional(),
    traffic_analytics: z.looseObject({}).describe('Estimated traffic and audience analytics.').optional(),
    technical_info: z.looseObject({}).describe('Detected technology information.').optional(),
    apps_integrations: z.looseObject({}).describe('Detected Shopify app integration information.').optional(),
    activity_signals: z.looseObject({}).describe('Recent activity and growth signals.').optional(),
    crm: z.looseObject({}).describe('StoreCensus CRM fields for the store.').optional(),
    data_metadata: z.looseObject({}).describe('StoreCensus data metadata for the store.').optional(),
  }).describe('A StoreCensus ecommerce store record.')).describe('The stores returned by StoreCensus.').optional(),
  pagination: z.looseObject({
    page: z.int().describe('The one-indexed page number returned by StoreCensus.').optional(),
    pageSize: z.int().describe('The page size returned by StoreCensus.').optional(),
    hasMore: z.boolean().describe('Whether StoreCensus has more results after this page.').optional(),
    nextCursor: z.string().describe('The cursor for the next result page.').nullable().optional(),
    total: z.int().describe('The total number of matching records when StoreCensus returns it.').optional(),
    returned: z.int().describe('The number of records returned in this response.').optional(),
    totalPages: z.int().describe('The total number of pages when StoreCensus returns it.').optional(),
  }).describe('StoreCensus pagination metadata.').optional(),
  filters: z.looseObject({}).describe('The filters applied by StoreCensus.').optional(),
  sort: z.looseObject({}).describe('The sort applied by StoreCensus.').optional(),
  sections: z.array(z.enum(['basic_info', 'contact_info', 'location_info', 'social_media', 'ecommerce_info', 'financial_info', 'traffic_analytics', 'technical_info', 'apps_integrations', 'activity_signals', 'crm', 'data_metadata']).describe('A StoreCensus response section to include.')).describe('The StoreCensus sections included in the response.').optional(),
}).describe('The response returned when searching StoreCensus stores.')

export const listAppsInput = z.strictObject({
  page: z.int().min(1).describe('The one-indexed page number to return.').optional(),
  pageSize: z.int().min(1).max(500).describe('The number of apps to return. StoreCensus caps this at 500.').optional(),
  app_id: z.int().min(1).describe('The specific StoreCensus app ID to retrieve.').optional(),
  minRating: z.number().min(0).max(5).describe('The minimum app rating to return.').optional(),
  search: z.string().min(1).regex(new RegExp('\\S')).describe('A text search applied to app name, description, or developer.').optional(),
  categoryId: z.int().min(1).describe('The StoreCensus app category ID to filter by.').optional(),
}).describe('The input payload for listing StoreCensus Shopify apps.')

export const listAppsOutput = z.strictObject({
  apps: z.array(z.looseObject({
    app_id: z.int().describe('The StoreCensus app identifier.').optional(),
    name: z.string().describe('The app name.').optional(),
    handle: z.string().describe('The URL-friendly Shopify app handle.').optional(),
    description: z.string().describe('The app description.').optional(),
    icon_url: z.string().describe('The app icon URL.').optional(),
    rating: z.number().describe('The average app rating from zero to five.').optional(),
    developer: z.string().describe('The app developer name.').optional(),
    active: z.boolean().describe('Whether the app is active.').optional(),
    check_status: z.string().describe('The StoreCensus app check status.').optional(),
    last_updated: z.string().describe('The last time StoreCensus updated this app record.').optional(),
    main_category: z.looseObject({
      category_id: z.int().describe('The StoreCensus category identifier.').optional(),
      name: z.string().describe('The category name.').optional(),
      slug: z.string().describe('The URL-friendly category slug.').optional(),
      app_count: z.int().describe('The number of active apps in this category.').optional(),
    }).describe('A StoreCensus Shopify app category.').optional(),
    categories: z.array(z.looseObject({
      category_id: z.int().describe('The StoreCensus category identifier.').optional(),
      name: z.string().describe('The category name.').optional(),
      slug: z.string().describe('The URL-friendly category slug.').optional(),
      app_count: z.int().describe('The number of active apps in this category.').optional(),
    }).describe('A StoreCensus Shopify app category.')).describe('The categories associated with this app.').optional(),
  }).describe('A StoreCensus Shopify app record.')).describe('The apps returned by StoreCensus.').optional(),
  pagination: z.looseObject({
    page: z.int().describe('The one-indexed page number returned by StoreCensus.').optional(),
    pageSize: z.int().describe('The page size returned by StoreCensus.').optional(),
    hasMore: z.boolean().describe('Whether StoreCensus has more results after this page.').optional(),
    nextCursor: z.string().describe('The cursor for the next result page.').nullable().optional(),
    total: z.int().describe('The total number of matching records when StoreCensus returns it.').optional(),
    returned: z.int().describe('The number of records returned in this response.').optional(),
    totalPages: z.int().describe('The total number of pages when StoreCensus returns it.').optional(),
  }).describe('StoreCensus pagination metadata.').optional(),
  filters: z.looseObject({}).describe('The app filters applied by StoreCensus.').optional(),
}).describe('The response returned when listing StoreCensus Shopify apps.')

export const listAppCategoriesInput = z.strictObject({}).describe('The input payload for listing StoreCensus app categories.')

export const listAppCategoriesOutput = z.strictObject({
  categories: z.array(z.looseObject({
    category_id: z.int().describe('The StoreCensus category identifier.').optional(),
    name: z.string().describe('The category name.').optional(),
    slug: z.string().describe('The URL-friendly category slug.').optional(),
    app_count: z.int().describe('The number of active apps in this category.').optional(),
  }).describe('A StoreCensus Shopify app category.')).describe('The app categories returned by StoreCensus.').optional(),
  total: z.int().describe('The total number of categories returned by StoreCensus.').optional(),
}).describe('The response returned when listing StoreCensus app categories.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const storecensusActions = {
  get_website: {
    description: 'Retrieve StoreCensus ecommerce intelligence for a website domain or lead ID.',
    effect: 'read',
    inputSchema: getWebsiteInput,
    outputSchema: z.toJSONSchema(getWebsiteOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_stores: {
    description: 'Search StoreCensus ecommerce stores with filters and cursor pagination.',
    effect: 'read',
    inputSchema: searchStoresInput,
    outputSchema: z.toJSONSchema(searchStoresOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_apps: {
    description: 'List or search StoreCensus Shopify apps with page pagination.',
    effect: 'read',
    inputSchema: listAppsInput,
    outputSchema: z.toJSONSchema(listAppsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_app_categories: {
    description: 'List StoreCensus Shopify app categories that have active apps.',
    effect: 'read',
    inputSchema: listAppCategoriesInput,
    outputSchema: z.toJSONSchema(listAppCategoriesOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
