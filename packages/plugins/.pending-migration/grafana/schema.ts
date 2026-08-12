/**
 * Grafana 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listFoldersInput = z.strictObject({
  namespace: z.string().min(1).describe('The Grafana API namespace. Use default for the main organization.').optional(),
  limit: z.int().min(1).describe('Maximum number of folders to request.').optional(),
  continueToken: z.string().min(1).describe('The Grafana continue token from a previous folder list response.').optional(),
}).describe('Input for listing Grafana folders.')

export const listFoldersOutput = z.strictObject({
  folders: z.array(z.strictObject({
    uid: z.string().describe('The Grafana folder UID.').nullable().optional(),
    title: z.string().describe('The folder title.').nullable().optional(),
    namespace: z.string().describe('The namespace that owns the folder.').nullable().optional(),
    resourceVersion: z.string().describe('The folder resource version.').nullable().optional(),
    parentUid: z.string().describe('The parent folder UID when the folder is nested.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw Grafana API object.').optional(),
  }).describe('A normalized Grafana folder.')).describe('Folders returned by Grafana.').optional(),
  continueToken: z.string().describe('The next Grafana continue token, or null on the last page.').nullable().optional(),
  raw: z.looseObject({}).describe('The raw Grafana API object.').optional(),
}).describe('A page of Grafana folders.')

export const getFolderInput = z.strictObject({
  uid: z.string().min(1).describe('The Grafana folder UID.'),
  namespace: z.string().min(1).describe('The Grafana API namespace. Use default for the main organization.').optional(),
}).describe('Input for retrieving a Grafana folder.')

export const getFolderOutput = z.strictObject({
  folder: z.strictObject({
    uid: z.string().describe('The Grafana folder UID.').nullable().optional(),
    title: z.string().describe('The folder title.').nullable().optional(),
    namespace: z.string().describe('The namespace that owns the folder.').nullable().optional(),
    resourceVersion: z.string().describe('The folder resource version.').nullable().optional(),
    parentUid: z.string().describe('The parent folder UID when the folder is nested.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw Grafana API object.').optional(),
  }).describe('A normalized Grafana folder.').optional(),
}).describe('A Grafana folder response.')

export const createFolderInput = z.strictObject({
  title: z.string().min(1).describe('The new folder title.'),
  uid: z.string().min(1).describe('Optional explicit Grafana folder UID.').optional(),
  generateName: z.string().min(1).describe('Optional UID prefix Grafana can use to generate a folder UID.').optional(),
  parentUid: z.string().min(1).describe('Optional parent folder UID for a nested folder.').optional(),
  namespace: z.string().min(1).describe('The Grafana API namespace. Use default for the main organization.').optional(),
}).describe('Input for creating a Grafana folder.')

export const createFolderOutput = z.strictObject({
  folder: z.strictObject({
    uid: z.string().describe('The Grafana folder UID.').nullable().optional(),
    title: z.string().describe('The folder title.').nullable().optional(),
    namespace: z.string().describe('The namespace that owns the folder.').nullable().optional(),
    resourceVersion: z.string().describe('The folder resource version.').nullable().optional(),
    parentUid: z.string().describe('The parent folder UID when the folder is nested.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw Grafana API object.').optional(),
  }).describe('A normalized Grafana folder.').optional(),
}).describe('The created Grafana folder.')

export const updateFolderInput = z.strictObject({
  uid: z.string().min(1).describe('The Grafana folder UID.'),
  title: z.string().min(1).describe('The updated folder title.'),
  parentUid: z.string().min(1).describe('Optional parent folder UID for a nested folder.').optional(),
  namespace: z.string().min(1).describe('The Grafana API namespace. Use default for the main organization.').optional(),
  resourceVersion: z.string().min(1).describe('The current Grafana resource version when required by the instance.').optional(),
}).describe('Input for updating a Grafana folder.')

export const updateFolderOutput = z.strictObject({
  folder: z.strictObject({
    uid: z.string().describe('The Grafana folder UID.').nullable().optional(),
    title: z.string().describe('The folder title.').nullable().optional(),
    namespace: z.string().describe('The namespace that owns the folder.').nullable().optional(),
    resourceVersion: z.string().describe('The folder resource version.').nullable().optional(),
    parentUid: z.string().describe('The parent folder UID when the folder is nested.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw Grafana API object.').optional(),
  }).describe('A normalized Grafana folder.').optional(),
}).describe('The updated Grafana folder.')

export const deleteFolderInput = z.strictObject({
  uid: z.string().min(1).describe('The Grafana folder UID.'),
  namespace: z.string().min(1).describe('The Grafana API namespace. Use default for the main organization.').optional(),
}).describe('Input for deleting a Grafana folder.')

export const deleteFolderOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the connector completed the delete request.').optional(),
  raw: z.looseObject({}).describe('The raw Grafana API object.').nullable().optional(),
}).describe('Grafana folder deletion result.')

export const searchDashboardsInput = z.strictObject({
  query: z.string().min(1).describe('Free-text search query.').optional(),
  tags: z.array(z.string().min(1).describe('A dashboard tag.')).describe('Dashboard tags to search for.').optional(),
  type: z.enum(['dash-db', 'dash-folder']).describe('Restrict results to dashboards or folders.').optional(),
  dashboardUids: z.array(z.string().min(1).describe('A dashboard UID.')).describe('Dashboard UIDs to search for.').optional(),
  folderUids: z.array(z.string().min(1).describe('A folder UID.')).describe('Folder UIDs to search in.').optional(),
  starred: z.boolean().describe('Whether to return only starred dashboards.').optional(),
  limit: z.int().min(1).max(5000).describe('Maximum number of search results to return.').optional(),
  page: z.int().min(1).describe('Search results page number. Numbering starts at 1.').optional(),
}).describe('Input for searching Grafana folders and dashboards.')

export const searchDashboardsOutput = z.strictObject({
  results: z.array(z.looseObject({
    id: z.int().describe('The numeric Grafana search result ID.').nullable(),
    uid: z.string().describe('The Grafana dashboard or folder UID.').nullable(),
    title: z.string().describe('The search result title.').nullable(),
    type: z.string().describe('The Grafana result type, such as dash-db or dash-folder.').nullable(),
    url: z.string().describe('The Grafana UI path for the result.').nullable(),
    isStarred: z.boolean().describe('Whether the dashboard is starred.').nullable(),
  }).describe('A Grafana folder or dashboard search result.')).describe('Search results returned by Grafana.').optional(),
  raw: z.array(z.looseObject({}).describe('The raw Grafana API object.')).describe('Raw Grafana search result objects.').optional(),
}).describe('Grafana folder and dashboard search results.')

export const getDashboardInput = z.strictObject({
  uid: z.string().min(1).describe('The Grafana dashboard UID.'),
  namespace: z.string().min(1).describe('The Grafana API namespace. Use default for the main organization.').optional(),
}).describe('Input for retrieving a Grafana dashboard.')

export const getDashboardOutput = z.strictObject({
  dashboard: z.strictObject({
    uid: z.string().describe('The dashboard UID.').nullable().optional(),
    title: z.string().describe('The dashboard title.').nullable().optional(),
    namespace: z.string().describe('The namespace that owns the dashboard.').nullable().optional(),
    resourceVersion: z.string().describe('The dashboard resource version.').nullable().optional(),
    folderUid: z.string().describe('The folder UID that contains the dashboard.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw Grafana API object.').optional(),
  }).describe('A normalized Grafana dashboard resource.').optional(),
}).describe('A Grafana dashboard response.')

export const createDashboardInput = z.strictObject({
  uid: z.string().min(1).describe('Optional explicit Grafana dashboard UID.').optional(),
  generateName: z.string().min(1).describe('Optional UID prefix Grafana can use to generate a dashboard UID.').optional(),
  folderUid: z.string().min(1).describe('Optional folder UID for the new dashboard.').optional(),
  spec: z.looseObject({}).describe('The Grafana dashboard spec JSON. This is forwarded to Grafana as the dashboard body.'),
  namespace: z.string().min(1).describe('The Grafana API namespace. Use default for the main organization.').optional(),
}).describe('Input for creating a Grafana dashboard.')

export const createDashboardOutput = z.strictObject({
  dashboard: z.strictObject({
    uid: z.string().describe('The dashboard UID.').nullable().optional(),
    title: z.string().describe('The dashboard title.').nullable().optional(),
    namespace: z.string().describe('The namespace that owns the dashboard.').nullable().optional(),
    resourceVersion: z.string().describe('The dashboard resource version.').nullable().optional(),
    folderUid: z.string().describe('The folder UID that contains the dashboard.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw Grafana API object.').optional(),
  }).describe('A normalized Grafana dashboard resource.').optional(),
}).describe('The created Grafana dashboard.')

export const updateDashboardInput = z.strictObject({
  uid: z.string().min(1).describe('The Grafana dashboard UID.'),
  folderUid: z.string().min(1).describe('Optional folder UID for the dashboard.').optional(),
  spec: z.looseObject({}).describe('The Grafana dashboard spec JSON. This is forwarded to Grafana as the dashboard body.'),
  namespace: z.string().min(1).describe('The Grafana API namespace. Use default for the main organization.').optional(),
  resourceVersion: z.string().min(1).describe('The current Grafana resource version when required by the instance.').optional(),
}).describe('Input for updating a Grafana dashboard.')

export const updateDashboardOutput = z.strictObject({
  dashboard: z.strictObject({
    uid: z.string().describe('The dashboard UID.').nullable().optional(),
    title: z.string().describe('The dashboard title.').nullable().optional(),
    namespace: z.string().describe('The namespace that owns the dashboard.').nullable().optional(),
    resourceVersion: z.string().describe('The dashboard resource version.').nullable().optional(),
    folderUid: z.string().describe('The folder UID that contains the dashboard.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw Grafana API object.').optional(),
  }).describe('A normalized Grafana dashboard resource.').optional(),
}).describe('The updated Grafana dashboard.')

export const deleteDashboardInput = z.strictObject({
  uid: z.string().min(1).describe('The Grafana dashboard UID.'),
  namespace: z.string().min(1).describe('The Grafana API namespace. Use default for the main organization.').optional(),
}).describe('Input for deleting a Grafana dashboard.')

export const deleteDashboardOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the connector completed the delete request.').optional(),
  raw: z.looseObject({}).describe('The raw Grafana API object.').nullable().optional(),
}).describe('Grafana dashboard deletion result.')

export const listDataSourcesInput = z.strictObject({}).describe('No input is required to list Grafana data sources.')

export const listDataSourcesOutput = z.strictObject({
  dataSources: z.array(z.looseObject({
    id: z.int().describe('The numeric Grafana data source ID.').nullable(),
    uid: z.string().describe('The Grafana data source UID.').nullable(),
    name: z.string().describe('The data source name.').nullable(),
    type: z.string().describe('The data source plugin type.').nullable(),
    access: z.string().describe('The data source access mode.').nullable(),
    url: z.string().describe('The data source URL when returned by Grafana.').nullable(),
    isDefault: z.boolean().describe('Whether this data source is the default.').nullable(),
    readOnly: z.boolean().describe('Whether this data source is read-only.').nullable(),
  }).describe('A Grafana data source record.')).describe('Data sources returned by Grafana.').optional(),
  raw: z.array(z.looseObject({}).describe('The raw Grafana API object.')).describe('Raw Grafana data source objects.').optional(),
}).describe('Grafana data sources.')

export const getDataSourceInput = z.strictObject({
  uid: z.string().min(1).describe('The Grafana data source UID.').optional(),
}).describe('Input for retrieving a Grafana data source.')

export const getDataSourceOutput = z.strictObject({
  dataSource: z.looseObject({
    id: z.int().describe('The numeric Grafana data source ID.').nullable(),
    uid: z.string().describe('The Grafana data source UID.').nullable(),
    name: z.string().describe('The data source name.').nullable(),
    type: z.string().describe('The data source plugin type.').nullable(),
    access: z.string().describe('The data source access mode.').nullable(),
    url: z.string().describe('The data source URL when returned by Grafana.').nullable(),
    isDefault: z.boolean().describe('Whether this data source is the default.').nullable(),
    readOnly: z.boolean().describe('Whether this data source is read-only.').nullable(),
  }).describe('A Grafana data source record.').optional(),
}).describe('A Grafana data source response.')

export const createDataSourceInput = z.strictObject({
  dataSource: z.looseObject({}).describe('The Grafana data source payload. Use official Grafana data source fields such as name, type, access, url, jsonData, and secureJsonData.').optional(),
}).describe('Input for creating a Grafana data source.')

export const createDataSourceOutput = z.strictObject({
  dataSource: z.looseObject({
    id: z.int().describe('The numeric Grafana data source ID.').nullable(),
    uid: z.string().describe('The Grafana data source UID.').nullable(),
    name: z.string().describe('The data source name.').nullable(),
    type: z.string().describe('The data source plugin type.').nullable(),
    access: z.string().describe('The data source access mode.').nullable(),
    url: z.string().describe('The data source URL when returned by Grafana.').nullable(),
    isDefault: z.boolean().describe('Whether this data source is the default.').nullable(),
    readOnly: z.boolean().describe('Whether this data source is read-only.').nullable(),
  }).describe('A Grafana data source record.').optional(),
  raw: z.looseObject({}).describe('The raw Grafana API object.').optional(),
}).describe('The created Grafana data source result.')

export const updateDataSourceInput = z.strictObject({
  uid: z.string().min(1).describe('The Grafana data source UID.').optional(),
  dataSource: z.looseObject({}).describe('The Grafana data source payload. Use official Grafana data source fields such as name, type, access, url, jsonData, and secureJsonData.').optional(),
}).describe('Input for updating a Grafana data source.')

export const updateDataSourceOutput = z.strictObject({
  dataSource: z.looseObject({
    id: z.int().describe('The numeric Grafana data source ID.').nullable(),
    uid: z.string().describe('The Grafana data source UID.').nullable(),
    name: z.string().describe('The data source name.').nullable(),
    type: z.string().describe('The data source plugin type.').nullable(),
    access: z.string().describe('The data source access mode.').nullable(),
    url: z.string().describe('The data source URL when returned by Grafana.').nullable(),
    isDefault: z.boolean().describe('Whether this data source is the default.').nullable(),
    readOnly: z.boolean().describe('Whether this data source is read-only.').nullable(),
  }).describe('A Grafana data source record.').optional(),
  raw: z.looseObject({}).describe('The raw Grafana API object.').optional(),
}).describe('The updated Grafana data source result.')

export const deleteDataSourceInput = z.strictObject({
  uid: z.string().min(1).describe('The Grafana data source UID.').optional(),
}).describe('Input for deleting a Grafana data source.')

export const deleteDataSourceOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the connector completed the delete request.').optional(),
  raw: z.looseObject({}).describe('The raw Grafana API object.').nullable().optional(),
}).describe('Grafana data source deletion result.')

export const listAlertRulesInput = z.strictObject({}).describe('No input is required to list Grafana alert rules.')

export const listAlertRulesOutput = z.strictObject({
  alertRules: z.array(z.looseObject({}).describe('A Grafana-managed alert rule.')).describe('Alert rules returned by Grafana.').optional(),
}).describe('Grafana-managed alert rules.')

export const getAlertRuleInput = z.strictObject({
  uid: z.string().min(1).describe('The Grafana alert rule UID.'),
}).describe('Input for retrieving a Grafana alert rule.')

export const getAlertRuleOutput = z.strictObject({
  alertRule: z.looseObject({}).describe('A Grafana-managed alert rule.').optional(),
}).describe('A Grafana-managed alert rule.')

export const listAlertInstancesInput = z.strictObject({
  active: z.boolean().describe('Include active (firing) alert instances.').optional(),
  silenced: z.boolean().describe('Include silenced alert instances.').optional(),
  inhibited: z.boolean().describe('Include inhibited alert instances.').optional(),
}).describe('Input for listing Grafana alert instances.')

export const listAlertInstancesOutput = z.strictObject({
  alertInstances: z.array(z.looseObject({}).describe('A firing or pending Grafana alert instance.')).describe('Alert instances returned by Grafana.').optional(),
}).describe('Grafana alert instances.')

export const listContactPointsInput = z.strictObject({}).describe('No input is required to list Grafana contact points.')

export const listContactPointsOutput = z.strictObject({
  contactPoints: z.array(z.looseObject({}).describe('A Grafana notification contact point.')).describe('Contact points returned by Grafana.').optional(),
}).describe('Grafana notification contact points.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const grafanaActions = {
  list_folders: {
    description: 'List Grafana folders in a namespace with optional pagination.',
    effect: 'read',
    inputSchema: listFoldersInput,
    outputSchema: z.toJSONSchema(listFoldersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_folder: {
    description: 'Retrieve one Grafana folder by UID.',
    effect: 'read',
    inputSchema: getFolderInput,
    outputSchema: z.toJSONSchema(getFolderOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_folder: {
    description: 'Create a Grafana folder in a namespace.',
    effect: 'write',
    inputSchema: createFolderInput,
    outputSchema: z.toJSONSchema(createFolderOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_folder: {
    description: 'Update the title or parent folder for a Grafana folder.',
    effect: 'write',
    inputSchema: updateFolderInput,
    outputSchema: z.toJSONSchema(updateFolderOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_folder: {
    description: 'Delete a Grafana folder by UID.',
    effect: 'destructive',
    inputSchema: deleteFolderInput,
    outputSchema: z.toJSONSchema(deleteFolderOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_dashboards: {
    description: 'Search Grafana folders and dashboards by query, tags, type, folder, and pagination.',
    effect: 'read',
    inputSchema: searchDashboardsInput,
    outputSchema: z.toJSONSchema(searchDashboardsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_dashboard: {
    description: 'Retrieve one Grafana dashboard resource by UID.',
    effect: 'read',
    inputSchema: getDashboardInput,
    outputSchema: z.toJSONSchema(getDashboardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_dashboard: {
    description: 'Create a Grafana dashboard resource in a namespace.',
    effect: 'write',
    inputSchema: createDashboardInput,
    outputSchema: z.toJSONSchema(createDashboardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_dashboard: {
    description: 'Replace a Grafana dashboard resource by UID.',
    effect: 'write',
    inputSchema: updateDashboardInput,
    outputSchema: z.toJSONSchema(updateDashboardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_dashboard: {
    description: 'Delete a Grafana dashboard resource by UID.',
    effect: 'destructive',
    inputSchema: deleteDashboardInput,
    outputSchema: z.toJSONSchema(deleteDashboardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_data_sources: {
    description: 'List Grafana data sources available to the service account token.',
    effect: 'read',
    inputSchema: listDataSourcesInput,
    outputSchema: z.toJSONSchema(listDataSourcesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_data_source: {
    description: 'Retrieve one Grafana data source by UID.',
    effect: 'read',
    inputSchema: getDataSourceInput,
    outputSchema: z.toJSONSchema(getDataSourceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_data_source: {
    description: 'Create a Grafana data source using a JSON payload accepted by Grafana.',
    effect: 'write',
    inputSchema: createDataSourceInput,
    outputSchema: z.toJSONSchema(createDataSourceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_data_source: {
    description: 'Update a Grafana data source by UID using fields accepted by Grafana.',
    effect: 'write',
    inputSchema: updateDataSourceInput,
    outputSchema: z.toJSONSchema(updateDataSourceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_data_source: {
    description: 'Delete a Grafana data source by UID.',
    effect: 'destructive',
    inputSchema: deleteDataSourceInput,
    outputSchema: z.toJSONSchema(deleteDataSourceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_alert_rules: {
    description: 'List all Grafana-managed alert rules via the provisioning API.',
    effect: 'read',
    inputSchema: listAlertRulesInput,
    outputSchema: z.toJSONSchema(listAlertRulesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_alert_rule: {
    description: 'Retrieve one Grafana-managed alert rule by UID via the provisioning API.',
    effect: 'read',
    inputSchema: getAlertRuleInput,
    outputSchema: z.toJSONSchema(getAlertRuleOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_alert_instances: {
    description: 'List currently firing or pending Grafana alert instances from the built-in Alertmanager.',
    effect: 'read',
    inputSchema: listAlertInstancesInput,
    outputSchema: z.toJSONSchema(listAlertInstancesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_contact_points: {
    description: 'List Grafana notification contact points via the provisioning API.',
    effect: 'read',
    inputSchema: listContactPointsInput,
    outputSchema: z.toJSONSchema(listContactPointsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
