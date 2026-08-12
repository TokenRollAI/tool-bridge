/**
 * GitHub 的 pull request / review / check / workflow action(41 个)。
 * 迁移自 open-connector `runtime-pull-request.ts`。
 *
 * 四处上游细节决定了这里的形状:
 *
 * 1. **`create_pull_request_review_comment` 的 schema 全是 optional,但上游有必填断言。**
 *    生成的 `schema.ts` 忠实反映上游的 action 声明(那条声明漏了 `required`),而上游 executor
 *    里靠 `String(input.owner)` 之类隐式要求了 owner/repo/pullNumber/body/commitId/path 六个。
 *    不补断言的后果不是"报错换个说法",而是把 `undefined` 拼进 URL 打出
 *    `/repos/undefined/undefined/pulls/undefined/comments` —— 一个 404,调用方永远猜不到
 *    真正缺的是什么。故这里保留断言并抛 `invalid_argument`,**不改 schema**。
 * 2. **`check_pull_request_merged` 用状态码表达布尔结果**(204 = 已合并,404 = 未合并),
 *    两者都是成功。同 activity.ts 里的 `check_repository_starred`。
 * 3. **`requested_reviewers` 的两个写端点回的是整个 PR 对象**,而不是"reviewer 列表"。
 *    上游把 PR 原样放在 `pull_request` 下、再把两个子列表提到顶层,见 `requestedReviewers`。
 * 4. **check/workflow 族是 `{total_count, <族名>}` 信封**,不是裸数组。每个端点的族名不同
 *    (check_runs / workflows / workflow_runs / jobs / artifacts),照抄。
 *
 * `workflowId` 既可以是数字 id 也可以是文件名(`ci.yml`),故一律 `String()` 后编码 ——
 * 文件名里的点不需要转义,但走同一条路径省得两种写法。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  cancelWorkflowRunInput,
  checkPullRequestMergedInput,
  createCommitStatusInput,
  createPullRequestInput,
  createPullRequestReviewCommentInput,
  createPullRequestReviewInput,
  deletePendingPullRequestReviewInput,
  deletePullRequestReviewCommentInput,
  disableWorkflowInput,
  dismissPullRequestReviewInput,
  dispatchWorkflowInput,
  enableWorkflowInput,
  getCommitStatusesInput,
  getPullRequestInput,
  getPullRequestReviewInput,
  getWorkflowInput,
  getWorkflowRunInput,
  listCheckRunsForRefInput,
  listPullRequestCommitsInput,
  listPullRequestFilesInput,
  listPullRequestRequestedReviewersInput,
  listPullRequestReviewCommentsInput,
  listPullRequestReviewsInput,
  listPullRequestsAssociatedWithCommitInput,
  listPullRequestsInput,
  listRepositoryWorkflowsInput,
  listWorkflowRunArtifactsInput,
  listWorkflowRunJobsInput,
  listWorkflowRunsInput,
  mergePullRequestInput,
  removePullRequestReviewersInput,
  replyPullRequestReviewCommentInput,
  requestPullRequestReviewersInput,
  rerequestCheckRunInput,
  rerequestCheckSuiteInput,
  rerunFailedJobsInput,
  rerunWorkflowInput,
  submitPullRequestReviewInput,
  updatePullRequestBranchInput,
  updatePullRequestInput,
  updatePullRequestReviewCommentInput,
} from '../schema'
import {
  compact,
  count,
  githubError,
  type Json,
  objectArray,
  type ProviderContext,
  repoPath,
  requestArray,
  requestNoContent,
  requestRaw,
  requestRecord,
  requireText,
} from './shared'

/** `/repos/{o}/{r}/pulls/{n}{suffix}`。 */
function pullPath(
  input: { owner: string, pullNumber: number, repo: string },
  suffix = '',
): string {
  return repoPath(input.owner, input.repo, `/pulls/${input.pullNumber}${suffix}`)
}

/** review 端点挂在 PR 下面,评论端点(`/pulls/comments/{id}`)不挂 —— 别弄混。 */
function reviewPath(
  input: { owner: string, pullNumber: number, repo: string, reviewId: number },
  suffix = '',
): string {
  return pullPath(input, `/reviews/${input.reviewId}${suffix}`)
}

function runPath(
  input: { owner: string, repo: string, runId: number },
  suffix = '',
): string {
  return repoPath(input.owner, input.repo, `/actions/runs/${input.runId}${suffix}`)
}

function workflowPath(
  input: { owner: string, repo: string, workflowId: number | string },
  suffix = '',
): string {
  return repoPath(
    input.owner,
    input.repo,
    `/actions/workflows/${encodeURIComponent(String(input.workflowId))}${suffix}`,
  )
}

/** `{total_count, <族名>}` 信封的公共整形(见文件头第 4 点)。 */
function envelope(payload: Json, key: string): Json {
  return { total_count: count(payload.total_count), [key]: objectArray(payload[key]) }
}

// ---------------------------------------------------------------------------
// pull requests
// ---------------------------------------------------------------------------

export async function listPullRequests(
  input: z.infer<typeof listPullRequestsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const pullRequests = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, '/pulls'),
    query: {
      state: input.state,
      head: input.head,
      base: input.base,
      sort: input.sort,
      direction: input.direction,
      per_page: input.perPage,
      page: input.page,
    },
  })
  return { pull_requests: pullRequests }
}

export async function listPullRequestsAssociatedWithCommit(
  input: z.infer<typeof listPullRequestsAssociatedWithCommitInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const pullRequests = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, `/commits/${encodeURIComponent(input.commitSha)}/pulls`),
    query: { per_page: input.perPage, page: input.page },
  })
  return { pull_requests: pullRequests }
}

export function getPullRequest(
  input: z.infer<typeof getPullRequestInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, { path: pullPath(input) })
}

export function createPullRequest(
  input: z.infer<typeof createPullRequestInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: repoPath(input.owner, input.repo, '/pulls'),
    body: compact({
      title: input.title,
      // 跨仓库 PR 的 head 写成 `owner:branch`;同仓库直接写分支名。
      head: input.head,
      base: input.base,
      body: input.body,
      draft: input.draft,
      maintainer_can_modify: input.maintainerCanModify,
    }),
  })
}

export function updatePullRequest(
  input: z.infer<typeof updatePullRequestInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'PATCH',
    path: pullPath(input),
    body: compact({
      title: input.title,
      body: input.body,
      state: input.state,
      base: input.base,
      maintainer_can_modify: input.maintainerCanModify,
    }),
  })
}

export async function updatePullRequestBranch(
  input: z.infer<typeof updatePullRequestBranchInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestRecord(ctx, {
    method: 'PUT',
    path: pullPath(input, '/update-branch'),
    // 带上 expectedHeadSha 就是乐观锁:head 变过了就拒绝,避免覆盖别人刚推的提交。
    body: compact({ expected_head_sha: input.expectedHeadSha }),
  })
  // 这个端点回的是 202 + `{message, url}`(异步任务),不是 PR 对象。
  return {
    message: String(payload.message ?? ''),
    url: String(payload.url ?? ''),
  }
}

export function mergePullRequest(
  input: z.infer<typeof mergePullRequestInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'PUT',
    path: pullPath(input, '/merge'),
    body: compact({
      commit_title: input.commitTitle,
      commit_message: input.commitMessage,
      // sha 是乐观锁:与当前 head 不符就 409,不会误合并新推上来的提交。
      sha: input.sha,
      merge_method: input.mergeMethod,
    }),
  })
}

export async function checkPullRequestMerged(
  input: z.infer<typeof checkPullRequestMergedInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const { payload, response } = await requestRaw(ctx, { path: pullPath(input, '/merge') })
  // 204 与 404 都是**成功**的答案,只是答案不同(见文件头第 2 点)。
  if (response.status === 204) return { merged: true }
  if (response.status === 404) return { merged: false }
  throw githubError(response, payload)
}

export async function listPullRequestFiles(
  input: z.infer<typeof listPullRequestFilesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const files = await requestArray(ctx, {
    path: pullPath(input, '/files'),
    query: { per_page: input.perPage, page: input.page },
  })
  return { files }
}

export async function listPullRequestCommits(
  input: z.infer<typeof listPullRequestCommitsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const commits = await requestArray(ctx, {
    path: pullPath(input, '/commits'),
    query: { per_page: input.perPage, page: input.page },
  })
  return { commits }
}

// ---------------------------------------------------------------------------
// reviewers
// ---------------------------------------------------------------------------

export async function listPullRequestRequestedReviewers(
  input: z.infer<typeof listPullRequestRequestedReviewersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestRecord(ctx, { path: pullPath(input, '/requested_reviewers') })
  return { users: objectArray(payload.users), teams: objectArray(payload.teams) }
}

/**
 * 两个 requested_reviewers 写端点回的是**整个 PR 对象**,不是 reviewer 列表(见文件头第 3 点)。
 * 上游把 PR 原样留在 `pull_request` 下,再把调用方真正关心的两个子列表提到顶层。
 */
function requestedReviewers(payload: Json): Json {
  return {
    pull_request: payload,
    requested_reviewers: objectArray(payload.requested_reviewers),
    requested_teams: objectArray(payload.requested_teams),
  }
}

export async function requestPullRequestReviewers(
  input: z.infer<typeof requestPullRequestReviewersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestRecord(ctx, {
    method: 'POST',
    path: pullPath(input, '/requested_reviewers'),
    body: compact({ reviewers: input.reviewers, team_reviewers: input.teamReviewers }),
  })
  return requestedReviewers(payload)
}

export async function removePullRequestReviewers(
  input: z.infer<typeof removePullRequestReviewersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // DELETE 带 body 并返回 PR 对象 —— 不是 204。
  const payload = await requestRecord(ctx, {
    method: 'DELETE',
    path: pullPath(input, '/requested_reviewers'),
    body: compact({ reviewers: input.reviewers, team_reviewers: input.teamReviewers }),
  })
  return requestedReviewers(payload)
}

// ---------------------------------------------------------------------------
// reviews
// ---------------------------------------------------------------------------

export async function listPullRequestReviews(
  input: z.infer<typeof listPullRequestReviewsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const reviews = await requestArray(ctx, {
    path: pullPath(input, '/reviews'),
    query: { per_page: input.perPage, page: input.page },
  })
  return { reviews }
}

/**
 * 行内评论的字段改名(camelCase → snake_case)。上游对 path/body 用 `String(x ?? '')`,
 * 也就是缺失时发**空串**而不是省略该键 —— 保留:GitHub 会为此回一个说得清的 422,
 * 比这里自行判定"哪些组合算合法"(单行 / 多行 / LEFT-RIGHT 的规则相当绕)更不容易判错。
 */
function reviewComment(comment: {
  body?: string
  line?: number
  path?: string
  side?: string
  startLine?: number
  startSide?: string
}): Json {
  return compact({
    path: String(comment.path ?? ''),
    body: String(comment.body ?? ''),
    line: comment.line,
    side: comment.side,
    start_line: comment.startLine,
    start_side: comment.startSide,
  })
}

export function createPullRequestReview(
  input: z.infer<typeof createPullRequestReviewInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: pullPath(input, '/reviews'),
    body: compact({
      body: input.body,
      // 不传 event 就是存草稿(pending review),之后用 submit_pull_request_review 提交。
      event: input.event,
      commit_id: input.commitId,
      comments: input.comments?.map(comment => reviewComment(comment)),
    }),
  })
}

export function submitPullRequestReview(
  input: z.infer<typeof submitPullRequestReviewInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: reviewPath(input, '/events'),
    body: compact({ event: input.event, body: input.body }),
  })
}

export function getPullRequestReview(
  input: z.infer<typeof getPullRequestReviewInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, { path: reviewPath(input) })
}

export function dismissPullRequestReview(
  input: z.infer<typeof dismissPullRequestReviewInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'PUT',
    path: reviewPath(input, '/dismissals'),
    body: { message: input.message },
  })
}

export function deletePendingPullRequestReview(
  input: z.infer<typeof deletePendingPullRequestReviewInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 只能删还没提交的草稿 review;返回被删掉的那条,不是 204。
  return requestRecord(ctx, { method: 'DELETE', path: reviewPath(input) })
}

// ---------------------------------------------------------------------------
// review comments
// ---------------------------------------------------------------------------

export async function listPullRequestReviewComments(
  input: z.infer<typeof listPullRequestReviewCommentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const comments = await requestArray(ctx, {
    path: pullPath(input, '/comments'),
    query: {
      sort: input.sort,
      direction: input.direction,
      since: input.since,
      per_page: input.perPage,
      page: input.page,
    },
  })
  return { comments }
}

/**
 * schema 里这六个字段全是 optional(上游 action 声明漏了 `required`),但上游 executor
 * 隐式要求它们 —— 见文件头第 1 点。断言留在这里,schema 不动。
 */
export function createPullRequestReviewComment(
  input: z.infer<typeof createPullRequestReviewCommentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const owner = requireText(input.owner, 'owner')
  const repo = requireText(input.repo, 'repo')
  const pullNumber = input.pullNumber
  if (pullNumber === undefined) {
    throw new TBError('invalid_argument', 'pullNumber 是必填的')
  }
  return requestRecord(ctx, {
    method: 'POST',
    path: repoPath(owner, repo, `/pulls/${pullNumber}/comments`),
    body: compact({
      body: requireText(input.body, 'body'),
      // 行内评论必须钉在某个提交的某个文件上,这两个字段缺了 GitHub 无法定位。
      commit_id: requireText(input.commitId, 'commitId'),
      path: requireText(input.path, 'path'),
      line: input.line,
      side: input.side,
      start_line: input.startLine,
      start_side: input.startSide,
    }),
  })
}

export function replyPullRequestReviewComment(
  input: z.infer<typeof replyPullRequestReviewCommentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: pullPath(input, `/comments/${input.commentId}/replies`),
    body: { body: input.body },
  })
}

export function updatePullRequestReviewComment(
  input: z.infer<typeof updatePullRequestReviewCommentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    // 改/删单条 review 评论走 `/pulls/comments/{id}`,不挂在某个 PR 下面。
    method: 'PATCH',
    path: repoPath(input.owner, input.repo, `/pulls/comments/${input.commentId}`),
    body: { body: input.body },
  })
}

export async function deletePullRequestReviewComment(
  input: z.infer<typeof deletePullRequestReviewCommentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, {
    method: 'DELETE',
    path: repoPath(input.owner, input.repo, `/pulls/comments/${input.commentId}`),
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// commit status / checks
// ---------------------------------------------------------------------------

export function createCommitStatus(
  input: z.infer<typeof createCommitStatusInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: repoPath(input.owner, input.repo, `/statuses/${encodeURIComponent(input.sha)}`),
    body: compact({
      state: input.state,
      context: input.context,
      target_url: input.targetUrl,
      description: input.description,
    }),
  })
}

export async function getCommitStatuses(
  input: z.infer<typeof getCommitStatusesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const statuses = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, `/commits/${encodeURIComponent(input.ref)}/statuses`),
    query: { per_page: input.perPage, page: input.page },
  })
  return { statuses }
}

export async function listCheckRunsForRef(
  input: z.infer<typeof listCheckRunsForRefInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestRecord(ctx, {
    path: repoPath(input.owner, input.repo, `/commits/${encodeURIComponent(input.ref)}/check-runs`),
    query: {
      app_id: input.appId,
      check_name: input.checkName,
      filter: input.filter,
      status: input.status,
      per_page: input.perPage,
      page: input.page,
    },
  })
  return envelope(payload, 'check_runs')
}

export async function rerequestCheckRun(
  input: z.infer<typeof rerequestCheckRunInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, {
    method: 'POST',
    path: repoPath(input.owner, input.repo, `/check-runs/${input.checkRunId}/rerequest`),
  })
  return { ok: true }
}

export async function rerequestCheckSuite(
  input: z.infer<typeof rerequestCheckSuiteInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, {
    method: 'POST',
    path: repoPath(input.owner, input.repo, `/check-suites/${input.checkSuiteId}/rerequest`),
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// workflows
// ---------------------------------------------------------------------------

export async function listRepositoryWorkflows(
  input: z.infer<typeof listRepositoryWorkflowsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestRecord(ctx, {
    path: repoPath(input.owner, input.repo, '/actions/workflows'),
    query: { per_page: input.perPage, page: input.page },
  })
  return envelope(payload, 'workflows')
}

export function getWorkflow(
  input: z.infer<typeof getWorkflowInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, { path: workflowPath(input) })
}

export async function dispatchWorkflow(
  input: z.infer<typeof dispatchWorkflowInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, {
    method: 'POST',
    path: workflowPath(input, '/dispatches'),
    // inputs 的值必须全是字符串 —— GitHub 的 workflow_dispatch 不接受数字/布尔。
    body: compact({ ref: input.ref, inputs: input.inputs }),
  })
  // 204 无 body:只知道"已受理",拿不到 run id(要另外去 list_workflow_runs 找)。
  return { dispatched: true }
}

export async function enableWorkflow(
  input: z.infer<typeof enableWorkflowInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, { method: 'PUT', path: workflowPath(input, '/enable') })
  return { ok: true }
}

export async function disableWorkflow(
  input: z.infer<typeof disableWorkflowInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, { method: 'PUT', path: workflowPath(input, '/disable') })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// workflow runs
// ---------------------------------------------------------------------------

export async function listWorkflowRuns(
  input: z.infer<typeof listWorkflowRunsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestRecord(ctx, {
    path: repoPath(input.owner, input.repo, '/actions/runs'),
    query: {
      actor: input.actor,
      branch: input.branch,
      // `created` 收的是日期范围语法(`>=2024-01-01`),不是单个时间戳。
      created: input.created,
      check_suite_id: input.checkSuiteId,
      event: input.event,
      head_sha: input.headSha,
      status: input.status,
      exclude_pull_requests: input.excludePullRequests,
      per_page: input.perPage,
      page: input.page,
    },
  })
  return envelope(payload, 'workflow_runs')
}

export function getWorkflowRun(
  input: z.infer<typeof getWorkflowRunInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, { path: runPath(input) })
}

export async function listWorkflowRunJobs(
  input: z.infer<typeof listWorkflowRunJobsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestRecord(ctx, {
    path: runPath(input, '/jobs'),
    query: { filter: input.filter, per_page: input.perPage, page: input.page },
  })
  return envelope(payload, 'jobs')
}

export async function rerunWorkflow(
  input: z.infer<typeof rerunWorkflowInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, {
    method: 'POST',
    path: runPath(input, '/rerun'),
    body: compact({ enable_debug_logging: input.enableDebugLogging }),
  })
  return { rerun_requested: true }
}

export async function rerunFailedJobs(
  input: z.infer<typeof rerunFailedJobsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, {
    method: 'POST',
    path: runPath(input, '/rerun-failed-jobs'),
    body: compact({ enable_debug_logging: input.enableDebugLogging }),
  })
  return { rerun_requested: true }
}

export async function cancelWorkflowRun(
  input: z.infer<typeof cancelWorkflowRunInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, { method: 'POST', path: runPath(input, '/cancel') })
  // 202 表示"取消请求已受理",不代表 run 已经停了。
  return { cancel_requested: true }
}

export async function listWorkflowRunArtifacts(
  input: z.infer<typeof listWorkflowRunArtifactsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestRecord(ctx, {
    path: runPath(input, '/artifacts'),
    query: { name: input.name, per_page: input.perPage, page: input.page },
  })
  return envelope(payload, 'artifacts')
}
