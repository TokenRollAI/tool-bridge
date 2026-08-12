/**
 * PostHog 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrentUserInput = z.strictObject({}).describe('No input is required for the current PostHog user lookup.')

export const getCurrentUserOutput = z.looseObject({
  id: z.int().describe('Numeric user identifier.'),
  uuid: z.string().describe('User UUID.'),
  distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
  first_name: z.string().describe('User first name.').optional(),
  last_name: z.string().describe('User last name.').optional(),
  email: z.string().describe('User email address.'),
  pending_email: z.string().describe('Pending email address awaiting verification.').nullable().optional(),
  is_email_verified: z.boolean().describe('Whether the email address is verified.').nullable().optional(),
  is_staff: z.boolean().describe('Whether the user has staff access.').optional(),
  role_at_organization: z.string().describe('Declared role for the user within the organization.').optional(),
  date_joined: z.string().describe('Datetime when the user joined PostHog.').optional(),
  team: z.looseObject({
    id: z.int().describe('Numeric team identifier.'),
    uuid: z.string().describe('Team UUID.').optional(),
    organization: z.string().describe('Owning organization UUID.').optional(),
    project_id: z.number().describe('Numeric project identifier.').optional(),
    name: z.string().describe('Team or project name.').optional(),
    api_token: z.string().describe('Project API token.').optional(),
    timezone: z.string().describe('Project timezone.').optional(),
  }).describe('PostHog current team summary.').nullable().optional(),
  organization: z.looseObject({
    id: z.string().describe('Organization UUID.'),
    name: z.string().describe('Organization name.'),
    slug: z.string().describe('Organization slug.').optional(),
    membership_level: z.number().describe('Membership level for the current user in this organization.').nullable().optional(),
  }).describe('PostHog organization summary.').nullable().optional(),
  organizations: z.array(z.looseObject({
    id: z.string().describe('Organization UUID.'),
    name: z.string().describe('Organization name.'),
    slug: z.string().describe('Organization slug.').optional(),
    membership_level: z.number().describe('Membership level for the current user in this organization.').nullable().optional(),
  }).describe('PostHog organization summary.')).describe('Organizations accessible to the user.').optional(),
  hedgehog_config: z.looseObject({}).describe('User hedgehog configuration returned by PostHog.').nullable().optional(),
  notification_settings: z.looseObject({}).describe('Notification settings for the user.').optional(),
}).describe('PostHog current user.')

export const listProjectsInput = z.strictObject({
  organization_id: z.union([z.string().min(1).describe('String organization ID accepted by the official PostHog API path.'), z.int().describe('Numeric organization ID accepted by the official PostHog API path.')]).describe('Organization ID. When omitted, the provider falls back to the current organization from the connected user.').optional(),
  limit: z.int().min(1).describe('Number of results to return per page.').optional(),
  offset: z.int().min(0).describe('Initial index from which to return the results.').optional(),
  search: z.string().describe('A search term used to filter projects.').optional(),
}).describe('Input for listing PostHog projects.')

export const listProjectsOutput = z.strictObject({
  count: z.int().describe('Total number of results available.').optional(),
  next: z.string().describe('URL for the next page of results, or null when there is no next page.').nullable().optional(),
  previous: z.string().describe('URL for the previous page of results, or null when there is no previous page.').nullable().optional(),
  results: z.array(z.looseObject({
    id: z.int().describe('Numeric project identifier.'),
    organization: z.string().describe('Owning organization UUID.'),
    uuid: z.string().describe('Project UUID.'),
    name: z.string().describe('Project name.'),
    api_token: z.string().describe('Project API token.').optional(),
    created_at: z.string().describe('Project creation datetime.').optional(),
    updated_at: z.string().describe('Project update datetime.').optional(),
    product_description: z.string().describe('Description configured for the product.').nullable().optional(),
    timezone: z.string().describe('Project timezone.').optional(),
    is_demo: z.boolean().describe('Whether the project is a demo project.').optional(),
    ingested_event: z.boolean().describe('Whether the project has ingested at least one event.').optional(),
    access_control: z.boolean().describe('Whether access control is enabled.').optional(),
    app_urls: z.array(z.string().describe('Configured application URL.').nullable()).describe('Configured application URLs.').optional(),
    group_types: z.array(z.looseObject({}).describe('Configured group type returned by PostHog.')).describe('Configured group types.').optional(),
    product_intents: z.array(z.looseObject({}).describe('Product intent summary returned by PostHog.')).describe('Product intent summaries for the project.').optional(),
    secret_api_token: z.string().describe('Project secret API token when available.').nullable().optional(),
    secret_api_token_backup: z.string().describe('Project secret API token backup when available.').nullable().optional(),
  }).describe('PostHog project.')).describe('Projects returned by PostHog.').optional(),
}).describe('Paginated PostHog project list.')

export const getProjectInput = z.strictObject({
  organization_id: z.union([z.string().min(1).describe('String organization ID accepted by the official PostHog API path.'), z.int().describe('Numeric organization ID accepted by the official PostHog API path.')]).describe('Organization ID. When omitted, the provider falls back to the current organization from the connected user.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.'),
}).describe('Input for getting a PostHog project.')

export const getProjectOutput = z.looseObject({
  id: z.int().describe('Numeric project identifier.'),
  organization: z.string().describe('Owning organization UUID.'),
  uuid: z.string().describe('Project UUID.'),
  name: z.string().describe('Project name.'),
  api_token: z.string().describe('Project API token.').optional(),
  created_at: z.string().describe('Project creation datetime.').optional(),
  updated_at: z.string().describe('Project update datetime.').optional(),
  product_description: z.string().describe('Description configured for the product.').nullable().optional(),
  timezone: z.string().describe('Project timezone.').optional(),
  is_demo: z.boolean().describe('Whether the project is a demo project.').optional(),
  ingested_event: z.boolean().describe('Whether the project has ingested at least one event.').optional(),
  access_control: z.boolean().describe('Whether access control is enabled.').optional(),
  app_urls: z.array(z.string().describe('Configured application URL.').nullable()).describe('Configured application URLs.').optional(),
  group_types: z.array(z.looseObject({}).describe('Configured group type returned by PostHog.')).describe('Configured group types.').optional(),
  product_intents: z.array(z.looseObject({}).describe('Product intent summary returned by PostHog.')).describe('Product intent summaries for the project.').optional(),
  secret_api_token: z.string().describe('Project secret API token when available.').nullable().optional(),
  secret_api_token_backup: z.string().describe('Project secret API token backup when available.').nullable().optional(),
}).describe('PostHog project.')

export const listEventDefinitionsInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  limit: z.int().min(1).describe('Number of results to return per page.').optional(),
  offset: z.int().min(0).describe('Initial index from which to return the results.').optional(),
}).describe('Input for listing PostHog event definitions.')

export const listEventDefinitionsOutput = z.strictObject({
  count: z.int().describe('Total number of results available.').optional(),
  next: z.string().describe('URL for the next page of results, or null when there is no next page.').nullable().optional(),
  previous: z.string().describe('URL for the previous page of results, or null when there is no previous page.').nullable().optional(),
  results: z.array(z.looseObject({
    id: z.string().describe('Event definition UUID.'),
    name: z.string().describe('Event definition name.'),
    owner: z.number().describe('Owner user ID.').nullable().optional(),
    description: z.string().describe('Description for the event definition.').nullable().optional(),
    tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the event definition.').optional(),
    created_at: z.string().describe('Creation datetime for the event definition.').nullable().optional(),
    updated_at: z.string().describe('Update datetime for the event definition.').optional(),
    updated_by: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').nullable().optional(),
    last_seen_at: z.string().describe('Datetime when the event was last seen.').nullable().optional(),
    last_updated_at: z.string().describe('Datetime of the last upstream update.').optional(),
    verified: z.boolean().describe('Whether the event definition is verified.').optional(),
    verified_at: z.string().describe('Datetime when the event definition was verified.').nullable().optional(),
    verified_by: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').nullable().optional(),
    hidden: z.boolean().describe('Whether the event definition is hidden.').nullable().optional(),
    enforcement_mode: z.string().describe('Enforcement mode for this event definition.').optional(),
    primary_property: z.string().describe('Primary property displayed alongside this event.').nullable().optional(),
    is_action: z.boolean().describe('Whether the definition represents an action.').optional(),
    action_id: z.number().describe('Action ID if this definition is an action.').optional(),
    is_calculating: z.boolean().describe('Whether PostHog is calculating related metadata.').optional(),
    last_calculated_at: z.string().describe('Last calculation datetime.').optional(),
    created_by: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').nullable().optional(),
    post_to_slack: z.boolean().describe('Whether new events post to Slack.').optional(),
    default_columns: z.array(z.string().describe('Default column name.')).describe('Default columns configured for this event definition.').optional(),
    media_preview_urls: z.array(z.string().describe('Media preview URL.')).describe('Media preview URLs returned by PostHog.').optional(),
  }).describe('PostHog event definition.')).describe('Event definitions returned by PostHog.').optional(),
}).describe('Paginated PostHog event definition list.')

export const getEventDefinitionInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
}).describe('Input for a PostHog event definition.')

export const getEventDefinitionOutput = z.looseObject({
  id: z.string().describe('Event definition UUID.'),
  name: z.string().describe('Event definition name.'),
  owner: z.number().describe('Owner user ID.').nullable().optional(),
  description: z.string().describe('Description for the event definition.').nullable().optional(),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the event definition.').optional(),
  created_at: z.string().describe('Creation datetime for the event definition.').nullable().optional(),
  updated_at: z.string().describe('Update datetime for the event definition.').optional(),
  updated_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  last_seen_at: z.string().describe('Datetime when the event was last seen.').nullable().optional(),
  last_updated_at: z.string().describe('Datetime of the last upstream update.').optional(),
  verified: z.boolean().describe('Whether the event definition is verified.').optional(),
  verified_at: z.string().describe('Datetime when the event definition was verified.').nullable().optional(),
  verified_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  hidden: z.boolean().describe('Whether the event definition is hidden.').nullable().optional(),
  enforcement_mode: z.string().describe('Enforcement mode for this event definition.').optional(),
  primary_property: z.string().describe('Primary property displayed alongside this event.').nullable().optional(),
  is_action: z.boolean().describe('Whether the definition represents an action.').optional(),
  action_id: z.number().describe('Action ID if this definition is an action.').optional(),
  is_calculating: z.boolean().describe('Whether PostHog is calculating related metadata.').optional(),
  last_calculated_at: z.string().describe('Last calculation datetime.').optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  post_to_slack: z.boolean().describe('Whether new events post to Slack.').optional(),
  default_columns: z.array(z.string().describe('Default column name.')).describe('Default columns configured for this event definition.').optional(),
  media_preview_urls: z.array(z.string().describe('Media preview URL.')).describe('Media preview URLs returned by PostHog.').optional(),
}).describe('PostHog event definition.')

export const createEventDefinitionInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  name: z.string().max(400).describe('Event definition name.'),
  owner: z.int().describe('Owner user ID.').nullable().optional(),
  description: z.string().describe('Description for the event definition.').nullable().optional(),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the event definition.').optional(),
  verified: z.boolean().describe('Whether the event definition is verified.').optional(),
  hidden: z.boolean().describe('Whether the event definition is hidden.').nullable().optional(),
  enforcement_mode: z.string().describe('Enforcement mode for this event definition.').optional(),
  primary_property: z.string().describe('Primary property displayed alongside this event.').nullable().optional(),
  post_to_slack: z.boolean().describe('Whether new events should post to Slack.').optional(),
  default_columns: z.array(z.string().describe('Default column name.')).describe('Default columns configured for this event definition.').optional(),
}).describe('Input for creating a PostHog event definition.')

export const createEventDefinitionOutput = z.looseObject({
  id: z.string().describe('Event definition UUID.'),
  name: z.string().describe('Event definition name.'),
  owner: z.number().describe('Owner user ID.').nullable().optional(),
  description: z.string().describe('Description for the event definition.').nullable().optional(),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the event definition.').optional(),
  created_at: z.string().describe('Creation datetime for the event definition.').nullable().optional(),
  updated_at: z.string().describe('Update datetime for the event definition.').optional(),
  updated_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  last_seen_at: z.string().describe('Datetime when the event was last seen.').nullable().optional(),
  last_updated_at: z.string().describe('Datetime of the last upstream update.').optional(),
  verified: z.boolean().describe('Whether the event definition is verified.').optional(),
  verified_at: z.string().describe('Datetime when the event definition was verified.').nullable().optional(),
  verified_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  hidden: z.boolean().describe('Whether the event definition is hidden.').nullable().optional(),
  enforcement_mode: z.string().describe('Enforcement mode for this event definition.').optional(),
  primary_property: z.string().describe('Primary property displayed alongside this event.').nullable().optional(),
  is_action: z.boolean().describe('Whether the definition represents an action.').optional(),
  action_id: z.number().describe('Action ID if this definition is an action.').optional(),
  is_calculating: z.boolean().describe('Whether PostHog is calculating related metadata.').optional(),
  last_calculated_at: z.string().describe('Last calculation datetime.').optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  post_to_slack: z.boolean().describe('Whether new events post to Slack.').optional(),
  default_columns: z.array(z.string().describe('Default column name.')).describe('Default columns configured for this event definition.').optional(),
  media_preview_urls: z.array(z.string().describe('Media preview URL.')).describe('Media preview URLs returned by PostHog.').optional(),
}).describe('PostHog event definition.')

export const updateEventDefinitionInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  name: z.string().max(400).describe('Event definition name.').optional(),
  owner: z.int().describe('Owner user ID.').nullable().optional(),
  description: z.string().describe('Description for the event definition.').nullable().optional(),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the event definition.').optional(),
  verified: z.boolean().describe('Whether the event definition is verified.').optional(),
  hidden: z.boolean().describe('Whether the event definition is hidden.').nullable().optional(),
  enforcement_mode: z.string().describe('Enforcement mode for this event definition.').optional(),
  primary_property: z.string().describe('Primary property displayed alongside this event.').nullable().optional(),
  post_to_slack: z.boolean().describe('Whether new events should post to Slack.').optional(),
  default_columns: z.array(z.string().describe('Default column name.')).describe('Default columns configured for this event definition.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.'),
}).describe('Input for updating a PostHog event definition.')

export const updateEventDefinitionOutput = z.looseObject({
  id: z.string().describe('Event definition UUID.'),
  name: z.string().describe('Event definition name.'),
  owner: z.number().describe('Owner user ID.').nullable().optional(),
  description: z.string().describe('Description for the event definition.').nullable().optional(),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the event definition.').optional(),
  created_at: z.string().describe('Creation datetime for the event definition.').nullable().optional(),
  updated_at: z.string().describe('Update datetime for the event definition.').optional(),
  updated_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  last_seen_at: z.string().describe('Datetime when the event was last seen.').nullable().optional(),
  last_updated_at: z.string().describe('Datetime of the last upstream update.').optional(),
  verified: z.boolean().describe('Whether the event definition is verified.').optional(),
  verified_at: z.string().describe('Datetime when the event definition was verified.').nullable().optional(),
  verified_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  hidden: z.boolean().describe('Whether the event definition is hidden.').nullable().optional(),
  enforcement_mode: z.string().describe('Enforcement mode for this event definition.').optional(),
  primary_property: z.string().describe('Primary property displayed alongside this event.').nullable().optional(),
  is_action: z.boolean().describe('Whether the definition represents an action.').optional(),
  action_id: z.number().describe('Action ID if this definition is an action.').optional(),
  is_calculating: z.boolean().describe('Whether PostHog is calculating related metadata.').optional(),
  last_calculated_at: z.string().describe('Last calculation datetime.').optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  post_to_slack: z.boolean().describe('Whether new events post to Slack.').optional(),
  default_columns: z.array(z.string().describe('Default column name.')).describe('Default columns configured for this event definition.').optional(),
  media_preview_urls: z.array(z.string().describe('Media preview URL.')).describe('Media preview URLs returned by PostHog.').optional(),
}).describe('PostHog event definition.')

export const deleteEventDefinitionInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
}).describe('Input for a PostHog event definition.')

export const deleteEventDefinitionOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the delete request succeeded.').optional(),
  id: z.string().describe('Deleted definition identifier.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Result returned after deleting a definition.')

export const getEventDefinitionByNameInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  name: z.string().min(1).describe('Exact event name to look up.').optional(),
}).describe('Input for getting a PostHog event definition by exact name.')

export const getEventDefinitionByNameOutput = z.looseObject({
  id: z.string().describe('Event definition UUID.'),
  name: z.string().describe('Event definition name.'),
  owner: z.number().describe('Owner user ID.').nullable().optional(),
  description: z.string().describe('Description for the event definition.').nullable().optional(),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the event definition.').optional(),
  created_at: z.string().describe('Creation datetime for the event definition.').nullable().optional(),
  updated_at: z.string().describe('Update datetime for the event definition.').optional(),
  updated_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  last_seen_at: z.string().describe('Datetime when the event was last seen.').nullable().optional(),
  last_updated_at: z.string().describe('Datetime of the last upstream update.').optional(),
  verified: z.boolean().describe('Whether the event definition is verified.').optional(),
  verified_at: z.string().describe('Datetime when the event definition was verified.').nullable().optional(),
  verified_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  hidden: z.boolean().describe('Whether the event definition is hidden.').nullable().optional(),
  enforcement_mode: z.string().describe('Enforcement mode for this event definition.').optional(),
  primary_property: z.string().describe('Primary property displayed alongside this event.').nullable().optional(),
  is_action: z.boolean().describe('Whether the definition represents an action.').optional(),
  action_id: z.number().describe('Action ID if this definition is an action.').optional(),
  is_calculating: z.boolean().describe('Whether PostHog is calculating related metadata.').optional(),
  last_calculated_at: z.string().describe('Last calculation datetime.').optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  post_to_slack: z.boolean().describe('Whether new events post to Slack.').optional(),
  default_columns: z.array(z.string().describe('Default column name.')).describe('Default columns configured for this event definition.').optional(),
  media_preview_urls: z.array(z.string().describe('Media preview URL.')).describe('Media preview URLs returned by PostHog.').optional(),
}).describe('PostHog event definition.')

export const getEventDefinitionPrimaryPropertiesInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  names: z.array(z.string().describe('Event name.')).min(1).describe('Event names to restrict the response to.').optional(),
}).describe('Input for getting PostHog event definition primary properties.')

export const getEventDefinitionPrimaryPropertiesOutput = z.strictObject({
  results: z.record(z.string(), z.unknown().describe('Primary property value returned by PostHog.')).describe('Primary properties keyed by event name.').optional(),
  raw: z.unknown().describe('Full raw primary properties payload returned by PostHog.').optional(),
}).describe('Primary properties configured for PostHog event definitions.')

export const bulkUpdateEventDefinitionTagsInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  ids: z.array(z.int().describe('Object ID.')).min(1).max(500).describe('Object IDs to update tags on.').optional(),
  action: z.enum(['add', 'remove', 'set']).describe('Bulk tag action to perform.').optional(),
  tags: z.array(z.string().describe('Tag name.')).min(1).describe('Tag names to add, remove, or set.').optional(),
}).describe('Input for bulk updating tags on PostHog definitions.')

export const bulkUpdateEventDefinitionTagsOutput = z.strictObject({
  updated: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Objects whose tags were updated.').optional(),
  skipped: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Objects skipped by PostHog during tag update.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('PostHog bulk tag update response.')

export const listPropertyDefinitionsInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  event_names: z.string().describe('JSON-encoded event names used by PostHog to populate filtered event visibility.').optional(),
  exclude_core_properties: z.boolean().describe('Whether to exclude core properties.').optional(),
  exclude_hidden: z.boolean().describe('Whether to exclude hidden properties.').optional(),
  excluded_properties: z.string().describe('JSON-encoded list of excluded properties.').optional(),
  filter_by_event_names: z.boolean().describe('Whether to return only properties seen on the supplied event names.').nullable().optional(),
  group_type_index: z.int().describe('Group type index to use when type is group.').optional(),
  is_feature_flag: z.boolean().describe('Whether to include only or exclude feature flag properties.').nullable().optional(),
  is_numerical: z.boolean().describe('Whether to include only or exclude numerical properties.').nullable().optional(),
  limit: z.int().min(1).describe('Number of results to return per page.').optional(),
  offset: z.int().min(0).describe('Initial index from which to return the results.').optional(),
  properties: z.string().describe('Comma-separated list of properties to filter.').optional(),
  search: z.string().describe('Search term used to match property names.').optional(),
  type: z.enum(['event', 'person', 'group', 'session']).describe('Property definition type to return.').optional(),
  verified: z.boolean().describe('Whether to filter by verified state.').nullable().optional(),
}).describe('Input for listing PostHog property definitions.')

export const listPropertyDefinitionsOutput = z.strictObject({
  count: z.int().describe('Total number of results available.').optional(),
  next: z.string().describe('URL for the next page of results, or null when there is no next page.').nullable().optional(),
  previous: z.string().describe('URL for the previous page of results, or null when there is no previous page.').nullable().optional(),
  results: z.array(z.looseObject({
    id: z.string().describe('Property definition UUID.'),
    name: z.string().describe('Property name.'),
    description: z.string().describe('Description for the property definition.').nullable().optional(),
    tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the property definition.').optional(),
    is_numerical: z.boolean().describe('Whether the property is numerical.'),
    updated_at: z.string().describe('Datetime when the property definition was updated.'),
    updated_by: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').nullable().optional(),
    is_seen_on_filtered_events: z.boolean().describe('Whether the property was seen on the filtered events.').nullable().optional(),
    property_type: z.string().describe('Property type inferred by PostHog.').nullable().optional(),
    verified: z.boolean().describe('Whether the property definition is verified.').optional(),
    verified_at: z.string().describe('Datetime when the property definition was verified.').nullable().optional(),
    verified_by: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').nullable().optional(),
    hidden: z.boolean().describe('Whether the property definition is hidden.').nullable().optional(),
  }).describe('PostHog property definition.')).describe('Property definitions returned by PostHog.').optional(),
}).describe('Paginated PostHog property definition list.')

export const getPropertyDefinitionInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
}).describe('Input for a PostHog property definition.')

export const getPropertyDefinitionOutput = z.looseObject({
  id: z.string().describe('Property definition UUID.'),
  name: z.string().describe('Property name.'),
  description: z.string().describe('Description for the property definition.').nullable().optional(),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the property definition.').optional(),
  is_numerical: z.boolean().describe('Whether the property is numerical.'),
  updated_at: z.string().describe('Datetime when the property definition was updated.'),
  updated_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  is_seen_on_filtered_events: z.boolean().describe('Whether the property was seen on the filtered events.').nullable().optional(),
  property_type: z.string().describe('Property type inferred by PostHog.').nullable().optional(),
  verified: z.boolean().describe('Whether the property definition is verified.').optional(),
  verified_at: z.string().describe('Datetime when the property definition was verified.').nullable().optional(),
  verified_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  hidden: z.boolean().describe('Whether the property definition is hidden.').nullable().optional(),
}).describe('PostHog property definition.')

export const updatePropertyDefinitionInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  description: z.string().describe('Description for the property definition.').nullable().optional(),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the property definition.').optional(),
  verified: z.boolean().describe('Whether the property definition is verified.').optional(),
  hidden: z.boolean().describe('Whether the property definition is hidden.').nullable().optional(),
  property_type: z.string().describe('Property type classified by PostHog.').nullable().optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.'),
}).describe('Input for updating a PostHog property definition.')

export const updatePropertyDefinitionOutput = z.looseObject({
  id: z.string().describe('Property definition UUID.'),
  name: z.string().describe('Property name.'),
  description: z.string().describe('Description for the property definition.').nullable().optional(),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the property definition.').optional(),
  is_numerical: z.boolean().describe('Whether the property is numerical.'),
  updated_at: z.string().describe('Datetime when the property definition was updated.'),
  updated_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  is_seen_on_filtered_events: z.boolean().describe('Whether the property was seen on the filtered events.').nullable().optional(),
  property_type: z.string().describe('Property type inferred by PostHog.').nullable().optional(),
  verified: z.boolean().describe('Whether the property definition is verified.').optional(),
  verified_at: z.string().describe('Datetime when the property definition was verified.').nullable().optional(),
  verified_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  hidden: z.boolean().describe('Whether the property definition is hidden.').nullable().optional(),
}).describe('PostHog property definition.')

export const deletePropertyDefinitionInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
}).describe('Input for a PostHog property definition.')

export const deletePropertyDefinitionOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the delete request succeeded.').optional(),
  id: z.string().describe('Deleted definition identifier.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Result returned after deleting a definition.')

export const bulkUpdatePropertyDefinitionTagsInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  ids: z.array(z.int().describe('Object ID.')).min(1).max(500).describe('Object IDs to update tags on.').optional(),
  action: z.enum(['add', 'remove', 'set']).describe('Bulk tag action to perform.').optional(),
  tags: z.array(z.string().describe('Tag name.')).min(1).describe('Tag names to add, remove, or set.').optional(),
}).describe('Input for bulk updating tags on PostHog definitions.')

export const bulkUpdatePropertyDefinitionTagsOutput = z.strictObject({
  updated: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Objects whose tags were updated.').optional(),
  skipped: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Objects skipped by PostHog during tag update.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('PostHog bulk tag update response.')

export const listAnnotationsInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  limit: z.int().min(1).describe('Number of results to return per page.').optional(),
  offset: z.int().min(0).describe('Initial index from which to return the results.').optional(),
  search: z.string().describe('Search term used to match annotations.').optional(),
}).describe('Input for listing PostHog annotations.')

export const listAnnotationsOutput = z.strictObject({
  count: z.int().describe('Total number of results available.').optional(),
  next: z.string().describe('URL for the next page of results, or null when there is no next page.').nullable().optional(),
  previous: z.string().describe('URL for the previous page of results, or null when there is no previous page.').nullable().optional(),
  results: z.array(z.looseObject({
    id: z.int().describe('Numeric annotation identifier.'),
    content: z.string().describe('Annotation text shown on charts.').nullable().optional(),
    date_marker: z.string().describe('ISO 8601 timestamp when this annotation happened.').nullable().optional(),
    creation_type: z.string().describe('Annotation creation type returned by PostHog.').optional(),
    dashboard_item: z.number().describe('Dashboard tile or insight identifier attached to the annotation.').nullable().optional(),
    dashboard_id: z.number().describe('Dashboard identifier attached to the annotation.').nullable().optional(),
    dashboard_name: z.string().describe('Dashboard name attached to the annotation.').nullable().optional(),
    insight_short_id: z.string().describe('Insight short ID attached to the annotation.').nullable().optional(),
    insight_name: z.string().describe('Insight name attached to the annotation.').nullable().optional(),
    insight_derived_name: z.string().describe('Derived insight name attached to the annotation.').nullable().optional(),
    created_by: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').nullable().optional(),
    created_at: z.string().describe('Datetime when the annotation was created.').nullable().optional(),
    updated_at: z.string().describe('Datetime when the annotation was updated.').optional(),
    deleted: z.boolean().describe('Whether the annotation is marked as deleted.').optional(),
    scope: z.string().describe('Annotation visibility scope.').optional(),
    raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
  }).describe('PostHog annotation.')).describe('Annotations returned by PostHog.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Paginated PostHog annotation list.')

export const getAnnotationInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
}).describe('Input for a PostHog annotation.')

export const getAnnotationOutput = z.looseObject({
  id: z.int().describe('Numeric annotation identifier.'),
  content: z.string().describe('Annotation text shown on charts.').nullable().optional(),
  date_marker: z.string().describe('ISO 8601 timestamp when this annotation happened.').nullable().optional(),
  creation_type: z.string().describe('Annotation creation type returned by PostHog.').optional(),
  dashboard_item: z.number().describe('Dashboard tile or insight identifier attached to the annotation.').nullable().optional(),
  dashboard_id: z.number().describe('Dashboard identifier attached to the annotation.').nullable().optional(),
  dashboard_name: z.string().describe('Dashboard name attached to the annotation.').nullable().optional(),
  insight_short_id: z.string().describe('Insight short ID attached to the annotation.').nullable().optional(),
  insight_name: z.string().describe('Insight name attached to the annotation.').nullable().optional(),
  insight_derived_name: z.string().describe('Derived insight name attached to the annotation.').nullable().optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  created_at: z.string().describe('Datetime when the annotation was created.').nullable().optional(),
  updated_at: z.string().describe('Datetime when the annotation was updated.').optional(),
  deleted: z.boolean().describe('Whether the annotation is marked as deleted.').optional(),
  scope: z.string().describe('Annotation visibility scope.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
}).describe('PostHog annotation.')

export const createAnnotationInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  content: z.string().describe('Annotation text shown on charts.').nullable().optional(),
  date_marker: z.string().describe('ISO 8601 timestamp when this annotation happened.').nullable().optional(),
  creation_type: z.enum(['USR', 'GIT']).describe('Annotation creation type.').optional(),
  dashboard_item: z.number().describe('Dashboard tile or insight identifier attached to the annotation.').nullable().optional(),
  dashboard_id: z.number().describe('Dashboard identifier attached to the annotation.').nullable().optional(),
  deleted: z.boolean().describe('Whether the annotation should be marked as deleted.').optional(),
  scope: z.enum(['dashboard_item', 'dashboard', 'project', 'organization']).describe('Annotation visibility scope.').optional(),
}).describe('Input for creating a PostHog annotation.')

export const createAnnotationOutput = z.looseObject({
  id: z.int().describe('Numeric annotation identifier.'),
  content: z.string().describe('Annotation text shown on charts.').nullable().optional(),
  date_marker: z.string().describe('ISO 8601 timestamp when this annotation happened.').nullable().optional(),
  creation_type: z.string().describe('Annotation creation type returned by PostHog.').optional(),
  dashboard_item: z.number().describe('Dashboard tile or insight identifier attached to the annotation.').nullable().optional(),
  dashboard_id: z.number().describe('Dashboard identifier attached to the annotation.').nullable().optional(),
  dashboard_name: z.string().describe('Dashboard name attached to the annotation.').nullable().optional(),
  insight_short_id: z.string().describe('Insight short ID attached to the annotation.').nullable().optional(),
  insight_name: z.string().describe('Insight name attached to the annotation.').nullable().optional(),
  insight_derived_name: z.string().describe('Derived insight name attached to the annotation.').nullable().optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  created_at: z.string().describe('Datetime when the annotation was created.').nullable().optional(),
  updated_at: z.string().describe('Datetime when the annotation was updated.').optional(),
  deleted: z.boolean().describe('Whether the annotation is marked as deleted.').optional(),
  scope: z.string().describe('Annotation visibility scope.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
}).describe('PostHog annotation.')

export const updateAnnotationInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  content: z.string().describe('Annotation text shown on charts.').nullable().optional(),
  date_marker: z.string().describe('ISO 8601 timestamp when this annotation happened.').nullable().optional(),
  creation_type: z.enum(['USR', 'GIT']).describe('Annotation creation type.').optional(),
  dashboard_item: z.number().describe('Dashboard tile or insight identifier attached to the annotation.').nullable().optional(),
  dashboard_id: z.number().describe('Dashboard identifier attached to the annotation.').nullable().optional(),
  deleted: z.boolean().describe('Whether the annotation should be marked as deleted.').optional(),
  scope: z.enum(['dashboard_item', 'dashboard', 'project', 'organization']).describe('Annotation visibility scope.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.'),
}).describe('Input for updating a PostHog annotation.')

export const updateAnnotationOutput = z.looseObject({
  id: z.int().describe('Numeric annotation identifier.'),
  content: z.string().describe('Annotation text shown on charts.').nullable().optional(),
  date_marker: z.string().describe('ISO 8601 timestamp when this annotation happened.').nullable().optional(),
  creation_type: z.string().describe('Annotation creation type returned by PostHog.').optional(),
  dashboard_item: z.number().describe('Dashboard tile or insight identifier attached to the annotation.').nullable().optional(),
  dashboard_id: z.number().describe('Dashboard identifier attached to the annotation.').nullable().optional(),
  dashboard_name: z.string().describe('Dashboard name attached to the annotation.').nullable().optional(),
  insight_short_id: z.string().describe('Insight short ID attached to the annotation.').nullable().optional(),
  insight_name: z.string().describe('Insight name attached to the annotation.').nullable().optional(),
  insight_derived_name: z.string().describe('Derived insight name attached to the annotation.').nullable().optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  created_at: z.string().describe('Datetime when the annotation was created.').nullable().optional(),
  updated_at: z.string().describe('Datetime when the annotation was updated.').optional(),
  deleted: z.boolean().describe('Whether the annotation is marked as deleted.').optional(),
  scope: z.string().describe('Annotation visibility scope.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
}).describe('PostHog annotation.')

export const deleteAnnotationInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
}).describe('Input for a PostHog annotation.')

export const deleteAnnotationOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the annotation was marked as deleted.').optional(),
  id: z.string().describe('Deleted annotation identifier.').optional(),
  annotation: z.looseObject({
    id: z.int().describe('Numeric annotation identifier.'),
    content: z.string().describe('Annotation text shown on charts.').nullable().optional(),
    date_marker: z.string().describe('ISO 8601 timestamp when this annotation happened.').nullable().optional(),
    creation_type: z.string().describe('Annotation creation type returned by PostHog.').optional(),
    dashboard_item: z.number().describe('Dashboard tile or insight identifier attached to the annotation.').nullable().optional(),
    dashboard_id: z.number().describe('Dashboard identifier attached to the annotation.').nullable().optional(),
    dashboard_name: z.string().describe('Dashboard name attached to the annotation.').nullable().optional(),
    insight_short_id: z.string().describe('Insight short ID attached to the annotation.').nullable().optional(),
    insight_name: z.string().describe('Insight name attached to the annotation.').nullable().optional(),
    insight_derived_name: z.string().describe('Derived insight name attached to the annotation.').nullable().optional(),
    created_by: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').nullable().optional(),
    created_at: z.string().describe('Datetime when the annotation was created.').nullable().optional(),
    updated_at: z.string().describe('Datetime when the annotation was updated.').optional(),
    deleted: z.boolean().describe('Whether the annotation is marked as deleted.').optional(),
    scope: z.string().describe('Annotation visibility scope.').optional(),
    raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
  }).describe('PostHog annotation.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Result returned after marking a PostHog annotation as deleted.')

export const listCohortsInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  limit: z.int().min(1).describe('Number of results to return per page.').optional(),
  offset: z.int().min(0).describe('Initial index from which to return the results.').optional(),
}).describe('Input for listing PostHog cohorts.')

export const listCohortsOutput = z.strictObject({
  count: z.int().describe('Total number of results available.').optional(),
  next: z.string().describe('URL for the next page of results, or null when there is no next page.').nullable().optional(),
  previous: z.string().describe('URL for the previous page of results, or null when there is no previous page.').nullable().optional(),
  results: z.array(z.looseObject({
    id: z.int().describe('Numeric cohort identifier.'),
    name: z.string().describe('Cohort name.').nullable().optional(),
    description: z.string().describe('Description for the cohort.').optional(),
    groups: z.looseObject({}).describe('Raw group configuration returned by PostHog.').optional(),
    deleted: z.boolean().describe('Whether the cohort is marked as deleted.').optional(),
    filters: z.looseObject({}).describe('Cohort filters returned by PostHog.').nullable().optional(),
    query: z.looseObject({}).describe('Query payload returned by PostHog for this cohort.').nullable().optional(),
    version: z.number().describe('Current cohort version.').nullable().optional(),
    pending_version: z.number().describe('Pending cohort version.').nullable().optional(),
    is_calculating: z.boolean().describe('Whether the cohort is being recalculated.').optional(),
    created_by: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').nullable().optional(),
    created_at: z.string().describe('Datetime when the cohort was created.').nullable().optional(),
    last_calculation: z.string().describe('Datetime when the cohort was last calculated.').nullable().optional(),
    last_backfill_person_properties_at: z.string().describe('Datetime when person properties were last backfilled.').nullable().optional(),
    errors_calculating: z.number().describe('Number of calculation errors recorded for the cohort.').optional(),
    last_error_message: z.string().describe('Most recent cohort calculation error message.').nullable().optional(),
    count: z.number().describe('Number of persons in the cohort.').nullable().optional(),
    is_static: z.boolean().describe('Whether the cohort is static.').optional(),
    cohort_type: z.string().describe('Cohort type classified by PostHog.').nullable().optional(),
    experiment_set: z.array(z.number().describe('Experiment identifier.')).describe('Experiment IDs attached to the cohort.').optional(),
  }).describe('PostHog cohort.')).describe('Cohorts returned by PostHog.').optional(),
}).describe('Paginated PostHog cohort list.')

export const getCohortInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
}).describe('Input for getting a PostHog cohort.')

export const getCohortOutput = z.looseObject({
  id: z.int().describe('Numeric cohort identifier.'),
  name: z.string().describe('Cohort name.').nullable().optional(),
  description: z.string().describe('Description for the cohort.').optional(),
  groups: z.looseObject({}).describe('Raw group configuration returned by PostHog.').optional(),
  deleted: z.boolean().describe('Whether the cohort is marked as deleted.').optional(),
  filters: z.looseObject({}).describe('Cohort filters returned by PostHog.').nullable().optional(),
  query: z.looseObject({}).describe('Query payload returned by PostHog for this cohort.').nullable().optional(),
  version: z.number().describe('Current cohort version.').nullable().optional(),
  pending_version: z.number().describe('Pending cohort version.').nullable().optional(),
  is_calculating: z.boolean().describe('Whether the cohort is being recalculated.').optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  created_at: z.string().describe('Datetime when the cohort was created.').nullable().optional(),
  last_calculation: z.string().describe('Datetime when the cohort was last calculated.').nullable().optional(),
  last_backfill_person_properties_at: z.string().describe('Datetime when person properties were last backfilled.').nullable().optional(),
  errors_calculating: z.number().describe('Number of calculation errors recorded for the cohort.').optional(),
  last_error_message: z.string().describe('Most recent cohort calculation error message.').nullable().optional(),
  count: z.number().describe('Number of persons in the cohort.').nullable().optional(),
  is_static: z.boolean().describe('Whether the cohort is static.').optional(),
  cohort_type: z.string().describe('Cohort type classified by PostHog.').nullable().optional(),
  experiment_set: z.array(z.number().describe('Experiment identifier.')).describe('Experiment IDs attached to the cohort.').optional(),
}).describe('PostHog cohort.')

export const createCohortInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  name: z.string().max(400).describe('Cohort name.').nullable(),
  description: z.string().max(1000).describe('Description for the cohort.').optional(),
  groups: z.unknown().describe('Group configuration defining cohort criteria.').optional(),
  deleted: z.boolean().describe('Whether the cohort should be marked as deleted.').optional(),
  filters: z.looseObject({}).describe('Object payload accepted or returned by PostHog.').nullable().optional(),
  query: z.unknown().describe('Query payload defining this cohort.').nullable().optional(),
  is_static: z.boolean().describe('Whether the cohort is static.').optional(),
  _create_in_folder: z.string().describe('Folder identifier where PostHog should create the cohort.').optional(),
  _create_static_person_ids: z.array(z.string().describe('Person UUID.')).min(1).describe('Person UUIDs to seed when creating a static cohort.').optional(),
}).describe('Input for creating a PostHog cohort.')

export const createCohortOutput = z.looseObject({
  id: z.int().describe('Numeric cohort identifier.'),
  name: z.string().describe('Cohort name.').nullable().optional(),
  description: z.string().describe('Description for the cohort.').optional(),
  groups: z.looseObject({}).describe('Raw group configuration returned by PostHog.').optional(),
  deleted: z.boolean().describe('Whether the cohort is marked as deleted.').optional(),
  filters: z.looseObject({}).describe('Cohort filters returned by PostHog.').nullable().optional(),
  query: z.looseObject({}).describe('Query payload returned by PostHog for this cohort.').nullable().optional(),
  version: z.number().describe('Current cohort version.').nullable().optional(),
  pending_version: z.number().describe('Pending cohort version.').nullable().optional(),
  is_calculating: z.boolean().describe('Whether the cohort is being recalculated.').optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  created_at: z.string().describe('Datetime when the cohort was created.').nullable().optional(),
  last_calculation: z.string().describe('Datetime when the cohort was last calculated.').nullable().optional(),
  last_backfill_person_properties_at: z.string().describe('Datetime when person properties were last backfilled.').nullable().optional(),
  errors_calculating: z.number().describe('Number of calculation errors recorded for the cohort.').optional(),
  last_error_message: z.string().describe('Most recent cohort calculation error message.').nullable().optional(),
  count: z.number().describe('Number of persons in the cohort.').nullable().optional(),
  is_static: z.boolean().describe('Whether the cohort is static.').optional(),
  cohort_type: z.string().describe('Cohort type classified by PostHog.').nullable().optional(),
  experiment_set: z.array(z.number().describe('Experiment identifier.')).describe('Experiment IDs attached to the cohort.').optional(),
}).describe('PostHog cohort.')

export const updateCohortInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  name: z.string().max(400).describe('Cohort name.').nullable().optional(),
  description: z.string().max(1000).describe('Description for the cohort.').optional(),
  groups: z.unknown().describe('Group configuration defining cohort criteria.').optional(),
  deleted: z.boolean().describe('Whether the cohort should be marked as deleted.').optional(),
  filters: z.looseObject({}).describe('Object payload accepted or returned by PostHog.').nullable().optional(),
  query: z.unknown().describe('Query payload defining this cohort.').nullable().optional(),
  is_static: z.boolean().describe('Whether the cohort is static.').optional(),
  _create_in_folder: z.string().describe('Folder identifier where PostHog should create the cohort.').optional(),
  _create_static_person_ids: z.array(z.string().describe('Person UUID.')).min(1).describe('Person UUIDs to seed when creating a static cohort.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.'),
}).describe('Input for updating a PostHog cohort.')

export const updateCohortOutput = z.looseObject({
  id: z.int().describe('Numeric cohort identifier.'),
  name: z.string().describe('Cohort name.').nullable().optional(),
  description: z.string().describe('Description for the cohort.').optional(),
  groups: z.looseObject({}).describe('Raw group configuration returned by PostHog.').optional(),
  deleted: z.boolean().describe('Whether the cohort is marked as deleted.').optional(),
  filters: z.looseObject({}).describe('Cohort filters returned by PostHog.').nullable().optional(),
  query: z.looseObject({}).describe('Query payload returned by PostHog for this cohort.').nullable().optional(),
  version: z.number().describe('Current cohort version.').nullable().optional(),
  pending_version: z.number().describe('Pending cohort version.').nullable().optional(),
  is_calculating: z.boolean().describe('Whether the cohort is being recalculated.').optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  created_at: z.string().describe('Datetime when the cohort was created.').nullable().optional(),
  last_calculation: z.string().describe('Datetime when the cohort was last calculated.').nullable().optional(),
  last_backfill_person_properties_at: z.string().describe('Datetime when person properties were last backfilled.').nullable().optional(),
  errors_calculating: z.number().describe('Number of calculation errors recorded for the cohort.').optional(),
  last_error_message: z.string().describe('Most recent cohort calculation error message.').nullable().optional(),
  count: z.number().describe('Number of persons in the cohort.').nullable().optional(),
  is_static: z.boolean().describe('Whether the cohort is static.').optional(),
  cohort_type: z.string().describe('Cohort type classified by PostHog.').nullable().optional(),
  experiment_set: z.array(z.number().describe('Experiment identifier.')).describe('Experiment IDs attached to the cohort.').optional(),
}).describe('PostHog cohort.')

export const deleteCohortInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
}).describe('Input for deleting a PostHog cohort.')

export const deleteCohortOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the cohort was marked as deleted.').optional(),
  id: z.string().describe('Deleted cohort identifier.').optional(),
  cohort: z.looseObject({
    id: z.int().describe('Numeric cohort identifier.'),
    name: z.string().describe('Cohort name.').nullable().optional(),
    description: z.string().describe('Description for the cohort.').optional(),
    groups: z.looseObject({}).describe('Raw group configuration returned by PostHog.').optional(),
    deleted: z.boolean().describe('Whether the cohort is marked as deleted.').optional(),
    filters: z.looseObject({}).describe('Cohort filters returned by PostHog.').nullable().optional(),
    query: z.looseObject({}).describe('Query payload returned by PostHog for this cohort.').nullable().optional(),
    version: z.number().describe('Current cohort version.').nullable().optional(),
    pending_version: z.number().describe('Pending cohort version.').nullable().optional(),
    is_calculating: z.boolean().describe('Whether the cohort is being recalculated.').optional(),
    created_by: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').nullable().optional(),
    created_at: z.string().describe('Datetime when the cohort was created.').nullable().optional(),
    last_calculation: z.string().describe('Datetime when the cohort was last calculated.').nullable().optional(),
    last_backfill_person_properties_at: z.string().describe('Datetime when person properties were last backfilled.').nullable().optional(),
    errors_calculating: z.number().describe('Number of calculation errors recorded for the cohort.').optional(),
    last_error_message: z.string().describe('Most recent cohort calculation error message.').nullable().optional(),
    count: z.number().describe('Number of persons in the cohort.').nullable().optional(),
    is_static: z.boolean().describe('Whether the cohort is static.').optional(),
    cohort_type: z.string().describe('Cohort type classified by PostHog.').nullable().optional(),
    experiment_set: z.array(z.number().describe('Experiment identifier.')).describe('Experiment IDs attached to the cohort.').optional(),
  }).describe('PostHog cohort.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Result returned after marking a PostHog cohort as deleted.')

export const addPersonsToStaticCohortInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
  person_ids: z.array(z.string().describe('Person UUID.')).min(1).describe('Person UUIDs to add to the static cohort.').optional(),
}).describe('Input for adding persons to a static PostHog cohort.')

export const addPersonsToStaticCohortOutput = z.strictObject({
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Raw PostHog cohort endpoint payload.')

export const getCohortPersonsInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.'),
  limit: z.int().min(1).describe('Number of results to return per page.').optional(),
  offset: z.int().min(0).describe('Initial index from which to return the results.').optional(),
  format: z.enum(['json']).describe('Response format requested from PostHog.').optional(),
}).describe('Input for listing persons in a PostHog cohort.')

export const getCohortPersonsOutput = z.strictObject({
  next: z.string().describe('URL for the next page of results, or null when there is no next page.').nullable().optional(),
  previous: z.string().describe('URL for the previous page of results, or null when there is no previous page.').nullable().optional(),
  results: z.array(z.looseObject({
    type: z.string().describe('Result type returned by PostHog.').optional(),
    id: z.string().describe('Person identifier returned by PostHog.').optional(),
    uuid: z.string().describe('Person UUID returned by PostHog.').optional(),
    distinct_ids: z.array(z.string().describe('Person distinct ID.')).describe('Distinct IDs associated with this person.').optional(),
    properties: z.looseObject({}).describe('Person properties returned by PostHog.').optional(),
  }).describe('Person row returned by PostHog for a cohort.')).describe('Persons returned by PostHog for this cohort.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Paginated PostHog cohort person list.')

export const getCohortCalculationHistoryInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
}).describe('Input for getting PostHog cohort calculation history.')

export const getCohortCalculationHistoryOutput = z.strictObject({
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Raw PostHog cohort endpoint payload.')

export const listInsightsInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  basic: z.boolean().describe('Whether to return basic insight metadata without results.').optional(),
  limit: z.int().min(1).describe('Number of results to return per page.').optional(),
  offset: z.int().min(0).describe('Initial index from which to return the results.').optional(),
  refresh: z.enum(['async', 'async_except_on_cache_miss', 'blocking', 'force_async', 'force_blocking', 'force_cache', 'lazy_async']).describe('Refresh mode used by the PostHog API.').optional(),
  short_id: z.string().describe('Short insight identifier to filter by.').optional(),
}).describe('Input for listing PostHog insights.')

export const listInsightsOutput = z.strictObject({
  count: z.int().describe('Total number of results available.').optional(),
  next: z.string().describe('URL for the next page of results, or null when there is no next page.').nullable().optional(),
  previous: z.string().describe('URL for the previous page of results, or null when there is no previous page.').nullable().optional(),
  results: z.array(z.looseObject({
    id: z.int().describe('Numeric insight identifier.'),
    short_id: z.string().describe('Short insight identifier.').optional(),
    name: z.string().describe('Insight name.').nullable().optional(),
    derived_name: z.string().describe('Derived insight name.').nullable().optional(),
    query: z.looseObject({}).describe('Insight query definition returned by PostHog.').nullable().optional(),
    order: z.number().describe('Display order for the insight.').nullable().optional(),
    deleted: z.boolean().describe('Whether the insight is marked as deleted.').optional(),
    dashboards: z.array(z.number().describe('Dashboard ID.')).describe('Dashboard IDs referencing the insight.').optional(),
    dashboard_tiles: z.array(z.looseObject({}).describe('Dashboard tile summary returned by PostHog.')).describe('Dashboard tile summaries referencing the insight.').optional(),
    last_refresh: z.string().describe('Datetime when the insight results were last refreshed.').nullable().optional(),
    cache_target_age: z.string().describe('Target age timestamp for cached insight results.').nullable().optional(),
    next_allowed_client_refresh: z.string().describe('Earliest datetime when a client may refresh the insight.').nullable().optional(),
    result: z.unknown().describe('Insight result payload returned by PostHog.').optional(),
    hasMore: z.boolean().describe('Whether the insight has more result rows.').nullable().optional(),
    columns: z.array(z.string().describe('Column name.')).describe('Column names for the result.').nullable().optional(),
    created_at: z.string().describe('Datetime when the insight was created.').nullable().optional(),
    created_by: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').nullable().optional(),
    description: z.string().describe('Insight description.').nullable().optional(),
    updated_at: z.string().describe('Datetime when the insight was updated.').optional(),
    tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the insight.').optional(),
    favorited: z.boolean().describe('Whether the insight is favorited.').optional(),
    last_modified_at: z.string().describe('Datetime when the insight was last modified.').optional(),
    last_modified_by: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').nullable().optional(),
    is_sample: z.boolean().describe('Whether the insight is a sample insight.').optional(),
    effective_restriction_level: z.number().describe('Effective restriction level for the current user.').optional(),
    effective_privilege_level: z.number().describe('Effective privilege level for the current user.').optional(),
    user_access_level: z.string().describe('Effective user access level for the insight.').nullable().optional(),
    timezone: z.string().describe('Timezone used to display the insight.').nullable().optional(),
    is_cached: z.boolean().describe('Whether the returned insight result is cached.').optional(),
    query_status: z.looseObject({}).describe('Query status returned with the insight.').nullable().optional(),
    hogql: z.string().describe('Generated HogQL query for the insight.').nullable().optional(),
    types: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Types returned for the insight.').nullable().optional(),
    resolved_date_range: z.looseObject({
      date_from: z.string().describe('Resolved start datetime for the date range.').optional(),
      date_to: z.string().describe('Resolved end datetime for the date range.').optional(),
    }).describe('Resolved date range returned by PostHog.').nullable().optional(),
    alerts: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Alerts attached to the insight.').optional(),
    last_viewed_at: z.string().describe('Datetime when the insight was last viewed.').nullable().optional(),
    raw: z.looseObject({}).describe('Full raw insight payload returned by PostHog.'),
  }).describe('PostHog insight with a stable top-level connector shape.')).describe('Insights returned by PostHog.').optional(),
  raw: z.looseObject({}).describe('Full raw insight list payload returned by PostHog.').optional(),
}).describe('Paginated PostHog insight list with a stable top-level connector shape.')

export const getInsightInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.'),
  from_dashboard: z.int().describe('Dashboard ID whose filters should override the insight context.').optional(),
  refresh: z.enum(['async', 'async_except_on_cache_miss', 'blocking', 'force_async', 'force_blocking', 'force_cache', 'lazy_async']).describe('Refresh mode used by the PostHog API.').optional(),
}).describe('Input for getting a PostHog insight.')

export const getInsightOutput = z.looseObject({
  id: z.int().describe('Numeric insight identifier.'),
  short_id: z.string().describe('Short insight identifier.').optional(),
  name: z.string().describe('Insight name.').nullable().optional(),
  derived_name: z.string().describe('Derived insight name.').nullable().optional(),
  query: z.looseObject({}).describe('Insight query definition returned by PostHog.').nullable().optional(),
  order: z.number().describe('Display order for the insight.').nullable().optional(),
  deleted: z.boolean().describe('Whether the insight is marked as deleted.').optional(),
  dashboards: z.array(z.number().describe('Dashboard ID.')).describe('Dashboard IDs referencing the insight.').optional(),
  dashboard_tiles: z.array(z.looseObject({}).describe('Dashboard tile summary returned by PostHog.')).describe('Dashboard tile summaries referencing the insight.').optional(),
  last_refresh: z.string().describe('Datetime when the insight results were last refreshed.').nullable().optional(),
  cache_target_age: z.string().describe('Target age timestamp for cached insight results.').nullable().optional(),
  next_allowed_client_refresh: z.string().describe('Earliest datetime when a client may refresh the insight.').nullable().optional(),
  result: z.unknown().describe('Insight result payload returned by PostHog.').optional(),
  hasMore: z.boolean().describe('Whether the insight has more result rows.').nullable().optional(),
  columns: z.array(z.string().describe('Column name.')).describe('Column names for the result.').nullable().optional(),
  created_at: z.string().describe('Datetime when the insight was created.').nullable().optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  description: z.string().describe('Insight description.').nullable().optional(),
  updated_at: z.string().describe('Datetime when the insight was updated.').optional(),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the insight.').optional(),
  favorited: z.boolean().describe('Whether the insight is favorited.').optional(),
  last_modified_at: z.string().describe('Datetime when the insight was last modified.').optional(),
  last_modified_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  is_sample: z.boolean().describe('Whether the insight is a sample insight.').optional(),
  effective_restriction_level: z.number().describe('Effective restriction level for the current user.').optional(),
  effective_privilege_level: z.number().describe('Effective privilege level for the current user.').optional(),
  user_access_level: z.string().describe('Effective user access level for the insight.').nullable().optional(),
  timezone: z.string().describe('Timezone used to display the insight.').nullable().optional(),
  is_cached: z.boolean().describe('Whether the returned insight result is cached.').optional(),
  query_status: z.looseObject({}).describe('Query status returned with the insight.').nullable().optional(),
  hogql: z.string().describe('Generated HogQL query for the insight.').nullable().optional(),
  types: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Types returned for the insight.').nullable().optional(),
  resolved_date_range: z.looseObject({
    date_from: z.string().describe('Resolved start datetime for the date range.').optional(),
    date_to: z.string().describe('Resolved end datetime for the date range.').optional(),
  }).describe('Resolved date range returned by PostHog.').nullable().optional(),
  alerts: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Alerts attached to the insight.').optional(),
  last_viewed_at: z.string().describe('Datetime when the insight was last viewed.').nullable().optional(),
  raw: z.looseObject({}).describe('Full raw insight payload returned by PostHog.'),
}).describe('PostHog insight with a stable top-level connector shape.')

export const runQueryInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  query: z.looseObject({
    kind: z.string().min(1).describe('Query kind accepted by the PostHog query API.'),
  }).describe('Query object submitted to the PostHog query API.'),
  async: z.boolean().describe('Whether PostHog should execute the query asynchronously.').nullable().optional(),
  client_query_id: z.string().describe('Client-provided query identifier.').nullable().optional(),
  filters_override: z.looseObject({}).describe('Object payload accepted or returned by PostHog.').nullable().optional(),
  limit_context: z.string().describe('Limit context forwarded to the query API.').nullable().optional(),
  name: z.string().max(128).describe('Descriptive query name for PostHog query logs.').nullable().optional(),
  refresh: z.enum(['async', 'async_except_on_cache_miss', 'blocking', 'force_async', 'force_blocking', 'force_cache', 'lazy_async']).describe('Refresh mode used by the PostHog API.').nullable().optional(),
  variables_override: z.record(z.string(), z.unknown().describe('Variable value.')).describe('Variable overrides for the supplied query.').nullable().optional(),
}).describe('Input for running a PostHog query in a project.')

export const runQueryOutput = z.looseObject({
  results: z.array(z.unknown().describe('Query result row.')).describe('Rows returned by the PostHog query.').optional(),
  columns: z.array(z.string().describe('Column name.')).describe('Column names for the result.').optional(),
  types: z.array(z.unknown().describe('Column type metadata.')).describe('Column type metadata returned by PostHog.').optional(),
  hasMore: z.boolean().describe('Whether the query has more result rows.').nullable().optional(),
  limit: z.int().describe('Limit returned by PostHog for the query.').optional(),
  offset: z.int().describe('Offset returned by PostHog for the query.').optional(),
  query: z.looseObject({}).describe('Object payload accepted or returned by PostHog.').nullable().optional(),
  error: z.unknown().describe('Query error payload returned by PostHog.').optional(),
  is_cached: z.boolean().describe('Whether the query result came from cache.').nullable().optional(),
  timings: z.array(z.looseObject({}).describe('Object payload accepted or returned by PostHog.')).describe('Timing metrics collected while processing the query.').optional(),
  query_status: z.looseObject({}).describe('Object payload accepted or returned by PostHog.').nullable().optional(),
  hogql: z.string().describe('Generated HogQL query.').nullable().optional(),
  cache_target_age: z.string().describe('Target age timestamp for the cached query result.').nullable().optional(),
  last_refresh: z.string().describe('Datetime when the query result was last refreshed.').nullable().optional(),
  next_allowed_client_refresh: z.string().describe('Earliest datetime when the client can request a fresh result.').nullable().optional(),
  resolved_date_range: z.looseObject({}).describe('Object payload accepted or returned by PostHog.').nullable().optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('PostHog query result with a stable connector shape.')

export const getAsyncQueryStatusInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  query_id: z.string().min(1).describe('Asynchronous query identifier returned by PostHog.').optional(),
}).describe('Input for retrieving or cancelling a PostHog asynchronous query.')

export const getAsyncQueryStatusOutput = z.looseObject({
  id: z.string().describe('Asynchronous query identifier.').optional(),
  query_status: z.looseObject({}).describe('Object payload accepted or returned by PostHog.').optional(),
  complete: z.boolean().describe('Whether the asynchronous query has completed.').optional(),
  results: z.array(z.unknown().describe('Query result row.')).describe('Rows returned by the query when available.').optional(),
  error: z.unknown().describe('Query error payload returned by PostHog.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('PostHog asynchronous query status with a stable connector shape.')

export const cancelQueryInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  query_id: z.string().min(1).describe('Asynchronous query identifier returned by PostHog.').optional(),
}).describe('Input for retrieving or cancelling a PostHog asynchronous query.')

export const cancelQueryOutput = z.strictObject({
  cancelled: z.boolean().describe('Whether the cancel request was sent successfully.').optional(),
  query_id: z.string().describe('Asynchronous query identifier.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Result returned after cancelling a PostHog asynchronous query.')

export const createInsightInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  name: z.string().describe('Insight name.').nullable().optional(),
  description: z.string().describe('Insight description.').nullable().optional(),
  query: z.looseObject({}).describe('Object payload accepted or returned by PostHog.').nullable().optional(),
  filters: z.looseObject({}).describe('Object payload accepted or returned by PostHog.').nullable().optional(),
  dashboards: z.array(z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.')).describe('Dashboard IDs referencing the insight.').optional(),
  tags: z.array(z.string().describe('Insight tag.')).describe('Tags attached to the insight.').optional(),
  refresh: z.enum(['async', 'async_except_on_cache_miss', 'blocking', 'force_async', 'force_blocking', 'force_cache', 'lazy_async']).describe('Refresh mode used by the PostHog API.').nullable().optional(),
  saved: z.boolean().describe('Whether the insight should be saved.').nullable().optional(),
  favorited: z.boolean().describe('Whether the insight should be favorited.').nullable().optional(),
}).describe('Input for creating a PostHog insight.')

export const createInsightOutput = z.looseObject({
  id: z.int().describe('Numeric insight identifier.').optional(),
  short_id: z.string().describe('Short insight identifier.').optional(),
  name: z.string().describe('Insight name.').nullable().optional(),
  query: z.looseObject({}).describe('Object payload accepted or returned by PostHog.').nullable().optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('PostHog insight with a stable connector shape.')

export const updateInsightInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  name: z.string().describe('Insight name.').nullable().optional(),
  description: z.string().describe('Insight description.').nullable().optional(),
  query: z.looseObject({}).describe('Object payload accepted or returned by PostHog.').nullable().optional(),
  filters: z.looseObject({}).describe('Object payload accepted or returned by PostHog.').nullable().optional(),
  dashboards: z.array(z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.')).describe('Dashboard IDs referencing the insight.').optional(),
  tags: z.array(z.string().describe('Insight tag.')).describe('Tags attached to the insight.').optional(),
  refresh: z.enum(['async', 'async_except_on_cache_miss', 'blocking', 'force_async', 'force_blocking', 'force_cache', 'lazy_async']).describe('Refresh mode used by the PostHog API.').nullable().optional(),
  saved: z.boolean().describe('Whether the insight should be saved.').nullable().optional(),
  favorited: z.boolean().describe('Whether the insight should be favorited.').nullable().optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.'),
}).describe('Input for updating a PostHog insight.')

export const updateInsightOutput = z.looseObject({
  id: z.int().describe('Numeric insight identifier.').optional(),
  short_id: z.string().describe('Short insight identifier.').optional(),
  name: z.string().describe('Insight name.').nullable().optional(),
  query: z.looseObject({}).describe('Object payload accepted or returned by PostHog.').nullable().optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('PostHog insight with a stable connector shape.')

export const deleteInsightInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
}).describe('Input for deleting a PostHog insight.')

export const deleteInsightOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the insight was deleted.').optional(),
  id: z.string().describe('Deleted insight identifier.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Result returned after deleting a PostHog insight.')

export const listDashboardsInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  limit: z.int().min(1).describe('Number of results to return per page.').optional(),
  offset: z.int().min(0).describe('Initial index from which to return the results.').optional(),
  search: z.string().max(200).describe('Search term used to match dashboard names and descriptions.').optional(),
}).describe('Input for listing PostHog dashboards.')

export const listDashboardsOutput = z.strictObject({
  count: z.int().describe('Total number of results available.').optional(),
  next: z.string().describe('URL for the next page of results, or null when there is no next page.').nullable().optional(),
  previous: z.string().describe('URL for the previous page of results, or null when there is no previous page.').nullable().optional(),
  results: z.array(z.looseObject({
    id: z.int().describe('Numeric dashboard identifier.'),
    name: z.string().describe('Dashboard name.').nullable().optional(),
    description: z.string().describe('Dashboard description.').optional(),
    pinned: z.boolean().describe('Whether the dashboard is pinned to the top of the list.').optional(),
    created_at: z.string().describe('Datetime when the dashboard was created.').optional(),
    created_by: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').nullable().optional(),
    last_accessed_at: z.string().describe('Datetime when the dashboard was last accessed.').nullable().optional(),
    last_viewed_at: z.string().describe('Datetime when the dashboard was last viewed.').nullable().optional(),
    is_shared: z.boolean().describe('Whether the dashboard is shared.').optional(),
    deleted: z.boolean().describe('Whether the dashboard is marked as deleted.').optional(),
    creation_mode: z.string().describe('Dashboard creation mode returned by PostHog.').optional(),
    tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the dashboard.').optional(),
    restriction_level: z.int().describe('Dashboard restriction level.').optional(),
    effective_restriction_level: z.int().describe('Effective restriction level for the current user.').optional(),
    effective_privilege_level: z.int().describe('Effective privilege level for the current user.').optional(),
    user_access_level: z.string().describe('Effective user access level for the dashboard.').nullable().optional(),
    access_control_version: z.string().describe('Dashboard access control version.').optional(),
    last_refresh: z.string().describe('Datetime when the dashboard last refreshed.').nullable().optional(),
    team_id: z.int().describe('Project or team ID this dashboard belongs to.').optional(),
  }).describe('PostHog dashboard summary.')).describe('Dashboards returned by PostHog.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Paginated PostHog dashboard list.')

export const getDashboardInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.'),
  filters_override: z.looseObject({}).describe('Object payload accepted or returned by PostHog.').nullable().optional(),
  variables_override: z.record(z.string(), z.looseObject({}).describe('Object payload accepted or returned by PostHog.')).describe('Dashboard variable overrides keyed by variable ID.').nullable().optional(),
}).describe('Input for getting a PostHog dashboard.')

export const getDashboardOutput = z.looseObject({
  id: z.int().describe('Numeric dashboard identifier.'),
  name: z.string().describe('Dashboard name.').nullable().optional(),
  description: z.string().describe('Dashboard description.').optional(),
  pinned: z.boolean().describe('Whether the dashboard is pinned to the top of the list.').optional(),
  created_at: z.string().describe('Datetime when the dashboard was created.').optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  last_accessed_at: z.string().describe('Datetime when the dashboard was last accessed.').nullable().optional(),
  last_viewed_at: z.string().describe('Datetime when the dashboard was last viewed.').nullable().optional(),
  is_shared: z.boolean().describe('Whether the dashboard is shared.').optional(),
  deleted: z.boolean().describe('Whether the dashboard is marked as deleted.').optional(),
  creation_mode: z.string().describe('Dashboard creation mode returned by PostHog.').optional(),
  filters: z.looseObject({}).describe('Dashboard filters returned by PostHog.').nullable().optional(),
  variables: z.looseObject({}).describe('Dashboard variables returned by PostHog.').nullable().optional(),
  breakdown_colors: z.unknown().describe('Custom color mapping for breakdown values.').optional(),
  data_color_theme_id: z.number().describe('Color theme ID used for chart visualizations.').nullable().optional(),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the dashboard.').optional(),
  restriction_level: z.int().describe('Dashboard restriction level.').optional(),
  effective_restriction_level: z.int().describe('Effective restriction level for the current user.').optional(),
  effective_privilege_level: z.int().describe('Effective privilege level for the current user.').optional(),
  user_access_level: z.string().describe('Effective user access level for the dashboard.').nullable().optional(),
  access_control_version: z.string().describe('Dashboard access control version.').optional(),
  last_refresh: z.string().describe('Datetime when the dashboard last refreshed.').nullable().optional(),
  persisted_filters: z.looseObject({}).describe('Persisted dashboard filters.').nullable().optional(),
  persisted_variables: z.looseObject({}).describe('Persisted dashboard variables.').nullable().optional(),
  team_id: z.int().describe('Project or team ID this dashboard belongs to.').optional(),
  quick_filter_ids: z.array(z.string().describe('Quick filter ID.')).describe('Quick filter IDs associated with this dashboard.').nullable().optional(),
  tiles: z.array(z.looseObject({}).describe('Object payload accepted or returned by PostHog.')).describe('Dashboard tile payloads returned by PostHog.').nullable().optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
}).describe('PostHog dashboard with a stable top-level connector shape.')

export const createDashboardInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  name: z.string().max(400).describe('Dashboard name.').nullable().optional(),
  description: z.string().describe('Dashboard description.').optional(),
  pinned: z.boolean().describe('Whether the dashboard should be pinned to the top of the list.').optional(),
  deleted: z.boolean().describe('Whether the dashboard should be marked as deleted.').optional(),
  breakdown_colors: z.unknown().describe('Custom color mapping for breakdown values.').optional(),
  data_color_theme_id: z.int().describe('Color theme ID used for chart visualizations.').nullable().optional(),
  tags: z.array(z.string().describe('Dashboard tag.')).describe('Tags attached to the dashboard.').optional(),
  restriction_level: z.int().describe('Dashboard restriction level.').optional(),
  quick_filter_ids: z.array(z.string().describe('Quick filter ID.')).describe('Quick filter IDs associated with this dashboard.').nullable().optional(),
  use_template: z.string().describe('Template key to create the dashboard from a predefined template.').optional(),
  use_dashboard: z.int().describe('ID of an existing dashboard to duplicate.').nullable().optional(),
  delete_insights: z.boolean().describe('Whether PostHog should also delete insights that are only on this dashboard.').optional(),
  _create_in_folder: z.string().describe('Folder identifier where PostHog should create the dashboard.').optional(),
}).describe('Input for creating a PostHog dashboard.')

export const createDashboardOutput = z.looseObject({
  id: z.int().describe('Numeric dashboard identifier.'),
  name: z.string().describe('Dashboard name.').nullable().optional(),
  description: z.string().describe('Dashboard description.').optional(),
  pinned: z.boolean().describe('Whether the dashboard is pinned to the top of the list.').optional(),
  created_at: z.string().describe('Datetime when the dashboard was created.').optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  last_accessed_at: z.string().describe('Datetime when the dashboard was last accessed.').nullable().optional(),
  last_viewed_at: z.string().describe('Datetime when the dashboard was last viewed.').nullable().optional(),
  is_shared: z.boolean().describe('Whether the dashboard is shared.').optional(),
  deleted: z.boolean().describe('Whether the dashboard is marked as deleted.').optional(),
  creation_mode: z.string().describe('Dashboard creation mode returned by PostHog.').optional(),
  filters: z.looseObject({}).describe('Dashboard filters returned by PostHog.').nullable().optional(),
  variables: z.looseObject({}).describe('Dashboard variables returned by PostHog.').nullable().optional(),
  breakdown_colors: z.unknown().describe('Custom color mapping for breakdown values.').optional(),
  data_color_theme_id: z.number().describe('Color theme ID used for chart visualizations.').nullable().optional(),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the dashboard.').optional(),
  restriction_level: z.int().describe('Dashboard restriction level.').optional(),
  effective_restriction_level: z.int().describe('Effective restriction level for the current user.').optional(),
  effective_privilege_level: z.int().describe('Effective privilege level for the current user.').optional(),
  user_access_level: z.string().describe('Effective user access level for the dashboard.').nullable().optional(),
  access_control_version: z.string().describe('Dashboard access control version.').optional(),
  last_refresh: z.string().describe('Datetime when the dashboard last refreshed.').nullable().optional(),
  persisted_filters: z.looseObject({}).describe('Persisted dashboard filters.').nullable().optional(),
  persisted_variables: z.looseObject({}).describe('Persisted dashboard variables.').nullable().optional(),
  team_id: z.int().describe('Project or team ID this dashboard belongs to.').optional(),
  quick_filter_ids: z.array(z.string().describe('Quick filter ID.')).describe('Quick filter IDs associated with this dashboard.').nullable().optional(),
  tiles: z.array(z.looseObject({}).describe('Object payload accepted or returned by PostHog.')).describe('Dashboard tile payloads returned by PostHog.').nullable().optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
}).describe('PostHog dashboard with a stable top-level connector shape.')

export const updateDashboardInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  name: z.string().max(400).describe('Dashboard name.').nullable().optional(),
  description: z.string().describe('Dashboard description.').optional(),
  pinned: z.boolean().describe('Whether the dashboard should be pinned to the top of the list.').optional(),
  deleted: z.boolean().describe('Whether the dashboard should be marked as deleted.').optional(),
  breakdown_colors: z.unknown().describe('Custom color mapping for breakdown values.').optional(),
  data_color_theme_id: z.int().describe('Color theme ID used for chart visualizations.').nullable().optional(),
  tags: z.array(z.string().describe('Dashboard tag.')).describe('Tags attached to the dashboard.').optional(),
  restriction_level: z.int().describe('Dashboard restriction level.').optional(),
  quick_filter_ids: z.array(z.string().describe('Quick filter ID.')).describe('Quick filter IDs associated with this dashboard.').nullable().optional(),
  use_template: z.string().describe('Template key to create the dashboard from a predefined template.').optional(),
  use_dashboard: z.int().describe('ID of an existing dashboard to duplicate.').nullable().optional(),
  delete_insights: z.boolean().describe('Whether PostHog should also delete insights that are only on this dashboard.').optional(),
  _create_in_folder: z.string().describe('Folder identifier where PostHog should create the dashboard.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.'),
}).describe('Input for updating a PostHog dashboard.')

export const updateDashboardOutput = z.looseObject({
  id: z.int().describe('Numeric dashboard identifier.'),
  name: z.string().describe('Dashboard name.').nullable().optional(),
  description: z.string().describe('Dashboard description.').optional(),
  pinned: z.boolean().describe('Whether the dashboard is pinned to the top of the list.').optional(),
  created_at: z.string().describe('Datetime when the dashboard was created.').optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  last_accessed_at: z.string().describe('Datetime when the dashboard was last accessed.').nullable().optional(),
  last_viewed_at: z.string().describe('Datetime when the dashboard was last viewed.').nullable().optional(),
  is_shared: z.boolean().describe('Whether the dashboard is shared.').optional(),
  deleted: z.boolean().describe('Whether the dashboard is marked as deleted.').optional(),
  creation_mode: z.string().describe('Dashboard creation mode returned by PostHog.').optional(),
  filters: z.looseObject({}).describe('Dashboard filters returned by PostHog.').nullable().optional(),
  variables: z.looseObject({}).describe('Dashboard variables returned by PostHog.').nullable().optional(),
  breakdown_colors: z.unknown().describe('Custom color mapping for breakdown values.').optional(),
  data_color_theme_id: z.number().describe('Color theme ID used for chart visualizations.').nullable().optional(),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the dashboard.').optional(),
  restriction_level: z.int().describe('Dashboard restriction level.').optional(),
  effective_restriction_level: z.int().describe('Effective restriction level for the current user.').optional(),
  effective_privilege_level: z.int().describe('Effective privilege level for the current user.').optional(),
  user_access_level: z.string().describe('Effective user access level for the dashboard.').nullable().optional(),
  access_control_version: z.string().describe('Dashboard access control version.').optional(),
  last_refresh: z.string().describe('Datetime when the dashboard last refreshed.').nullable().optional(),
  persisted_filters: z.looseObject({}).describe('Persisted dashboard filters.').nullable().optional(),
  persisted_variables: z.looseObject({}).describe('Persisted dashboard variables.').nullable().optional(),
  team_id: z.int().describe('Project or team ID this dashboard belongs to.').optional(),
  quick_filter_ids: z.array(z.string().describe('Quick filter ID.')).describe('Quick filter IDs associated with this dashboard.').nullable().optional(),
  tiles: z.array(z.looseObject({}).describe('Object payload accepted or returned by PostHog.')).describe('Dashboard tile payloads returned by PostHog.').nullable().optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
}).describe('PostHog dashboard with a stable top-level connector shape.')

export const deleteDashboardInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
  delete_insights: z.boolean().describe('Whether PostHog should also delete insights that are only on this dashboard.').optional(),
}).describe('Input for deleting a PostHog dashboard.')

export const deleteDashboardOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the dashboard was marked as deleted.').optional(),
  id: z.string().describe('Deleted dashboard identifier.').optional(),
  dashboard: z.looseObject({
    id: z.int().describe('Numeric dashboard identifier.'),
    name: z.string().describe('Dashboard name.').nullable().optional(),
    description: z.string().describe('Dashboard description.').optional(),
    pinned: z.boolean().describe('Whether the dashboard is pinned to the top of the list.').optional(),
    created_at: z.string().describe('Datetime when the dashboard was created.').optional(),
    created_by: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').nullable().optional(),
    last_accessed_at: z.string().describe('Datetime when the dashboard was last accessed.').nullable().optional(),
    last_viewed_at: z.string().describe('Datetime when the dashboard was last viewed.').nullable().optional(),
    is_shared: z.boolean().describe('Whether the dashboard is shared.').optional(),
    deleted: z.boolean().describe('Whether the dashboard is marked as deleted.').optional(),
    creation_mode: z.string().describe('Dashboard creation mode returned by PostHog.').optional(),
    filters: z.looseObject({}).describe('Dashboard filters returned by PostHog.').nullable().optional(),
    variables: z.looseObject({}).describe('Dashboard variables returned by PostHog.').nullable().optional(),
    breakdown_colors: z.unknown().describe('Custom color mapping for breakdown values.').optional(),
    data_color_theme_id: z.number().describe('Color theme ID used for chart visualizations.').nullable().optional(),
    tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the dashboard.').optional(),
    restriction_level: z.int().describe('Dashboard restriction level.').optional(),
    effective_restriction_level: z.int().describe('Effective restriction level for the current user.').optional(),
    effective_privilege_level: z.int().describe('Effective privilege level for the current user.').optional(),
    user_access_level: z.string().describe('Effective user access level for the dashboard.').nullable().optional(),
    access_control_version: z.string().describe('Dashboard access control version.').optional(),
    last_refresh: z.string().describe('Datetime when the dashboard last refreshed.').nullable().optional(),
    persisted_filters: z.looseObject({}).describe('Persisted dashboard filters.').nullable().optional(),
    persisted_variables: z.looseObject({}).describe('Persisted dashboard variables.').nullable().optional(),
    team_id: z.int().describe('Project or team ID this dashboard belongs to.').optional(),
    quick_filter_ids: z.array(z.string().describe('Quick filter ID.')).describe('Quick filter IDs associated with this dashboard.').nullable().optional(),
    tiles: z.array(z.looseObject({}).describe('Object payload accepted or returned by PostHog.')).describe('Dashboard tile payloads returned by PostHog.').nullable().optional(),
    raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
  }).describe('PostHog dashboard with a stable top-level connector shape.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Result returned after marking a PostHog dashboard as deleted.')

export const runDashboardInsightsInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.'),
  filters_override: z.looseObject({}).describe('Object payload accepted or returned by PostHog.').nullable().optional(),
  variables_override: z.record(z.string(), z.looseObject({}).describe('Object payload accepted or returned by PostHog.')).describe('Dashboard variable overrides keyed by variable ID.').nullable().optional(),
  output_format: z.enum(['json', 'optimized']).describe('Output format returned by PostHog.').optional(),
  refresh: z.enum(['blocking', 'force_blocking', 'force_cache']).describe('Cache behavior for dashboard insight execution.').optional(),
}).describe('Input for running all insights on a PostHog dashboard.')

export const runDashboardInsightsOutput = z.strictObject({
  results: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Dashboard tile results returned by PostHog.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Results returned after running all insights on a PostHog dashboard.')

export const copyDashboardTileInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
  fromDashboardId: z.int().describe('Dashboard ID the tile currently belongs to.').optional(),
  tileId: z.int().describe('Dashboard tile ID to copy.').optional(),
}).describe('Input for copying a PostHog dashboard tile to another dashboard.')

export const copyDashboardTileOutput = z.looseObject({
  id: z.int().describe('Numeric dashboard identifier.'),
  name: z.string().describe('Dashboard name.').nullable().optional(),
  description: z.string().describe('Dashboard description.').optional(),
  pinned: z.boolean().describe('Whether the dashboard is pinned to the top of the list.').optional(),
  created_at: z.string().describe('Datetime when the dashboard was created.').optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  last_accessed_at: z.string().describe('Datetime when the dashboard was last accessed.').nullable().optional(),
  last_viewed_at: z.string().describe('Datetime when the dashboard was last viewed.').nullable().optional(),
  is_shared: z.boolean().describe('Whether the dashboard is shared.').optional(),
  deleted: z.boolean().describe('Whether the dashboard is marked as deleted.').optional(),
  creation_mode: z.string().describe('Dashboard creation mode returned by PostHog.').optional(),
  filters: z.looseObject({}).describe('Dashboard filters returned by PostHog.').nullable().optional(),
  variables: z.looseObject({}).describe('Dashboard variables returned by PostHog.').nullable().optional(),
  breakdown_colors: z.unknown().describe('Custom color mapping for breakdown values.').optional(),
  data_color_theme_id: z.number().describe('Color theme ID used for chart visualizations.').nullable().optional(),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the dashboard.').optional(),
  restriction_level: z.int().describe('Dashboard restriction level.').optional(),
  effective_restriction_level: z.int().describe('Effective restriction level for the current user.').optional(),
  effective_privilege_level: z.int().describe('Effective privilege level for the current user.').optional(),
  user_access_level: z.string().describe('Effective user access level for the dashboard.').nullable().optional(),
  access_control_version: z.string().describe('Dashboard access control version.').optional(),
  last_refresh: z.string().describe('Datetime when the dashboard last refreshed.').nullable().optional(),
  persisted_filters: z.looseObject({}).describe('Persisted dashboard filters.').nullable().optional(),
  persisted_variables: z.looseObject({}).describe('Persisted dashboard variables.').nullable().optional(),
  team_id: z.int().describe('Project or team ID this dashboard belongs to.').optional(),
  quick_filter_ids: z.array(z.string().describe('Quick filter ID.')).describe('Quick filter IDs associated with this dashboard.').nullable().optional(),
  tiles: z.array(z.looseObject({}).describe('Object payload accepted or returned by PostHog.')).describe('Dashboard tile payloads returned by PostHog.').nullable().optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
}).describe('PostHog dashboard with a stable top-level connector shape.')

export const moveDashboardTileInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
  tile: z.strictObject({
    id: z.int().describe('Dashboard tile ID to move.').optional(),
  }).describe('Dashboard tile to move.').optional(),
  toDashboard: z.int().describe('Dashboard ID to move the tile to.').optional(),
}).describe('Input for moving a PostHog dashboard tile.')

export const moveDashboardTileOutput = z.strictObject({
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Raw PostHog cohort endpoint payload.')

export const reorderDashboardTilesInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
  tile_order: z.array(z.int().describe('Dashboard tile ID.')).min(1).describe('Dashboard tile IDs in the desired display order.').optional(),
}).describe('Input for reordering PostHog dashboard tiles.')

export const reorderDashboardTilesOutput = z.looseObject({
  id: z.int().describe('Numeric dashboard identifier.'),
  name: z.string().describe('Dashboard name.').nullable().optional(),
  description: z.string().describe('Dashboard description.').optional(),
  pinned: z.boolean().describe('Whether the dashboard is pinned to the top of the list.').optional(),
  created_at: z.string().describe('Datetime when the dashboard was created.').optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  last_accessed_at: z.string().describe('Datetime when the dashboard was last accessed.').nullable().optional(),
  last_viewed_at: z.string().describe('Datetime when the dashboard was last viewed.').nullable().optional(),
  is_shared: z.boolean().describe('Whether the dashboard is shared.').optional(),
  deleted: z.boolean().describe('Whether the dashboard is marked as deleted.').optional(),
  creation_mode: z.string().describe('Dashboard creation mode returned by PostHog.').optional(),
  filters: z.looseObject({}).describe('Dashboard filters returned by PostHog.').nullable().optional(),
  variables: z.looseObject({}).describe('Dashboard variables returned by PostHog.').nullable().optional(),
  breakdown_colors: z.unknown().describe('Custom color mapping for breakdown values.').optional(),
  data_color_theme_id: z.number().describe('Color theme ID used for chart visualizations.').nullable().optional(),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the dashboard.').optional(),
  restriction_level: z.int().describe('Dashboard restriction level.').optional(),
  effective_restriction_level: z.int().describe('Effective restriction level for the current user.').optional(),
  effective_privilege_level: z.int().describe('Effective privilege level for the current user.').optional(),
  user_access_level: z.string().describe('Effective user access level for the dashboard.').nullable().optional(),
  access_control_version: z.string().describe('Dashboard access control version.').optional(),
  last_refresh: z.string().describe('Datetime when the dashboard last refreshed.').nullable().optional(),
  persisted_filters: z.looseObject({}).describe('Persisted dashboard filters.').nullable().optional(),
  persisted_variables: z.looseObject({}).describe('Persisted dashboard variables.').nullable().optional(),
  team_id: z.int().describe('Project or team ID this dashboard belongs to.').optional(),
  quick_filter_ids: z.array(z.string().describe('Quick filter ID.')).describe('Quick filter IDs associated with this dashboard.').nullable().optional(),
  tiles: z.array(z.looseObject({}).describe('Object payload accepted or returned by PostHog.')).describe('Dashboard tile payloads returned by PostHog.').nullable().optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
}).describe('PostHog dashboard with a stable top-level connector shape.')

export const listDashboardCollaboratorsInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  dashboard_id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
}).describe('Input for listing PostHog dashboard collaborators.')

export const listDashboardCollaboratorsOutput = z.strictObject({
  results: z.array(z.looseObject({
    id: z.string().describe('Dashboard collaborator UUID.').optional(),
    dashboard_id: z.int().describe('Dashboard identifier.').optional(),
    user: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').optional(),
    level: z.int().describe('Restriction level granted to the collaborator.').optional(),
    added_at: z.string().describe('Datetime when the collaborator was added.').optional(),
    updated_at: z.string().describe('Datetime when the collaborator was updated.').optional(),
    raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
  }).describe('PostHog dashboard collaborator.')).describe('Dashboard collaborators returned by PostHog.').optional(),
  raw: z.unknown().describe('Full raw collaborators payload returned by PostHog.').optional(),
}).describe('PostHog dashboard collaborators.')

export const addDashboardCollaboratorInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  dashboard_id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
  user_uuid: z.string().min(1).describe('User UUID to add as a collaborator.').optional(),
  level: z.int().describe('Restriction level to grant to the collaborator.').optional(),
}).describe('Input for adding a PostHog dashboard collaborator.')

export const addDashboardCollaboratorOutput = z.looseObject({
  id: z.string().describe('Dashboard collaborator UUID.').optional(),
  dashboard_id: z.int().describe('Dashboard identifier.').optional(),
  user: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').optional(),
  level: z.int().describe('Restriction level granted to the collaborator.').optional(),
  added_at: z.string().describe('Datetime when the collaborator was added.').optional(),
  updated_at: z.string().describe('Datetime when the collaborator was updated.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
}).describe('PostHog dashboard collaborator.')

export const removeDashboardCollaboratorInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  dashboard_id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
  user_uuid: z.string().min(1).describe('User UUID to remove from the dashboard collaborators.').optional(),
}).describe('Input for removing a PostHog dashboard collaborator.')

export const removeDashboardCollaboratorOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the collaborator was removed.').optional(),
  dashboard_id: z.string().describe('Dashboard identifier.').optional(),
  user_uuid: z.string().describe('Removed user UUID.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Result returned after removing a PostHog dashboard collaborator.')

export const listFeatureFlagsInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  active: z.enum(['STALE', 'false', 'true']).describe('Filter feature flags by active state.').optional(),
  created_by_id: z.string().describe('User ID that initially created the feature flag.').optional(),
  evaluation_runtime: z.enum(['both', 'client', 'server']).describe('Filter feature flags by evaluation runtime.').optional(),
  excluded_properties: z.string().describe('JSON-encoded list of feature flag keys to exclude.').optional(),
  has_evaluation_contexts: z.enum(['false', 'true']).describe('Filter feature flags by whether they have evaluation contexts.').optional(),
  limit: z.int().min(1).describe('Number of results to return per page.').optional(),
  offset: z.int().min(0).describe('Initial index from which to return the results.').optional(),
  search: z.string().describe('Search term used to match feature flag keys or names.').optional(),
  tags: z.string().describe('JSON-encoded list of feature flag tags to filter by.').optional(),
  type: z.enum(['boolean', 'experiment', 'multivariant', 'remote_config']).describe('Filter feature flags by type.').optional(),
}).describe('Input for listing PostHog feature flags.')

export const listFeatureFlagsOutput = z.strictObject({
  count: z.int().describe('Total number of results available.').optional(),
  next: z.string().describe('URL for the next page of results, or null when there is no next page.').nullable().optional(),
  previous: z.string().describe('URL for the previous page of results, or null when there is no previous page.').nullable().optional(),
  results: z.array(z.looseObject({
    id: z.int().describe('Feature flag identifier.'),
    key: z.string().describe('Feature flag key.'),
    name: z.string().describe('Feature flag description.'),
    active: z.boolean().describe('Whether the feature flag is active.'),
    deleted: z.boolean().describe('Whether the feature flag is marked as deleted.'),
    filters: z.looseObject({}).describe('Feature flag filters returned by PostHog.'),
    tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the feature flag.'),
    raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
    created_at: z.string().describe('Feature flag creation datetime.').nullable().optional(),
    updated_at: z.string().describe('Feature flag update datetime.').nullable().optional(),
    created_by: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').nullable().optional(),
    last_modified_by: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').nullable().optional(),
    version: z.number().describe('Feature flag version.').nullable().optional(),
    ensure_experience_continuity: z.boolean().describe('Whether experience continuity is enabled for the feature flag.').nullable().optional(),
    experiment_set: z.array(z.int().describe('Experiment ID.')).describe('Associated experiment IDs.').optional(),
    experiment_set_metadata: z.array(z.looseObject({}).describe('Object payload accepted or returned by PostHog.')).describe('Associated experiment metadata objects.').optional(),
    surveys: z.looseObject({}).describe('Survey metadata attached to the feature flag.').nullable().optional(),
    features: z.looseObject({}).describe('Early access feature metadata attached to the flag.').nullable().optional(),
    rollback_conditions: z.unknown().describe('Rollback conditions for the feature flag.').nullable().optional(),
    performed_rollback: z.boolean().describe('Whether a rollback has been performed.').nullable().optional(),
    can_edit: z.boolean().describe('Whether the current user can edit the feature flag.').nullable().optional(),
    status: z.string().describe('Computed feature flag status.').nullable().optional(),
    evaluation_runtime: z.string().describe('Where the feature flag is evaluated.').nullable().optional(),
    bucketing_identifier: z.string().describe('Identifier used for bucketing users.').nullable().optional(),
    last_called_at: z.string().describe('Last time the feature flag was evaluated.').nullable().optional(),
    user_access_level: z.string().describe('Effective access level for the current user.').nullable().optional(),
    rollout_percentage: z.number().describe('Feature flag rollout percentage, when present.').nullable().optional(),
    evaluation_contexts: z.array(z.string().describe('Evaluation context.')).describe('Evaluation contexts attached to the feature flag.').optional(),
    usage_dashboard: z.number().describe('Usage dashboard identifier.').nullable().optional(),
    analytics_dashboards: z.array(z.int().describe('Dashboard identifier.')).describe('Analytics dashboard identifiers attached to the feature flag.').optional(),
    has_enriched_analytics: z.boolean().describe('Whether analytics have been enriched.').nullable().optional(),
    is_remote_configuration: z.boolean().describe('Whether the flag is a remote configuration.').nullable().optional(),
    has_encrypted_payloads: z.boolean().describe('Whether the flag has encrypted payloads.').nullable().optional(),
    is_used_in_replay_settings: z.boolean().describe('Whether the flag is used in replay settings.').nullable().optional(),
  }).describe('PostHog feature flag with a stable top-level connector shape.')).describe('Feature flags returned by PostHog.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Paginated PostHog feature flag list.')

export const getFeatureFlagInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
}).describe('Input for getting a PostHog feature flag.')

export const getFeatureFlagOutput = z.looseObject({
  id: z.int().describe('Feature flag identifier.'),
  key: z.string().describe('Feature flag key.'),
  name: z.string().describe('Feature flag description.'),
  active: z.boolean().describe('Whether the feature flag is active.'),
  deleted: z.boolean().describe('Whether the feature flag is marked as deleted.'),
  filters: z.looseObject({}).describe('Feature flag filters returned by PostHog.'),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the feature flag.'),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
  created_at: z.string().describe('Feature flag creation datetime.').nullable().optional(),
  updated_at: z.string().describe('Feature flag update datetime.').nullable().optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  last_modified_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  version: z.number().describe('Feature flag version.').nullable().optional(),
  ensure_experience_continuity: z.boolean().describe('Whether experience continuity is enabled for the feature flag.').nullable().optional(),
  experiment_set: z.array(z.int().describe('Experiment ID.')).describe('Associated experiment IDs.').optional(),
  experiment_set_metadata: z.array(z.looseObject({}).describe('Object payload accepted or returned by PostHog.')).describe('Associated experiment metadata objects.').optional(),
  surveys: z.looseObject({}).describe('Survey metadata attached to the feature flag.').nullable().optional(),
  features: z.looseObject({}).describe('Early access feature metadata attached to the flag.').nullable().optional(),
  rollback_conditions: z.unknown().describe('Rollback conditions for the feature flag.').nullable().optional(),
  performed_rollback: z.boolean().describe('Whether a rollback has been performed.').nullable().optional(),
  can_edit: z.boolean().describe('Whether the current user can edit the feature flag.').nullable().optional(),
  status: z.string().describe('Computed feature flag status.').nullable().optional(),
  evaluation_runtime: z.string().describe('Where the feature flag is evaluated.').nullable().optional(),
  bucketing_identifier: z.string().describe('Identifier used for bucketing users.').nullable().optional(),
  last_called_at: z.string().describe('Last time the feature flag was evaluated.').nullable().optional(),
  user_access_level: z.string().describe('Effective access level for the current user.').nullable().optional(),
  rollout_percentage: z.number().describe('Feature flag rollout percentage, when present.').nullable().optional(),
  evaluation_contexts: z.array(z.string().describe('Evaluation context.')).describe('Evaluation contexts attached to the feature flag.').optional(),
  usage_dashboard: z.number().describe('Usage dashboard identifier.').nullable().optional(),
  analytics_dashboards: z.array(z.int().describe('Dashboard identifier.')).describe('Analytics dashboard identifiers attached to the feature flag.').optional(),
  has_enriched_analytics: z.boolean().describe('Whether analytics have been enriched.').nullable().optional(),
  is_remote_configuration: z.boolean().describe('Whether the flag is a remote configuration.').nullable().optional(),
  has_encrypted_payloads: z.boolean().describe('Whether the flag has encrypted payloads.').nullable().optional(),
  is_used_in_replay_settings: z.boolean().describe('Whether the flag is used in replay settings.').nullable().optional(),
}).describe('PostHog feature flag with a stable top-level connector shape.')

export const createFeatureFlagInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  key: z.string().describe('Feature flag key.'),
  name: z.string().describe('Feature flag description.'),
  filters: z.looseObject({}).describe('Feature flag filters returned by PostHog.').nullable().optional(),
  active: z.boolean().describe('Whether the feature flag is active.').optional(),
  tags: z.array(z.string().describe('Feature flag tag.')).describe('Tags attached to the feature flag.').optional(),
  evaluation_contexts: z.array(z.string().describe('Evaluation context.')).describe('Evaluation contexts attached to the feature flag.').optional(),
}).describe('Input for creating a PostHog feature flag.')

export const createFeatureFlagOutput = z.looseObject({
  id: z.int().describe('Feature flag identifier.'),
  key: z.string().describe('Feature flag key.'),
  name: z.string().describe('Feature flag description.'),
  active: z.boolean().describe('Whether the feature flag is active.'),
  deleted: z.boolean().describe('Whether the feature flag is marked as deleted.'),
  filters: z.looseObject({}).describe('Feature flag filters returned by PostHog.'),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the feature flag.'),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
  created_at: z.string().describe('Feature flag creation datetime.').nullable().optional(),
  updated_at: z.string().describe('Feature flag update datetime.').nullable().optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  last_modified_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  version: z.number().describe('Feature flag version.').nullable().optional(),
  ensure_experience_continuity: z.boolean().describe('Whether experience continuity is enabled for the feature flag.').nullable().optional(),
  experiment_set: z.array(z.int().describe('Experiment ID.')).describe('Associated experiment IDs.').optional(),
  experiment_set_metadata: z.array(z.looseObject({}).describe('Object payload accepted or returned by PostHog.')).describe('Associated experiment metadata objects.').optional(),
  surveys: z.looseObject({}).describe('Survey metadata attached to the feature flag.').nullable().optional(),
  features: z.looseObject({}).describe('Early access feature metadata attached to the flag.').nullable().optional(),
  rollback_conditions: z.unknown().describe('Rollback conditions for the feature flag.').nullable().optional(),
  performed_rollback: z.boolean().describe('Whether a rollback has been performed.').nullable().optional(),
  can_edit: z.boolean().describe('Whether the current user can edit the feature flag.').nullable().optional(),
  status: z.string().describe('Computed feature flag status.').nullable().optional(),
  evaluation_runtime: z.string().describe('Where the feature flag is evaluated.').nullable().optional(),
  bucketing_identifier: z.string().describe('Identifier used for bucketing users.').nullable().optional(),
  last_called_at: z.string().describe('Last time the feature flag was evaluated.').nullable().optional(),
  user_access_level: z.string().describe('Effective access level for the current user.').nullable().optional(),
  rollout_percentage: z.number().describe('Feature flag rollout percentage, when present.').nullable().optional(),
  evaluation_contexts: z.array(z.string().describe('Evaluation context.')).describe('Evaluation contexts attached to the feature flag.').optional(),
  usage_dashboard: z.number().describe('Usage dashboard identifier.').nullable().optional(),
  analytics_dashboards: z.array(z.int().describe('Dashboard identifier.')).describe('Analytics dashboard identifiers attached to the feature flag.').optional(),
  has_enriched_analytics: z.boolean().describe('Whether analytics have been enriched.').nullable().optional(),
  is_remote_configuration: z.boolean().describe('Whether the flag is a remote configuration.').nullable().optional(),
  has_encrypted_payloads: z.boolean().describe('Whether the flag has encrypted payloads.').nullable().optional(),
  is_used_in_replay_settings: z.boolean().describe('Whether the flag is used in replay settings.').nullable().optional(),
}).describe('PostHog feature flag with a stable top-level connector shape.')

export const updateFeatureFlagInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.'),
  key: z.string().describe('Feature flag key.').optional(),
  name: z.string().describe('Feature flag description.').optional(),
  filters: z.looseObject({}).describe('Feature flag filters returned by PostHog.').nullable().optional(),
  active: z.boolean().describe('Whether the feature flag is active.').optional(),
  tags: z.array(z.string().describe('Feature flag tag.')).describe('Tags attached to the feature flag.').optional(),
  evaluation_contexts: z.array(z.string().describe('Evaluation context.')).describe('Evaluation contexts attached to the feature flag.').optional(),
}).describe('Input for updating a PostHog feature flag.')

export const updateFeatureFlagOutput = z.looseObject({
  id: z.int().describe('Feature flag identifier.'),
  key: z.string().describe('Feature flag key.'),
  name: z.string().describe('Feature flag description.'),
  active: z.boolean().describe('Whether the feature flag is active.'),
  deleted: z.boolean().describe('Whether the feature flag is marked as deleted.'),
  filters: z.looseObject({}).describe('Feature flag filters returned by PostHog.'),
  tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the feature flag.'),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
  created_at: z.string().describe('Feature flag creation datetime.').nullable().optional(),
  updated_at: z.string().describe('Feature flag update datetime.').nullable().optional(),
  created_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  last_modified_by: z.looseObject({
    id: z.int().describe('Numeric user identifier.'),
    uuid: z.string().describe('User UUID.'),
    email: z.string().describe('User email address.'),
    first_name: z.string().describe('User first name.').optional(),
    last_name: z.string().describe('User last name.').optional(),
    distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
    role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
  }).describe('Basic PostHog user.').nullable().optional(),
  version: z.number().describe('Feature flag version.').nullable().optional(),
  ensure_experience_continuity: z.boolean().describe('Whether experience continuity is enabled for the feature flag.').nullable().optional(),
  experiment_set: z.array(z.int().describe('Experiment ID.')).describe('Associated experiment IDs.').optional(),
  experiment_set_metadata: z.array(z.looseObject({}).describe('Object payload accepted or returned by PostHog.')).describe('Associated experiment metadata objects.').optional(),
  surveys: z.looseObject({}).describe('Survey metadata attached to the feature flag.').nullable().optional(),
  features: z.looseObject({}).describe('Early access feature metadata attached to the flag.').nullable().optional(),
  rollback_conditions: z.unknown().describe('Rollback conditions for the feature flag.').nullable().optional(),
  performed_rollback: z.boolean().describe('Whether a rollback has been performed.').nullable().optional(),
  can_edit: z.boolean().describe('Whether the current user can edit the feature flag.').nullable().optional(),
  status: z.string().describe('Computed feature flag status.').nullable().optional(),
  evaluation_runtime: z.string().describe('Where the feature flag is evaluated.').nullable().optional(),
  bucketing_identifier: z.string().describe('Identifier used for bucketing users.').nullable().optional(),
  last_called_at: z.string().describe('Last time the feature flag was evaluated.').nullable().optional(),
  user_access_level: z.string().describe('Effective access level for the current user.').nullable().optional(),
  rollout_percentage: z.number().describe('Feature flag rollout percentage, when present.').nullable().optional(),
  evaluation_contexts: z.array(z.string().describe('Evaluation context.')).describe('Evaluation contexts attached to the feature flag.').optional(),
  usage_dashboard: z.number().describe('Usage dashboard identifier.').nullable().optional(),
  analytics_dashboards: z.array(z.int().describe('Dashboard identifier.')).describe('Analytics dashboard identifiers attached to the feature flag.').optional(),
  has_enriched_analytics: z.boolean().describe('Whether analytics have been enriched.').nullable().optional(),
  is_remote_configuration: z.boolean().describe('Whether the flag is a remote configuration.').nullable().optional(),
  has_encrypted_payloads: z.boolean().describe('Whether the flag has encrypted payloads.').nullable().optional(),
  is_used_in_replay_settings: z.boolean().describe('Whether the flag is used in replay settings.').nullable().optional(),
}).describe('PostHog feature flag with a stable top-level connector shape.')

export const deleteFeatureFlagInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
}).describe('Input for deleting a PostHog feature flag.')

export const deleteFeatureFlagOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the feature flag was marked as deleted.').optional(),
  id: z.string().describe('Deleted feature flag identifier.').optional(),
  feature_flag: z.looseObject({
    id: z.int().describe('Feature flag identifier.'),
    key: z.string().describe('Feature flag key.'),
    name: z.string().describe('Feature flag description.'),
    active: z.boolean().describe('Whether the feature flag is active.'),
    deleted: z.boolean().describe('Whether the feature flag is marked as deleted.'),
    filters: z.looseObject({}).describe('Feature flag filters returned by PostHog.'),
    tags: z.array(z.unknown().describe('Array item returned by PostHog.')).describe('Tags attached to the feature flag.'),
    raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
    created_at: z.string().describe('Feature flag creation datetime.').nullable().optional(),
    updated_at: z.string().describe('Feature flag update datetime.').nullable().optional(),
    created_by: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').nullable().optional(),
    last_modified_by: z.looseObject({
      id: z.int().describe('Numeric user identifier.'),
      uuid: z.string().describe('User UUID.'),
      email: z.string().describe('User email address.'),
      first_name: z.string().describe('User first name.').optional(),
      last_name: z.string().describe('User last name.').optional(),
      distinct_id: z.string().describe('Current distinct ID for the user.').nullable().optional(),
      role_at_organization: z.string().describe('Role declared for the user within the organization.').nullable().optional(),
    }).describe('Basic PostHog user.').nullable().optional(),
    version: z.number().describe('Feature flag version.').nullable().optional(),
    ensure_experience_continuity: z.boolean().describe('Whether experience continuity is enabled for the feature flag.').nullable().optional(),
    experiment_set: z.array(z.int().describe('Experiment ID.')).describe('Associated experiment IDs.').optional(),
    experiment_set_metadata: z.array(z.looseObject({}).describe('Object payload accepted or returned by PostHog.')).describe('Associated experiment metadata objects.').optional(),
    surveys: z.looseObject({}).describe('Survey metadata attached to the feature flag.').nullable().optional(),
    features: z.looseObject({}).describe('Early access feature metadata attached to the flag.').nullable().optional(),
    rollback_conditions: z.unknown().describe('Rollback conditions for the feature flag.').nullable().optional(),
    performed_rollback: z.boolean().describe('Whether a rollback has been performed.').nullable().optional(),
    can_edit: z.boolean().describe('Whether the current user can edit the feature flag.').nullable().optional(),
    status: z.string().describe('Computed feature flag status.').nullable().optional(),
    evaluation_runtime: z.string().describe('Where the feature flag is evaluated.').nullable().optional(),
    bucketing_identifier: z.string().describe('Identifier used for bucketing users.').nullable().optional(),
    last_called_at: z.string().describe('Last time the feature flag was evaluated.').nullable().optional(),
    user_access_level: z.string().describe('Effective access level for the current user.').nullable().optional(),
    rollout_percentage: z.number().describe('Feature flag rollout percentage, when present.').nullable().optional(),
    evaluation_contexts: z.array(z.string().describe('Evaluation context.')).describe('Evaluation contexts attached to the feature flag.').optional(),
    usage_dashboard: z.number().describe('Usage dashboard identifier.').nullable().optional(),
    analytics_dashboards: z.array(z.int().describe('Dashboard identifier.')).describe('Analytics dashboard identifiers attached to the feature flag.').optional(),
    has_enriched_analytics: z.boolean().describe('Whether analytics have been enriched.').nullable().optional(),
    is_remote_configuration: z.boolean().describe('Whether the flag is a remote configuration.').nullable().optional(),
    has_encrypted_payloads: z.boolean().describe('Whether the flag has encrypted payloads.').nullable().optional(),
    is_used_in_replay_settings: z.boolean().describe('Whether the flag is used in replay settings.').nullable().optional(),
  }).describe('PostHog feature flag with a stable top-level connector shape.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Result returned after soft deleting a PostHog feature flag.')

export const getFeatureFlagStatusInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
}).describe('Input for deleting a PostHog feature flag.')

export const getFeatureFlagStatusOutput = z.looseObject({
  status: z.string().describe('Computed feature flag status.'),
  reason: z.string().describe('Human-readable explanation of the feature flag status.'),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
  active: z.boolean().describe('Whether the feature flag is active.').nullable().optional(),
  deleted: z.boolean().describe('Whether the feature flag is deleted.').nullable().optional(),
  last_called_at: z.string().describe('Last time the feature flag was evaluated.').nullable().optional(),
  status_code: z.number().describe('HTTP status code returned by the status endpoint.').nullable().optional(),
}).describe('PostHog feature flag status response.')

export const getFeatureFlagDependentFlagsInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.').optional(),
  id: z.union([z.string().min(1).describe('String identifier accepted by the official PostHog API path.'), z.int().describe('Numeric identifier accepted by the official PostHog API path.')]).describe('Identifier accepted by the official PostHog API path.').optional(),
}).describe('Input for deleting a PostHog feature flag.')

export const getFeatureFlagDependentFlagsOutput = z.strictObject({
  results: z.array(z.looseObject({
    id: z.int().describe('Feature flag identifier.'),
    key: z.string().describe('Feature flag key.'),
    name: z.string().describe('Feature flag name.'),
  }).describe('PostHog dependent feature flag summary.')).describe('Dependent feature flags returned by PostHog.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('Dependent feature flags returned by PostHog.')

export const getFeatureFlagsLocalEvaluationInput = z.strictObject({
  project_id: z.union([z.string().min(1).describe('String project ID of the project to access.'), z.int().describe('Numeric project ID of the project to access.')]).describe('Project ID of the project to access.'),
  send_cohorts: z.boolean().describe('Whether to include cohorts in the response.').nullable().optional(),
}).describe('Input for getting the local evaluation payload for PostHog feature flags.')

export const getFeatureFlagsLocalEvaluationOutput = z.strictObject({
  flags: z.array(z.looseObject({
    id: z.int().describe('Feature flag identifier.'),
    team_id: z.int().describe('Owning team identifier.'),
    name: z.string().describe('Feature flag description.'),
    key: z.string().describe('Feature flag key.'),
    filters: z.looseObject({}).describe('Feature flag filters returned by PostHog.'),
    deleted: z.boolean().describe('Whether the feature flag is marked as deleted.'),
    active: z.boolean().describe('Whether the feature flag is active.'),
    evaluation_contexts: z.array(z.string().describe('Evaluation context.')).describe('Evaluation contexts attached to the feature flag.'),
    raw: z.looseObject({}).describe('Full raw payload returned by PostHog.'),
    ensure_experience_continuity: z.boolean().describe('Whether experience continuity is enabled for the feature flag.').nullable().optional(),
    version: z.number().describe('Feature flag version.').nullable().optional(),
    evaluation_runtime: z.string().describe('Where the feature flag is evaluated.').nullable().optional(),
    bucketing_identifier: z.string().describe('Identifier used for bucketing users.').nullable().optional(),
  }).describe('Minimal PostHog feature flag used by local evaluation.')).describe('Feature flags returned by the local evaluation endpoint.').optional(),
  group_type_mapping: z.record(z.string(), z.string().describe('Group type mapping value.')).describe('Group type mappings returned by PostHog.').optional(),
  cohorts: z.looseObject({}).describe('Cohorts returned by PostHog for local evaluation.').optional(),
  raw: z.looseObject({}).describe('Full raw payload returned by PostHog.').optional(),
}).describe('PostHog feature flag local evaluation response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const posthogActions = {
  get_current_user: {
    description: 'Get the current user associated with the PostHog personal API key.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_projects: {
    description: 'List PostHog projects for the current or specified organization.',
    effect: 'read',
    inputSchema: listProjectsInput,
    outputSchema: z.toJSONSchema(listProjectsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project: {
    description: 'Get a PostHog project from the current or specified organization.',
    effect: 'read',
    inputSchema: getProjectInput,
    outputSchema: z.toJSONSchema(getProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_event_definitions: {
    description: 'List event definitions for a PostHog project.',
    effect: 'read',
    inputSchema: listEventDefinitionsInput,
    outputSchema: z.toJSONSchema(listEventDefinitionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_event_definition: {
    description: 'Get a PostHog event definition by ID.',
    effect: 'read',
    inputSchema: getEventDefinitionInput,
    outputSchema: z.toJSONSchema(getEventDefinitionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_event_definition: {
    description: 'Create an event definition for a PostHog project.',
    effect: 'write',
    inputSchema: createEventDefinitionInput,
    outputSchema: z.toJSONSchema(createEventDefinitionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_event_definition: {
    description: 'Partially update a PostHog event definition by ID.',
    effect: 'write',
    inputSchema: updateEventDefinitionInput,
    outputSchema: z.toJSONSchema(updateEventDefinitionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_event_definition: {
    description: 'Delete a PostHog event definition by ID.',
    effect: 'destructive',
    inputSchema: deleteEventDefinitionInput,
    outputSchema: z.toJSONSchema(deleteEventDefinitionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_event_definition_by_name: {
    description: 'Get a PostHog event definition by exact event name.',
    effect: 'read',
    inputSchema: getEventDefinitionByNameInput,
    outputSchema: z.toJSONSchema(getEventDefinitionByNameOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_event_definition_primary_properties: {
    description: 'Get primary properties configured for PostHog event definitions.',
    effect: 'read',
    inputSchema: getEventDefinitionPrimaryPropertiesInput,
    outputSchema: z.toJSONSchema(getEventDefinitionPrimaryPropertiesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  bulk_update_event_definition_tags: {
    description: 'Bulk add, remove, or set tags on PostHog event definitions.',
    effect: 'write',
    inputSchema: bulkUpdateEventDefinitionTagsInput,
    outputSchema: z.toJSONSchema(bulkUpdateEventDefinitionTagsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_property_definitions: {
    description: 'List property definitions for a PostHog project.',
    effect: 'read',
    inputSchema: listPropertyDefinitionsInput,
    outputSchema: z.toJSONSchema(listPropertyDefinitionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_property_definition: {
    description: 'Get a PostHog property definition by ID.',
    effect: 'read',
    inputSchema: getPropertyDefinitionInput,
    outputSchema: z.toJSONSchema(getPropertyDefinitionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_property_definition: {
    description: 'Partially update a PostHog property definition by ID.',
    effect: 'write',
    inputSchema: updatePropertyDefinitionInput,
    outputSchema: z.toJSONSchema(updatePropertyDefinitionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_property_definition: {
    description: 'Delete a PostHog property definition by ID.',
    effect: 'destructive',
    inputSchema: deletePropertyDefinitionInput,
    outputSchema: z.toJSONSchema(deletePropertyDefinitionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  bulk_update_property_definition_tags: {
    description: 'Bulk add, remove, or set tags on PostHog property definitions.',
    effect: 'write',
    inputSchema: bulkUpdatePropertyDefinitionTagsInput,
    outputSchema: z.toJSONSchema(bulkUpdatePropertyDefinitionTagsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_annotations: {
    description: 'List annotations for a PostHog project.',
    effect: 'read',
    inputSchema: listAnnotationsInput,
    outputSchema: z.toJSONSchema(listAnnotationsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_annotation: {
    description: 'Get a PostHog annotation by ID.',
    effect: 'read',
    inputSchema: getAnnotationInput,
    outputSchema: z.toJSONSchema(getAnnotationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_annotation: {
    description: 'Create an annotation in a PostHog project.',
    effect: 'write',
    inputSchema: createAnnotationInput,
    outputSchema: z.toJSONSchema(createAnnotationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_annotation: {
    description: 'Partially update a PostHog annotation by ID.',
    effect: 'write',
    inputSchema: updateAnnotationInput,
    outputSchema: z.toJSONSchema(updateAnnotationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_annotation: {
    description: 'Mark a PostHog annotation as deleted using the official soft-delete contract.',
    effect: 'destructive',
    inputSchema: deleteAnnotationInput,
    outputSchema: z.toJSONSchema(deleteAnnotationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_cohorts: {
    description: 'List cohorts for a PostHog project.',
    effect: 'read',
    inputSchema: listCohortsInput,
    outputSchema: z.toJSONSchema(listCohortsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_cohort: {
    description: 'Get a PostHog cohort by ID.',
    effect: 'read',
    inputSchema: getCohortInput,
    outputSchema: z.toJSONSchema(getCohortOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_cohort: {
    description: 'Create a cohort in a PostHog project.',
    effect: 'write',
    inputSchema: createCohortInput,
    outputSchema: z.toJSONSchema(createCohortOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_cohort: {
    description: 'Partially update a PostHog cohort by ID.',
    effect: 'write',
    inputSchema: updateCohortInput,
    outputSchema: z.toJSONSchema(updateCohortOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_cohort: {
    description: 'Mark a PostHog cohort as deleted using the official soft-delete contract.',
    effect: 'destructive',
    inputSchema: deleteCohortInput,
    outputSchema: z.toJSONSchema(deleteCohortOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_persons_to_static_cohort: {
    description: 'Add person UUIDs to a static PostHog cohort.',
    effect: 'write',
    inputSchema: addPersonsToStaticCohortInput,
    outputSchema: z.toJSONSchema(addPersonsToStaticCohortOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_cohort_persons: {
    description: 'List persons that belong to a PostHog cohort.',
    effect: 'read',
    inputSchema: getCohortPersonsInput,
    outputSchema: z.toJSONSchema(getCohortPersonsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_cohort_calculation_history: {
    description: 'Get the raw calculation history payload for a PostHog cohort.',
    effect: 'read',
    inputSchema: getCohortCalculationHistoryInput,
    outputSchema: z.toJSONSchema(getCohortCalculationHistoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_insights: {
    description: 'List insights for a PostHog project.',
    effect: 'read',
    inputSchema: listInsightsInput,
    outputSchema: z.toJSONSchema(listInsightsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_insight: {
    description: 'Get a PostHog insight by ID with a stable top-level connector shape.',
    effect: 'read',
    inputSchema: getInsightInput,
    outputSchema: z.toJSONSchema(getInsightOutput, { io: 'output', unrepresentable: 'any' }),
  },
  run_query: {
    description: 'Run a PostHog query and return a stable top-level query result shape.',
    effect: 'write',
    inputSchema: runQueryInput,
    outputSchema: z.toJSONSchema(runQueryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_async_query_status: {
    description: 'Retrieve the status and available result payload for a PostHog async query.',
    effect: 'read',
    inputSchema: getAsyncQueryStatusInput,
    outputSchema: z.toJSONSchema(getAsyncQueryStatusOutput, { io: 'output', unrepresentable: 'any' }),
  },
  cancel_query: {
    description: 'Cancel a PostHog async query by project ID and query ID.',
    effect: 'destructive',
    inputSchema: cancelQueryInput,
    outputSchema: z.toJSONSchema(cancelQueryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_insight: {
    description: 'Create a saved PostHog insight in a project.',
    effect: 'write',
    inputSchema: createInsightInput,
    outputSchema: z.toJSONSchema(createInsightOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_insight: {
    description: 'Update a saved PostHog insight by ID.',
    effect: 'write',
    inputSchema: updateInsightInput,
    outputSchema: z.toJSONSchema(updateInsightOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_insight: {
    description: 'Delete a saved PostHog insight by ID.',
    effect: 'destructive',
    inputSchema: deleteInsightInput,
    outputSchema: z.toJSONSchema(deleteInsightOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_dashboards: {
    description: 'List dashboards for a PostHog project.',
    effect: 'read',
    inputSchema: listDashboardsInput,
    outputSchema: z.toJSONSchema(listDashboardsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_dashboard: {
    description: 'Get a PostHog dashboard by ID with a stable top-level connector shape.',
    effect: 'read',
    inputSchema: getDashboardInput,
    outputSchema: z.toJSONSchema(getDashboardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_dashboard: {
    description: 'Create a PostHog dashboard in a project.',
    effect: 'write',
    inputSchema: createDashboardInput,
    outputSchema: z.toJSONSchema(createDashboardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_dashboard: {
    description: 'Partially update a PostHog dashboard by ID.',
    effect: 'write',
    inputSchema: updateDashboardInput,
    outputSchema: z.toJSONSchema(updateDashboardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_dashboard: {
    description: 'Mark a PostHog dashboard as deleted using the official soft-delete contract.',
    effect: 'destructive',
    inputSchema: deleteDashboardInput,
    outputSchema: z.toJSONSchema(deleteDashboardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  run_dashboard_insights: {
    description: 'Run all insights on a PostHog dashboard and return their results.',
    effect: 'write',
    inputSchema: runDashboardInsightsInput,
    outputSchema: z.toJSONSchema(runDashboardInsightsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  copy_dashboard_tile: {
    description: 'Copy an existing PostHog dashboard tile to another dashboard.',
    effect: 'write',
    inputSchema: copyDashboardTileInput,
    outputSchema: z.toJSONSchema(copyDashboardTileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  move_dashboard_tile: {
    description: 'Move a PostHog dashboard tile to another dashboard.',
    effect: 'write',
    inputSchema: moveDashboardTileInput,
    outputSchema: z.toJSONSchema(moveDashboardTileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  reorder_dashboard_tiles: {
    description: 'Reorder tiles on a PostHog dashboard.',
    effect: 'write',
    inputSchema: reorderDashboardTilesInput,
    outputSchema: z.toJSONSchema(reorderDashboardTilesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_dashboard_collaborators: {
    description: 'List collaborators for a PostHog dashboard.',
    effect: 'read',
    inputSchema: listDashboardCollaboratorsInput,
    outputSchema: z.toJSONSchema(listDashboardCollaboratorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_dashboard_collaborator: {
    description: 'Add a collaborator to a PostHog dashboard.',
    effect: 'write',
    inputSchema: addDashboardCollaboratorInput,
    outputSchema: z.toJSONSchema(addDashboardCollaboratorOutput, { io: 'output', unrepresentable: 'any' }),
  },
  remove_dashboard_collaborator: {
    description: 'Remove a collaborator from a PostHog dashboard.',
    effect: 'destructive',
    inputSchema: removeDashboardCollaboratorInput,
    outputSchema: z.toJSONSchema(removeDashboardCollaboratorOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_feature_flags: {
    description: 'List feature flags for a PostHog project.',
    effect: 'read',
    inputSchema: listFeatureFlagsInput,
    outputSchema: z.toJSONSchema(listFeatureFlagsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_feature_flag: {
    description: 'Get a PostHog feature flag by ID.',
    effect: 'read',
    inputSchema: getFeatureFlagInput,
    outputSchema: z.toJSONSchema(getFeatureFlagOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_feature_flag: {
    description: 'Create a feature flag in a PostHog project.',
    effect: 'write',
    inputSchema: createFeatureFlagInput,
    outputSchema: z.toJSONSchema(createFeatureFlagOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_feature_flag: {
    description: 'Partially update a PostHog feature flag by ID.',
    effect: 'write',
    inputSchema: updateFeatureFlagInput,
    outputSchema: z.toJSONSchema(updateFeatureFlagOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_feature_flag: {
    description: 'Soft delete a PostHog feature flag by setting deleted to true.',
    effect: 'destructive',
    inputSchema: deleteFeatureFlagInput,
    outputSchema: z.toJSONSchema(deleteFeatureFlagOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_feature_flag_status: {
    description: 'Get the computed status for a PostHog feature flag.',
    effect: 'read',
    inputSchema: getFeatureFlagStatusInput,
    outputSchema: z.toJSONSchema(getFeatureFlagStatusOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_feature_flag_dependent_flags: {
    description: 'List the feature flags that depend on a PostHog feature flag.',
    effect: 'read',
    inputSchema: getFeatureFlagDependentFlagsInput,
    outputSchema: z.toJSONSchema(getFeatureFlagDependentFlagsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_feature_flags_local_evaluation: {
    description: 'Get the local evaluation payload for PostHog feature flags.',
    effect: 'read',
    inputSchema: getFeatureFlagsLocalEvaluationInput,
    outputSchema: z.toJSONSchema(getFeatureFlagsLocalEvaluationOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
