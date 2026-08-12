/**
 * Rootly 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrentUserInput = z.strictObject({}).describe('This action does not require input.')

export const getCurrentUserOutput = z.strictObject({
  resource: z.looseObject({
    id: z.string().min(1).describe('The Rootly resource ID.').optional(),
    type: z.string().min(1).describe('The Rootly resource type.').optional(),
    attributes: z.looseObject({}).describe('The Rootly resource attributes.').optional(),
    relationships: z.looseObject({}).describe('The Rootly resource relationships.').optional(),
  }).describe('A Rootly JSON:API resource.'),
  included: z.array(z.looseObject({}).describe('One included Rootly JSON:API resource.')).describe('Included Rootly JSON:API resources.').optional(),
  raw: z.looseObject({}).describe('The raw Rootly JSON:API response.'),
}).describe('A Rootly single-resource response.')

export const listIncidentsInput = z.strictObject({
  pageAfter: z.string().min(1).describe('The Rootly cursor from meta.next_cursor.').optional(),
  pageNumber: z.int().min(1).describe('The page number to request.').optional(),
  pageSize: z.int().min(1).describe('The number of records to request per page.').optional(),
  search: z.string().min(1).describe('Search text for Rootly incident filtering.').optional(),
  kind: z.string().min(1).describe('Rootly incident kind filter.').optional(),
  status: z.string().min(1).describe('Rootly incident status filter.').optional(),
  private: z.boolean().describe('Whether to filter private incidents.').optional(),
  userId: z.int().min(1).describe('Rootly user ID filter.').optional(),
  severity: z.string().min(1).describe('Rootly severity name filter.').optional(),
  severityId: z.string().min(1).describe('Rootly severity ID filter.').optional(),
  labels: z.string().min(1).describe('Comma-separated Rootly label filter.').optional(),
  serviceIds: z.string().min(1).describe('Comma-separated Rootly service ID filter.').optional(),
  serviceNames: z.string().min(1).describe('Comma-separated Rootly service name filter.').optional(),
  teamIds: z.string().min(1).describe('Comma-separated Rootly team ID filter.').optional(),
  teamNames: z.string().min(1).describe('Comma-separated Rootly team name filter.').optional(),
  createdAtGt: z.iso.datetime({ offset: true }).describe('The ISO 8601 timestamp for this filter.').optional(),
  createdAtGte: z.iso.datetime({ offset: true }).describe('The ISO 8601 timestamp for this filter.').optional(),
  createdAtLt: z.iso.datetime({ offset: true }).describe('The ISO 8601 timestamp for this filter.').optional(),
  createdAtLte: z.iso.datetime({ offset: true }).describe('The ISO 8601 timestamp for this filter.').optional(),
  sort: z.string().min(1).describe('The Rootly sort expression, such as name or -created_at.').optional(),
}).describe('Input for listing Rootly incidents.')

export const listIncidentsOutput = z.strictObject({
  resources: z.array(z.looseObject({
    id: z.string().min(1).describe('The Rootly resource ID.').optional(),
    type: z.string().min(1).describe('The Rootly resource type.').optional(),
    attributes: z.looseObject({}).describe('The Rootly resource attributes.').optional(),
    relationships: z.looseObject({}).describe('The Rootly resource relationships.').optional(),
  }).describe('A Rootly JSON:API resource.')).describe('Rootly JSON:API resources.'),
  included: z.array(z.looseObject({}).describe('One included Rootly JSON:API resource.')).describe('Included Rootly JSON:API resources.').optional(),
  links: z.looseObject({}).describe('Rootly pagination or resource links.').optional(),
  meta: z.looseObject({}).describe('Rootly response metadata.').optional(),
  raw: z.looseObject({}).describe('The raw Rootly JSON:API response.'),
}).describe('A Rootly list response.')

export const getIncidentInput = z.strictObject({
  id: z.string().min(1).describe('The Rootly resource UUID or slug.'),
  include: z.array(z.string().min(1).describe('One Rootly include value.')).min(1).describe('Related Rootly resources to include in the JSON:API response.').optional(),
}).describe('Input for retrieving one Rootly resource.')

export const getIncidentOutput = z.strictObject({
  resource: z.looseObject({
    id: z.string().min(1).describe('The Rootly resource ID.').optional(),
    type: z.string().min(1).describe('The Rootly resource type.').optional(),
    attributes: z.looseObject({}).describe('The Rootly resource attributes.').optional(),
    relationships: z.looseObject({}).describe('The Rootly resource relationships.').optional(),
  }).describe('A Rootly JSON:API resource.'),
  included: z.array(z.looseObject({}).describe('One included Rootly JSON:API resource.')).describe('Included Rootly JSON:API resources.').optional(),
  raw: z.looseObject({}).describe('The raw Rootly JSON:API response.'),
}).describe('A Rootly single-resource response.')

export const listServicesInput = z.strictObject({
  include: z.array(z.string().min(1).describe('One Rootly include value.')).min(1).describe('Related Rootly resources to include in the JSON:API response.').optional(),
  pageNumber: z.int().min(1).describe('The page number to request.').optional(),
  pageSize: z.int().min(1).describe('The number of records to request per page.').optional(),
  search: z.string().min(1).describe('Search text for Rootly filtering.').optional(),
  name: z.string().min(1).describe('Rootly name filter.').optional(),
  slug: z.string().min(1).describe('Rootly slug filter.').optional(),
  externalId: z.string().min(1).describe('Rootly external ID filter.').optional(),
  alertBroadcastEnabled: z.boolean().describe('Whether alert broadcast is enabled.').optional(),
  incidentBroadcastEnabled: z.boolean().describe('Whether incident broadcast is enabled.').optional(),
  createdAtGt: z.iso.datetime({ offset: true }).describe('The ISO 8601 timestamp for this filter.').optional(),
  createdAtGte: z.iso.datetime({ offset: true }).describe('The ISO 8601 timestamp for this filter.').optional(),
  createdAtLt: z.iso.datetime({ offset: true }).describe('The ISO 8601 timestamp for this filter.').optional(),
  createdAtLte: z.iso.datetime({ offset: true }).describe('The ISO 8601 timestamp for this filter.').optional(),
  sort: z.string().min(1).describe('The Rootly sort expression, such as name or -created_at.').optional(),
}).describe('Input for listing Rootly services.')

export const listServicesOutput = z.strictObject({
  resources: z.array(z.looseObject({
    id: z.string().min(1).describe('The Rootly resource ID.').optional(),
    type: z.string().min(1).describe('The Rootly resource type.').optional(),
    attributes: z.looseObject({}).describe('The Rootly resource attributes.').optional(),
    relationships: z.looseObject({}).describe('The Rootly resource relationships.').optional(),
  }).describe('A Rootly JSON:API resource.')).describe('Rootly JSON:API resources.'),
  included: z.array(z.looseObject({}).describe('One included Rootly JSON:API resource.')).describe('Included Rootly JSON:API resources.').optional(),
  links: z.looseObject({}).describe('Rootly pagination or resource links.').optional(),
  meta: z.looseObject({}).describe('Rootly response metadata.').optional(),
  raw: z.looseObject({}).describe('The raw Rootly JSON:API response.'),
}).describe('A Rootly list response.')

export const listTeamsInput = z.strictObject({
  include: z.array(z.string().min(1).describe('One Rootly include value.')).min(1).describe('Related Rootly resources to include in the JSON:API response.').optional(),
  pageNumber: z.int().min(1).describe('The page number to request.').optional(),
  pageSize: z.int().min(1).describe('The number of records to request per page.').optional(),
  search: z.string().min(1).describe('Search text for Rootly filtering.').optional(),
  name: z.string().min(1).describe('Rootly name filter.').optional(),
  slug: z.string().min(1).describe('Rootly slug filter.').optional(),
  externalId: z.string().min(1).describe('Rootly external ID filter.').optional(),
  alertBroadcastEnabled: z.boolean().describe('Whether alert broadcast is enabled.').optional(),
  incidentBroadcastEnabled: z.boolean().describe('Whether incident broadcast is enabled.').optional(),
  createdAtGt: z.iso.datetime({ offset: true }).describe('The ISO 8601 timestamp for this filter.').optional(),
  createdAtGte: z.iso.datetime({ offset: true }).describe('The ISO 8601 timestamp for this filter.').optional(),
  createdAtLt: z.iso.datetime({ offset: true }).describe('The ISO 8601 timestamp for this filter.').optional(),
  createdAtLte: z.iso.datetime({ offset: true }).describe('The ISO 8601 timestamp for this filter.').optional(),
  sort: z.string().min(1).describe('The Rootly sort expression, such as name or -created_at.').optional(),
  color: z.string().min(1).describe('Rootly team color filter.').optional(),
}).describe('Input for listing Rootly teams.')

export const listTeamsOutput = z.strictObject({
  resources: z.array(z.looseObject({
    id: z.string().min(1).describe('The Rootly resource ID.').optional(),
    type: z.string().min(1).describe('The Rootly resource type.').optional(),
    attributes: z.looseObject({}).describe('The Rootly resource attributes.').optional(),
    relationships: z.looseObject({}).describe('The Rootly resource relationships.').optional(),
  }).describe('A Rootly JSON:API resource.')).describe('Rootly JSON:API resources.'),
  included: z.array(z.looseObject({}).describe('One included Rootly JSON:API resource.')).describe('Included Rootly JSON:API resources.').optional(),
  links: z.looseObject({}).describe('Rootly pagination or resource links.').optional(),
  meta: z.looseObject({}).describe('Rootly response metadata.').optional(),
  raw: z.looseObject({}).describe('The raw Rootly JSON:API response.'),
}).describe('A Rootly list response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const rootlyActions = {
  get_current_user: {
    description: 'Get the Rootly user associated with the API key.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_incidents: {
    description: 'List Rootly incidents with common filters and pagination.',
    effect: 'read',
    inputSchema: listIncidentsInput,
    outputSchema: z.toJSONSchema(listIncidentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_incident: {
    description: 'Retrieve one Rootly incident by UUID or slug.',
    effect: 'read',
    inputSchema: getIncidentInput,
    outputSchema: z.toJSONSchema(getIncidentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_services: {
    description: 'List Rootly services with common filters and pagination.',
    effect: 'read',
    inputSchema: listServicesInput,
    outputSchema: z.toJSONSchema(listServicesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_teams: {
    description: 'List Rootly teams with common filters and pagination.',
    effect: 'read',
    inputSchema: listTeamsInput,
    outputSchema: z.toJSONSchema(listTeamsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
