/**
 * Vercel 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getAuthUserInput = z.strictObject({}).describe('Vercel action input.')

export const getAuthUserOutput = z.strictObject({
  user: z.strictObject({
    id: z.string().describe('Vercel user ID.').optional(),
    username: z.string().describe('Vercel username.').optional(),
    email: z.string().describe('Vercel account email address.').optional(),
    name: z.string().describe('Vercel display name.').optional(),
  }).describe('Vercel user.'),
})

export const listTeamsInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('Maximum number of results to return.').optional(),
  since: z.int().describe('Pagination cursor for results created after this timestamp.').optional(),
}).describe('Vercel action input.')

export const listTeamsOutput = z.strictObject({
  teams: z.array(z.looseObject({
    id: z.string().describe('Vercel team ID.').optional(),
    slug: z.string().describe('Vercel team slug.').optional(),
    name: z.string().describe('Vercel team display name.').optional(),
    createdAt: z.number().describe('Team creation timestamp in milliseconds.').optional(),
    updatedAt: z.number().describe('Last team update timestamp in milliseconds.').optional(),
  }).describe('Vercel team.')).describe('Vercel teams available to the authenticated user.').optional(),
  pagination: z.looseObject({
    count: z.number().describe('Number of items returned in this page.').optional(),
    next: z.number().describe('Pagination cursor for the next page, or null when there is no next page.').nullable().optional(),
    prev: z.number().describe('Pagination cursor for the previous page, or null when there is no previous page.').nullable().optional(),
  }).describe('Vercel pagination information.').optional(),
})

export const getTeamInput = z.strictObject({
  teamId: z.string().min(1).describe('Vercel team ID or team slug.'),
}).describe('Vercel action input.')

export const getTeamOutput = z.strictObject({
  team: z.looseObject({
    id: z.string().describe('Vercel team ID.').optional(),
    slug: z.string().describe('Vercel team slug.').optional(),
    name: z.string().describe('Vercel team display name.').optional(),
    createdAt: z.number().describe('Team creation timestamp in milliseconds.').optional(),
    updatedAt: z.number().describe('Last team update timestamp in milliseconds.').optional(),
  }).describe('Vercel team.'),
})

export const listProjectsInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('Maximum number of results to return.').optional(),
  since: z.int().describe('Pagination cursor for results created after this timestamp.').optional(),
  until: z.int().describe('Pagination cursor for results created before this timestamp.').optional(),
  repoUrl: z.url().describe('Repository URL used to filter projects.').optional(),
}).describe('Vercel action input.')

export const listProjectsOutput = z.strictObject({
  projects: z.array(z.strictObject({
    id: z.string().describe('Vercel project ID.'),
    name: z.string().describe('Vercel project name.'),
    accountId: z.string().describe('Owning account ID for the project.').optional(),
    framework: z.string().describe('Detected framework for the project.').optional(),
    nodeVersion: z.string().describe('Configured Node.js version for the project.').optional(),
    createdAt: z.number().describe('Project creation timestamp in milliseconds.').optional(),
    updatedAt: z.number().describe('Last project update timestamp in milliseconds.').optional(),
    link: z.looseObject({}).describe('Raw object payload returned by Vercel.').optional(),
    latestDeployments: z.array(z.looseObject({
      id: z.string().describe('Vercel deployment ID.').optional(),
      name: z.string().describe('Deployment name.').optional(),
      url: z.string().describe('Deployment URL.').optional(),
      state: z.string().describe('Deployment state reported by Vercel.').optional(),
      readyState: z.string().describe('Deployment readiness state reported by Vercel.').optional(),
      target: z.string().describe('Deployment target such as production or preview.').optional(),
      createdAt: z.number().describe('Deployment creation timestamp in milliseconds.').optional(),
      ready: z.number().describe('Deployment ready timestamp in milliseconds.').optional(),
      projectId: z.string().describe('Vercel project ID for the deployment.').optional(),
      creator: z.looseObject({}).describe('Raw object payload returned by Vercel.').optional(),
      meta: z.looseObject({}).describe('Raw object payload returned by Vercel.').optional(),
      alias: z.array(z.string()).describe('Aliases currently assigned to the deployment.').optional(),
    }).describe('Vercel deployment summary.')).describe('Most recent deployments attached to the project.').optional(),
  }).describe('Vercel project.')).describe('Vercel projects.').optional(),
  pagination: z.looseObject({
    count: z.number().describe('Number of items returned in this page.').optional(),
    next: z.number().describe('Pagination cursor for the next page, or null when there is no next page.').nullable().optional(),
    prev: z.number().describe('Pagination cursor for the previous page, or null when there is no previous page.').nullable().optional(),
  }).describe('Vercel pagination information.').optional(),
})

export const getProjectInput = z.strictObject({
  idOrName: z.string().min(1).describe('Vercel project ID or project name.'),
}).describe('Vercel action input.')

export const getProjectOutput = z.strictObject({
  project: z.strictObject({
    id: z.string().describe('Vercel project ID.'),
    name: z.string().describe('Vercel project name.'),
    accountId: z.string().describe('Owning account ID for the project.').optional(),
    framework: z.string().describe('Detected framework for the project.').optional(),
    nodeVersion: z.string().describe('Configured Node.js version for the project.').optional(),
    createdAt: z.number().describe('Project creation timestamp in milliseconds.').optional(),
    updatedAt: z.number().describe('Last project update timestamp in milliseconds.').optional(),
    link: z.looseObject({}).describe('Raw object payload returned by Vercel.').optional(),
    latestDeployments: z.array(z.looseObject({
      id: z.string().describe('Vercel deployment ID.').optional(),
      name: z.string().describe('Deployment name.').optional(),
      url: z.string().describe('Deployment URL.').optional(),
      state: z.string().describe('Deployment state reported by Vercel.').optional(),
      readyState: z.string().describe('Deployment readiness state reported by Vercel.').optional(),
      target: z.string().describe('Deployment target such as production or preview.').optional(),
      createdAt: z.number().describe('Deployment creation timestamp in milliseconds.').optional(),
      ready: z.number().describe('Deployment ready timestamp in milliseconds.').optional(),
      projectId: z.string().describe('Vercel project ID for the deployment.').optional(),
      creator: z.looseObject({}).describe('Raw object payload returned by Vercel.').optional(),
      meta: z.looseObject({}).describe('Raw object payload returned by Vercel.').optional(),
      alias: z.array(z.string()).describe('Aliases currently assigned to the deployment.').optional(),
    }).describe('Vercel deployment summary.')).describe('Most recent deployments attached to the project.').optional(),
  }).describe('Vercel project.'),
})

export const createProjectInput = z.strictObject({
  name: z.string().min(1).describe('Vercel project name.'),
  framework: z.string().min(1).describe('Framework to set on the project.').optional(),
  rootDirectory: z.string().min(1).describe('Root directory for the project.').optional(),
  nodeVersion: z.string().min(1).describe('Node.js version to use for the project.').optional(),
  buildCommand: z.string().min(1).describe('Build command for the project.').optional(),
  devCommand: z.string().min(1).describe('Development command for the project.').optional(),
  installCommand: z.string().min(1).describe('Install command for the project.').optional(),
  outputDirectory: z.string().min(1).describe('Output directory for the project build.').optional(),
  directoryListing: z.boolean().describe('Whether directory listing is enabled for the project.').optional(),
  publicSource: z.boolean().describe('Whether the project source is public.').optional(),
  gitForkProtection: z.boolean().describe('Whether Git fork protection is enabled for the project.').optional(),
}).describe('Vercel action input.')

export const createProjectOutput = z.strictObject({
  project: z.strictObject({
    id: z.string().describe('Vercel project ID.'),
    name: z.string().describe('Vercel project name.'),
    accountId: z.string().describe('Owning account ID for the project.').optional(),
    framework: z.string().describe('Detected framework for the project.').optional(),
    nodeVersion: z.string().describe('Configured Node.js version for the project.').optional(),
    createdAt: z.number().describe('Project creation timestamp in milliseconds.').optional(),
    updatedAt: z.number().describe('Last project update timestamp in milliseconds.').optional(),
    link: z.looseObject({}).describe('Raw object payload returned by Vercel.').optional(),
    latestDeployments: z.array(z.looseObject({
      id: z.string().describe('Vercel deployment ID.').optional(),
      name: z.string().describe('Deployment name.').optional(),
      url: z.string().describe('Deployment URL.').optional(),
      state: z.string().describe('Deployment state reported by Vercel.').optional(),
      readyState: z.string().describe('Deployment readiness state reported by Vercel.').optional(),
      target: z.string().describe('Deployment target such as production or preview.').optional(),
      createdAt: z.number().describe('Deployment creation timestamp in milliseconds.').optional(),
      ready: z.number().describe('Deployment ready timestamp in milliseconds.').optional(),
      projectId: z.string().describe('Vercel project ID for the deployment.').optional(),
      creator: z.looseObject({}).describe('Raw object payload returned by Vercel.').optional(),
      meta: z.looseObject({}).describe('Raw object payload returned by Vercel.').optional(),
      alias: z.array(z.string()).describe('Aliases currently assigned to the deployment.').optional(),
    }).describe('Vercel deployment summary.')).describe('Most recent deployments attached to the project.').optional(),
  }).describe('Vercel project.'),
})

export const updateProjectInput = z.strictObject({
  idOrName: z.string().min(1).describe('Vercel project ID or project name.'),
  name: z.string().min(1).describe('Vercel project name.').optional(),
  framework: z.string().min(1).describe('Framework to set on the project.').optional(),
  rootDirectory: z.string().min(1).describe('Root directory for the project.').optional(),
  nodeVersion: z.string().min(1).describe('Node.js version to use for the project.').optional(),
  buildCommand: z.string().min(1).describe('Build command for the project.').optional(),
  devCommand: z.string().min(1).describe('Development command for the project.').optional(),
  installCommand: z.string().min(1).describe('Install command for the project.').optional(),
  outputDirectory: z.string().min(1).describe('Output directory for the project build.').optional(),
  directoryListing: z.boolean().describe('Whether directory listing is enabled for the project.').optional(),
  publicSource: z.boolean().describe('Whether the project source is public.').optional(),
  gitForkProtection: z.boolean().describe('Whether Git fork protection is enabled for the project.').optional(),
}).describe('Vercel action input.')

export const updateProjectOutput = z.strictObject({
  project: z.strictObject({
    id: z.string().describe('Vercel project ID.'),
    name: z.string().describe('Vercel project name.'),
    accountId: z.string().describe('Owning account ID for the project.').optional(),
    framework: z.string().describe('Detected framework for the project.').optional(),
    nodeVersion: z.string().describe('Configured Node.js version for the project.').optional(),
    createdAt: z.number().describe('Project creation timestamp in milliseconds.').optional(),
    updatedAt: z.number().describe('Last project update timestamp in milliseconds.').optional(),
    link: z.looseObject({}).describe('Raw object payload returned by Vercel.').optional(),
    latestDeployments: z.array(z.looseObject({
      id: z.string().describe('Vercel deployment ID.').optional(),
      name: z.string().describe('Deployment name.').optional(),
      url: z.string().describe('Deployment URL.').optional(),
      state: z.string().describe('Deployment state reported by Vercel.').optional(),
      readyState: z.string().describe('Deployment readiness state reported by Vercel.').optional(),
      target: z.string().describe('Deployment target such as production or preview.').optional(),
      createdAt: z.number().describe('Deployment creation timestamp in milliseconds.').optional(),
      ready: z.number().describe('Deployment ready timestamp in milliseconds.').optional(),
      projectId: z.string().describe('Vercel project ID for the deployment.').optional(),
      creator: z.looseObject({}).describe('Raw object payload returned by Vercel.').optional(),
      meta: z.looseObject({}).describe('Raw object payload returned by Vercel.').optional(),
      alias: z.array(z.string()).describe('Aliases currently assigned to the deployment.').optional(),
    }).describe('Vercel deployment summary.')).describe('Most recent deployments attached to the project.').optional(),
  }).describe('Vercel project.'),
})

export const listDeploymentsInput = z.strictObject({
  projectId: z.string().min(1).describe('Vercel project ID.').optional(),
  limit: z.int().min(1).max(100).describe('Maximum number of results to return.').optional(),
  since: z.int().describe('Pagination cursor for results created after this timestamp.').optional(),
  until: z.int().describe('Pagination cursor for results created before this timestamp.').optional(),
  target: z.string().min(1).describe('Deployment target such as production or preview.').optional(),
  state: z.string().min(1).describe('Deployment state to filter by.').optional(),
}).describe('Vercel action input.')

export const listDeploymentsOutput = z.strictObject({
  deployments: z.array(z.looseObject({
    id: z.string().describe('Vercel deployment ID.').optional(),
    name: z.string().describe('Deployment name.').optional(),
    url: z.string().describe('Deployment URL.').optional(),
    state: z.string().describe('Deployment state reported by Vercel.').optional(),
    readyState: z.string().describe('Deployment readiness state reported by Vercel.').optional(),
    target: z.string().describe('Deployment target such as production or preview.').optional(),
    createdAt: z.number().describe('Deployment creation timestamp in milliseconds.').optional(),
    ready: z.number().describe('Deployment ready timestamp in milliseconds.').optional(),
    projectId: z.string().describe('Vercel project ID for the deployment.').optional(),
    creator: z.looseObject({}).describe('Raw object payload returned by Vercel.').optional(),
    meta: z.looseObject({}).describe('Raw object payload returned by Vercel.').optional(),
    alias: z.array(z.string()).describe('Aliases currently assigned to the deployment.').optional(),
  }).describe('Vercel deployment summary.')).describe('Vercel deployments.').optional(),
  pagination: z.looseObject({
    count: z.number().describe('Number of items returned in this page.').optional(),
    next: z.number().describe('Pagination cursor for the next page, or null when there is no next page.').nullable().optional(),
    prev: z.number().describe('Pagination cursor for the previous page, or null when there is no previous page.').nullable().optional(),
  }).describe('Vercel pagination information.').optional(),
})

export const getDeploymentInput = z.strictObject({
  idOrUrl: z.string().min(1).describe('Vercel deployment ID or deployment URL.'),
  withGitRepoInfo: z.boolean().describe('When true, include Git repository metadata in the deployment response.').optional(),
}).describe('Vercel action input.')

export const getDeploymentOutput = z.strictObject({
  deployment: z.looseObject({
    id: z.string().describe('Vercel deployment ID.').optional(),
    name: z.string().describe('Deployment name.').optional(),
    url: z.string().describe('Deployment URL.').optional(),
    state: z.string().describe('Deployment state reported by Vercel.').optional(),
    readyState: z.string().describe('Deployment readiness state reported by Vercel.').optional(),
    target: z.string().describe('Deployment target such as production or preview.').optional(),
    createdAt: z.number().describe('Deployment creation timestamp in milliseconds.').optional(),
    ready: z.number().describe('Deployment ready timestamp in milliseconds.').optional(),
    projectId: z.string().describe('Vercel project ID for the deployment.').optional(),
    creator: z.looseObject({}).describe('Raw object payload returned by Vercel.').optional(),
    meta: z.looseObject({}).describe('Raw object payload returned by Vercel.').optional(),
    alias: z.array(z.string()).describe('Aliases currently assigned to the deployment.').optional(),
  }).describe('Vercel deployment summary.'),
})

export const getDeploymentEventsInput = z.strictObject({
  idOrUrl: z.string().min(1).describe('Vercel deployment ID or deployment URL.'),
  limit: z.int().min(1).max(100).describe('Maximum number of results to return.').optional(),
  since: z.int().describe('Pagination cursor for results created after this timestamp.').optional(),
  until: z.int().describe('Pagination cursor for results created before this timestamp.').optional(),
  direction: z.enum(['forward', 'backward']).describe('Order in which to return deployment events.').optional(),
  builds: z.boolean().describe('When true, include build events in the response.').optional(),
}).describe('Vercel action input.')

export const getDeploymentEventsOutput = z.strictObject({
  events: z.array(z.strictObject({
    created: z.number().describe('Deployment event timestamp in milliseconds.'),
    type: z.string().describe('Deployment event type.'),
    payload: z.looseObject({}).describe('Raw object payload returned by Vercel.'),
  }).describe('Vercel deployment event.')).describe('Deployment events returned by Vercel.').optional(),
})

export const getRuntimeLogsInput = z.strictObject({
  projectId: z.string().min(1).describe('Vercel project ID.'),
  deploymentId: z.string().min(1).describe('Vercel deployment ID.'),
}).describe('Vercel action input.')

export const getRuntimeLogsOutput = z.strictObject({
  logs: z.array(z.strictObject({
    timestampInMs: z.number().describe('Runtime log timestamp in milliseconds.'),
    level: z.string().describe('Runtime log level.'),
    message: z.string().describe('Runtime log message.'),
    source: z.string().describe('Runtime log source.'),
    requestMethod: z.string().describe('HTTP method for the runtime log entry, when present.').optional(),
    requestPath: z.string().describe('HTTP request path for the runtime log entry, when present.').optional(),
    responseStatusCode: z.number().describe('HTTP response status code for the runtime log entry, when present.').optional(),
  }).describe('Vercel runtime log entry.')).describe('Runtime log entries returned by Vercel.').optional(),
})

export const listProjectEnvsInput = z.strictObject({
  idOrName: z.string().min(1).describe('Vercel project ID or project name.'),
  gitBranch: z.string().min(1).describe('Git branch name.').optional(),
  customEnvironmentId: z.string().min(1).describe('Vercel custom environment ID.').optional(),
}).describe('Vercel action input.')

export const listProjectEnvsOutput = z.strictObject({
  envs: z.array(z.strictObject({
    id: z.string().describe('Vercel environment variable ID.'),
    key: z.string().describe('Environment variable name.'),
    type: z.string().describe('Environment variable type.'),
    target: z.array(z.string()).describe('Deployment targets that receive this environment variable.').optional(),
    gitBranch: z.string().describe('Git branch name scoped to this environment variable, when present.').optional(),
    createdAt: z.number().describe('Environment variable creation timestamp in milliseconds.').optional(),
    updatedAt: z.number().describe('Last environment variable update timestamp in milliseconds.').optional(),
    comment: z.string().describe('Comment attached to the environment variable, when present.').optional(),
  }).describe('Vercel environment variable.')).describe('Environment variables configured on the project.').optional(),
})

export const createProjectEnvInput = z.strictObject({
  idOrName: z.string().min(1).describe('Vercel project ID or project name.'),
  key: z.string().min(1).describe('Environment variable name.'),
  value: z.string().min(1).describe('Environment variable value.'),
  type: z.enum(['plain', 'secret', 'system', 'encrypted', 'sensitive']).describe('Environment variable type.'),
  target: z.array(z.enum(['production', 'preview', 'development'])).min(1).describe('Deployment targets that should receive this environment variable.'),
  gitBranch: z.string().min(1).describe('Git branch name.').optional(),
  comment: z.string().min(1).describe('Optional comment for the environment variable.').optional(),
  customEnvironmentIds: z.array(z.string().min(1)).describe('Custom environment IDs that should receive this environment variable.').optional(),
}).describe('Vercel action input.')

export const createProjectEnvOutput = z.strictObject({
  envs: z.array(z.strictObject({
    id: z.string().describe('Vercel environment variable ID.'),
    key: z.string().describe('Environment variable name.'),
    type: z.string().describe('Environment variable type.'),
    target: z.array(z.string()).describe('Deployment targets that receive this environment variable.').optional(),
    gitBranch: z.string().describe('Git branch name scoped to this environment variable, when present.').optional(),
    createdAt: z.number().describe('Environment variable creation timestamp in milliseconds.').optional(),
    updatedAt: z.number().describe('Last environment variable update timestamp in milliseconds.').optional(),
    comment: z.string().describe('Comment attached to the environment variable, when present.').optional(),
  }).describe('Vercel environment variable.')).describe('Environment variables returned by Vercel after creation.').optional(),
})

export const updateProjectEnvInput = z.strictObject({
  idOrName: z.string().min(1).describe('Vercel project ID or project name.'),
  id: z.string().min(1).describe('Vercel environment variable ID.'),
  key: z.string().min(1).describe('Environment variable name.'),
  value: z.string().min(1).describe('Environment variable value.'),
  type: z.enum(['plain', 'secret', 'system', 'encrypted', 'sensitive']).describe('Environment variable type.'),
  target: z.array(z.enum(['production', 'preview', 'development'])).min(1).describe('Deployment targets that should receive this environment variable.'),
  gitBranch: z.string().min(1).describe('Git branch name.').optional(),
  comment: z.string().min(1).describe('Optional comment for the environment variable.').optional(),
  customEnvironmentIds: z.array(z.string().min(1)).describe('Custom environment IDs that should receive this environment variable.').optional(),
}).describe('Vercel action input.')

export const updateProjectEnvOutput = z.strictObject({
  env: z.strictObject({
    id: z.string().describe('Vercel environment variable ID.'),
    key: z.string().describe('Environment variable name.'),
    type: z.string().describe('Environment variable type.'),
    target: z.array(z.string()).describe('Deployment targets that receive this environment variable.').optional(),
    gitBranch: z.string().describe('Git branch name scoped to this environment variable, when present.').optional(),
    createdAt: z.number().describe('Environment variable creation timestamp in milliseconds.').optional(),
    updatedAt: z.number().describe('Last environment variable update timestamp in milliseconds.').optional(),
    comment: z.string().describe('Comment attached to the environment variable, when present.').optional(),
  }).describe('Vercel environment variable.'),
})

export const deleteProjectEnvInput = z.strictObject({
  idOrName: z.string().min(1).describe('Vercel project ID or project name.'),
  id: z.string().min(1).describe('Vercel environment variable ID.'),
}).describe('Vercel action input.')

export const deleteProjectEnvOutput = z.strictObject({
  envs: z.array(z.strictObject({
    id: z.string().describe('Vercel environment variable ID.'),
    key: z.string().describe('Environment variable name.'),
    type: z.string().describe('Environment variable type.'),
    target: z.array(z.string()).describe('Deployment targets that receive this environment variable.').optional(),
    gitBranch: z.string().describe('Git branch name scoped to this environment variable, when present.').optional(),
    createdAt: z.number().describe('Environment variable creation timestamp in milliseconds.').optional(),
    updatedAt: z.number().describe('Last environment variable update timestamp in milliseconds.').optional(),
    comment: z.string().describe('Comment attached to the environment variable, when present.').optional(),
  }).describe('Vercel environment variable.')).describe('Environment variables returned by Vercel after deletion.').optional(),
})

export const listProjectDomainsInput = z.strictObject({
  idOrName: z.string().min(1).describe('Vercel project ID or project name.'),
  limit: z.int().min(1).max(100).describe('Maximum number of results to return.').optional(),
  since: z.int().describe('Pagination cursor for results created after this timestamp.').optional(),
  until: z.int().describe('Pagination cursor for results created before this timestamp.').optional(),
  gitBranch: z.string().min(1).describe('Git branch name.').optional(),
  customEnvironmentId: z.string().min(1).describe('Vercel custom environment ID.').optional(),
}).describe('Vercel action input.')

export const listProjectDomainsOutput = z.strictObject({
  domains: z.array(z.strictObject({
    name: z.string().describe('Domain name.'),
    apexName: z.string().describe('Apex domain name.').optional(),
    verified: z.boolean().describe('Whether the domain is verified in Vercel.').optional(),
    verification: z.array(z.looseObject({}).describe('Raw object payload returned by Vercel.')).describe('Raw domain verification records returned by Vercel.').optional(),
    redirect: z.string().describe('Redirect target configured for the domain, or null when no redirect is set.').nullable().optional(),
    gitBranch: z.string().describe('Git branch associated with the domain, when present.').optional(),
    customEnvironmentId: z.string().describe('Custom environment ID associated with the domain, when present.').optional(),
  }).describe('Vercel project domain.')).describe('Domains attached to the project.').optional(),
  pagination: z.looseObject({
    count: z.number().describe('Number of items returned in this page.').optional(),
    next: z.number().describe('Pagination cursor for the next page, or null when there is no next page.').nullable().optional(),
    prev: z.number().describe('Pagination cursor for the previous page, or null when there is no previous page.').nullable().optional(),
  }).describe('Vercel pagination information.').optional(),
})

export const getProjectDomainInput = z.strictObject({
  idOrName: z.string().min(1).describe('Vercel project ID or project name.'),
  domain: z.string().min(1).describe('Domain name.'),
}).describe('Vercel action input.')

export const getProjectDomainOutput = z.strictObject({
  domain: z.strictObject({
    name: z.string().describe('Domain name.'),
    apexName: z.string().describe('Apex domain name.').optional(),
    verified: z.boolean().describe('Whether the domain is verified in Vercel.').optional(),
    verification: z.array(z.looseObject({}).describe('Raw object payload returned by Vercel.')).describe('Raw domain verification records returned by Vercel.').optional(),
    redirect: z.string().describe('Redirect target configured for the domain, or null when no redirect is set.').nullable().optional(),
    gitBranch: z.string().describe('Git branch associated with the domain, when present.').optional(),
    customEnvironmentId: z.string().describe('Custom environment ID associated with the domain, when present.').optional(),
  }).describe('Vercel project domain.'),
})

export const addProjectDomainInput = z.strictObject({
  idOrName: z.string().min(1).describe('Vercel project ID or project name.'),
  name: z.string().min(1).describe('Domain name to add to the project.'),
  redirect: z.string().min(1).describe('Redirect target for the domain.').optional(),
  gitBranch: z.string().min(1).describe('Git branch name.').optional(),
  customEnvironmentId: z.string().min(1).describe('Vercel custom environment ID.').optional(),
}).describe('Vercel action input.')

export const addProjectDomainOutput = z.strictObject({
  domain: z.strictObject({
    name: z.string().describe('Domain name.'),
    apexName: z.string().describe('Apex domain name.').optional(),
    verified: z.boolean().describe('Whether the domain is verified in Vercel.').optional(),
    verification: z.array(z.looseObject({}).describe('Raw object payload returned by Vercel.')).describe('Raw domain verification records returned by Vercel.').optional(),
    redirect: z.string().describe('Redirect target configured for the domain, or null when no redirect is set.').nullable().optional(),
    gitBranch: z.string().describe('Git branch associated with the domain, when present.').optional(),
    customEnvironmentId: z.string().describe('Custom environment ID associated with the domain, when present.').optional(),
  }).describe('Vercel project domain.'),
})

export const verifyProjectDomainInput = z.strictObject({
  idOrName: z.string().min(1).describe('Vercel project ID or project name.'),
  domain: z.string().min(1).describe('Domain name.'),
}).describe('Vercel action input.')

export const verifyProjectDomainOutput = z.strictObject({
  domain: z.strictObject({
    name: z.string().describe('Domain name.'),
    apexName: z.string().describe('Apex domain name.').optional(),
    verified: z.boolean().describe('Whether the domain is verified in Vercel.').optional(),
    verification: z.array(z.looseObject({}).describe('Raw object payload returned by Vercel.')).describe('Raw domain verification records returned by Vercel.').optional(),
    redirect: z.string().describe('Redirect target configured for the domain, or null when no redirect is set.').nullable().optional(),
    gitBranch: z.string().describe('Git branch associated with the domain, when present.').optional(),
    customEnvironmentId: z.string().describe('Custom environment ID associated with the domain, when present.').optional(),
  }).describe('Vercel project domain.'),
})

export const getDomainConfigInput = z.strictObject({
  domain: z.string().min(1).describe('Domain name.'),
}).describe('Vercel action input.')

export const getDomainConfigOutput = z.strictObject({
  configuredBy: z.string().describe('Party that configured the domain.').optional(),
  acceptedChallenges: z.array(z.string()).describe('Domain verification challenge types accepted by Vercel.').optional(),
  misconfigured: z.boolean().describe('Whether Vercel considers the domain misconfigured.').optional(),
  recommendedNameServers: z.array(z.string()).describe('Name servers recommended by Vercel for the domain.').optional(),
}).describe('Vercel domain configuration.')

export const listWebhooksInput = z.strictObject({}).describe('Vercel action input.')

export const listWebhooksOutput = z.strictObject({
  webhooks: z.array(z.strictObject({
    id: z.string().describe('Vercel webhook ID.'),
    url: z.string().describe('Webhook destination URL.'),
    events: z.array(z.string()).describe('Webhook events configured on the webhook.').optional(),
    projectIds: z.array(z.string()).describe('Project IDs associated with the webhook, when scoped to specific projects.').optional(),
    teamId: z.string().describe('Vercel team ID that owns the webhook, when present.').optional(),
    createdAt: z.number().describe('Webhook creation timestamp in milliseconds.').optional(),
    updatedAt: z.number().describe('Last webhook update timestamp in milliseconds.').optional(),
  }).describe('Vercel webhook.')).describe('Vercel webhooks.').optional(),
})

export const getWebhookInput = z.strictObject({
  id: z.string().min(1).describe('Vercel webhook ID.'),
}).describe('Vercel action input.')

export const getWebhookOutput = z.strictObject({
  webhook: z.strictObject({
    id: z.string().describe('Vercel webhook ID.'),
    url: z.string().describe('Webhook destination URL.'),
    events: z.array(z.string()).describe('Webhook events configured on the webhook.').optional(),
    projectIds: z.array(z.string()).describe('Project IDs associated with the webhook, when scoped to specific projects.').optional(),
    teamId: z.string().describe('Vercel team ID that owns the webhook, when present.').optional(),
    createdAt: z.number().describe('Webhook creation timestamp in milliseconds.').optional(),
    updatedAt: z.number().describe('Last webhook update timestamp in milliseconds.').optional(),
  }).describe('Vercel webhook.'),
})

export const createWebhookInput = z.strictObject({
  url: z.url().describe('Webhook destination URL.'),
  events: z.array(z.string().min(1)).min(1).describe('Webhook events that should trigger notifications.'),
  projectIds: z.array(z.string().min(1)).describe('Project IDs that should trigger the webhook. Omit to receive events for all projects.').optional(),
}).describe('Vercel action input.')

export const createWebhookOutput = z.strictObject({
  webhook: z.strictObject({
    id: z.string().describe('Vercel webhook ID.'),
    url: z.string().describe('Webhook destination URL.'),
    events: z.array(z.string()).describe('Webhook events configured on the webhook.').optional(),
    projectIds: z.array(z.string()).describe('Project IDs associated with the webhook, when scoped to specific projects.').optional(),
    teamId: z.string().describe('Vercel team ID that owns the webhook, when present.').optional(),
    createdAt: z.number().describe('Webhook creation timestamp in milliseconds.').optional(),
    updatedAt: z.number().describe('Last webhook update timestamp in milliseconds.').optional(),
  }).describe('Vercel webhook.'),
})

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const vercelActions = {
  get_auth_user: {
    description: 'Get the authenticated Vercel user.',
    effect: 'read',
    inputSchema: getAuthUserInput,
    outputSchema: z.toJSONSchema(getAuthUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_teams: {
    description: 'List Vercel teams available to the authenticated user.',
    effect: 'read',
    inputSchema: listTeamsInput,
    outputSchema: z.toJSONSchema(listTeamsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_team: {
    description: 'Get a Vercel team by id or slug.',
    effect: 'read',
    inputSchema: getTeamInput,
    outputSchema: z.toJSONSchema(getTeamOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_projects: {
    description: 'List Vercel projects.',
    effect: 'read',
    inputSchema: listProjectsInput,
    outputSchema: z.toJSONSchema(listProjectsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project: {
    description: 'Get a Vercel project.',
    effect: 'read',
    inputSchema: getProjectInput,
    outputSchema: z.toJSONSchema(getProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_project: {
    description: 'Create a Vercel project.',
    effect: 'write',
    inputSchema: createProjectInput,
    outputSchema: z.toJSONSchema(createProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_project: {
    description: 'Update a Vercel project.',
    effect: 'write',
    inputSchema: updateProjectInput,
    outputSchema: z.toJSONSchema(updateProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_deployments: {
    description: 'List Vercel deployments.',
    effect: 'read',
    inputSchema: listDeploymentsInput,
    outputSchema: z.toJSONSchema(listDeploymentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_deployment: {
    description: 'Get a Vercel deployment.',
    effect: 'read',
    inputSchema: getDeploymentInput,
    outputSchema: z.toJSONSchema(getDeploymentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_deployment_events: {
    description: 'Get Vercel deployment events.',
    effect: 'read',
    inputSchema: getDeploymentEventsInput,
    outputSchema: z.toJSONSchema(getDeploymentEventsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_runtime_logs: {
    description: 'Get runtime logs for a Vercel deployment.',
    effect: 'read',
    inputSchema: getRuntimeLogsInput,
    outputSchema: z.toJSONSchema(getRuntimeLogsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_project_envs: {
    description: 'List environment variables for a Vercel project.',
    effect: 'read',
    inputSchema: listProjectEnvsInput,
    outputSchema: z.toJSONSchema(listProjectEnvsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_project_env: {
    description: 'Create a Vercel project environment variable.',
    effect: 'write',
    inputSchema: createProjectEnvInput,
    outputSchema: z.toJSONSchema(createProjectEnvOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_project_env: {
    description: 'Update a Vercel project environment variable.',
    effect: 'write',
    inputSchema: updateProjectEnvInput,
    outputSchema: z.toJSONSchema(updateProjectEnvOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_project_env: {
    description: 'Delete a Vercel project environment variable.',
    effect: 'destructive',
    inputSchema: deleteProjectEnvInput,
    outputSchema: z.toJSONSchema(deleteProjectEnvOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_project_domains: {
    description: 'List domains for a Vercel project.',
    effect: 'read',
    inputSchema: listProjectDomainsInput,
    outputSchema: z.toJSONSchema(listProjectDomainsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project_domain: {
    description: 'Get a Vercel project domain.',
    effect: 'read',
    inputSchema: getProjectDomainInput,
    outputSchema: z.toJSONSchema(getProjectDomainOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_project_domain: {
    description: 'Add a domain to a Vercel project.',
    effect: 'write',
    inputSchema: addProjectDomainInput,
    outputSchema: z.toJSONSchema(addProjectDomainOutput, { io: 'output', unrepresentable: 'any' }),
  },
  verify_project_domain: {
    description: 'Verify a Vercel project domain.',
    effect: 'write',
    inputSchema: verifyProjectDomainInput,
    outputSchema: z.toJSONSchema(verifyProjectDomainOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_domain_config: {
    description: 'Get domain configuration guidance from Vercel.',
    effect: 'read',
    inputSchema: getDomainConfigInput,
    outputSchema: z.toJSONSchema(getDomainConfigOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_webhooks: {
    description: 'List Vercel webhooks.',
    effect: 'read',
    inputSchema: listWebhooksInput,
    outputSchema: z.toJSONSchema(listWebhooksOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_webhook: {
    description: 'Get a Vercel webhook.',
    effect: 'read',
    inputSchema: getWebhookInput,
    outputSchema: z.toJSONSchema(getWebhookOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_webhook: {
    description: 'Create a Vercel webhook.',
    effect: 'write',
    inputSchema: createWebhookInput,
    outputSchema: z.toJSONSchema(createWebhookOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
