/**
 * Render 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrentUserInput = z.strictObject({}).describe('Action input.')

export const getCurrentUserOutput = z.strictObject({
  email: z.email().describe('Email address of the authenticated Render user.').optional(),
  name: z.string().describe('Display name of the authenticated Render user.').optional(),
}).describe('Render user.')

export const listWorkspacesInput = z.strictObject({
  name: z.array(z.string().min(1)).min(1).describe('Only return resources with one of these exact names.').optional(),
  email: z.array(z.email().describe('Workspace owner email.')).min(1).describe('Only return workspaces owned by one of these email addresses.').optional(),
  cursor: z.string().min(1).describe('Pagination cursor returned by a previous Render response.').optional(),
  limit: z.int().min(1).max(100).describe('Maximum number of results to return.').optional(),
})

export const listWorkspacesOutput = z.strictObject({
  workspaces: z.array(z.looseObject({
    id: z.string().describe('Unique identifier of the workspace.').optional(),
    name: z.string().describe('Workspace display name.').optional(),
    email: z.email().describe('Primary email address of the workspace.').optional(),
    type: z.enum(['user', 'team']).describe('Workspace type.').optional(),
    ipAllowList: z.array(z.looseObject({}).describe('Object returned by Render.')).describe('IP allow list entries configured for the workspace, when present.').optional(),
    twoFactorAuthEnabled: z.boolean().describe('Whether two-factor authentication is enabled for the workspace owner.').optional(),
  }).describe('Render workspace.')).describe('Workspaces returned by Render.').optional(),
  nextCursor: z.string().describe('Cursor for the next page of workspaces, or null when there is no next page.').nullable().optional(),
}).describe('Paginated Render workspace list.')

export const listServicesInput = z.strictObject({
  name: z.array(z.string().min(1)).min(1).describe('Only return resources with one of these exact names.').optional(),
  type: z.array(z.enum(['static_site', 'web_service', 'private_service', 'background_worker', 'cron_job']).describe('Type of service on Render.')).min(1).describe('Only return services with these types.').optional(),
  ownerId: z.array(z.string().min(1)).min(1).describe('Only return resources for one of these workspace IDs.').optional(),
  suspended: z.array(z.enum(['suspended', 'not_suspended']).describe('Suspension state reported by Render.')).min(1).describe('Only return services in one of these suspension states.').optional(),
  includePreviews: z.boolean().describe('Whether preview services should be included in the response.').optional(),
  cursor: z.string().min(1).describe('Pagination cursor returned by a previous Render response.').optional(),
  limit: z.int().min(1).max(100).describe('Maximum number of results to return.').optional(),
})

export const listServicesOutput = z.strictObject({
  services: z.array(z.looseObject({
    id: z.string().describe('Unique identifier of the service.').optional(),
    name: z.string().describe('Name of the service.').optional(),
    ownerId: z.string().describe('Workspace ID that owns the service.').optional(),
    type: z.enum(['static_site', 'web_service', 'private_service', 'background_worker', 'cron_job']).describe('Type of service on Render.').optional(),
    createdAt: z.string().describe('Timestamp in ISO 8601 format.').optional(),
    dashboardUrl: z.string().describe('Dashboard URL for the service.').optional(),
    updatedAt: z.string().describe('Timestamp in ISO 8601 format.').optional(),
    suspended: z.enum(['suspended', 'not_suspended']).describe('Suspension state reported by Render.').optional(),
    suspenders: z.array(z.enum(['admin', 'billing', 'user', 'parent_service', 'stuck_crashlooping', 'hipaa_enablement', 'unknown']).describe('Reason why the service is suspended.')).describe('Suspension reasons reported for the service.').optional(),
    autoDeploy: z.enum(['yes', 'no']).describe('Whether Render auto-deploys changes for the service.').optional(),
    notifyOnFail: z.enum(['default', 'notify', 'ignore']).describe('Notification setting when a deploy fails.').optional(),
    slug: z.string().describe('URL-friendly slug of the service.').optional(),
    serviceDetails: z.looseObject({}).describe('Object returned by Render.').optional(),
    rootDir: z.string().describe('Repository root directory configured for the service.').optional(),
    branch: z.string().describe('Git branch used by the service, when present.').optional(),
    buildFilter: z.looseObject({}).describe('Object returned by Render.').optional(),
    environmentId: z.string().describe('Environment ID attached to the service, when present.').optional(),
    imagePath: z.string().describe('Docker image path used by the service, when present.').optional(),
    registryCredential: z.looseObject({}).describe('Object returned by Render.').optional(),
    repo: z.string().describe('Source repository URL for the service, when present.').optional(),
  }).describe('Render service.')).describe('Services returned by Render.').optional(),
  nextCursor: z.string().describe('Cursor for the next page of services, or null when there is no next page.').nullable().optional(),
}).describe('Paginated Render service list.')

export const getServiceInput = z.strictObject({
  serviceId: z.string().min(1).describe('The unique identifier of the Render service.').optional(),
})

export const getServiceOutput = z.looseObject({
  id: z.string().describe('Unique identifier of the service.').optional(),
  name: z.string().describe('Name of the service.').optional(),
  ownerId: z.string().describe('Workspace ID that owns the service.').optional(),
  type: z.enum(['static_site', 'web_service', 'private_service', 'background_worker', 'cron_job']).describe('Type of service on Render.').optional(),
  createdAt: z.string().describe('Timestamp in ISO 8601 format.').optional(),
  dashboardUrl: z.string().describe('Dashboard URL for the service.').optional(),
  updatedAt: z.string().describe('Timestamp in ISO 8601 format.').optional(),
  suspended: z.enum(['suspended', 'not_suspended']).describe('Suspension state reported by Render.').optional(),
  suspenders: z.array(z.enum(['admin', 'billing', 'user', 'parent_service', 'stuck_crashlooping', 'hipaa_enablement', 'unknown']).describe('Reason why the service is suspended.')).describe('Suspension reasons reported for the service.').optional(),
  autoDeploy: z.enum(['yes', 'no']).describe('Whether Render auto-deploys changes for the service.').optional(),
  notifyOnFail: z.enum(['default', 'notify', 'ignore']).describe('Notification setting when a deploy fails.').optional(),
  slug: z.string().describe('URL-friendly slug of the service.').optional(),
  serviceDetails: z.looseObject({}).describe('Object returned by Render.').optional(),
  rootDir: z.string().describe('Repository root directory configured for the service.').optional(),
  branch: z.string().describe('Git branch used by the service, when present.').optional(),
  buildFilter: z.looseObject({}).describe('Object returned by Render.').optional(),
  environmentId: z.string().describe('Environment ID attached to the service, when present.').optional(),
  imagePath: z.string().describe('Docker image path used by the service, when present.').optional(),
  registryCredential: z.looseObject({}).describe('Object returned by Render.').optional(),
  repo: z.string().describe('Source repository URL for the service, when present.').optional(),
}).describe('Render service.')

export const listDeploysInput = z.strictObject({
  serviceId: z.string().min(1).describe('The unique identifier of the Render service.'),
  status: z.array(z.enum(['created', 'queued', 'build_in_progress', 'update_in_progress', 'live', 'deactivated', 'build_failed', 'update_failed', 'canceled', 'pre_deploy_in_progress', 'pre_deploy_failed']).describe('Deploy status reported by Render.')).min(1).describe('Only return deploys with these statuses.').optional(),
  cursor: z.string().min(1).describe('Pagination cursor returned by a previous Render response.').optional(),
  limit: z.int().min(1).max(100).describe('Maximum number of results to return.').optional(),
})

export const listDeploysOutput = z.strictObject({
  deploys: z.array(z.looseObject({
    id: z.string().describe('Unique identifier of the deploy.').optional(),
    commit: z.looseObject({}).describe('Object returned by Render.').optional(),
    image: z.looseObject({}).describe('Object returned by Render.').optional(),
    status: z.enum(['created', 'queued', 'build_in_progress', 'update_in_progress', 'live', 'deactivated', 'build_failed', 'update_failed', 'canceled', 'pre_deploy_in_progress', 'pre_deploy_failed']).describe('Deploy status reported by Render.').optional(),
    trigger: z.string().describe('Event that triggered the deploy.').optional(),
    startedAt: z.string().describe('Timestamp in ISO 8601 format.').optional(),
    finishedAt: z.string().describe('Timestamp in ISO 8601 format.').optional(),
    createdAt: z.string().describe('Timestamp in ISO 8601 format.').optional(),
    updatedAt: z.string().describe('Timestamp in ISO 8601 format.').optional(),
  }).describe('Render deploy.')).describe('Deploys returned by Render.').optional(),
  nextCursor: z.string().describe('Cursor for the next page of deploys, or null when there is no next page.').nullable().optional(),
}).describe('Paginated Render deploy list.')

export const triggerDeployInput = z.strictObject({
  serviceId: z.string().min(1).describe('The unique identifier of the Render service.'),
  clearCache: z.boolean().describe('Whether Render should clear the build cache before deploying.').optional(),
  commitId: z.string().min(1).describe('Specific Git commit SHA to deploy instead of the latest commit.').optional(),
  imageUrl: z.string().min(1).describe('Image URL to deploy for an image-backed service.').optional(),
  deployMode: z.enum(['deploy_only', 'build_and_deploy']).describe('Deployment behavior to use when triggering a deploy.').optional(),
}).describe('Input for triggering a Render deploy. deployMode cannot be combined with commitId, imageUrl, or clearCache.')

export const triggerDeployOutput = z.union([z.looseObject({
  id: z.string().describe('Unique identifier of the deploy.').optional(),
  commit: z.looseObject({}).describe('Object returned by Render.').optional(),
  image: z.looseObject({}).describe('Object returned by Render.').optional(),
  status: z.enum(['created', 'queued', 'build_in_progress', 'update_in_progress', 'live', 'deactivated', 'build_failed', 'update_failed', 'canceled', 'pre_deploy_in_progress', 'pre_deploy_failed']).describe('Deploy status reported by Render.').optional(),
  trigger: z.string().describe('Event that triggered the deploy.').optional(),
  startedAt: z.string().describe('Timestamp in ISO 8601 format.').optional(),
  finishedAt: z.string().describe('Timestamp in ISO 8601 format.').optional(),
  createdAt: z.string().describe('Timestamp in ISO 8601 format.').optional(),
  updatedAt: z.string().describe('Timestamp in ISO 8601 format.').optional(),
}).describe('Render deploy.'), z.strictObject({
  queued: z.boolean().describe('Whether the deploy request was accepted and queued.').optional(),
  serviceId: z.string().min(1).describe('The unique identifier of the Render service.').optional(),
}).describe('Acknowledgement for a queued Render deploy request.')])

export const rollbackDeployInput = z.strictObject({
  serviceId: z.string().min(1).describe('The unique identifier of the Render service.').optional(),
  deployId: z.string().min(1).describe('The unique identifier of the Render deploy.').optional(),
})

export const rollbackDeployOutput = z.looseObject({
  id: z.string().describe('Unique identifier of the deploy.').optional(),
  commit: z.looseObject({}).describe('Object returned by Render.').optional(),
  image: z.looseObject({}).describe('Object returned by Render.').optional(),
  status: z.enum(['created', 'queued', 'build_in_progress', 'update_in_progress', 'live', 'deactivated', 'build_failed', 'update_failed', 'canceled', 'pre_deploy_in_progress', 'pre_deploy_failed']).describe('Deploy status reported by Render.').optional(),
  trigger: z.string().describe('Event that triggered the deploy.').optional(),
  startedAt: z.string().describe('Timestamp in ISO 8601 format.').optional(),
  finishedAt: z.string().describe('Timestamp in ISO 8601 format.').optional(),
  createdAt: z.string().describe('Timestamp in ISO 8601 format.').optional(),
  updatedAt: z.string().describe('Timestamp in ISO 8601 format.').optional(),
}).describe('Render deploy.')

export const restartServiceInput = z.strictObject({
  serviceId: z.string().min(1).describe('The unique identifier of the Render service.').optional(),
})

export const restartServiceOutput = z.strictObject({
  ok: z.boolean().describe('Whether the lifecycle operation request was accepted.').optional(),
  serviceId: z.string().min(1).describe('The unique identifier of the Render service.').optional(),
  action: z.enum(['restart', 'suspend', 'resume']).describe('Lifecycle action requested.').optional(),
}).describe('Acknowledgement for a Render lifecycle operation.')

export const suspendServiceInput = z.strictObject({
  serviceId: z.string().min(1).describe('The unique identifier of the Render service.').optional(),
})

export const suspendServiceOutput = z.strictObject({
  ok: z.boolean().describe('Whether the lifecycle operation request was accepted.').optional(),
  serviceId: z.string().min(1).describe('The unique identifier of the Render service.').optional(),
  action: z.enum(['restart', 'suspend', 'resume']).describe('Lifecycle action requested.').optional(),
}).describe('Acknowledgement for a Render lifecycle operation.')

export const resumeServiceInput = z.strictObject({
  serviceId: z.string().min(1).describe('The unique identifier of the Render service.').optional(),
})

export const resumeServiceOutput = z.strictObject({
  ok: z.boolean().describe('Whether the lifecycle operation request was accepted.').optional(),
  serviceId: z.string().min(1).describe('The unique identifier of the Render service.').optional(),
  action: z.enum(['restart', 'suspend', 'resume']).describe('Lifecycle action requested.').optional(),
}).describe('Acknowledgement for a Render lifecycle operation.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const renderActions = {
  get_current_user: {
    description: 'Get the currently authenticated Render user profile.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_workspaces: {
    description: 'List Render workspaces available to the authenticated API key.',
    effect: 'read',
    inputSchema: listWorkspacesInput,
    outputSchema: z.toJSONSchema(listWorkspacesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_services: {
    description: 'List Render services with optional workspace, type, and suspension filters.',
    effect: 'read',
    inputSchema: listServicesInput,
    outputSchema: z.toJSONSchema(listServicesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_service: {
    description: 'Get Render service details by service ID.',
    effect: 'read',
    inputSchema: getServiceInput,
    outputSchema: z.toJSONSchema(getServiceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_deploys: {
    description: 'List recent Render deploys for a service.',
    effect: 'read',
    inputSchema: listDeploysInput,
    outputSchema: z.toJSONSchema(listDeploysOutput, { io: 'output', unrepresentable: 'any' }),
  },
  trigger_deploy: {
    description: 'Trigger a new deploy for a Render service.',
    effect: 'write',
    inputSchema: triggerDeployInput,
    outputSchema: z.toJSONSchema(triggerDeployOutput, { io: 'output', unrepresentable: 'any' }),
  },
  rollback_deploy: {
    description: 'Trigger a rollback to a previous deploy for a Render service.',
    effect: 'write',
    inputSchema: rollbackDeployInput,
    outputSchema: z.toJSONSchema(rollbackDeployOutput, { io: 'output', unrepresentable: 'any' }),
  },
  restart_service: {
    description: 'Restart a Render service.',
    effect: 'write',
    inputSchema: restartServiceInput,
    outputSchema: z.toJSONSchema(restartServiceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  suspend_service: {
    description: 'Suspend a Render service.',
    effect: 'write',
    inputSchema: suspendServiceInput,
    outputSchema: z.toJSONSchema(suspendServiceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  resume_service: {
    description: 'Resume a suspended Render service.',
    effect: 'write',
    inputSchema: resumeServiceInput,
    outputSchema: z.toJSONSchema(resumeServiceOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
