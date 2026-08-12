/**
 * CircleCI 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrentUserInput = z.strictObject({}).describe('No input is required.')

export const getCurrentUserOutput = z.looseObject({
  avatar_url: z.string().describe('URL to the user\'s avatar on the VCS.').nullable().optional(),
  id: z.string().min(1).describe('The unique ID of the user.').optional(),
  login: z.string().min(1).describe('The VCS login of the current user.').optional(),
  name: z.string().min(1).describe('The display name of the current user.').optional(),
}).describe('CircleCI user.')

export const getProjectInput = z.strictObject({
  projectSlug: z.string().min(1).describe('Project slug in the form `vcs-slug/org-name/repo-name`. GitHub App and GitLab projects may use an opaque CircleCI slug such as `circleci/<org-id>/<project-id>`.'),
}).describe('Input for getting a project.')

export const getProjectOutput = z.looseObject({
  slug: z.string().min(1).describe('Project slug in the form `vcs-slug/org-name/repo-name`. GitHub App and GitLab projects may use an opaque CircleCI slug such as `circleci/<org-id>/<project-id>`.').optional(),
  name: z.string().min(1).describe('The project name.').optional(),
  id: z.string().min(1).describe('The unique ID of the project.').optional(),
  organization_name: z.string().describe('The organization name that owns the project.').optional(),
  organization_slug: z.string().describe('The organization slug that owns the project.').optional(),
  organization_id: z.string().describe('The unique ID of the organization.').optional(),
  vcs_info: z.looseObject({}).describe('Version control information for the project.').optional(),
}).describe('CircleCI project.')

export const listPipelinesForProjectInput = z.strictObject({
  projectSlug: z.string().min(1).describe('Project slug in the form `vcs-slug/org-name/repo-name`. GitHub App and GitLab projects may use an opaque CircleCI slug such as `circleci/<org-id>/<project-id>`.'),
  branch: z.string().min(1).describe('The VCS branch name.').optional(),
  pageToken: z.string().min(1).describe('Pagination token returned by CircleCI.').optional(),
}).describe('Input for listing project pipelines.')

export const listPipelinesForProjectOutput = z.strictObject({
  items: z.array(z.looseObject({
    id: z.string().min(1).describe('The unique ID of the CircleCI pipeline.').optional(),
    errors: z.array(z.looseObject({}).describe('CircleCI pipeline error.')).describe('Errors attached to the pipeline.').optional(),
    project_slug: z.string().min(1).describe('Project slug in the form `vcs-slug/org-name/repo-name`. GitHub App and GitLab projects may use an opaque CircleCI slug such as `circleci/<org-id>/<project-id>`.').optional(),
    updated_at: z.iso.datetime({ offset: true }).describe('The time when the pipeline was last updated.').optional(),
    number: z.int().describe('The pipeline number.').optional(),
    state: z.enum(['created', 'errored', 'setup-pending', 'setup', 'pending']).describe('The current pipeline state reported by CircleCI.').optional(),
    created_at: z.iso.datetime({ offset: true }).describe('The time when the pipeline was created.').optional(),
    trigger: z.looseObject({}).describe('Trigger metadata for the pipeline.').optional(),
    vcs: z.looseObject({}).describe('Version control metadata for the pipeline.').optional(),
  }).describe('CircleCI pipeline.')).describe('The pipelines returned by CircleCI.').optional(),
  next_page_token: z.string().describe('Pagination token for the next page, or null when there is no next page.').nullable().optional(),
}).describe('Paginated CircleCI pipeline list.')

export const getPipelineInput = z.strictObject({
  pipelineId: z.string().min(1).describe('The unique ID of the CircleCI pipeline.'),
}).describe('Input for getting a pipeline.')

export const getPipelineOutput = z.looseObject({
  id: z.string().min(1).describe('The unique ID of the CircleCI pipeline.').optional(),
  errors: z.array(z.looseObject({}).describe('CircleCI pipeline error.')).describe('Errors attached to the pipeline.').optional(),
  project_slug: z.string().min(1).describe('Project slug in the form `vcs-slug/org-name/repo-name`. GitHub App and GitLab projects may use an opaque CircleCI slug such as `circleci/<org-id>/<project-id>`.').optional(),
  updated_at: z.iso.datetime({ offset: true }).describe('The time when the pipeline was last updated.').optional(),
  number: z.int().describe('The pipeline number.').optional(),
  state: z.enum(['created', 'errored', 'setup-pending', 'setup', 'pending']).describe('The current pipeline state reported by CircleCI.').optional(),
  created_at: z.iso.datetime({ offset: true }).describe('The time when the pipeline was created.').optional(),
  trigger: z.looseObject({}).describe('Trigger metadata for the pipeline.').optional(),
  vcs: z.looseObject({}).describe('Version control metadata for the pipeline.').optional(),
}).describe('CircleCI pipeline.')

export const listWorkflowsByPipelineInput = z.strictObject({
  pipelineId: z.string().min(1).describe('The unique ID of the CircleCI pipeline.'),
  pageToken: z.string().min(1).describe('Pagination token returned by CircleCI.').optional(),
}).describe('Input for listing pipeline workflows.')

export const listWorkflowsByPipelineOutput = z.strictObject({
  items: z.array(z.looseObject({
    pipeline_id: z.string().min(1).describe('The unique ID of the CircleCI pipeline.').optional(),
    id: z.string().min(1).describe('The unique ID of the workflow.').optional(),
    name: z.string().min(1).describe('The workflow name.').optional(),
    project_slug: z.string().min(1).describe('Project slug in the form `vcs-slug/org-name/repo-name`. GitHub App and GitLab projects may use an opaque CircleCI slug such as `circleci/<org-id>/<project-id>`.').optional(),
    status: z.enum(['success', 'canceled', 'error', 'failed', 'failing', 'not_run', 'on_hold', 'running', 'unauthorized']).describe('The current workflow status reported by CircleCI.').optional(),
    started_by: z.string().min(1).describe('The user ID that started the workflow.').optional(),
    pipeline_number: z.int().describe('The pipeline number that owns the workflow.').optional(),
    created_at: z.iso.datetime({ offset: true }).describe('The time when the workflow was created.').optional(),
    stopped_at: z.string().describe('The time when the workflow stopped, or null.').nullable().optional(),
  }).describe('CircleCI workflow.')).describe('The workflows returned by CircleCI.').optional(),
  next_page_token: z.string().describe('Pagination token for the next page, or null when there is no next page.').nullable().optional(),
}).describe('Paginated CircleCI workflow list.')

export const getWorkflowSummaryInput = z.strictObject({
  projectSlug: z.string().min(1).describe('Project slug in the form `vcs-slug/org-name/repo-name`. GitHub App and GitLab projects may use an opaque CircleCI slug such as `circleci/<org-id>/<project-id>`.'),
  workflowName: z.string().min(1).describe('The CircleCI workflow name.'),
  allBranches: z.boolean().describe('Whether to aggregate across all branches.').optional(),
  branch: z.string().min(1).describe('The VCS branch name.').optional(),
}).describe('Input for getting a workflow insights summary. Do not provide both allBranches and branch.')

export const getWorkflowSummaryOutput = z.looseObject({
  metrics: z.looseObject({}).describe('Aggregated workflow metrics.').optional(),
  trends: z.looseObject({}).describe('Workflow trend metrics.').optional(),
  workflow_names: z.array(z.string().min(1)).describe('Workflow names available for the project.').optional(),
}).describe('CircleCI workflow summary.')

export const getJobDetailsInput = z.strictObject({
  projectSlug: z.string().min(1).describe('Project slug in the form `vcs-slug/org-name/repo-name`. GitHub App and GitLab projects may use an opaque CircleCI slug such as `circleci/<org-id>/<project-id>`.'),
  jobNumber: z.int().min(1).describe('The CircleCI job number.'),
}).describe('Input for getting job details.')

export const getJobDetailsOutput = z.looseObject({
  web_url: z.url().describe('URL of the job in the CircleCI web UI.').optional(),
  project: z.looseObject({}).describe('Project information for the job.').optional(),
  parallel_runs: z.array(z.looseObject({}).describe('Parallel run information.')).describe('Parallel run statuses for the job.').optional(),
  started_at: z.iso.datetime({ offset: true }).describe('The time when the job started.').optional(),
  latest_workflow: z.looseObject({}).describe('The latest workflow that included the job.').optional(),
  name: z.string().min(1).describe('The CircleCI job name.').optional(),
  executor: z.looseObject({}).describe('Executor information for the job.').optional(),
  parallelism: z.int().describe('The number of parallel runs.').optional(),
  status: z.enum(['success', 'running', 'not_run', 'failed', 'retried', 'queued', 'not_running', 'infrastructure_fail', 'timedout', 'on_hold', 'terminated-unknown', 'blocked', 'canceled', 'unauthorized']).describe('The current job status reported by CircleCI.').optional(),
  number: z.int().describe('The CircleCI job number.').optional(),
  pipeline: z.looseObject({}).describe('Pipeline information for the job.').optional(),
}).describe('CircleCI job details.')

export const getJobArtifactsInput = z.strictObject({
  projectSlug: z.string().min(1).describe('Project slug in the form `vcs-slug/org-name/repo-name`. GitHub App and GitLab projects may use an opaque CircleCI slug such as `circleci/<org-id>/<project-id>`.'),
  jobNumber: z.int().min(1).describe('The CircleCI job number.'),
}).describe('Input for listing job artifacts.')

export const getJobArtifactsOutput = z.strictObject({
  items: z.array(z.looseObject({
    path: z.string().min(1).describe('The artifact path.').optional(),
    node_index: z.int().describe('The node index that stored the artifact.').optional(),
    url: z.url().describe('The artifact download URL.').optional(),
  }).describe('CircleCI artifact.')).describe('Artifacts returned by CircleCI.').optional(),
  next_page_token: z.string().describe('Pagination token for the next page, or null when there is no next page.').nullable().optional(),
}).describe('Paginated CircleCI artifact list.')

export const listInsightsSummaryInput = z.strictObject({
  orgSlug: z.string().min(1).describe('Organization slug in the form `vcs-slug/org-name`.'),
  reportingWindow: z.enum(['last-7-days', 'last-24-hours', 'last-30-days', 'last-60-days', 'last-90-days']).describe('The reporting window used by CircleCI Insights.').optional(),
}).describe('Input for listing organization insights summary.')

export const listInsightsSummaryOutput = z.looseObject({
  org_data: z.looseObject({}).describe('Organization-level summary data.').optional(),
  org_project_data: z.array(z.looseObject({}).describe('Project summary data.')).describe('Project summary data across the organization.').optional(),
  all_projects: z.array(z.string().min(1)).describe('All project names available in the organization.').nullable().optional(),
}).describe('CircleCI Insights organization summary.')

export const triggerPipelineInput = z.strictObject({
  projectSlug: z.string().min(1).describe('Project slug in the form `vcs-slug/org-name/repo-name`. GitHub App and GitLab projects may use an opaque CircleCI slug such as `circleci/<org-id>/<project-id>`.'),
  branch: z.string().min(1).describe('The VCS branch name.').optional(),
  tag: z.string().min(1).describe('The VCS tag name.').optional(),
  parameters: z.record(z.string(), z.union([z.string().describe('A string parameter value.'), z.number().describe('A numeric parameter value.'), z.boolean().describe('A boolean parameter value.')])).describe('Pipeline parameters declared in `.circleci/config.yml`.').optional(),
}).describe('Input for triggering a pipeline. Provide either branch or tag, not both.')

export const triggerPipelineOutput = z.looseObject({
  id: z.string().min(1).describe('The unique ID of the CircleCI pipeline.').optional(),
  state: z.enum(['created', 'errored', 'setup-pending', 'setup', 'pending']).describe('The current pipeline state reported by CircleCI.').optional(),
  number: z.int().describe('The pipeline number.').optional(),
  created_at: z.iso.datetime({ offset: true }).describe('The time when the pipeline was created.').optional(),
}).describe('CircleCI pipeline creation response.')

export const listProjectEnvVarsInput = z.strictObject({
  projectSlug: z.string().min(1).describe('Project slug in the form `vcs-slug/org-name/repo-name`. GitHub App and GitLab projects may use an opaque CircleCI slug such as `circleci/<org-id>/<project-id>`.'),
}).describe('Input for listing project environment variables.')

export const listProjectEnvVarsOutput = z.strictObject({
  items: z.array(z.looseObject({
    'name': z.string().min(1).describe('The environment variable name.').optional(),
    'value': z.string().describe('The masked environment variable value returned by CircleCI.').optional(),
    'created-at': z.string().describe('The creation timestamp payload returned by CircleCI, when present.').optional(),
  }).describe('CircleCI environment variable.')).describe('Environment variables returned by CircleCI.').optional(),
  next_page_token: z.string().describe('Pagination token for the next page, or null when there is no next page.').nullable().optional(),
}).describe('Paginated CircleCI environment variable list.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const circleciActions = {
  get_current_user: {
    description: 'Get the currently authenticated CircleCI user profile.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project: {
    description: 'Get CircleCI project details by project slug.',
    effect: 'read',
    inputSchema: getProjectInput,
    outputSchema: z.toJSONSchema(getProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_pipelines_for_project: {
    description: 'List CircleCI pipelines for a project.',
    effect: 'read',
    inputSchema: listPipelinesForProjectInput,
    outputSchema: z.toJSONSchema(listPipelinesForProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_pipeline: {
    description: 'Get a CircleCI pipeline by pipeline ID.',
    effect: 'read',
    inputSchema: getPipelineInput,
    outputSchema: z.toJSONSchema(getPipelineOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_workflows_by_pipeline: {
    description: 'List workflows for a CircleCI pipeline.',
    effect: 'read',
    inputSchema: listWorkflowsByPipelineInput,
    outputSchema: z.toJSONSchema(listWorkflowsByPipelineOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_workflow_summary: {
    description: 'Get CircleCI Insights summary metrics for a workflow.',
    effect: 'read',
    inputSchema: getWorkflowSummaryInput,
    outputSchema: z.toJSONSchema(getWorkflowSummaryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_job_details: {
    description: 'Get CircleCI job details by project slug and job number.',
    effect: 'read',
    inputSchema: getJobDetailsInput,
    outputSchema: z.toJSONSchema(getJobDetailsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_job_artifacts: {
    description: 'List artifacts for a CircleCI job.',
    effect: 'read',
    inputSchema: getJobArtifactsInput,
    outputSchema: z.toJSONSchema(getJobArtifactsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_insights_summary: {
    description: 'Get CircleCI Insights summary metrics for an organization.',
    effect: 'read',
    inputSchema: listInsightsSummaryInput,
    outputSchema: z.toJSONSchema(listInsightsSummaryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  trigger_pipeline: {
    description: 'Trigger a new CircleCI pipeline for a project.',
    effect: 'write',
    inputSchema: triggerPipelineInput,
    outputSchema: z.toJSONSchema(triggerPipelineOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_project_env_vars: {
    description: 'List masked CircleCI environment variables for a project.',
    effect: 'read',
    inputSchema: listProjectEnvVarsInput,
    outputSchema: z.toJSONSchema(listProjectEnvVarsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
