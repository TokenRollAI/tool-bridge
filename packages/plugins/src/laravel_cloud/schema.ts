/**
 * Laravel Cloud 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getOrganizationInput = z.strictObject({}).describe('The input payload for getting the Laravel Cloud organization.')

export const getOrganizationOutput = z.strictObject({
  organization: z.strictObject({
    id: z.string().describe('The organization identifier.').optional(),
    type: z.string().describe('The JSON:API resource type.').optional(),
    name: z.string().describe('The organization name.').nullable().optional(),
    slug: z.string().describe('The organization slug.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw organization resource returned by Laravel Cloud.').optional(),
  }).describe('A Laravel Cloud organization.').optional(),
}).describe('The response returned when getting the Laravel Cloud organization.')

export const listRegionsInput = z.strictObject({}).describe('The input payload for listing Laravel Cloud regions.')

export const listRegionsOutput = z.strictObject({
  regions: z.array(z.strictObject({
    region: z.string().describe('The region identifier.').optional(),
    label: z.string().describe('The human-readable region label.').optional(),
    flag: z.string().describe('The region flag returned by Laravel Cloud.').optional(),
    raw: z.looseObject({}).describe('The raw region object returned by Laravel Cloud.').optional(),
  }).describe('A Laravel Cloud region.')).describe('The regions returned by Laravel Cloud.').optional(),
}).describe('The response returned when listing Laravel Cloud regions.')

export const listApplicationsInput = z.strictObject({
  name: z.string().min(1).describe('Filter applications by name.').optional(),
  region: z.string().min(1).describe('Filter applications by region identifier.').optional(),
  slug: z.string().min(1).describe('Filter applications by slug.').optional(),
  include: z.array(z.enum(['organization', 'environments', 'defaultEnvironment']).describe('One Laravel Cloud include relationship.')).min(1).describe('Related application resources to include.').optional(),
}).describe('The input payload for listing Laravel Cloud applications.')

export const listApplicationsOutput = z.strictObject({
  applications: z.array(z.strictObject({
    id: z.string().describe('The application identifier.').optional(),
    type: z.string().describe('The JSON:API resource type.').optional(),
    name: z.string().describe('The application name.').nullable().optional(),
    slug: z.string().describe('The application slug.').nullable().optional(),
    region: z.string().describe('The application region identifier.').nullable().optional(),
    slackChannel: z.string().describe('The Slack channel configured for the application.').nullable().optional(),
    avatarUrl: z.string().describe('The application avatar URL.').nullable().optional(),
    createdAt: z.string().describe('The timestamp when the application was created.').nullable().optional(),
    repository: z.looseObject({}).describe('The repository summary embedded in the application attributes.').nullable().optional(),
    relationships: z.looseObject({}).describe('The relationships object returned by Laravel Cloud.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw application resource returned by Laravel Cloud.').optional(),
  }).describe('A Laravel Cloud application.')).describe('The applications returned by Laravel Cloud.').optional(),
  links: z.looseObject({}).describe('The links object returned by Laravel Cloud.').nullable().optional(),
  meta: z.looseObject({}).describe('The pagination metadata returned by Laravel Cloud for list endpoints.').nullable().optional(),
  included: z.array(z.looseObject({}).describe('One included JSON:API resource.')).describe('The included JSON:API resources returned by Laravel Cloud.').nullable().optional(),
}).describe('The response returned when listing Laravel Cloud applications.')

export const getApplicationInput = z.strictObject({
  applicationId: z.string().min(1).describe('The Laravel Cloud application identifier.'),
  include: z.array(z.enum(['organization', 'environments', 'defaultEnvironment']).describe('One Laravel Cloud include relationship.')).min(1).describe('Related application resources to include.').optional(),
}).describe('The input payload for getting a Laravel Cloud application.')

export const getApplicationOutput = z.strictObject({
  application: z.strictObject({
    id: z.string().describe('The application identifier.').optional(),
    type: z.string().describe('The JSON:API resource type.').optional(),
    name: z.string().describe('The application name.').nullable().optional(),
    slug: z.string().describe('The application slug.').nullable().optional(),
    region: z.string().describe('The application region identifier.').nullable().optional(),
    slackChannel: z.string().describe('The Slack channel configured for the application.').nullable().optional(),
    avatarUrl: z.string().describe('The application avatar URL.').nullable().optional(),
    createdAt: z.string().describe('The timestamp when the application was created.').nullable().optional(),
    repository: z.looseObject({}).describe('The repository summary embedded in the application attributes.').nullable().optional(),
    relationships: z.looseObject({}).describe('The relationships object returned by Laravel Cloud.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw application resource returned by Laravel Cloud.').optional(),
  }).describe('A Laravel Cloud application.').optional(),
  included: z.array(z.looseObject({}).describe('One included JSON:API resource.')).describe('The included JSON:API resources returned by Laravel Cloud.').nullable().optional(),
}).describe('The response returned when getting a Laravel Cloud application.')

export const listEnvironmentsInput = z.strictObject({
  applicationId: z.string().min(1).describe('The Laravel Cloud application identifier.'),
  name: z.string().min(1).describe('Filter environments by name.').optional(),
  status: z.string().min(1).describe('Filter environments by status.').optional(),
  slug: z.string().min(1).describe('Filter environments by slug.').optional(),
  include: z.array(z.enum(['application', 'branch', 'deployments', 'currentDeployment', 'primaryDomain', 'instances', 'database', 'cache', 'buckets', 'websocketApplication']).describe('One Laravel Cloud include relationship.')).min(1).describe('Related environment resources to include.').optional(),
}).describe('The input payload for listing Laravel Cloud environments.')

export const listEnvironmentsOutput = z.strictObject({
  environments: z.array(z.strictObject({
    id: z.string().describe('The environment identifier.').optional(),
    type: z.string().describe('The JSON:API resource type.').optional(),
    name: z.string().describe('The environment name.').nullable().optional(),
    slug: z.string().describe('The environment slug.').nullable().optional(),
    status: z.string().describe('The environment status.').nullable().optional(),
    vanityDomain: z.string().describe('The environment vanity domain.').nullable().optional(),
    phpMajorVersion: z.string().describe('The configured PHP major version.').nullable().optional(),
    nodeVersion: z.string().describe('The configured Node.js version.').nullable().optional(),
    buildCommand: z.string().describe('The build command when configured.').nullable().optional(),
    deployCommand: z.string().describe('The deploy command when configured.').nullable().optional(),
    usesOctane: z.boolean().describe('Whether the environment uses Laravel Octane.').nullable().optional(),
    usesPushToDeploy: z.boolean().describe('Whether push-to-deploy is enabled for the environment.').nullable().optional(),
    usesDeployHook: z.boolean().describe('Whether deploy hooks are enabled for the environment.').nullable().optional(),
    createdAt: z.string().describe('The timestamp when the environment was created.').nullable().optional(),
    relationships: z.looseObject({}).describe('The relationships object returned by Laravel Cloud.').nullable().optional(),
    links: z.looseObject({}).describe('The links object returned by Laravel Cloud.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw environment resource returned by Laravel Cloud.').optional(),
  }).describe('A Laravel Cloud environment.')).describe('The environments returned by Laravel Cloud.').optional(),
  links: z.looseObject({}).describe('The links object returned by Laravel Cloud.').nullable().optional(),
  meta: z.looseObject({}).describe('The pagination metadata returned by Laravel Cloud for list endpoints.').nullable().optional(),
  included: z.array(z.looseObject({}).describe('One included JSON:API resource.')).describe('The included JSON:API resources returned by Laravel Cloud.').nullable().optional(),
}).describe('The response returned when listing Laravel Cloud environments.')

export const getEnvironmentInput = z.strictObject({
  environmentId: z.string().min(1).describe('The Laravel Cloud environment identifier.'),
  include: z.array(z.enum(['application', 'branch', 'deployments', 'currentDeployment', 'primaryDomain', 'instances', 'database', 'cache', 'buckets', 'websocketApplication']).describe('One Laravel Cloud include relationship.')).min(1).describe('Related environment resources to include.').optional(),
}).describe('The input payload for getting a Laravel Cloud environment.')

export const getEnvironmentOutput = z.strictObject({
  environment: z.strictObject({
    id: z.string().describe('The environment identifier.').optional(),
    type: z.string().describe('The JSON:API resource type.').optional(),
    name: z.string().describe('The environment name.').nullable().optional(),
    slug: z.string().describe('The environment slug.').nullable().optional(),
    status: z.string().describe('The environment status.').nullable().optional(),
    vanityDomain: z.string().describe('The environment vanity domain.').nullable().optional(),
    phpMajorVersion: z.string().describe('The configured PHP major version.').nullable().optional(),
    nodeVersion: z.string().describe('The configured Node.js version.').nullable().optional(),
    buildCommand: z.string().describe('The build command when configured.').nullable().optional(),
    deployCommand: z.string().describe('The deploy command when configured.').nullable().optional(),
    usesOctane: z.boolean().describe('Whether the environment uses Laravel Octane.').nullable().optional(),
    usesPushToDeploy: z.boolean().describe('Whether push-to-deploy is enabled for the environment.').nullable().optional(),
    usesDeployHook: z.boolean().describe('Whether deploy hooks are enabled for the environment.').nullable().optional(),
    createdAt: z.string().describe('The timestamp when the environment was created.').nullable().optional(),
    relationships: z.looseObject({}).describe('The relationships object returned by Laravel Cloud.').nullable().optional(),
    links: z.looseObject({}).describe('The links object returned by Laravel Cloud.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw environment resource returned by Laravel Cloud.').optional(),
  }).describe('A Laravel Cloud environment.').optional(),
  included: z.array(z.looseObject({}).describe('One included JSON:API resource.')).describe('The included JSON:API resources returned by Laravel Cloud.').nullable().optional(),
}).describe('The response returned when getting a Laravel Cloud environment.')

export const listDeploymentsInput = z.strictObject({
  environmentId: z.string().min(1).describe('The Laravel Cloud environment identifier.'),
  status: z.string().min(1).describe('Filter deployments by status.').optional(),
  branchName: z.string().min(1).describe('Filter deployments by branch name.').optional(),
  commitHash: z.string().min(1).describe('Filter deployments by commit hash.').optional(),
  include: z.array(z.enum(['environment', 'initiator']).describe('One Laravel Cloud include relationship.')).min(1).describe('Related deployment resources to include.').optional(),
}).describe('The input payload for listing Laravel Cloud deployments.')

export const listDeploymentsOutput = z.strictObject({
  deployments: z.array(z.strictObject({
    id: z.string().describe('The deployment identifier.').optional(),
    type: z.string().describe('The JSON:API resource type.').optional(),
    status: z.string().describe('The deployment status.').nullable().optional(),
    branchName: z.string().describe('The deployed branch name.').nullable().optional(),
    commitHash: z.string().describe('The deployed commit hash.').nullable().optional(),
    commitMessage: z.string().describe('The deployed commit message.').nullable().optional(),
    commitAuthor: z.string().describe('The deployed commit author.').nullable().optional(),
    failureReason: z.string().describe('The deployment failure reason when available.').nullable().optional(),
    phpMajorVersion: z.string().describe('The PHP major version used for the deployment.').nullable().optional(),
    buildCommand: z.string().describe('The build command used for the deployment.').nullable().optional(),
    nodeVersion: z.string().describe('The Node.js version used for the deployment.').nullable().optional(),
    usesOctane: z.boolean().describe('Whether the deployment uses Laravel Octane.').nullable().optional(),
    startedAt: z.string().describe('The timestamp when the deployment started.').nullable().optional(),
    finishedAt: z.string().describe('The timestamp when the deployment finished.').nullable().optional(),
    relationships: z.looseObject({}).describe('The relationships object returned by Laravel Cloud.').nullable().optional(),
    links: z.looseObject({}).describe('The links object returned by Laravel Cloud.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw deployment resource returned by Laravel Cloud.').optional(),
  }).describe('A Laravel Cloud deployment.')).describe('The deployments returned by Laravel Cloud.').optional(),
  links: z.looseObject({}).describe('The links object returned by Laravel Cloud.').nullable().optional(),
  meta: z.looseObject({}).describe('The pagination metadata returned by Laravel Cloud for list endpoints.').nullable().optional(),
  included: z.array(z.looseObject({}).describe('One included JSON:API resource.')).describe('The included JSON:API resources returned by Laravel Cloud.').nullable().optional(),
}).describe('The response returned when listing Laravel Cloud deployments.')

export const getDeploymentInput = z.strictObject({
  deploymentId: z.string().min(1).describe('The Laravel Cloud deployment identifier.'),
  include: z.array(z.enum(['environment', 'initiator']).describe('One Laravel Cloud include relationship.')).min(1).describe('Related deployment resources to include.').optional(),
}).describe('The input payload for getting a Laravel Cloud deployment.')

export const getDeploymentOutput = z.strictObject({
  deployment: z.strictObject({
    id: z.string().describe('The deployment identifier.').optional(),
    type: z.string().describe('The JSON:API resource type.').optional(),
    status: z.string().describe('The deployment status.').nullable().optional(),
    branchName: z.string().describe('The deployed branch name.').nullable().optional(),
    commitHash: z.string().describe('The deployed commit hash.').nullable().optional(),
    commitMessage: z.string().describe('The deployed commit message.').nullable().optional(),
    commitAuthor: z.string().describe('The deployed commit author.').nullable().optional(),
    failureReason: z.string().describe('The deployment failure reason when available.').nullable().optional(),
    phpMajorVersion: z.string().describe('The PHP major version used for the deployment.').nullable().optional(),
    buildCommand: z.string().describe('The build command used for the deployment.').nullable().optional(),
    nodeVersion: z.string().describe('The Node.js version used for the deployment.').nullable().optional(),
    usesOctane: z.boolean().describe('Whether the deployment uses Laravel Octane.').nullable().optional(),
    startedAt: z.string().describe('The timestamp when the deployment started.').nullable().optional(),
    finishedAt: z.string().describe('The timestamp when the deployment finished.').nullable().optional(),
    relationships: z.looseObject({}).describe('The relationships object returned by Laravel Cloud.').nullable().optional(),
    links: z.looseObject({}).describe('The links object returned by Laravel Cloud.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw deployment resource returned by Laravel Cloud.').optional(),
  }).describe('A Laravel Cloud deployment.').optional(),
  included: z.array(z.looseObject({}).describe('One included JSON:API resource.')).describe('The included JSON:API resources returned by Laravel Cloud.').nullable().optional(),
}).describe('The response returned when getting a Laravel Cloud deployment.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const laravelCloudActions = {
  get_organization: {
    description: 'Get the Laravel Cloud organization associated with the API token.',
    effect: 'read',
    inputSchema: getOrganizationInput,
    outputSchema: z.toJSONSchema(getOrganizationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_regions: {
    description: 'List cloud regions currently available in Laravel Cloud.',
    effect: 'read',
    inputSchema: listRegionsInput,
    outputSchema: z.toJSONSchema(listRegionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_applications: {
    description: 'List Laravel Cloud applications for the authenticated organization.',
    effect: 'read',
    inputSchema: listApplicationsInput,
    outputSchema: z.toJSONSchema(listApplicationsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_application: {
    description: 'Get a specific Laravel Cloud application.',
    effect: 'read',
    inputSchema: getApplicationInput,
    outputSchema: z.toJSONSchema(getApplicationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_environments: {
    description: 'List Laravel Cloud environments for an application.',
    effect: 'read',
    inputSchema: listEnvironmentsInput,
    outputSchema: z.toJSONSchema(listEnvironmentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_environment: {
    description: 'Get a specific Laravel Cloud environment.',
    effect: 'read',
    inputSchema: getEnvironmentInput,
    outputSchema: z.toJSONSchema(getEnvironmentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_deployments: {
    description: 'List Laravel Cloud deployments for an environment.',
    effect: 'read',
    inputSchema: listDeploymentsInput,
    outputSchema: z.toJSONSchema(listDeploymentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_deployment: {
    description: 'Get a specific Laravel Cloud deployment.',
    effect: 'read',
    inputSchema: getDeploymentInput,
    outputSchema: z.toJSONSchema(getDeploymentOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
