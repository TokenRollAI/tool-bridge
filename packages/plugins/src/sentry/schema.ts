/**
 * Sentry 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listOrganizationIntegrationsInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The Sentry organization id or slug whose installed integrations should be listed.'),
  providerKey: z.string().min(1).describe('Optional provider key filter such as slack, github, or jira.').optional(),
  includeConfig: z.boolean().describe('Whether to ask Sentry to include expanded third-party configuration details.').optional(),
  features: z.array(z.string().min(1)).describe('Optional provider feature filters such as alert-rule or issue-sync.').optional(),
}).describe('The input payload for listing installed Sentry integrations.')

export const listOrganizationIntegrationsOutput = z.strictObject({
  integrations: z.array(z.looseObject({}).describe('An installed integration within a Sentry organization.')).describe('The installed integrations returned for the organization.'),
}).describe('Action output.')

export const getOrganizationIntegrationInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The Sentry organization id or slug that owns the integration.'),
  integrationId: z.string().min(1).describe('The installed integration id to retrieve.'),
}).describe('The input payload for retrieving an installed Sentry integration.')

export const getOrganizationIntegrationOutput = z.strictObject({
  integration: z.looseObject({}).describe('An installed integration within a Sentry organization.'),
}).describe('Action output.')

export const getOrganizationIntegrationConfigInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The Sentry organization id or slug whose integration config should be retrieved.'),
  providerKey: z.string().min(1).describe('Optional provider key filter such as slack, github, or jira.').optional(),
}).describe('The input payload for retrieving Sentry integration provider config.')

export const getOrganizationIntegrationConfigOutput = z.strictObject({
  providers: z.array(z.looseObject({}).describe('A Sentry integration provider summary.')).describe('The integration provider configs returned by Sentry.'),
}).describe('Action output.')

export const listOrganizationSentryAppsInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The Sentry organization id or slug whose custom Sentry Apps should be listed.'),
}).describe('The input payload for listing organization-owned Sentry Apps.')

export const listOrganizationSentryAppsOutput = z.strictObject({
  sentryApps: z.array(z.looseObject({}).describe('A Sentry App with integration and OAuth settings details.')).describe('The custom Sentry Apps returned for the organization.'),
}).describe('Action output.')

export const getSentryAppInput = z.strictObject({
  sentryAppIdOrSlug: z.string().min(1).describe('The Sentry App id or slug to retrieve from the global Sentry App registry.'),
}).describe('The input payload for retrieving a Sentry App.')

export const getSentryAppOutput = z.strictObject({
  sentryApp: z.looseObject({}).describe('A Sentry App with integration and OAuth settings details.'),
}).describe('Action output.')

export const listOrganizationProjectsInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The Sentry organization id or slug whose projects should be listed.'),
  cursor: z.string().min(1).describe('The opaque Sentry pagination cursor for the next or previous page.').optional(),
}).describe('The input payload for listing Sentry organization projects.')

export const listOrganizationProjectsOutput = z.strictObject({
  projects: z.array(z.looseObject({}).describe('A Sentry project returned by project list or detail endpoints.')).describe('The projects returned by Sentry.'),
  nextCursor: z.string().describe('The opaque Sentry cursor from the Link header for the next page, or null when there are no more results.').nullable(),
  previousCursor: z.string().describe('The opaque Sentry cursor from the Link header for the previous page, or null when there are no earlier results.').nullable(),
}).describe('Action output.')

export const getProjectInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The organization id or slug that owns the project.'),
  projectIdOrSlug: z.string().min(1).describe('The Sentry project id or slug to retrieve.'),
}).describe('The input payload for retrieving one Sentry project.')

export const getProjectOutput = z.strictObject({
  project: z.looseObject({}).describe('A Sentry project returned by project list or detail endpoints.'),
}).describe('Action output.')

export const listOrganizationIssuesInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The organization id or slug whose issues should be listed.'),
  query: z.string().describe('The Sentry issue search query string used to filter the results.').optional(),
  sort: z.string().describe('The issue sort order such as date, freq, inbox, new, trends, or user.').optional(),
  limit: z.int().min(1).max(100).describe('The maximum number of issues to return in one page.').optional(),
  start: z.string().describe('The inclusive ISO 8601 start time used to filter the issue results.').optional(),
  end: z.string().describe('The inclusive ISO 8601 end time used to filter the issue results.').optional(),
  cursor: z.string().describe('The opaque Sentry pagination cursor for the issue results.').optional(),
  expand: z.array(z.string().min(1)).describe('Additional issue data keys that Sentry should expand in the response.').optional(),
  collapse: z.array(z.string().min(1)).describe('Response sections that Sentry should collapse or omit from the payload.').optional(),
  environments: z.array(z.string().min(1)).describe('The environment names used to filter issues.').optional(),
  projectIds: z.array(z.int().describe('A numeric Sentry project id.')).describe('The numeric Sentry project ids used to filter issues.').optional(),
  statsPeriod: z.string().describe('The relative stats period such as 24h or 7d used for issue statistics.').optional(),
  shortIdLookup: z.boolean().describe('Whether Sentry should parse short issue ids inside the query string.').optional(),
  groupStatsPeriod: z.string().describe('The issue group statistics window such as auto, 24h, or 14d.').optional(),
  viewId: z.string().describe('The Sentry saved view id whose filters should be applied.').optional(),
}).describe('The input payload for listing Sentry organization issues.')

export const listOrganizationIssuesOutput = z.strictObject({
  issues: z.array(z.looseObject({}).describe('A Sentry issue summary or detail payload.')).describe('The issues returned by Sentry.'),
  nextCursor: z.string().describe('The opaque Sentry cursor from the Link header for the next page, or null when there are no more results.').nullable(),
  previousCursor: z.string().describe('The opaque Sentry cursor from the Link header for the previous page, or null when there are no earlier results.').nullable(),
}).describe('Action output.')

export const getIssueInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The organization id or slug that owns the issue.'),
  issueId: z.string().min(1).describe('The Sentry issue id or short id to retrieve.'),
}).describe('The input payload for retrieving one Sentry issue.')

export const getIssueOutput = z.strictObject({
  issue: z.looseObject({}).describe('A Sentry issue summary or detail payload.'),
}).describe('Action output.')

export const getIssueEventInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The organization id or slug that owns the issue.'),
  issueId: z.string().min(1).describe('The Sentry issue id whose event should be retrieved.'),
  eventId: z.string().min(1).describe('The event id or selector such as latest, oldest, or recommended.'),
  environments: z.array(z.string().min(1)).describe('The environment names used to filter which issue event Sentry selects.').optional(),
}).describe('The input payload for retrieving one event from a Sentry issue.')

export const getIssueEventOutput = z.strictObject({
  event: z.looseObject({}).describe('A normalized event associated with a Sentry issue.'),
}).describe('Action output.')

export const listIssueEventsInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The organization id or slug that owns the issue.'),
  issueId: z.string().min(1).describe('The Sentry issue id whose events should be listed.'),
  full: z.boolean().describe('Whether Sentry should return full event payloads instead of summaries.').optional(),
  sample: z.boolean().describe('Whether Sentry should return a deterministic sample of issue events.').optional(),
  query: z.string().describe('The Sentry event search query string used to filter issue events.').optional(),
  start: z.string().describe('The inclusive ISO 8601 start time used to filter issue events.').optional(),
  end: z.string().describe('The inclusive ISO 8601 end time used to filter issue events.').optional(),
  environments: z.array(z.string().min(1)).describe('The environment names used to filter issue events.').optional(),
  statsPeriod: z.string().describe('The relative stats period such as 24h or 7d used to filter issue events.').optional(),
}).describe('The input payload for listing events attached to one Sentry issue.')

export const listIssueEventsOutput = z.strictObject({
  events: z.array(z.looseObject({}).describe('A normalized event associated with a Sentry issue.')).describe('The issue events returned by Sentry.'),
}).describe('Action output.')

export const updateIssueInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The organization id or slug that owns the issue.'),
  issueId: z.string().min(1).describe('The Sentry issue id to update.'),
  status: z.string().describe('The new issue status such as resolved, resolvedInNextRelease, unresolved, or ignored.').optional(),
  hasSeen: z.boolean().describe('Whether the current user has seen the issue after this update.').optional(),
  isPublic: z.boolean().describe('Whether the issue should be visible via a public permalink.').optional(),
  assignedTo: z.string().describe('The assignee actor id, username, or email address; use an empty string to unassign.').optional(),
  isBookmarked: z.boolean().describe('Whether the current user should bookmark the issue after this update.').optional(),
  isSubscribed: z.boolean().describe('Whether the current user should subscribe to issue notifications.').optional(),
  statusDetails: z.strictObject({
    inCommit: z.string().describe('The commit hash associated with the issue resolution.').optional(),
    inRelease: z.string().describe('The release version in which the issue is considered resolved.').optional(),
    inNextRelease: z.boolean().describe('Whether the issue is considered resolved in the next release.').optional(),
  }).describe('Additional issue resolution details sent to Sentry.').optional(),
}).describe('The input payload for updating one Sentry issue.')

export const updateIssueOutput = z.strictObject({
  issue: z.looseObject({}).describe('A Sentry issue summary or detail payload.'),
}).describe('Action output.')

export const listOrganizationReleasesInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The organization id or slug whose releases should be listed.'),
  query: z.string().describe('An optional release version prefix used to filter the release list.').optional(),
}).describe('The input payload for listing Sentry organization releases.')

export const listOrganizationReleasesOutput = z.strictObject({
  releases: z.array(z.looseObject({}).describe('A Sentry release payload.')).describe('The releases returned by Sentry.'),
}).describe('Action output.')

export const getOrganizationReleaseInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The organization id or slug that owns the release.'),
  version: z.string().min(1).describe('The Sentry release version identifier to retrieve.'),
  health: z.boolean().describe('Whether Sentry should include release health details in the response.').optional(),
  summaryStatsPeriod: z.string().describe('The relative time period used for release summary statistics.').optional(),
  healthStatsPeriod: z.string().describe('The relative time period used for release health statistics.').optional(),
  adoptionStages: z.boolean().describe('Whether Sentry should include release adoption stage information.').optional(),
  projectId: z.string().describe('An optional project id used to scope the release details.').optional(),
  query: z.string().describe('An optional Sentry query string used to filter release statistics.').optional(),
  sort: z.string().describe('The sort field used for release statistics in the Sentry response.').optional(),
  status: z.string().describe('An optional release status filter such as open or archived.').optional(),
}).describe('The input payload for retrieving one Sentry release.')

export const getOrganizationReleaseOutput = z.strictObject({
  release: z.looseObject({}).describe('A Sentry release payload.'),
}).describe('Action output.')

export const getReleaseHealthStatsInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The organization id or slug that owns the release.'),
  version: z.string().min(1).describe('The Sentry release version to filter release health statistics by.'),
  fields: z.array(z.string().min(1)).describe('The session metric fields that Sentry should calculate.'),
  groupBy: z.array(z.string().min(1)).describe('The session dimensions that Sentry should group by.').optional(),
  query: z.string().describe('An optional additional Sentry search query appended to the release filter.').optional(),
  start: z.string().describe('The inclusive ISO 8601 start time used to query release health data.').optional(),
  end: z.string().describe('The inclusive ISO 8601 end time used to query release health data.').optional(),
  environments: z.array(z.string().min(1)).describe('The environment names used to filter release health statistics.').optional(),
  projectIds: z.array(z.int().describe('A numeric Sentry project id.')).describe('The numeric Sentry project ids used to filter release health statistics.').optional(),
  interval: z.string().describe('The interval used for time-series release health statistics.').optional(),
  statsPeriod: z.string().describe('The relative time period such as 24h or 7d used for release health statistics.').optional(),
  includeSeries: z.int().describe('Whether Sentry should include series data, using 1 for yes and 0 for no.').optional(),
  includeTotals: z.int().describe('Whether Sentry should include totals data, using 1 for yes and 0 for no.').optional(),
  perPage: z.int().min(1).describe('The maximum number of grouped rows to return.').optional(),
  orderBy: z.string().describe('The metric field Sentry should order the grouped rows by.').optional(),
}).describe('The input payload for retrieving Sentry release health statistics.')

export const getReleaseHealthStatsOutput = z.strictObject({
  groups: z.array(z.looseObject({}).describe('A grouped release health statistics row.')).describe('The grouped release health statistics returned by Sentry.'),
  intervals: z.array(z.string().min(1)).describe('The interval boundaries returned by the Sentry sessions endpoint.'),
  start: z.string().describe('The ISO 8601 start time applied to the statistics query.').nullable(),
  end: z.string().describe('The ISO 8601 end time applied to the statistics query.').nullable(),
}).describe('Action output.')

export const listOrganizationReplaysInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The organization id or slug whose replays should be listed.'),
  start: z.string().describe('The inclusive ISO 8601 start time used to filter replays.').optional(),
  end: z.string().describe('The inclusive ISO 8601 end time used to filter replays.').optional(),
  statsPeriod: z.string().describe('The relative time period such as 1d or 7d used to filter replays.').optional(),
  sort: z.string().describe('The replay sort field returned by Sentry, optionally prefixed with -.').optional(),
  field: z.array(z.string().min(1)).describe('Additional replay fields that Sentry should include in each result.').optional(),
  query: z.string().describe('The Sentry replay search query string used to filter results.').optional(),
  cursor: z.string().describe('The opaque Sentry pagination cursor for the replay results.').optional(),
  projectIds: z.array(z.int().describe('A numeric Sentry project id.')).describe('The numeric Sentry project ids used to filter replays.').optional(),
  perPage: z.int().min(1).describe('The maximum number of replay rows to return.').optional(),
  environment: z.string().describe('The environment name used to filter replays.').optional(),
}).describe('The input payload for listing Sentry organization replays.')

export const listOrganizationReplaysOutput = z.strictObject({
  replays: z.array(z.looseObject({}).describe('A Sentry replay payload.')).describe('The replays returned by Sentry.'),
  nextCursor: z.string().describe('The opaque Sentry cursor from the Link header for the next page, or null when there are no more results.').nullable(),
  previousCursor: z.string().describe('The opaque Sentry cursor from the Link header for the previous page, or null when there are no earlier results.').nullable(),
}).describe('Action output.')

export const getReplayInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The organization id or slug that owns the replay.'),
  replayId: z.string().min(1).describe('The replay id to retrieve.'),
  start: z.string().describe('The inclusive ISO 8601 start time used to scope replay detail metrics.').optional(),
  end: z.string().describe('The inclusive ISO 8601 end time used to scope replay detail metrics.').optional(),
  statsPeriod: z.string().describe('The relative time period such as 1h or 7d used to scope replay detail metrics.').optional(),
  sort: z.string().describe('The replay detail sort field returned by Sentry, optionally prefixed with -.').optional(),
  field: z.array(z.string().min(1)).describe('Additional replay detail fields that Sentry should include in the response.').optional(),
  query: z.string().describe('The Sentry replay search query string used to scope the replay detail response.').optional(),
  cursor: z.string().describe('The opaque Sentry pagination cursor for nested replay detail data.').optional(),
  projectIds: z.array(z.int().describe('A numeric Sentry project id.')).describe('The numeric Sentry project ids used to scope replay details.').optional(),
  perPage: z.int().min(1).describe('The maximum number of nested replay detail rows to return.').optional(),
  environment: z.string().describe('The environment name used to scope replay details.').optional(),
}).describe('The input payload for retrieving one Sentry replay.')

export const getReplayOutput = z.strictObject({
  replay: z.looseObject({}).describe('A Sentry replay payload.'),
  nextCursor: z.string().describe('The opaque Sentry cursor from the Link header for the next page, or null when there are no more results.').nullable(),
  previousCursor: z.string().describe('The opaque Sentry cursor from the Link header for the previous page, or null when there are no earlier results.').nullable(),
}).describe('Action output.')

export const listAlertsInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The organization id or slug whose alert workflows should be listed.'),
  ids: z.array(z.string().min(1)).describe('Specific alert workflow ids that Sentry should filter the list to.').optional(),
  query: z.string().describe('An optional free-text search query used to filter alert workflows.').optional(),
  sortBy: z.string().describe('The alert workflow sort field, optionally prefixed with - for descending.').optional(),
  projectIds: z.array(z.int().describe('A numeric Sentry project id.')).describe('The numeric Sentry project ids used to filter alert workflows.').optional(),
}).describe('The input payload for listing Sentry alert workflows.')

export const listAlertsOutput = z.strictObject({
  alerts: z.array(z.looseObject({}).describe('A Sentry alert workflow payload.')).describe('The alert workflows returned by Sentry.'),
}).describe('Action output.')

export const getAlertInput = z.strictObject({
  organizationIdOrSlug: z.string().min(1).describe('The organization id or slug that owns the alert workflow.'),
  alertId: z.string().min(1).describe('The alert workflow id to retrieve.'),
}).describe('The input payload for retrieving one Sentry alert workflow.')

export const getAlertOutput = z.strictObject({
  alert: z.looseObject({}).describe('A Sentry alert workflow payload.'),
}).describe('Action output.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const sentryActions = {
  list_organization_integrations: {
    description: 'List installed integrations for a Sentry organization, with optional provider and feature filters.',
    effect: 'read',
    inputSchema: listOrganizationIntegrationsInput,
    outputSchema: z.toJSONSchema(listOrganizationIntegrationsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_organization_integration: {
    description: 'Get one installed Sentry organization integration by its integration id.',
    effect: 'read',
    inputSchema: getOrganizationIntegrationInput,
    outputSchema: z.toJSONSchema(getOrganizationIntegrationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_organization_integration_config: {
    description: 'List available integration provider configs for a Sentry organization, optionally filtered by provider key.',
    effect: 'read',
    inputSchema: getOrganizationIntegrationConfigInput,
    outputSchema: z.toJSONSchema(getOrganizationIntegrationConfigOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_organization_sentry_apps: {
    description: 'List the custom Sentry Apps created by a Sentry organization.',
    effect: 'read',
    inputSchema: listOrganizationSentryAppsInput,
    outputSchema: z.toJSONSchema(listOrganizationSentryAppsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_sentry_app: {
    description: 'Get one Sentry App by id or slug, including integration metadata and OAuth client settings.',
    effect: 'read',
    inputSchema: getSentryAppInput,
    outputSchema: z.toJSONSchema(getSentryAppOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_organization_projects: {
    description: 'List projects that belong to a Sentry organization.',
    effect: 'read',
    inputSchema: listOrganizationProjectsInput,
    outputSchema: z.toJSONSchema(listOrganizationProjectsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project: {
    description: 'Get one Sentry project by organization and project slug or id.',
    effect: 'read',
    inputSchema: getProjectInput,
    outputSchema: z.toJSONSchema(getProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_organization_issues: {
    description: 'List issues for a Sentry organization with optional search, project, and environment filters.',
    effect: 'read',
    inputSchema: listOrganizationIssuesInput,
    outputSchema: z.toJSONSchema(listOrganizationIssuesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_issue: {
    description: 'Get one issue in a Sentry organization by numeric id or short id.',
    effect: 'read',
    inputSchema: getIssueInput,
    outputSchema: z.toJSONSchema(getIssueOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_issue_event: {
    description: 'Get one event for a Sentry issue by event id, or use latest, oldest, or recommended selectors.',
    effect: 'read',
    inputSchema: getIssueEventInput,
    outputSchema: z.toJSONSchema(getIssueEventOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_issue_events: {
    description: 'List events that belong to one Sentry issue, with optional event query filters.',
    effect: 'read',
    inputSchema: listIssueEventsInput,
    outputSchema: z.toJSONSchema(listIssueEventsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_issue: {
    description: 'Update mutable attributes on one Sentry issue, such as status, assignment, or bookmarks.',
    effect: 'write',
    inputSchema: updateIssueInput,
    outputSchema: z.toJSONSchema(updateIssueOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_organization_releases: {
    description: 'List releases that belong to a Sentry organization, optionally filtered by version prefix.',
    effect: 'read',
    inputSchema: listOrganizationReleasesInput,
    outputSchema: z.toJSONSchema(listOrganizationReleasesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_organization_release: {
    description: 'Get one release in a Sentry organization, with optional health and summary statistics included.',
    effect: 'read',
    inputSchema: getOrganizationReleaseInput,
    outputSchema: z.toJSONSchema(getOrganizationReleaseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_release_health_stats: {
    description: 'Retrieve release health session statistics for one Sentry release by querying the sessions endpoint with that release version.',
    effect: 'read',
    inputSchema: getReleaseHealthStatsInput,
    outputSchema: z.toJSONSchema(getReleaseHealthStatsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_organization_replays: {
    description: 'List session replays for a Sentry organization, with optional project and environment filters.',
    effect: 'read',
    inputSchema: listOrganizationReplaysInput,
    outputSchema: z.toJSONSchema(listOrganizationReplaysOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_replay: {
    description: 'Get one replay instance in a Sentry organization by replay id.',
    effect: 'read',
    inputSchema: getReplayInput,
    outputSchema: z.toJSONSchema(getReplayOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_alerts: {
    description: 'List alert workflows for a Sentry organization, with optional id, project, and search filters.',
    effect: 'read',
    inputSchema: listAlertsInput,
    outputSchema: z.toJSONSchema(listAlertsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_alert: {
    description: 'Get one alert workflow in a Sentry organization by workflow id.',
    effect: 'read',
    inputSchema: getAlertInput,
    outputSchema: z.toJSONSchema(getAlertOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
