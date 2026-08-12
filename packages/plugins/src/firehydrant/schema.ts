/**
 * FireHydrant 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listIncidentsInput = z.strictObject({
  page: z.int().min(1).describe('The page number to request.').optional(),
  perPage: z.int().min(1).max(200).describe('The number of records to request per page. FireHydrant allows up to 200.').optional(),
  query: z.string().describe('A text query that searches incident name, summary, and description.').optional(),
  name: z.string().describe('A query to search incidents by name.').optional(),
  status: z.string().describe('The incident status to filter by.').optional(),
  services: z.string().describe('A comma-separated list of service IDs, or is_empty for incidents with no impacted services.').optional(),
  environments: z.string().describe('A comma-separated list of environment IDs, or is_empty for incidents with no impacted environments.').optional(),
  tags: z.string().describe('A comma-separated list of tags.').optional(),
  tagMatchStrategy: z.enum(['any', 'match_all', 'exclude']).describe('The tag matching strategy.').optional(),
  archived: z.boolean().describe('Whether to return archived incidents.').optional(),
  createdAtOrAfter: z.iso.datetime({ offset: true }).describe('Only return incidents created at or after this time.').optional(),
  createdAtOrBefore: z.iso.datetime({ offset: true }).describe('Only return incidents created at or before this time.').optional(),
  updatedAfter: z.iso.datetime({ offset: true }).describe('Only return incidents updated after this time.').optional(),
  updatedBefore: z.iso.datetime({ offset: true }).describe('Only return incidents updated before this time.').optional(),
}).describe('The input payload for listing FireHydrant incidents.')

export const listIncidentsOutput = z.strictObject({
  incidents: z.array(z.strictObject({
    id: z.string().describe('The incident UUID.').nullable(),
    name: z.string().describe('The incident name.').nullable(),
    number: z.int().describe('The incident number.').nullable(),
    summary: z.string().describe('The incident summary.').nullable(),
    description: z.string().describe('The incident description.').nullable(),
    customerImpactSummary: z.string().describe('The customer impact summary.').nullable(),
    currentMilestone: z.string().describe('The current incident milestone slug.').nullable(),
    severity: z.string().describe('The incident severity.').nullable(),
    priority: z.string().describe('The incident priority.').nullable(),
    createdAt: z.string().describe('When the incident was created.').nullable(),
    startedAt: z.string().describe('When the incident started.').nullable(),
    updatedAt: z.string().describe('When the incident was last updated.').nullable(),
    incidentUrl: z.string().describe('The FireHydrant incident URL.').nullable(),
    active: z.boolean().describe('Whether the incident is active.').nullable(),
    restricted: z.boolean().describe('Whether the incident is restricted.').nullable(),
    services: z.array(z.strictObject({
      id: z.string().describe('The related entity identifier.').nullable(),
      name: z.string().describe('The related entity name.').nullable(),
      slug: z.string().describe('The related entity slug.').nullable(),
      raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
    }).describe('A compact FireHydrant related entity.')).describe('Services impacted by the incident.'),
    environments: z.array(z.strictObject({
      id: z.string().describe('The related entity identifier.').nullable(),
      name: z.string().describe('The related entity name.').nullable(),
      slug: z.string().describe('The related entity slug.').nullable(),
      raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
    }).describe('A compact FireHydrant related entity.')).describe('Environments impacted by the incident.'),
    tags: z.array(z.string().describe('A FireHydrant incident tag.')).describe('Tags attached to the incident.'),
    labels: z.record(z.string(), z.unknown().describe('The label value.')).describe('FireHydrant labels keyed by label name.').nullable(),
    raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
  }).describe('A normalized FireHydrant incident.')).describe('The incidents returned by FireHydrant.'),
  pagination: z.strictObject({
    count: z.int().describe('The total number of matching records.').nullable(),
    page: z.int().describe('The current page number.').nullable(),
    items: z.int().describe('The number of records returned on this page.').nullable(),
    pages: z.int().describe('The total number of available pages.').nullable(),
    last: z.int().describe('The last page number.').nullable(),
    prev: z.int().describe('The previous page number.').nullable(),
    next: z.int().describe('The next page number.').nullable(),
    raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
  }).describe('Pagination metadata returned by FireHydrant.').nullable(),
  raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
}).describe('The response returned when listing FireHydrant incidents.')

export const getIncidentInput = z.strictObject({
  incidentId: z.string().min(1).describe('The incident ID to load.'),
}).describe('The input payload for loading one FireHydrant incident.')

export const getIncidentOutput = z.strictObject({
  incident: z.strictObject({
    id: z.string().describe('The incident UUID.').nullable(),
    name: z.string().describe('The incident name.').nullable(),
    number: z.int().describe('The incident number.').nullable(),
    summary: z.string().describe('The incident summary.').nullable(),
    description: z.string().describe('The incident description.').nullable(),
    customerImpactSummary: z.string().describe('The customer impact summary.').nullable(),
    currentMilestone: z.string().describe('The current incident milestone slug.').nullable(),
    severity: z.string().describe('The incident severity.').nullable(),
    priority: z.string().describe('The incident priority.').nullable(),
    createdAt: z.string().describe('When the incident was created.').nullable(),
    startedAt: z.string().describe('When the incident started.').nullable(),
    updatedAt: z.string().describe('When the incident was last updated.').nullable(),
    incidentUrl: z.string().describe('The FireHydrant incident URL.').nullable(),
    active: z.boolean().describe('Whether the incident is active.').nullable(),
    restricted: z.boolean().describe('Whether the incident is restricted.').nullable(),
    services: z.array(z.strictObject({
      id: z.string().describe('The related entity identifier.').nullable(),
      name: z.string().describe('The related entity name.').nullable(),
      slug: z.string().describe('The related entity slug.').nullable(),
      raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
    }).describe('A compact FireHydrant related entity.')).describe('Services impacted by the incident.'),
    environments: z.array(z.strictObject({
      id: z.string().describe('The related entity identifier.').nullable(),
      name: z.string().describe('The related entity name.').nullable(),
      slug: z.string().describe('The related entity slug.').nullable(),
      raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
    }).describe('A compact FireHydrant related entity.')).describe('Environments impacted by the incident.'),
    tags: z.array(z.string().describe('A FireHydrant incident tag.')).describe('Tags attached to the incident.'),
    labels: z.record(z.string(), z.unknown().describe('The label value.')).describe('FireHydrant labels keyed by label name.').nullable(),
    raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
  }).describe('A normalized FireHydrant incident.'),
  raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
}).describe('The response returned when loading a FireHydrant incident.')

export const createIncidentInput = z.strictObject({
  name: z.string().min(1).describe('The incident name.'),
  summary: z.string().describe('The incident summary.').optional(),
  customerImpactSummary: z.string().describe('The customer impact summary.').optional(),
  description: z.string().describe('The incident description.').optional(),
  priority: z.string().describe('The incident priority.').optional(),
  severity: z.string().describe('The incident severity.').optional(),
  severityConditionId: z.string().min(1).describe('The severity condition ID.').optional(),
  severityImpactId: z.string().min(1).describe('The severity impact ID.').optional(),
  labels: z.record(z.string(), z.unknown().describe('The label value.')).describe('FireHydrant labels keyed by label name.').optional(),
  tagList: z.array(z.string().describe('A FireHydrant incident tag.')).describe('Tags to attach to the incident.').optional(),
  impacts: z.array(z.strictObject({
    type: z.enum(['environment', 'functionality', 'service']).describe('The impacted infrastructure type.'),
    id: z.string().min(1).describe('The impacted infrastructure ID.'),
    conditionId: z.string().min(1).describe('The severity matrix condition ID for the impact.'),
  }).describe('An impacted FireHydrant infrastructure item.')).describe('Impacted infrastructure to attach to the incident.').optional(),
  teamIds: z.array(z.string().min(1).describe('A FireHydrant team ID.')).describe('Team IDs to assign to the incident.').optional(),
  restricted: z.boolean().describe('Whether the incident should be restricted.').optional(),
  incidentTypeId: z.string().min(1).describe('The incident type ID.').optional(),
  skipIncidentTypeValues: z.boolean().describe('Whether to skip values copied from the incident type.').optional(),
}).describe('The input payload for creating a FireHydrant incident.')

export const createIncidentOutput = z.strictObject({
  incident: z.strictObject({
    id: z.string().describe('The incident UUID.').nullable(),
    name: z.string().describe('The incident name.').nullable(),
    number: z.int().describe('The incident number.').nullable(),
    summary: z.string().describe('The incident summary.').nullable(),
    description: z.string().describe('The incident description.').nullable(),
    customerImpactSummary: z.string().describe('The customer impact summary.').nullable(),
    currentMilestone: z.string().describe('The current incident milestone slug.').nullable(),
    severity: z.string().describe('The incident severity.').nullable(),
    priority: z.string().describe('The incident priority.').nullable(),
    createdAt: z.string().describe('When the incident was created.').nullable(),
    startedAt: z.string().describe('When the incident started.').nullable(),
    updatedAt: z.string().describe('When the incident was last updated.').nullable(),
    incidentUrl: z.string().describe('The FireHydrant incident URL.').nullable(),
    active: z.boolean().describe('Whether the incident is active.').nullable(),
    restricted: z.boolean().describe('Whether the incident is restricted.').nullable(),
    services: z.array(z.strictObject({
      id: z.string().describe('The related entity identifier.').nullable(),
      name: z.string().describe('The related entity name.').nullable(),
      slug: z.string().describe('The related entity slug.').nullable(),
      raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
    }).describe('A compact FireHydrant related entity.')).describe('Services impacted by the incident.'),
    environments: z.array(z.strictObject({
      id: z.string().describe('The related entity identifier.').nullable(),
      name: z.string().describe('The related entity name.').nullable(),
      slug: z.string().describe('The related entity slug.').nullable(),
      raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
    }).describe('A compact FireHydrant related entity.')).describe('Environments impacted by the incident.'),
    tags: z.array(z.string().describe('A FireHydrant incident tag.')).describe('Tags attached to the incident.'),
    labels: z.record(z.string(), z.unknown().describe('The label value.')).describe('FireHydrant labels keyed by label name.').nullable(),
    raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
  }).describe('A normalized FireHydrant incident.'),
  raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
}).describe('The response returned when creating a FireHydrant incident.')

export const listServicesInput = z.strictObject({
  page: z.int().min(1).describe('The page number to request.').optional(),
  perPage: z.int().min(1).max(200).describe('The number of records to request per page. FireHydrant allows up to 200.').optional(),
  query: z.string().describe('A free-text query to search matching records.').optional(),
  name: z.string().describe('A name query to search matching records.').optional(),
}).describe('The input payload for FireHydrant paginated list actions.')

export const listServicesOutput = z.strictObject({
  services: z.array(z.strictObject({
    id: z.string().describe('The catalog entry UUID.').nullable(),
    name: z.string().describe('The catalog entry name.').nullable(),
    slug: z.string().describe('The catalog entry slug.').nullable(),
    description: z.string().describe('The catalog entry description.').nullable(),
    serviceTier: z.int().describe('The service tier when FireHydrant provides one.').nullable(),
    createdAt: z.string().describe('When the catalog entry was created.').nullable(),
    updatedAt: z.string().describe('When the catalog entry was last updated.').nullable(),
    activeIncidents: z.array(z.string().describe('An active incident identifier.')).describe('Active incident identifiers associated with this catalog entry.'),
    labels: z.record(z.string(), z.unknown().describe('The label value.')).describe('FireHydrant labels keyed by label name.').nullable(),
    owner: z.strictObject({
      id: z.string().describe('The related entity identifier.').nullable(),
      name: z.string().describe('The related entity name.').nullable(),
      slug: z.string().describe('The related entity slug.').nullable(),
      raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
    }).describe('A compact FireHydrant related entity.').nullable(),
    raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
  }).describe('A normalized FireHydrant catalog entry.')).describe('The services returned by FireHydrant.'),
  pagination: z.strictObject({
    count: z.int().describe('The total number of matching records.').nullable(),
    page: z.int().describe('The current page number.').nullable(),
    items: z.int().describe('The number of records returned on this page.').nullable(),
    pages: z.int().describe('The total number of available pages.').nullable(),
    last: z.int().describe('The last page number.').nullable(),
    prev: z.int().describe('The previous page number.').nullable(),
    next: z.int().describe('The next page number.').nullable(),
    raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
  }).describe('Pagination metadata returned by FireHydrant.').nullable(),
  raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
}).describe('The response returned when listing FireHydrant services.')

export const getServiceInput = z.strictObject({
  serviceId: z.string().min(1).describe('The service UUID or slug to load.'),
}).describe('The input payload for loading one FireHydrant service.')

export const getServiceOutput = z.strictObject({
  service: z.strictObject({
    id: z.string().describe('The catalog entry UUID.').nullable(),
    name: z.string().describe('The catalog entry name.').nullable(),
    slug: z.string().describe('The catalog entry slug.').nullable(),
    description: z.string().describe('The catalog entry description.').nullable(),
    serviceTier: z.int().describe('The service tier when FireHydrant provides one.').nullable(),
    createdAt: z.string().describe('When the catalog entry was created.').nullable(),
    updatedAt: z.string().describe('When the catalog entry was last updated.').nullable(),
    activeIncidents: z.array(z.string().describe('An active incident identifier.')).describe('Active incident identifiers associated with this catalog entry.'),
    labels: z.record(z.string(), z.unknown().describe('The label value.')).describe('FireHydrant labels keyed by label name.').nullable(),
    owner: z.strictObject({
      id: z.string().describe('The related entity identifier.').nullable(),
      name: z.string().describe('The related entity name.').nullable(),
      slug: z.string().describe('The related entity slug.').nullable(),
      raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
    }).describe('A compact FireHydrant related entity.').nullable(),
    raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
  }).describe('A normalized FireHydrant catalog entry.'),
  raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
}).describe('The response returned when loading a FireHydrant service.')

export const listEnvironmentsInput = z.strictObject({
  page: z.int().min(1).describe('The page number to request.').optional(),
  perPage: z.int().min(1).max(200).describe('The number of records to request per page. FireHydrant allows up to 200.').optional(),
  query: z.string().describe('A free-text query to search matching records.').optional(),
  name: z.string().describe('A name query to search matching records.').optional(),
}).describe('The input payload for FireHydrant paginated list actions.')

export const listEnvironmentsOutput = z.strictObject({
  environments: z.array(z.strictObject({
    id: z.string().describe('The catalog entry UUID.').nullable(),
    name: z.string().describe('The catalog entry name.').nullable(),
    slug: z.string().describe('The catalog entry slug.').nullable(),
    description: z.string().describe('The catalog entry description.').nullable(),
    serviceTier: z.int().describe('The service tier when FireHydrant provides one.').nullable(),
    createdAt: z.string().describe('When the catalog entry was created.').nullable(),
    updatedAt: z.string().describe('When the catalog entry was last updated.').nullable(),
    activeIncidents: z.array(z.string().describe('An active incident identifier.')).describe('Active incident identifiers associated with this catalog entry.'),
    labels: z.record(z.string(), z.unknown().describe('The label value.')).describe('FireHydrant labels keyed by label name.').nullable(),
    owner: z.strictObject({
      id: z.string().describe('The related entity identifier.').nullable(),
      name: z.string().describe('The related entity name.').nullable(),
      slug: z.string().describe('The related entity slug.').nullable(),
      raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
    }).describe('A compact FireHydrant related entity.').nullable(),
    raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
  }).describe('A normalized FireHydrant catalog entry.')).describe('The environments returned by FireHydrant.'),
  pagination: z.strictObject({
    count: z.int().describe('The total number of matching records.').nullable(),
    page: z.int().describe('The current page number.').nullable(),
    items: z.int().describe('The number of records returned on this page.').nullable(),
    pages: z.int().describe('The total number of available pages.').nullable(),
    last: z.int().describe('The last page number.').nullable(),
    prev: z.int().describe('The previous page number.').nullable(),
    next: z.int().describe('The next page number.').nullable(),
    raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
  }).describe('Pagination metadata returned by FireHydrant.').nullable(),
  raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
}).describe('The response returned when listing FireHydrant environments.')

export const getEnvironmentInput = z.strictObject({
  environmentId: z.string().min(1).describe('The environment UUID or slug to load.'),
}).describe('The input payload for loading one FireHydrant environment.')

export const getEnvironmentOutput = z.strictObject({
  environment: z.strictObject({
    id: z.string().describe('The catalog entry UUID.').nullable(),
    name: z.string().describe('The catalog entry name.').nullable(),
    slug: z.string().describe('The catalog entry slug.').nullable(),
    description: z.string().describe('The catalog entry description.').nullable(),
    serviceTier: z.int().describe('The service tier when FireHydrant provides one.').nullable(),
    createdAt: z.string().describe('When the catalog entry was created.').nullable(),
    updatedAt: z.string().describe('When the catalog entry was last updated.').nullable(),
    activeIncidents: z.array(z.string().describe('An active incident identifier.')).describe('Active incident identifiers associated with this catalog entry.'),
    labels: z.record(z.string(), z.unknown().describe('The label value.')).describe('FireHydrant labels keyed by label name.').nullable(),
    owner: z.strictObject({
      id: z.string().describe('The related entity identifier.').nullable(),
      name: z.string().describe('The related entity name.').nullable(),
      slug: z.string().describe('The related entity slug.').nullable(),
      raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
    }).describe('A compact FireHydrant related entity.').nullable(),
    raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
  }).describe('A normalized FireHydrant catalog entry.'),
  raw: z.looseObject({}).describe('The raw object returned by FireHydrant.'),
}).describe('The response returned when loading a FireHydrant environment.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const firehydrantActions = {
  list_incidents: {
    description: 'List FireHydrant incidents with stable pagination and common filters.',
    effect: 'read',
    inputSchema: listIncidentsInput,
    outputSchema: z.toJSONSchema(listIncidentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_incident: {
    description: 'Retrieve a single FireHydrant incident by ID.',
    effect: 'read',
    inputSchema: getIncidentInput,
    outputSchema: z.toJSONSchema(getIncidentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_incident: {
    description: 'Create a FireHydrant incident using a JSON-friendly request body.',
    effect: 'write',
    inputSchema: createIncidentInput,
    outputSchema: z.toJSONSchema(createIncidentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_services: {
    description: 'List FireHydrant services with pagination and search filters.',
    effect: 'read',
    inputSchema: listServicesInput,
    outputSchema: z.toJSONSchema(listServicesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_service: {
    description: 'Retrieve a single FireHydrant service by UUID or slug.',
    effect: 'read',
    inputSchema: getServiceInput,
    outputSchema: z.toJSONSchema(getServiceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_environments: {
    description: 'List FireHydrant environments with pagination and search filters.',
    effect: 'read',
    inputSchema: listEnvironmentsInput,
    outputSchema: z.toJSONSchema(listEnvironmentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_environment: {
    description: 'Retrieve a single FireHydrant environment by UUID or slug.',
    effect: 'read',
    inputSchema: getEnvironmentInput,
    outputSchema: z.toJSONSchema(getEnvironmentOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
