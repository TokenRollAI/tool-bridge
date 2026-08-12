/**
 * Railway 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listProjectsInput = z.strictObject({}).describe('Input for listing Railway projects.')

export const listProjectsOutput = z.strictObject({
  projects: z.array(z.strictObject({
    id: z.string().min(1).describe('Railway project ID.'),
    name: z.string().min(1).describe('Project name.'),
    description: z.string().describe('Project description.').nullable().optional(),
    createdAt: z.iso.datetime({ offset: true }).describe('When the project was created.').optional(),
    updatedAt: z.iso.datetime({ offset: true }).describe('When the project was last updated.').optional(),
  }).describe('A Railway project.')).describe('Railway projects.').optional(),
}).describe('Railway projects available to the token.')

export const getProjectInput = z.strictObject({
  projectId: z.string().min(1).describe('Railway project ID.').optional(),
}).describe('Input for retrieving a Railway project.')

export const getProjectOutput = z.strictObject({
  project: z.strictObject({
    id: z.string().min(1).describe('Railway project ID.'),
    name: z.string().min(1).describe('Project name.'),
    description: z.string().describe('Project description.').nullable().optional(),
    createdAt: z.iso.datetime({ offset: true }).describe('When the project was created.').optional(),
    services: z.array(z.strictObject({
      id: z.string().min(1).describe('Railway service ID.'),
      name: z.string().min(1).describe('Service name.'),
      icon: z.string().describe('Service icon URL or identifier.').nullable().optional(),
    }).describe('A Railway service.')).describe('Services in the project.'),
    environments: z.array(z.strictObject({
      id: z.string().min(1).describe('Railway environment ID.').optional(),
      name: z.string().min(1).describe('Environment name.').optional(),
    }).describe('A Railway environment.')).describe('Environments in the project.'),
  }).describe('Railway project details.').optional(),
}).describe('A Railway project with related resources.')

export const getServiceInstanceInput = z.strictObject({
  serviceId: z.string().min(1).describe('Railway service ID.').optional(),
  environmentId: z.string().min(1).describe('Railway environment ID.').optional(),
}).describe('Input for retrieving a Railway service instance.')

export const getServiceInstanceOutput = z.strictObject({
  serviceInstance: z.looseObject({
    id: z.string().min(1).describe('Railway service instance ID.'),
    serviceName: z.string().min(1).describe('Service name.'),
    startCommand: z.string().describe('Configured start command.').nullable().optional(),
    buildCommand: z.string().describe('Configured build command.').nullable().optional(),
    rootDirectory: z.string().describe('Configured repository root directory.').nullable().optional(),
    healthcheckPath: z.string().describe('Configured health check path.').nullable().optional(),
    region: z.string().describe('Deployment region.').nullable().optional(),
    numReplicas: z.int().describe('Configured replica count.').nullable().optional(),
    restartPolicyType: z.string().describe('Restart policy type.').nullable().optional(),
    restartPolicyMaxRetries: z.int().describe('Maximum restart attempts.').nullable().optional(),
    latestDeployment: z.strictObject({
      id: z.string().min(1).describe('Railway deployment ID.'),
      status: z.string().min(1).describe('Current Railway deployment status.'),
      createdAt: z.iso.datetime({ offset: true }).describe('When the deployment was created.').optional(),
      url: z.string().describe('Deployment URL.').nullable().optional(),
      staticUrl: z.string().describe('Static deployment URL.').nullable().optional(),
    }).describe('A Railway deployment.').nullable().optional(),
  }).describe('A Railway service instance.').optional(),
}).describe('Railway service instance configuration.')

export const listDeploymentsInput = z.strictObject({
  projectId: z.string().min(1).describe('Railway project ID.'),
  serviceId: z.string().min(1).describe('Railway service ID.'),
  environmentId: z.string().min(1).describe('Railway environment ID.'),
  limit: z.int().min(1).max(100).default(20).describe('Maximum number of deployments to return.').optional(),
}).describe('Filters for Railway deployments.')

export const listDeploymentsOutput = z.strictObject({
  deployments: z.array(z.strictObject({
    id: z.string().min(1).describe('Railway deployment ID.'),
    status: z.string().min(1).describe('Current Railway deployment status.'),
    createdAt: z.iso.datetime({ offset: true }).describe('When the deployment was created.').optional(),
    url: z.string().describe('Deployment URL.').nullable().optional(),
    staticUrl: z.string().describe('Static deployment URL.').nullable().optional(),
  }).describe('A Railway deployment.')).describe('Railway deployments ordered by the provider.').optional(),
}).describe('Recent Railway deployments.')

export const getDeploymentInput = z.strictObject({
  deploymentId: z.string().min(1).describe('Railway deployment ID.').optional(),
}).describe('Input for retrieving a Railway deployment.')

export const getDeploymentOutput = z.strictObject({
  deployment: z.strictObject({
    id: z.string().min(1).describe('Railway deployment ID.'),
    status: z.string().min(1).describe('Current Railway deployment status.'),
    createdAt: z.iso.datetime({ offset: true }).describe('When the deployment was created.').optional(),
    url: z.string().describe('Deployment URL.').nullable().optional(),
    staticUrl: z.string().describe('Static deployment URL.').nullable().optional(),
    canRedeploy: z.boolean().describe('Whether Railway allows this deployment to be redeployed.').optional(),
    canRollback: z.boolean().describe('Whether Railway allows a rollback to this deployment.').optional(),
    meta: z.looseObject({}).describe('Provider-defined deployment metadata.').nullable().optional(),
  }).describe('Detailed Railway deployment information.').optional(),
}).describe('A Railway deployment.')

export const getDeploymentLogsInput = z.strictObject({
  deploymentId: z.string().min(1).describe('Railway deployment ID.'),
  limit: z.int().min(1).max(5000).default(500).describe('Maximum number of log entries to return.').optional(),
  filter: z.string().min(1).describe('Railway log filter expression.').optional(),
  startDate: z.iso.datetime({ offset: true }).describe('Start of the log time range.').optional(),
  endDate: z.iso.datetime({ offset: true }).describe('End of the log time range.').optional(),
}).describe('Filters for Railway deployment logs.')

export const getDeploymentLogsOutput = z.strictObject({
  logs: z.array(z.strictObject({
    timestamp: z.string().min(1).describe('Provider timestamp for the log entry.'),
    message: z.string().describe('Log message.'),
    severity: z.string().describe('Log severity.').nullable().optional(),
  }).describe('A Railway runtime log entry.')).describe('Railway runtime log entries.').optional(),
}).describe('Runtime log entries for a Railway deployment.')

export const deployServiceInput = z.strictObject({
  serviceId: z.string().min(1).describe('Railway service ID.'),
  environmentId: z.string().min(1).describe('Railway environment ID.'),
  commitSha: z.string().min(1).describe('Commit SHA from the repository connected to the Railway service.').optional(),
}).describe('Input for deploying a Railway service.')

export const deployServiceOutput = z.strictObject({
  deploymentId: z.string().min(1).describe('Railway deployment ID.').optional(),
}).describe('The triggered Railway deployment.')

export const upsertVariableInput = z.strictObject({
  projectId: z.string().min(1).describe('Railway project ID.'),
  serviceId: z.string().min(1).describe('Railway service ID.').optional(),
  environmentId: z.string().min(1).describe('Railway environment ID.'),
  name: z.string().min(1).max(255).regex(new RegExp('^[A-Za-z_][A-Za-z0-9_]*$')).describe('Variable name.'),
  value: z.string().describe('Variable value. This may contain a Railway variable reference.'),
  skipDeploys: z.boolean().describe('Do not automatically redeploy after updating the variable.').optional(),
}).describe('Input for creating or updating a Railway variable.')

export const upsertVariableOutput = z.strictObject({
  updated: z.boolean().describe('Whether Railway accepted the variable update.').optional(),
}).describe('Result of updating a Railway variable.')

export const rollbackDeploymentInput = z.strictObject({
  deploymentId: z.string().min(1).describe('Rollback-capable Railway deployment ID.').optional(),
}).describe('Input for rolling back a Railway deployment.')

export const rollbackDeploymentOutput = z.strictObject({
  deployment: z.strictObject({
    id: z.string().min(1).describe('Railway deployment ID.'),
    status: z.string().min(1).describe('Current Railway deployment status.'),
    createdAt: z.iso.datetime({ offset: true }).describe('When the deployment was created.').optional(),
    url: z.string().describe('Deployment URL.').nullable().optional(),
    staticUrl: z.string().describe('Static deployment URL.').nullable().optional(),
  }).describe('A Railway deployment.').optional(),
}).describe('The Railway deployment created by the rollback.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const railwayActions = {
  list_projects: {
    description: 'List Railway projects available to the configured account or workspace token.',
    effect: 'read',
    inputSchema: listProjectsInput,
    outputSchema: z.toJSONSchema(listProjectsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project: {
    description: 'Get a Railway project together with its services and environments.',
    effect: 'read',
    inputSchema: getProjectInput,
    outputSchema: z.toJSONSchema(getProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_service_instance: {
    description: 'Get Railway service configuration and its latest deployment in one environment.',
    effect: 'read',
    inputSchema: getServiceInstanceInput,
    outputSchema: z.toJSONSchema(getServiceInstanceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_deployments: {
    description: 'List recent Railway deployments for a service and environment.',
    effect: 'read',
    inputSchema: listDeploymentsInput,
    outputSchema: z.toJSONSchema(listDeploymentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_deployment: {
    description: 'Get one Railway deployment and its redeploy and rollback capabilities.',
    effect: 'read',
    inputSchema: getDeploymentInput,
    outputSchema: z.toJSONSchema(getDeploymentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_deployment_logs: {
    description: 'Read runtime logs for a Railway deployment with optional text and time filters.',
    effect: 'read',
    inputSchema: getDeploymentLogsInput,
    outputSchema: z.toJSONSchema(getDeploymentLogsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  deploy_service: {
    description: 'Trigger a Railway deployment for a service, optionally at a specific connected-repository commit.',
    effect: 'write',
    inputSchema: deployServiceInput,
    outputSchema: z.toJSONSchema(deployServiceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  upsert_variable: {
    description: 'Create or update one Railway variable for an environment or service.',
    effect: 'write',
    inputSchema: upsertVariableInput,
    outputSchema: z.toJSONSchema(upsertVariableOutput, { io: 'output', unrepresentable: 'any' }),
  },
  rollback_deployment: {
    description: 'Roll a Railway service back to a deployment that Railway marks as rollback-capable.',
    effect: 'write',
    inputSchema: rollbackDeploymentInput,
    outputSchema: z.toJSONSchema(rollbackDeploymentOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
