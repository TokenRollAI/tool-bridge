/**
 * Railway 的业务逻辑(backboard GraphQL v2 上的 9 个 action)。
 *
 * 迁移自 open-connector `src/providers/railway/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 四处上游细节决定了这里的形状:
 * - **只有一个端点**。九个 action 全是 `POST /graphql/v2`,差别只在 query 文本与 variables,
 *   故请求层收成一个 `graphql()`。
 * - **信封式错误**:GraphQL 失败走 HTTP 200 + `{"errors":[...]}`,当成功返回就会把
 *   "权限不足 / 参数非法"读成"data 是空的"。故解完 JSON 先看 errors。
 * - **connection 分页壳**:列表统一包成 `{edges:[{node}]}`,出参要拆成裸数组;`node` 为 null
 *   的边(上游对无权访问的元素这么表达)要丢掉,不能变成数组里的 null 洞。
 * - **workspaceId 决定 list_projects 用哪条 query**。它是上游 api_key 认证的 `extraFields`
 *   (非敏感),在这里落到挂载的 `providerConfig`(`ctx.config`)—— 那正是"workspace 归属"
 *   这类配置该待的通道,不是 secret。
 *
 * `upsert_variable` 的 value **逐字保留**(允许空串与前后空白):变量值是不透明的,上游
 * 用 `optionalRawString` 而非 `optionalString`,这处不对称是有意的。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  deployServiceInput,
  getDeploymentInput,
  getDeploymentLogsInput,
  getProjectInput,
  getServiceInstanceInput,
  listDeploymentsInput,
  rollbackDeploymentInput,
  upsertVariableInput,
} from './schema'
import { compactDefined as compact, asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'railway'
const GRAPHQL_URL = 'https://backboard.railway.com/graphql/v2'
/** 上游 `list_deployments` / `get_deployment_logs` 的兜底页大小(schema 的 default 只是标注)。 */
const DEFAULT_DEPLOYMENT_LIMIT = 20
const DEFAULT_LOG_LIMIT = 500

type Json = Record<string, unknown>

/** 上游回的形状不符合契约 —— 是上游的问题,不是调用方的错。 */
function responseError(message: string): TBError {
  return new TBError('unavailable', message, { retryable: true })
}

/**
 * 必填断言。上游 34.3% 的 action 没在声明里写 `required`,但 executor 里有断言;
 * schema.ts 忠实反映声明(全 optional),必填就落在这一层。值按上游语义去空白。
 */
function required(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} 是必填的`)
  return result
}

/** GraphQL 的 `errors[]` → 一条消息。上游把多条错误用 '; ' 串起来。 */
function errorMessages(payload: unknown): string | undefined {
  const errors = record(payload)?.errors
  if (!Array.isArray(errors)) return undefined
  const messages = errors
    .map(error => text(record(error)?.message))
    .filter((message): message is string => message !== undefined)
  return messages.length > 0 ? messages.join('; ') : undefined
}

/**
 * 非 2xx 的消息提取。上游只看顶层的 message/error/detail/title,而 Railway 的 401 把原因
 * (`Not Authorized`)放在 `errors[]` 里 —— 那条路上游取不到,只能报"HTTP 401"。
 * 这里多看一眼 errors[],消息更准,归码不变。
 */
function errorText(payload: unknown, status: number): string {
  const body = record(payload)
  return errorMessages(payload)
    ?? text(body?.message)
    ?? text(body?.error)
    ?? text(body?.detail)
    ?? text(body?.title)
    ?? `Railway 返回 HTTP ${status}`
}

async function graphql(ctx: ProviderContext, query: string, variables?: Json): Promise<Json> {
  const response = await guardedFetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${requireApiKey(ctx, SERVICE)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(variables === undefined ? { query } : { query, variables }),
  })

  const body = await response.text()
  let payload: unknown
  if (body.trim() !== '') {
    try {
      payload = JSON.parse(body)
    } catch {
      // 2xx 上回非 JSON 只能是上游坏了;错误响应上回 HTML 错误页却很常见,那时按 HTTP
      // 状态归一比报"响应不是 JSON"准得多。
      if (response.ok) throw responseError('Railway 返回了非 JSON 响应')
    }
  }
  if (!response.ok) throw upstreamError(response.status, errorText(payload, response.status))

  const envelope = record(payload)
  if (envelope === undefined) throw responseError('Railway GraphQL 响应不是对象')
  // GraphQL 的失败走 200 + errors[];这是调用方能修的问题(权限、参数、不存在的 id)。
  const failure = errorMessages(envelope)
  if (failure !== undefined) throw new TBError('invalid_argument', failure)

  const data = record(envelope.data)
  if (data === undefined) throw responseError('Railway GraphQL 响应缺 data')
  return data
}

/** connection 壳 → 裸数组;`node` 为 null 的边丢掉(上游对无权访问的元素这么表达)。 */
function nodes(value: unknown): Json[] {
  const edges = record(value)?.edges
  if (!Array.isArray(edges)) return []
  return edges.flatMap((edge) => {
    const node = record(record(edge)?.node)
    return node === undefined ? [] : [node]
  })
}

/** GraphQL 把"没查到"表达成 data 里的 null 字段;那是上游没给该给的东西。 */
function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === undefined || value === null) throw responseError(message)
  return value
}

/** workspace 归属走挂载配置(非敏感),不走 secret。 */
function workspaceId(ctx: ProviderContext): string | undefined {
  return text(ctx.config?.workspaceId)
}

const PROJECT_FIELDS = 'id name description createdAt updatedAt'
const DEPLOYMENT_FIELDS = 'id status createdAt url staticUrl'

export async function listProjects(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const workspace = workspaceId(ctx)
  // workspace 令牌下 `projects` 必须带 workspaceId,账号令牌下则不能带 —— 两条 query。
  const data = workspace === undefined
    ? await graphql(ctx, `query projects {
        projects {
          edges { node { ${PROJECT_FIELDS} } }
        }
      }`)
    : await graphql(ctx, `query workspaceProjects($workspaceId: String!) {
        projects(workspaceId: $workspaceId) {
          edges { node { ${PROJECT_FIELDS} } }
        }
      }`, { workspaceId: workspace })

  return { projects: nodes(data.projects) }
}

export async function getProject(input: z.infer<typeof getProjectInput>, ctx: ProviderContext): Promise<Json> {
  const data = await graphql(ctx, `query project($id: String!) {
      project(id: $id) {
        id
        name
        description
        createdAt
        services { edges { node { id name icon } } }
        environments { edges { node { id name } } }
      }
    }`, { id: required(input.projectId, 'projectId') })

  const project = requireValue(record(data.project), 'Railway 没有返回 project')
  return {
    project: compact({
      id: project.id,
      name: project.name,
      // 上游把缺席的 description 显式归一成 null(出参声明里它是 nullable 的)。
      description: project.description ?? null,
      createdAt: project.createdAt,
      services: nodes(project.services),
      environments: nodes(project.environments),
    }),
  }
}

export async function getServiceInstance(
  input: z.infer<typeof getServiceInstanceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const data = await graphql(ctx, `query serviceInstance($serviceId: String!, $environmentId: String!) {
      serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
        id
        serviceName
        startCommand
        buildCommand
        rootDirectory
        healthcheckPath
        region
        numReplicas
        restartPolicyType
        restartPolicyMaxRetries
        latestDeployment { ${DEPLOYMENT_FIELDS} }
      }
    }`, {
    serviceId: required(input.serviceId, 'serviceId'),
    environmentId: required(input.environmentId, 'environmentId'),
  })

  return {
    serviceInstance: requireValue(record(data.serviceInstance), 'Railway 没有返回 serviceInstance'),
  }
}

export async function listDeployments(
  input: z.infer<typeof listDeploymentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const data = await graphql(ctx, `query deployments($input: DeploymentListInput!, $first: Int) {
      deployments(input: $input, first: $first) {
        edges { node { ${DEPLOYMENT_FIELDS} } }
      }
    }`, {
    input: {
      projectId: required(input.projectId, 'projectId'),
      serviceId: required(input.serviceId, 'serviceId'),
      environmentId: required(input.environmentId, 'environmentId'),
    },
    first: input.limit ?? DEFAULT_DEPLOYMENT_LIMIT,
  })

  return { deployments: nodes(data.deployments) }
}

export async function getDeployment(input: z.infer<typeof getDeploymentInput>, ctx: ProviderContext): Promise<Json> {
  const data = await graphql(ctx, `query deployment($id: String!) {
      deployment(id: $id) {
        ${DEPLOYMENT_FIELDS} meta canRedeploy canRollback
      }
    }`, { id: required(input.deploymentId, 'deploymentId') })

  return { deployment: requireValue(record(data.deployment), 'Railway 没有返回 deployment') }
}

export async function getDeploymentLogs(
  input: z.infer<typeof getDeploymentLogsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const data = await graphql(ctx, `query deploymentLogs(
      $deploymentId: String!
      $limit: Int
      $filter: String
      $startDate: DateTime
      $endDate: DateTime
    ) {
      deploymentLogs(
        deploymentId: $deploymentId
        limit: $limit
        filter: $filter
        startDate: $startDate
        endDate: $endDate
      ) {
        timestamp message severity
      }
    }`, compact({
    deploymentId: required(input.deploymentId, 'deploymentId'),
    limit: input.limit ?? DEFAULT_LOG_LIMIT,
    filter: text(input.filter),
    startDate: text(input.startDate),
    endDate: text(input.endDate),
  }))

  // 没有日志时上游给 null;出参声明的是数组,归一成空数组而不是把 null 透出去。
  return { logs: Array.isArray(data.deploymentLogs) ? data.deploymentLogs : [] }
}

export async function deployService(input: z.infer<typeof deployServiceInput>, ctx: ProviderContext): Promise<Json> {
  const data = await graphql(
    ctx,
    `mutation serviceInstanceDeployV2($serviceId: String!, $environmentId: String!, $commitSha: String) {
      serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId, commitSha: $commitSha)
    }`,
    compact({
      serviceId: required(input.serviceId, 'serviceId'),
      environmentId: required(input.environmentId, 'environmentId'),
      commitSha: text(input.commitSha),
    }),
  )

  return {
    deploymentId: requireValue(data.serviceInstanceDeployV2, 'Railway 没有返回 deployment id'),
  }
}

export async function upsertVariable(input: z.infer<typeof upsertVariableInput>, ctx: ProviderContext): Promise<Json> {
  const data = await graphql(ctx, `mutation variableUpsert($input: VariableUpsertInput!) {
      variableUpsert(input: $input)
    }`, {
    input: compact({
      projectId: required(input.projectId, 'projectId'),
      environmentId: required(input.environmentId, 'environmentId'),
      serviceId: text(input.serviceId),
      name: required(input.name, 'name'),
      // 变量值不透明:空串与前后空白都要原样写进去。
      value: input.value,
      skipDeploys: input.skipDeploys,
    }),
  })

  return { updated: requireValue(data.variableUpsert, 'Railway 没有返回变量更新结果') }
}

export async function rollbackDeployment(
  input: z.infer<typeof rollbackDeploymentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const data = await graphql(ctx, `mutation deploymentRollback($id: String!) {
      deploymentRollback(id: $id) { ${DEPLOYMENT_FIELDS} }
    }`, { id: required(input.deploymentId, 'deploymentId') })

  return { deployment: requireValue(record(data.deploymentRollback), 'Railway 没有返回回滚后的 deployment') }
}
