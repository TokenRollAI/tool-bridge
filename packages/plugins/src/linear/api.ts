/**
 * Linear 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/linear/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * ## 凭证:裸 Authorization 头,**不带 `Bearer ` 前缀**
 *
 * Linear 的 personal API key(`lin_api_…`)是**直接当作 Authorization 头的值**发出去的,
 * 加上 `Bearer ` 前缀会 401。上游对 OAuth token 才拼 `Bearer `,对 api_key 是原样透传;
 * 本迁移只做 api_key 一路,故这里永远是原样透传。
 *
 * **存 secret 时也不能自己加前缀** —— `tb secret set` 里存的应当就是 `lin_api_…` 本身。
 *
 * ## 形状
 *
 * 34 个 action 全部打同一个端点(`POST https://api.linear.app/graphql`),差别只在
 * query 文本与 variables。五处上游细节决定了这里的形状:
 *
 * - **GraphQL 的失败可以带着 HTTP 200 回来**(`{data: null, errors: [...]}`)。除了
 *   `run_query` / `run_mutation` 这两个"透传原始文档"的 action 之外,errors 非空一律抛错。
 * - GraphQL 错误没有稳定错误码,上游靠**消息子串**归一(`syntax error` → 参数问题、
 *   `unauthorized` → 认证问题…)。判定**顺序是有意义的**:`invalid` 排在 `unauthorized`
 *   前面,于是 "Invalid authentication" 归 400 而不是 401 —— 照抄,别重排。
 * - 每个 create / update mutation 只回一个 id,**要再打一次查询**把实体取回来才能组出出参。
 *   一次 action 两趟往返是上游的既定行为,保留。
 * - 几个 list 接口在插件侧**自动翻完所有页**(`first: 100` + `after` 游标循环),对外只呈现
 *   一个完整列表,没有游标出参。
 * - `list_linear_issues` 的 `assignee_id` 认字面量 `"me"`,要先查 viewer 换成真实 id。
 *
 * ## 与上游的三处有意偏离
 *
 * - 上游 `throwLinearHttpError` 只认 400/401/429,其余(含 403/404/5xx)一律压成 502。
 *   这里改用共用的 `upstreamError` 按状态归一 —— 每个 provider 各压一套正是它要消灭的东西。
 * - 上游的翻页循环是 `for(;;)` **无上界**:上游若把同一个 endCursor 一直回下去(它是远端
 *   可控的),这个循环就永远不结束。插件与网关同进程跑,一个不结束的循环拖住的是网关。
 *   这里加了页数上限,超了**报错**而不是静默截断 —— 截断会让调用方拿到一份看起来完整、
 *   实际少了一半的列表。
 * - 上游没有包传输层异常,裸 Error 冒到 plugin-sdk 会被抹成 "internal plugin error" 500。
 *   这里就地归一成 unavailable。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createAttachmentInput,
  createCommentReactionInput,
  createLinearCommentInput,
  createLinearIssueInput,
  createLinearIssueRelationInput,
  createLinearLabelInput,
  createLinearProjectInput,
  createProjectMilestoneInput,
  createProjectUpdateInput,
  deleteLinearIssueInput,
  getAttachmentInput,
  getCyclesByTeamIdInput,
  getIssueDefaultsInput,
  getLinearIssueInput,
  getLinearProjectInput,
  listIssueDraftsInput,
  listIssuesByTeamIdInput,
  listLinearIssuesInput,
  listLinearLabelsInput,
  listLinearStatesInput,
  listLinearTeamsInput,
  listLinearUsersInput,
  removeIssueLabelInput,
  removeReactionInput,
  runMutationInput,
  runQueryInput,
  searchIssuesInput,
  updateIssueInput,
  updateLinearCommentInput,
  updateLinearProjectInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'linear'
const GRAPHQL_URL = 'https://api.linear.app/graphql'

/**
 * 自动翻页的页数上限(每页 100 条,即 10000 条)。真实 workspace 到不了这个量级;
 * 到得了就说明上游的游标没在推进,那时报错比无限转下去好。
 */
const MAX_PAGES = 100

type Json = Record<string, unknown>

// ── GraphQL 字段片段 ──────────────────────────────────────────────────────────
// 与上游逐字一致:选择集变了就是出参变了,这些常量是出参契约的真源。

const pageInfoFields = `
  startCursor
  endCursor
  hasPreviousPage
  hasNextPage
`

const userFields = `
  id
  name
  displayName
  email
  avatarUrl
  active
  admin
  createdAt
`

const teamFields = `
  id
  name
  key
`

const workflowStateFields = `
  id
  name
  type
  color
  description
`

const labelFields = `
  id
  name
  color
  description
  isGroup
  parent {
    id
    name
  }
`

const cycleFields = `
  id
  name
  number
  description
  startsAt
  endsAt
  completedAt
  isActive
  isFuture
  isPast
  isNext
  isPrevious
  team {
    ${teamFields}
  }
`

const projectStatusFields = `
  id
  name
  type
  color
  description
`

const projectFields = `
  id
  name
  description
  url
  slugId
  icon
  color
  state
  health
  progress
  priority
  priorityLabel
  scope
  startDate
  targetDate
  createdAt
  updatedAt
  lead {
    ${userFields}
  }
  creator {
    ${userFields}
  }
  status {
    ${projectStatusFields}
  }
`

const initiativeFields = `
  id
  name
  description
  url
`

const attachmentFields = `
  id
  title
  subtitle
  url
  sourceType
  metadata
  source
  createdAt
  updatedAt
  issue {
    id
    identifier
    title
  }
`

const reactionFields = `
  id
  emoji
  createdAt
  updatedAt
  user {
    ${userFields}
  }
  comment {
    id
  }
  issue {
    id
    identifier
  }
  projectUpdate {
    id
  }
`

const commentFields = `
  id
  body
  url
  quotedText
  createdAt
  updatedAt
  editedAt
  resolvedAt
  issueId
  parentId
  projectUpdateId
  user {
    ${userFields}
  }
  reactions {
    ${reactionFields}
  }
`

const issueFields = `
  id
  identifier
  title
  description
  url
  createdAt
  updatedAt
  archivedAt
  completedAt
  dueDate
  priority
  estimate
  team {
    ${teamFields}
  }
  state {
    ${workflowStateFields}
  }
  project {
    ${projectFields}
  }
  assignee {
    ${userFields}
  }
  creator {
    ${userFields}
  }
  cycle {
    ${cycleFields}
  }
  parent {
    id
    identifier
    title
  }
  labels(first: 50) {
    nodes {
      ${labelFields}
    }
  }
`

const detailedIssueFields = `
  ${issueFields}
  attachments(first: 50) {
    nodes {
      ${attachmentFields}
    }
    pageInfo {
      ${pageInfoFields}
    }
  }
  comments(first: 50) {
    nodes {
      ${commentFields}
    }
    pageInfo {
      ${pageInfoFields}
    }
  }
  subscribers(first: 50) {
    nodes {
      ${userFields}
    }
    pageInfo {
      ${pageInfoFields}
    }
  }
  reactions {
    ${reactionFields}
  }
`

// ── 取值助手 ─────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined
}

/**
 * 上游 `asOptionalString` / `getOptionalString` 的语义:**空串视同没给**,但**不 trim**
 * (Linear 的 description / body 里首尾空白是内容的一部分,不能替调用方剪掉)。
 */
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** 丢掉值为 `undefined` 的键;`null` 要留着(出参里它表示"这一项确实没有")。 */
function compact(input: Json): Json {
  const output: Json = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value
  }
  return output
}

/** GraphQL connection 的 `nodes`;缺席按空列表处理(上游如此)。 */
function nodesOf(connection: unknown): unknown[] {
  const nodes = asRecord(connection)?.nodes
  return Array.isArray(nodes) ? nodes : []
}

/** URL 的最后一段(去掉 query),用于把附件 URL 与 file_name 对上。 */
function basenameFromUrl(url: string): string {
  const withoutQuery = url.includes('?') ? url.slice(0, url.indexOf('?')) : url
  const lastSlash = withoutQuery.lastIndexOf('/')
  return lastSlash >= 0 ? withoutQuery.slice(lastSlash + 1) : withoutQuery
}

/** 上游 `mapWithConcurrency`:按 5 个一批并发,不是一次全放出去。 */
async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = []
  for (let index = 0; index < items.length; index += concurrency) {
    results.push(...(await Promise.all(items.slice(index, index + concurrency).map(mapper))))
  }
  return results
}

// ── GraphQL 传输与错误归一 ────────────────────────────────────────────────────

interface GraphqlResponse {
  data: Json | null | undefined
  errors: Json[] | undefined
  extensions: Json | undefined
}

/** 空体回 `{}`,非 JSON 回 `{message: 原文}` —— Linear 的网关错误页有时是纯文本。 */
async function readJson(response: Response): Promise<Json> {
  const text = await response.text().catch(() => '')
  if (text === '') return {}
  try {
    return (asRecord(JSON.parse(text)) ?? { message: text })
  } catch {
    return { message: text }
  }
}

function extractErrorMessage(body: Json): string {
  const direct = str(body.message)
  if (direct !== undefined) return direct

  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const joined = body.errors
      .map(error => str(asRecord(error)?.message))
      .filter((message): message is string => message !== undefined)
      .join('; ')
    if (joined !== '') return joined
  }
  return 'linear 请求失败'
}

/**
 * GraphQL 错误 → TBError。Linear 的 errors 没有稳定错误码,只能按消息子串判。
 *
 * **判定顺序是有意义的**:`invalid` 排在 `unauthorized` 前面,于是 "Invalid authentication"
 * 落到 400 而不是 401。照抄上游,别按"看起来更合理"的顺序重排 —— 那会改掉一批既有调用方
 * 已经在依赖的错误码。(400 与 401 在本仓库都不是可重试码,归错也不会引发重试风暴。)
 */
function graphqlErrorsToTBError(errors: Json[]): TBError {
  const message = errors
    .map(error => (typeof error.message === 'string' ? error.message : ''))
    .join('; ')
  const lower = message.toLowerCase()

  if (
    lower.includes('cannot query field')
    || lower.includes('syntax error')
    || lower.includes('entity not found')
    || lower.includes('invalid')
    || lower.includes('expected type')
    || lower.includes('required type')
    || lower.includes('must be')
  ) {
    return upstreamError(400, message)
  }
  if (lower.includes('unauthorized') || lower.includes('authentication')) {
    return upstreamError(401, message)
  }
  if (lower.includes('rate limit')) {
    return upstreamError(429, message)
  }
  return upstreamError(502, message)
}

async function graphqlRequest(
  ctx: ProviderContext,
  query: string,
  variables?: Json,
): Promise<GraphqlResponse> {
  // 裸 Authorization 头:personal API key 直接当头的值,**不加 `Bearer ` 前缀**。
  const authorization = requireApiKey(ctx, SERVICE)

  let response: Response
  let body: Json
  try {
    response = await guardedFetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'authorization': authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify(compact({ query, variables })),
    })
    body = await readJson(response)
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障,还丢掉唯一有诊断价值的那句消息。
    if (error instanceof TBError) throw error
    throw upstreamError(502, error instanceof Error ? `linear 请求失败: ${error.message}` : 'linear 请求失败')
  }

  if (!response.ok) throw upstreamError(response.status, extractErrorMessage(body))

  const errors = Array.isArray(body.errors)
    ? body.errors.map(error => asRecord(error) ?? { message: String(error) })
    : undefined
  return {
    // `data: null` 与"没有 data 字段"要分开:前者是 GraphQL 明确说"这次没有数据"。
    data: body.data === null ? null : asRecord(body.data),
    errors,
    extensions: asRecord(body.extensions),
  }
}

/** 带 errors 检查的操作:errors 非空即抛,`data` 为空即视为上游破契约。 */
async function operation(ctx: ProviderContext, query: string, variables?: Json): Promise<Json> {
  const response = await graphqlRequest(ctx, query, variables)
  if (response.errors !== undefined && response.errors.length > 0) {
    throw graphqlErrorsToTBError(response.errors)
  }
  if (response.data === null || response.data === undefined) {
    throw upstreamError(502, 'linear graphql 响应里没有 data')
  }
  return response.data
}

/**
 * `run_query` / `run_mutation` 的透传形态:**不对 GraphQL errors 抛错**,而是把
 * data / errors / extensions 一起交给调用方 —— 它们要的就是原始响应。
 * (HTTP 层的错误仍然抛:那时根本没有 GraphQL 响应可透传。)
 */
async function rawDocument(ctx: ProviderContext, document: string, variables?: Json): Promise<Json> {
  const response = await graphqlRequest(ctx, document, variables)
  const hasErrors = response.errors !== undefined && response.errors.length > 0
  return compact({
    data: response.data === null ? null : response.data,
    errors: response.errors,
    extensions: response.extensions,
    message: hasErrors
      ? response.errors!.map(error => (typeof error.message === 'string' ? error.message : '')).join('; ')
      : undefined,
  })
}

/**
 * 沿 `after` 游标翻完全部页。见文件头:上界是本地加的,超了报错而不是静默截断。
 */
async function fetchAllNodes(
  ctx: ProviderContext,
  query: string,
  extract: (data: Json) => unknown,
): Promise<unknown[]> {
  const nodes: unknown[] = []
  let after: string | undefined

  for (let page = 0; ; page += 1) {
    if (page >= MAX_PAGES) {
      throw upstreamError(502, `linear 翻页超过 ${MAX_PAGES} 页,上游游标可能没有推进`)
    }
    const data = await operation(ctx, query, { after })
    const connection = asRecord(extract(data))
    if (connection === undefined) return nodes

    nodes.push(...nodesOf(connection))

    const pageInfo = asRecord(connection.pageInfo)
    const endCursor = str(pageInfo?.endCursor)
    if (pageInfo?.hasNextPage !== true || endCursor === undefined) return nodes
    after = endCursor
  }
}

// ── 单实体查询 ───────────────────────────────────────────────────────────────
// mutation 只回 id,出参要靠这些查询把实体取回来 —— 一次 action 两趟往返。

/** 实体查不到时,归 invalid_argument:是调用方给的 id 不对,重试不会变。 */
function requireEntity(value: unknown, message: string): Json {
  const record = asRecord(value)
  if (record === undefined) throw new TBError('invalid_argument', message)
  return record
}

async function fetchIssueById(ctx: ProviderContext, issueId: string): Promise<Json> {
  const payload = await operation(ctx, `
    query GetIssue($id: String!) {
      issue(id: $id) {
        ${detailedIssueFields}
      }
    }
  `, { id: issueId })
  return requireEntity(payload.issue, 'linear issue 不存在')
}

async function fetchProjectById(
  ctx: ProviderContext,
  projectId: string,
  includeTeams: boolean,
  includeMembers: boolean,
  includeInitiatives: boolean,
): Promise<Json> {
  const payload = await operation(ctx, `
    query GetProject(
      $id: String!
      $includeTeams: Boolean!
      $includeMembers: Boolean!
      $includeInitiatives: Boolean!
    ) {
      project(id: $id) {
        ${projectFields}
        teams(first: 50, includeArchived: false) @include(if: $includeTeams) {
          nodes {
            ${teamFields}
          }
        }
        members(first: 100, includeArchived: false, includeDisabled: true) @include(if: $includeMembers) {
          nodes {
            ${userFields}
          }
        }
        initiatives(first: 50, includeArchived: false) @include(if: $includeInitiatives) {
          nodes {
            ${initiativeFields}
          }
        }
      }
    }
  `, { id: projectId, includeTeams, includeMembers, includeInitiatives })
  return requireEntity(payload.project, 'linear project 不存在')
}

async function fetchAttachmentById(ctx: ProviderContext, attachmentId: string): Promise<Json> {
  const payload = await operation(ctx, `
    query GetAttachment($id: String!) {
      attachment(id: $id) {
        ${attachmentFields}
      }
    }
  `, { id: attachmentId })
  return requireEntity(payload.attachment, 'linear attachment 不存在')
}

async function fetchIssueLabelById(ctx: ProviderContext, labelId: string): Promise<Json> {
  const payload = await operation(ctx, `
    query GetIssueLabel($id: String!) {
      issueLabel(id: $id) {
        ${labelFields}
        team {
          ${teamFields}
        }
      }
    }
  `, { id: labelId })
  return requireEntity(payload.issueLabel, 'linear label 不存在')
}

async function fetchCommentById(ctx: ProviderContext, commentId: string): Promise<Json> {
  const payload = await operation(ctx, `
    query GetComment($id: String!) {
      comment(id: $id) {
        ${commentFields}
      }
    }
  `, { id: commentId })
  return requireEntity(payload.comment, 'linear comment 不存在')
}

async function fetchIssueRelationById(ctx: ProviderContext, relationId: string): Promise<Json> {
  const payload = await operation(ctx, `
    query GetIssueRelation($id: String!) {
      issueRelation(id: $id) {
        id
        type
        issue {
          id
        }
        relatedIssue {
          id
        }
      }
    }
  `, { id: relationId })
  return requireEntity(payload.issueRelation, 'linear issue relation 不存在')
}

async function fetchProjectMilestoneById(ctx: ProviderContext, milestoneId: string): Promise<Json> {
  const payload = await operation(ctx, `
    query GetProjectMilestone($id: String!) {
      projectMilestone(id: $id) {
        id
        name
        description
        targetDate
        sortOrder
        progress
        status
        project {
          id
        }
      }
    }
  `, { id: milestoneId })
  return requireEntity(payload.projectMilestone, 'linear project milestone 不存在')
}

async function fetchProjectUpdateById(ctx: ProviderContext, projectUpdateId: string): Promise<Json> {
  const payload = await operation(ctx, `
    query GetProjectUpdate($id: String!) {
      projectUpdate(id: $id) {
        id
        body
        health
        isDiffHidden
        isStale
        url
        createdAt
        updatedAt
        editedAt
        slugId
        project {
          id
        }
        user {
          ${userFields}
        }
        reactions {
          ${reactionFields}
        }
        commentCount
      }
    }
  `, { id: projectUpdateId })
  return requireEntity(payload.projectUpdate, 'linear project update 不存在')
}

async function fetchViewer(ctx: ProviderContext): Promise<Json> {
  const payload = await operation(ctx, `
    query Viewer {
      viewer {
        ${userFields}
      }
    }
  `, {})
  const viewer = asRecord(payload.viewer)
  // viewer 查不到不是入参问题(这个查询没有入参),只能是上游/凭证出了状况。
  if (viewer === undefined) throw upstreamError(502, 'linear viewer 查询回了空响应')
  return viewer
}

async function fetchIssueAttachments(ctx: ProviderContext, issueId: string): Promise<unknown[]> {
  const payload = await operation(ctx, `
    query GetIssueAttachments($id: String!) {
      issue(id: $id) {
        attachments(first: 100, includeArchived: false) {
          nodes {
            ${attachmentFields}
          }
        }
      }
    }
  `, { id: issueId })
  return nodesOf(requireEntity(payload.issue, 'linear issue 不存在').attachments)
}

async function fetchTeamCycles(ctx: ProviderContext, teamId: string): Promise<unknown[]> {
  const payload = await operation(ctx, `
    query GetTeamCycles($id: String!) {
      team(id: $id) {
        cycles(first: 100, includeArchived: false) {
          nodes {
            ${cycleFields}
          }
        }
      }
    }
  `, { id: teamId })
  return nodesOf(requireEntity(payload.team, 'linear team 不存在').cycles)
}

async function fetchTeamLabels(ctx: ProviderContext, teamId: string): Promise<unknown[]> {
  const payload = await operation(ctx, `
    query GetTeamLabels($id: String!) {
      team(id: $id) {
        labels(first: 100, includeArchived: false) {
          nodes {
            ${labelFields}
          }
        }
      }
    }
  `, { id: teamId })
  return nodesOf(requireEntity(payload.team, 'linear team 不存在').labels)
}

async function fetchTeamStates(ctx: ProviderContext, teamId: string): Promise<unknown[]> {
  const payload = await operation(ctx, `
    query GetTeamStates($id: String!) {
      team(id: $id) {
        states(first: 100, includeArchived: false) {
          nodes {
            ${workflowStateFields}
          }
        }
      }
    }
  `, { id: teamId })
  return nodesOf(requireEntity(payload.team, 'linear team 不存在').states)
}

async function fetchTeamDetails(ctx: ProviderContext, teamId: string): Promise<Json> {
  const payload = await operation(ctx, `
    query GetTeamDetails($id: String!) {
      team(id: $id) {
        ${teamFields}
        members(first: 100, includeDisabled: true) {
          nodes {
            ${userFields}
          }
        }
        projects(first: 100, includeArchived: false) {
          nodes {
            ${projectFields}
          }
        }
      }
    }
  `, { id: teamId })
  return requireEntity(payload.team, 'linear team 不存在')
}

/** `assignee_id: "me"` 是字面量:要先查 viewer 换成真实 id,直接发 "me" 会查不到。 */
async function resolveAssigneeFilterId(
  ctx: ProviderContext,
  assigneeId: string | undefined,
): Promise<string | undefined> {
  if (assigneeId === undefined) return undefined
  if (assigneeId !== 'me') return assigneeId
  return String((await fetchViewer(ctx)).id)
}

function buildIssuesFilter(projectId: string | undefined, assigneeId: string | undefined): Json | undefined {
  const filter = compact({
    project: projectId === undefined ? undefined : { id: { eq: projectId } },
    assignee: assigneeId === undefined ? undefined : { id: { eq: assigneeId } },
  })
  // 空 filter 要发 undefined 而不是 `{}`:后者会被 Linear 当成一个真实(且无效)的过滤器。
  return Object.keys(filter).length > 0 ? filter : undefined
}

/** `update_linear_project` 的 `state` 是**状态类型名**,要先在组织的状态表里换成 statusId。 */
async function resolveProjectStatusId(ctx: ProviderContext, statusType: string): Promise<string> {
  const payload = await operation(ctx, `
    query GetProjectStatuses {
      organization {
        projectStatuses {
          id
          type
        }
      }
    }
  `, {})
  const statuses = asRecord(payload.organization)?.projectStatuses
  const list = Array.isArray(statuses) ? statuses : []
  const matched = list.map(item => asRecord(item)).find(item => item?.type === statusType)
  const id = str(matched?.id)
  if (id === undefined) throw new TBError('invalid_argument', `linear 没有 state 为 ${statusType} 的 project status`)
  return id
}

// ── mutation 结果断言 ────────────────────────────────────────────────────────
// mutation 回的是 `{success, <entity>}`;success 不为 true 或拿不到 id 都是上游的问题
// (入参非法在这之前就被 GraphQL errors 拦掉了),归 unavailable。

function mutationEntityId(payload: unknown, entityKey: string, message: string): string {
  const record = asRecord(payload)
  const id = str(asRecord(record?.[entityKey])?.id)
  if (record?.success !== true || id === undefined) throw upstreamError(502, message)
  return id
}

function archiveEntityId(payload: unknown, message: string): string {
  const record = asRecord(payload)
  const id = str(asRecord(record?.entity)?.id)
  if (record?.success !== true || id === undefined) throw upstreamError(502, message)
  return id
}

function requireSuccess(payload: unknown, message: string): void {
  if (asRecord(payload)?.success !== true) throw upstreamError(502, message)
}

// ── 出参映射 ─────────────────────────────────────────────────────────────────

function mapPageInfo(pageInfo: unknown): Json {
  const info = asRecord(pageInfo)
  return {
    startCursor: info?.startCursor ?? null,
    endCursor: info?.endCursor ?? null,
    hasPreviousPage: Boolean(info?.hasPreviousPage),
    hasNextPage: Boolean(info?.hasNextPage),
  }
}

/** `list_issues_by_team_id` 独一份的蛇形 page_info(上游如此,不要顺手统一)。 */
function mapSnakePageInfo(pageInfo: unknown): Json {
  const info = asRecord(pageInfo)
  return {
    end_cursor: info?.endCursor ?? null,
    has_next_page: Boolean(info?.hasNextPage),
  }
}

function mapUser(user: unknown): Json | null {
  const record = asRecord(user)
  if (record === undefined) return null
  return compact({
    id: str(record.id),
    name: str(record.name),
    displayName: str(record.displayName),
    email: str(record.email),
    avatarUrl: str(record.avatarUrl),
    active: bool(record.active),
    admin: bool(record.admin),
    createdAt: str(record.createdAt),
  })
}

function mapTeam(team: unknown): Json | null {
  const record = asRecord(team)
  if (record === undefined) return null
  return compact({ id: str(record.id), name: str(record.name), key: str(record.key) })
}

function mapWorkflowState(state: unknown): Json | null {
  const record = asRecord(state)
  if (record === undefined) return null
  return compact({
    id: str(record.id),
    name: str(record.name),
    type: str(record.type),
    color: str(record.color),
    description: str(record.description),
  })
}

function mapLabel(label: unknown): Json | null {
  const record = asRecord(label)
  if (record === undefined) return null
  const parent = asRecord(record.parent)
  return compact({
    id: str(record.id),
    name: str(record.name),
    color: str(record.color),
    description: str(record.description),
    is_group: bool(record.isGroup),
    parent: parent === undefined ? null : compact({ id: str(parent.id), name: str(parent.name) }),
  })
}

function mapCycle(cycle: unknown): Json | null {
  const record = asRecord(cycle)
  if (record === undefined) return null
  return compact({
    id: str(record.id),
    name: str(record.name),
    number: num(record.number),
    description: str(record.description),
    startsAt: str(record.startsAt),
    endsAt: str(record.endsAt),
    completedAt: str(record.completedAt),
    isActive: bool(record.isActive),
    isFuture: bool(record.isFuture),
    isPast: bool(record.isPast),
    team: mapTeam(record.team),
  })
}

function mapProjectStatus(status: unknown): Json | null {
  const record = asRecord(status)
  if (record === undefined) return null
  return compact({
    id: str(record.id),
    name: str(record.name),
    type: str(record.type),
    color: str(record.color),
    description: str(record.description),
  })
}

interface ProjectIncludes {
  includeInitiatives?: boolean
  includeMembers?: boolean
  includeTeams?: boolean
}

function mapProject(project: unknown, options: ProjectIncludes = {}): Json | null {
  const record = asRecord(project)
  if (record === undefined) return null
  return compact({
    id: str(record.id),
    name: str(record.name),
    description: str(record.description),
    url: str(record.url),
    slugId: str(record.slugId),
    icon: str(record.icon),
    color: str(record.color),
    state: str(record.state),
    health: str(record.health),
    progress: num(record.progress),
    priority: num(record.priority),
    priorityLabel: str(record.priorityLabel),
    scope: num(record.scope),
    startDate: str(record.startDate),
    targetDate: str(record.targetDate),
    createdAt: str(record.createdAt),
    updatedAt: str(record.updatedAt),
    lead: mapUser(record.lead),
    creator: mapUser(record.creator),
    status: mapProjectStatus(record.status),
    // 这三块只在调用方明确要了、且上游确实回了的时候才出现 —— 没要就整个键都不该在。
    teams: options.includeTeams === true && record.teams !== undefined
      ? { nodes: nodesOf(record.teams).map(mapTeam) }
      : undefined,
    members: options.includeMembers === true && record.members !== undefined
      ? { nodes: nodesOf(record.members).map(mapUser) }
      : undefined,
    initiatives: options.includeInitiatives === true && record.initiatives !== undefined
      ? {
          nodes: nodesOf(record.initiatives).map((initiative) => {
            const item = asRecord(initiative) ?? {}
            return compact({
              id: str(item.id),
              name: str(item.name),
              description: str(item.description),
              url: str(item.url),
            })
          }),
        }
      : undefined,
  })
}

function mapAttachment(attachment: unknown): Json | null {
  const record = asRecord(attachment)
  if (record === undefined) return null
  const issue = asRecord(record.issue)
  return compact({
    id: str(record.id),
    title: str(record.title),
    subtitle: str(record.subtitle),
    url: str(record.url),
    sourceType: str(record.sourceType),
    metadata: asRecord(record.metadata),
    source: asRecord(record.source),
    issue: issue === undefined
      ? null
      : compact({ id: str(issue.id), identifier: str(issue.identifier), title: str(issue.title) }),
    createdAt: str(record.createdAt),
    updatedAt: str(record.updatedAt),
  })
}

function mapReaction(reaction: unknown): Json | null {
  const record = asRecord(reaction)
  if (record === undefined) return null
  const comment = asRecord(record.comment)
  const issue = asRecord(record.issue)
  const projectUpdate = asRecord(record.projectUpdate)
  return compact({
    id: str(record.id),
    emoji: str(record.emoji),
    createdAt: str(record.createdAt),
    updatedAt: str(record.updatedAt),
    user: mapUser(record.user),
    comment: comment === undefined ? null : { id: str(comment.id) },
    issue: issue === undefined ? null : compact({ id: str(issue.id), identifier: str(issue.identifier) }),
    projectUpdate: projectUpdate === undefined ? null : { id: str(projectUpdate.id) },
  })
}

function mapComment(comment: unknown): Json | null {
  const record = asRecord(comment)
  if (record === undefined) return null
  return compact({
    id: str(record.id),
    body: str(record.body),
    url: str(record.url),
    quotedText: str(record.quotedText),
    createdAt: str(record.createdAt),
    updatedAt: str(record.updatedAt),
    editedAt: str(record.editedAt),
    resolvedAt: str(record.resolvedAt),
    issueId: str(record.issueId),
    parentId: str(record.parentId),
    projectUpdateId: str(record.projectUpdateId),
    user: mapUser(record.user),
    // reactions 在 Linear 这里是裸数组而不是 connection,不能走 nodesOf。
    reactions: Array.isArray(record.reactions) ? record.reactions.map(mapReaction) : [],
  })
}

function mapIssueSummary(issue: unknown): Json | null {
  const record = asRecord(issue)
  if (record === undefined) return null
  return compact({
    id: str(record.id),
    identifier: str(record.identifier),
    title: str(record.title),
    description: str(record.description),
    url: str(record.url),
    createdAt: str(record.createdAt),
    updatedAt: str(record.updatedAt),
    archivedAt: str(record.archivedAt),
    dueDate: str(record.dueDate),
    priority: num(record.priority),
    estimate: num(record.estimate),
    team: mapTeam(record.team),
    state: mapWorkflowState(record.state),
    project: mapProject(record.project),
    assignee: mapUser(record.assignee),
    labels: { nodes: nodesOf(record.labels).map(mapLabel) },
  })
}

function mapDetailedIssue(issue: unknown): Json | null {
  const base = mapIssueSummary(issue)
  if (base === null) return null
  const record = asRecord(issue) ?? {}
  const parent = asRecord(record.parent)
  return compact({
    ...base,
    creator: mapUser(record.creator),
    cycle: mapCycle(record.cycle),
    parent: parent === undefined
      ? null
      : compact({ id: str(parent.id), identifier: str(parent.identifier), title: str(parent.title) }),
    attachments: {
      nodes: nodesOf(record.attachments).map(mapAttachment),
      pageInfo: mapPageInfo(asRecord(record.attachments)?.pageInfo),
    },
    comments: {
      nodes: nodesOf(record.comments).map(mapComment),
      pageInfo: mapPageInfo(asRecord(record.comments)?.pageInfo),
    },
    subscribers: {
      nodes: nodesOf(record.subscribers).map(mapUser),
      pageInfo: mapPageInfo(asRecord(record.subscribers)?.pageInfo),
    },
    reactions: Array.isArray(record.reactions) ? record.reactions.map(mapReaction) : [],
  })
}

function mapDraft(draft: unknown): Json | null {
  const record = asRecord(draft)
  if (record === undefined) return null
  const issue = asRecord(record.issue)
  const project = asRecord(record.project)
  const projectUpdate = asRecord(record.projectUpdate)
  return compact({
    id: str(record.id),
    data: asRecord(record.data),
    bodyData: str(record.bodyData),
    createdAt: str(record.createdAt),
    updatedAt: str(record.updatedAt),
    isAutogenerated: bool(record.isAutogenerated),
    team: mapTeam(record.team),
    issue: issue === undefined ? null : { id: str(issue.id) },
    project: project === undefined ? null : { id: str(project.id) },
    projectUpdate: projectUpdate === undefined ? null : { id: str(projectUpdate.id) },
    user: mapUser(record.user),
  })
}

// ── action handlers ──────────────────────────────────────────────────────────

export async function createAttachment(
  input: z.infer<typeof createAttachmentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    mutation CreateAttachment($input: AttachmentCreateInput!) {
      attachmentCreate(input: $input) {
        success
        attachment {
          id
        }
      }
    }
  `, {
    input: compact({
      issueId: input.issue_id,
      title: input.title,
      url: input.url,
      subtitle: str(input.subtitle),
    }),
  })

  const attachmentId = mutationEntityId(payload.attachmentCreate, 'attachment', 'linear create_attachment 失败')
  const attachment = await fetchAttachmentById(ctx, attachmentId)

  return {
    id: attachment.id,
    issue_id: asRecord(attachment.issue)?.id ?? input.issue_id,
    title: attachment.title,
    url: attachment.url,
    subtitle: attachment.subtitle ?? null,
  }
}

export async function createCommentReaction(
  input: z.infer<typeof createCommentReactionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    mutation CreateCommentReaction($input: ReactionCreateInput!) {
      reactionCreate(input: $input) {
        success
        reaction {
          id
        }
      }
    }
  `, { input: { commentId: input.comment_id, emoji: input.emoji } })

  return {
    reaction_id: mutationEntityId(payload.reactionCreate, 'reaction', 'linear create_comment_reaction 失败'),
    comment_id: input.comment_id,
    emoji: input.emoji,
  }
}

export async function createLinearComment(
  input: z.infer<typeof createLinearCommentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    mutation CreateComment($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment {
          id
        }
      }
    }
  `, { input: { issueId: input.issueId, body: input.body } })

  const commentId = mutationEntityId(payload.commentCreate, 'comment', 'linear create_linear_comment 失败')
  const comment = await fetchCommentById(ctx, commentId)

  return {
    comment_id: comment.id,
    issue_id: comment.issueId ?? input.issueId,
    body: comment.body ?? input.body,
  }
}

export async function createLinearIssue(
  input: z.infer<typeof createLinearIssueInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
        }
      }
    }
  `, {
    input: compact({
      title: input.title,
      teamId: input.team_id,
      cycleId: str(input.cycle_id),
      dueDate: str(input.due_date),
      estimate: input.estimate,
      priority: input.priority,
      stateId: str(input.state_id),
      labelIds: input.label_ids,
      parentId: str(input.parent_id),
      projectId: str(input.project_id),
      assigneeId: str(input.assignee_id),
      description: str(input.description),
    }),
  })

  const issueId = mutationEntityId(payload.issueCreate, 'issue', 'linear create_linear_issue 失败')
  const issue = await fetchIssueById(ctx, issueId)

  return {
    id: issue.id,
    identifier: issue.identifier,
    issue_title: issue.title,
    issue_description: issue.description ?? null,
    ticket_url: issue.url,
  }
}

export async function createLinearIssueRelation(
  input: z.infer<typeof createLinearIssueRelationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    mutation CreateIssueRelation($input: IssueRelationCreateInput!) {
      issueRelationCreate(input: $input) {
        success
        issueRelation {
          id
        }
      }
    }
  `, {
    input: {
      issueId: input.issue_id,
      relatedIssueId: input.related_issue_id,
      type: input.relation_type,
    },
  })

  const relationId = mutationEntityId(
    payload.issueRelationCreate,
    'issueRelation',
    'linear create_linear_issue_relation 失败',
  )
  const relation = await fetchIssueRelationById(ctx, relationId)

  return {
    id: relation.id,
    issue_id: asRecord(relation.issue)?.id ?? input.issue_id,
    related_issue_id: asRecord(relation.relatedIssue)?.id ?? input.related_issue_id,
    relation_type: relation.type ?? input.relation_type,
  }
}

export async function createLinearLabel(
  input: z.infer<typeof createLinearLabelInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    mutation CreateIssueLabel($input: IssueLabelCreateInput!) {
      issueLabelCreate(input: $input) {
        success
        issueLabel {
          id
        }
      }
    }
  `, {
    input: compact({
      teamId: input.team_id,
      name: input.name,
      color: input.color,
      description: str(input.description),
    }),
  })

  const labelId = mutationEntityId(payload.issueLabelCreate, 'issueLabel', 'linear create_linear_label 失败')
  const label = await fetchIssueLabelById(ctx, labelId)

  return {
    id: label.id,
    team_id: asRecord(label.team)?.id ?? input.team_id,
    name: label.name,
    color: label.color ?? input.color,
    description: label.description ?? null,
  }
}

export async function createLinearProject(
  input: z.infer<typeof createLinearProjectInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    mutation CreateProject($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        success
        project {
          id
        }
      }
    }
  `, {
    // 入参声明里还有 `status_id` 与 `state`,上游**不往 create 里发**(只有 update 认它们)。
    // 保留这个取舍:替上游发一个没验证过的字段,失败方式会比"这个字段没生效"更难查。
    input: compact({
      icon: str(input.icon),
      name: input.name,
      color: str(input.color),
      leadId: str(input.lead_id),
      priority: input.priority,
      teamIds: input.team_ids,
      startDate: str(input.start_date),
      description: str(input.description),
      targetDate: str(input.target_date),
    }),
  })

  const projectId = mutationEntityId(payload.projectCreate, 'project', 'linear create_linear_project 失败')
  const project = await fetchProjectById(ctx, projectId, false, false, false)

  return { id: project.id, name: project.name, url: project.url, state: project.state }
}

export async function createProjectMilestone(
  input: z.infer<typeof createProjectMilestoneInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    mutation CreateProjectMilestone($input: ProjectMilestoneCreateInput!) {
      projectMilestoneCreate(input: $input) {
        success
        projectMilestone {
          id
        }
      }
    }
  `, {
    input: compact({
      name: input.name,
      projectId: input.project_id,
      sortOrder: input.sort_order,
      description: str(input.description),
      targetDate: str(input.target_date),
    }),
  })

  const milestoneId = mutationEntityId(
    payload.projectMilestoneCreate,
    'projectMilestone',
    'linear create_project_milestone 失败',
  )
  const milestone = await fetchProjectMilestoneById(ctx, milestoneId)

  return {
    id: milestone.id,
    project_id: asRecord(milestone.project)?.id ?? input.project_id,
    name: milestone.name,
    target_date: milestone.targetDate ?? null,
  }
}

export async function createProjectUpdate(
  input: z.infer<typeof createProjectUpdateInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    mutation CreateProjectUpdate($input: ProjectUpdateCreateInput!) {
      projectUpdateCreate(input: $input) {
        success
        projectUpdate {
          id
        }
      }
    }
  `, {
    input: compact({
      body: input.body,
      health: str(input.health),
      projectId: input.project_id,
      isDiffHidden: input.is_diff_hidden,
    }),
  })

  const projectUpdateId = mutationEntityId(
    payload.projectUpdateCreate,
    'projectUpdate',
    'linear create_project_update 失败',
  )
  const projectUpdate = await fetchProjectUpdateById(ctx, projectUpdateId)

  return {
    id: projectUpdate.id,
    project_id: asRecord(projectUpdate.project)?.id ?? input.project_id,
    body: projectUpdate.body ?? null,
    health: projectUpdate.health ?? null,
    is_diff_hidden: Boolean(projectUpdate.isDiffHidden),
  }
}

export async function deleteLinearIssue(
  input: z.infer<typeof deleteLinearIssueInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    mutation DeleteIssue($id: String!) {
      issueDelete(id: $id) {
        success
        entity {
          id
        }
      }
    }
  `, { id: input.issue_id })

  return { id: archiveEntityId(payload.issueDelete, 'linear delete_linear_issue 失败'), deleted: true }
}

const LIST_TEAMS_QUERY = `
  query ListTeams($after: String) {
    teams(after: $after, first: 100, includeArchived: false) {
      nodes {
        ${teamFields}
      }
      pageInfo {
        ${pageInfoFields}
      }
    }
  }
`

export async function getAllLinearTeams(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const teams = await fetchAllNodes(ctx, LIST_TEAMS_QUERY, data => data.teams)
  return { teams: teams.map(mapTeam) }
}

export async function getAttachment(
  input: z.infer<typeof getAttachmentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const attachmentId = str(input.attachment_id)
  const fileName = str(input.file_name)
  // 两个定位字段都是 optional,但至少要有一个 —— 跨字段约束,schema 表达不了。
  if (attachmentId === undefined && fileName === undefined) {
    throw new TBError('invalid_argument', 'linear attachment 需要 attachment_id 或 file_name')
  }

  const attachments = await fetchIssueAttachments(ctx, input.issue_id)
  const matched = attachments.find((item) => {
    const attachment = asRecord(item)
    if (attachmentId !== undefined && attachment?.id === attachmentId) return true
    if (fileName !== undefined && attachment?.title === fileName) return true
    // 最后一招:拿 URL 的最后一段(去掉 query)与 file_name 比。
    return fileName !== undefined && basenameFromUrl(String(attachment?.url ?? '')) === fileName
  })

  if (matched === undefined) {
    throw new TBError('invalid_argument', 'linear 在该 issue 下找不到匹配的 attachment')
  }
  return { attachment: mapAttachment(matched) }
}

export async function getCurrentUser(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return { viewer: mapUser(await fetchViewer(ctx)) }
}

export async function getCyclesByTeamId(
  input: z.infer<typeof getCyclesByTeamIdInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const cycles = await fetchTeamCycles(ctx, input.team_id)
  return { cycles: cycles.map(mapCycle) }
}

export async function getIssueDefaults(
  input: z.infer<typeof getIssueDefaultsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const data = await operation(ctx, `
    query GetIssueDefaults($id: String!) {
      team(id: $id) {
        defaultIssueEstimate
        defaultIssueState {
          id
          name
        }
      }
    }
  `, { id: input.team_id })

  const team = requireEntity(data.team, 'linear team 不存在')
  const defaultState = asRecord(team.defaultIssueState)
  return {
    team: {
      defaultIssueState: defaultState === undefined
        ? null
        : { id: String(defaultState.id), name: String(defaultState.name) },
      defaultIssueEstimate: num(team.defaultIssueEstimate) ?? null,
    },
  }
}

export async function getLinearIssue(
  input: z.infer<typeof getLinearIssueInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { issue: mapDetailedIssue(await fetchIssueById(ctx, input.issue_id)) }
}

export async function getLinearProject(
  input: z.infer<typeof getLinearProjectInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const includeTeams = input.include_teams === true
  const includeMembers = input.include_members === true
  const includeInitiatives = input.include_initiatives === true
  const project = await fetchProjectById(ctx, input.project_id, includeTeams, includeMembers, includeInitiatives)
  return { project: mapProject(project, { includeTeams, includeMembers, includeInitiatives }) }
}

export async function listIssuesByTeamId(
  input: z.infer<typeof listIssuesByTeamIdInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    query ListIssuesByTeamId($id: String!, $after: String, $first: Int, $includeArchived: Boolean) {
      team(id: $id) {
        ${teamFields}
        issues(after: $after, first: $first, includeArchived: $includeArchived) {
          nodes {
            ${issueFields}
          }
          pageInfo {
            ${pageInfoFields}
          }
        }
      }
    }
  `, {
    id: input.team_id,
    after: str(input.after),
    first: input.first,
    includeArchived: input.include_archived,
  })

  const team = requireEntity(payload.team, 'linear team 不存在')
  const issues = asRecord(team.issues)
  return {
    team: mapTeam(team),
    issues: nodesOf(issues).map(mapIssueSummary),
    // 只有这一个 action 的 page_info 是蛇形键,上游如此。
    page_info: mapSnakePageInfo(issues?.pageInfo),
  }
}

export async function listIssueDrafts(
  input: z.infer<typeof listIssueDraftsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    query ListIssueDrafts($after: String, $first: Int) {
      viewer {
        drafts(after: $after, first: $first, includeArchived: false) {
          nodes {
            id
            data
            bodyData
            createdAt
            updatedAt
            isAutogenerated
            team {
              ${teamFields}
            }
            issue {
              id
            }
            project {
              id
            }
            projectUpdate {
              id
            }
            user {
              ${userFields}
            }
          }
          pageInfo {
            ${pageInfoFields}
          }
        }
      }
    }
  `, { after: str(input.after), first: input.first })

  const drafts = asRecord(asRecord(payload.viewer)?.drafts)
  return { drafts: nodesOf(drafts).map(mapDraft), page_info: mapPageInfo(drafts?.pageInfo) }
}

export async function listLinearCycles(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const cycles = await fetchAllNodes(ctx, `
    query ListCycles($after: String) {
      cycles(after: $after, first: 100, includeArchived: false) {
        nodes {
          ${cycleFields}
        }
        pageInfo {
          ${pageInfoFields}
        }
      }
    }
  `, data => data.cycles)
  return { cycles: cycles.map(mapCycle) }
}

export async function listLinearIssues(
  input: z.infer<typeof listLinearIssuesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const assigneeId = await resolveAssigneeFilterId(ctx, str(input.assignee_id))
  const payload = await operation(ctx, `
    query ListLinearIssues($after: String, $first: Int, $filter: IssueFilter) {
      issues(after: $after, first: $first, includeArchived: false, filter: $filter) {
        nodes {
          ${issueFields}
        }
        pageInfo {
          ${pageInfoFields}
        }
      }
    }
  `, {
    after: str(input.after),
    first: input.first,
    filter: buildIssuesFilter(str(input.project_id), assigneeId),
  })

  const issues = asRecord(payload.issues)
  return { issues: nodesOf(issues).map(mapIssueSummary), page_info: mapPageInfo(issues?.pageInfo) }
}

export async function listLinearLabels(
  input: z.infer<typeof listLinearLabelsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const teamId = str(input.team_id)
  // 给了 team_id 就只查该团队的标签,否则翻完整个 workspace 的标签表。
  const labels = teamId === undefined
    ? await fetchAllNodes(ctx, `
        query ListWorkspaceLabels($after: String) {
          issueLabels(after: $after, first: 100, includeArchived: false) {
            nodes {
              ${labelFields}
              team {
                ${teamFields}
              }
            }
            pageInfo {
              ${pageInfoFields}
            }
          }
        }
      `, data => data.issueLabels)
    : await fetchTeamLabels(ctx, teamId)

  return { labels: labels.map(mapLabel) }
}

export async function listLinearProjects(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const projects = await fetchAllNodes(ctx, `
    query ListProjects($after: String) {
      projects(after: $after, first: 100, includeArchived: false) {
        nodes {
          ${projectFields}
        }
        pageInfo {
          ${pageInfoFields}
        }
      }
    }
  `, data => data.projects)
  return { projects: projects.map(project => mapProject(project)) }
}

export async function listLinearStates(
  input: z.infer<typeof listLinearStatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const states = await fetchTeamStates(ctx, input.team_id)
  return { states: states.map(mapWorkflowState) }
}

export async function listLinearTeams(
  input: z.infer<typeof listLinearTeamsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const teams = await fetchAllNodes(ctx, LIST_TEAMS_QUERY, data => data.teams)
  const projectId = str(input.project_id)

  // 每个团队再单独查一次成员与项目 —— N+1 次往返是上游的既定行为,故按 5 个一批限流。
  const detailedTeams = await mapWithConcurrency(teams, 5, async (team) => {
    const teamId = str(asRecord(team)?.id)
    const detailed = teamId === undefined ? (asRecord(team) ?? {}) : await fetchTeamDetails(ctx, teamId)
    return {
      ...mapTeam(detailed),
      members: nodesOf(detailed.members).map(mapUser),
      projects: nodesOf(detailed.projects)
        .filter(project => projectId === undefined || String(asRecord(project)?.id) === projectId)
        .map(project => mapProject(project)),
    }
  })

  return { teams: detailedTeams }
}

export async function listLinearUsers(
  input: z.infer<typeof listLinearUsersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    query ListUsers($after: String, $first: Int) {
      users(
        after: $after
        first: $first
        includeArchived: false
        includeDisabled: true
      ) {
        nodes {
          ${userFields}
        }
        pageInfo {
          ${pageInfoFields}
        }
      }
    }
  `, { after: str(input.after), first: input.first })

  const users = asRecord(payload.users)
  return { users: nodesOf(users).map(mapUser), page_info: mapPageInfo(users?.pageInfo) }
}

export async function removeIssueLabel(
  input: z.infer<typeof removeIssueLabelInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    mutation RemoveIssueLabel($id: String!, $labelId: String!) {
      issueRemoveLabel(id: $id, labelId: $labelId) {
        success
        issue {
          id
        }
      }
    }
  `, { id: input.issue_id, labelId: input.label_id })
  requireSuccess(payload.issueRemoveLabel, 'linear remove_issue_label 失败')

  return { issue_id: input.issue_id, label_id: input.label_id, removed: true }
}

export async function removeReaction(
  input: z.infer<typeof removeReactionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    mutation RemoveReaction($id: String!) {
      reactionDelete(id: $id) {
        success
        entityId
      }
    }
  `, { id: input.reaction_id })
  requireSuccess(payload.reactionDelete, 'linear remove_reaction 失败')

  return { reaction_id: input.reaction_id, removed: true }
}

export async function runQuery(
  input: z.infer<typeof runQueryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return rawDocument(ctx, input.query, input.variables)
}

export async function runMutation(
  input: z.infer<typeof runMutationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return rawDocument(ctx, input.mutation, input.variables)
}

export async function searchIssues(
  input: z.infer<typeof searchIssuesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    query SearchIssues($after: String, $first: Int, $includeArchived: Boolean, $term: String!) {
      searchIssues(
        after: $after
        first: $first
        includeArchived: $includeArchived
        term: $term
      ) {
        nodes {
          ${issueFields}
        }
        pageInfo {
          ${pageInfoFields}
        }
        totalCount
      }
    }
  `, {
    after: str(input.after),
    first: input.first,
    includeArchived: input.include_archived,
    // 入参叫 query,GraphQL 变量叫 term —— 别顺手改名。
    term: input.query,
  })

  const results = asRecord(payload.searchIssues)
  return {
    issues: nodesOf(results).map(mapIssueSummary),
    page_info: mapPageInfo(results?.pageInfo),
    total_count: num(results?.totalCount) ?? 0,
  }
}

export async function updateIssue(
  input: z.infer<typeof updateIssueInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue {
          id
        }
      }
    }
  `, {
    id: input.issueId,
    input: compact({
      title: str(input.title),
      teamId: str(input.teamId),
      cycleId: str(input.cycleId),
      dueDate: str(input.dueDate),
      stateId: str(input.stateId),
      estimate: input.estimate,
      labelIds: input.labelIds,
      parentId: str(input.parentId),
      priority: input.priority,
      projectId: str(input.projectId),
      assigneeId: str(input.assigneeId),
      description: str(input.description),
    }),
  })

  const issueId = mutationEntityId(payload.issueUpdate, 'issue', 'linear update_issue 失败')
  return { issue: mapDetailedIssue(await fetchIssueById(ctx, issueId)) }
}

export async function updateLinearComment(
  input: z.infer<typeof updateLinearCommentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await operation(ctx, `
    mutation UpdateComment($id: String!, $input: CommentUpdateInput!) {
      commentUpdate(id: $id, input: $input) {
        success
        comment {
          id
        }
      }
    }
  `, { id: input.comment_id, input: { body: input.body } })

  const commentId = mutationEntityId(payload.commentUpdate, 'comment', 'linear update_linear_comment 失败')
  return { comment: mapComment(await fetchCommentById(ctx, commentId)) }
}

export async function updateLinearProject(
  input: z.infer<typeof updateLinearProjectInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const requestedState = str(input.state)
  // 显式给了 status_id 就用它;否则把 state(状态**类型名**)换成 statusId —— 多一趟往返。
  const resolvedStatusId = str(input.status_id)
    ?? (requestedState === undefined ? undefined : await resolveProjectStatusId(ctx, requestedState))

  const payload = await operation(ctx, `
    mutation UpdateProject($id: String!, $input: ProjectUpdateInput!) {
      projectUpdate(id: $id, input: $input) {
        success
        project {
          id
        }
      }
    }
  `, {
    id: input.project_id,
    input: compact({
      icon: str(input.icon),
      name: str(input.name),
      color: str(input.color),
      leadId: str(input.lead_id),
      priority: input.priority,
      statusId: resolvedStatusId,
      startDate: str(input.start_date),
      description: str(input.description),
      targetDate: str(input.target_date),
    }),
  })

  const projectId = mutationEntityId(payload.projectUpdate, 'project', 'linear update_linear_project 失败')
  return { project: mapProject(await fetchProjectById(ctx, projectId, false, false, false)) }
}
