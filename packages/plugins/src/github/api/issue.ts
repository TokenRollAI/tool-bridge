/**
 * GitHub 的 issue / label / milestone / comment action(35 个)。
 * 迁移自 open-connector `runtime-issue.ts`。
 *
 * 三处上游细节决定了这里的形状:
 *
 * 1. **`list_repository_issues` 的分页信号必须单独透出**。GitHub 的 `/issues` 端点把 issue
 *    和 pull request 混在一页里返回,上游把 PR 过滤掉 —— 于是 `issues.length` 不再等于
 *    "这一页有多少条",按页翻页的调用方失去了唯一的"还有没有下一页"判据。`pageInfo.fetched`
 *    保留的是**过滤前**的原始页长:只要 `fetched === perPage` 就还要继续翻,即使 `issues`
 *    这一页短甚至为空。丢掉这个字段,调用方会在第一个全是 PR 的页面上提前停止 —— 这是整个
 *    github 迁移里最容易迁丢的一处,测试专门钉了它。
 *    也正因如此,`perPage` 的缺省值 30 要在**这一层**兑现:调用方拿 `fetched` 与自己传的
 *    perPage 比,而没传时它比的就是 30。
 * 2. **搜索 issue/PR 不是转发 `q`,而是拼 qualifier**。`search_issues_and_pull_requests`
 *    把 owner/repo/state/label/author/… 十几个结构化入参编译成 GitHub 搜索语法
 *    (`repo:a/b is:issue label:"needs triage"`),带空白的值要加引号,否则 qualifier
 *    在空格处断开、后半段变成自由文本。见 `buildSearchQuery`。
 * 3. **`update_label` 的 color 在本地校验**。GitHub 对非法 hex 回的是一个 422
 *    "Validation Failed",看不出错在哪;上游在本地断言 6 位 hex(不带 #)并直接说清。保留。
 *
 * `remove_issue_label` / `remove_issue_assignees` 是**带 body 或有返回值的 DELETE**,
 * 不是 204 —— 它们返回剩下的 label / 更新后的 issue,故走 requestArray/requestRecord。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  addIssueAssigneesInput,
  addIssueLabelsInput,
  clearIssueLabelsInput,
  createIssueCommentInput,
  createIssueCommentReactionInput,
  createIssueInput,
  createIssueReactionInput,
  createLabelInput,
  createMilestoneInput,
  deleteIssueCommentInput,
  deleteLabelInput,
  deleteMilestoneInput,
  getIssueCommentInput,
  getIssueInput,
  getLabelInput,
  getMilestoneInput,
  listAssigneesInput,
  listIssueCommentsInput,
  listIssueEventsInput,
  listIssueLabelsInput,
  listIssueTimelineEventsInput,
  listMilestonesInput,
  listRepositoryIssueEventsInput,
  listRepositoryIssuesInput,
  listRepositoryLabelsInput,
  lockIssueInput,
  removeIssueAssigneesInput,
  removeIssueLabelInput,
  searchIssuesAndPullRequestsInput,
  setIssueLabelsInput,
  unlockIssueInput,
  updateIssueCommentInput,
  updateIssueInput,
  updateLabelInput,
  updateMilestoneInput,
} from '../schema'
import {
  compact,
  count,
  type Json,
  objectArray,
  type ProviderContext,
  repoPath,
  requestArray,
  requestNoContent,
  requestRecord,
  text,
} from './shared'

/** `/repos/{o}/{r}/issues/{n}{suffix}`;issueNumber 是整数,不需要编码。 */
function issuePath(
  input: { issueNumber: number, owner: string, repo: string },
  suffix = '',
): string {
  return repoPath(input.owner, input.repo, `/issues/${input.issueNumber}${suffix}`)
}

/** `/repos/{o}/{r}/issues/comments/{id}{suffix}` —— 评论端点不挂在 issue 下面。 */
function commentPath(
  input: { commentId: number, owner: string, repo: string },
  suffix = '',
): string {
  return repoPath(input.owner, input.repo, `/issues/comments/${input.commentId}${suffix}`)
}

function labelPath(input: { name: string, owner: string, repo: string }): string {
  return repoPath(input.owner, input.repo, `/labels/${encodeURIComponent(input.name)}`)
}

function milestonePath(input: { milestoneNumber: number, owner: string, repo: string }): string {
  return repoPath(input.owner, input.repo, `/milestones/${input.milestoneNumber}`)
}

// ---------------------------------------------------------------------------
// issues
// ---------------------------------------------------------------------------

/** 上游的缺省页大小。写成常量是因为它同时决定了出参里 `pageInfo.fetched` 的参照值。 */
const DEFAULT_ISSUES_PER_PAGE = 30

export async function listRepositoryIssues(
  input: z.infer<typeof listRepositoryIssuesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const perPage = input.perPage ?? DEFAULT_ISSUES_PER_PAGE
  const page = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, '/issues'),
    query: {
      state: input.state,
      // labels 是**逗号分隔**的单个参数,不是重复同名参数。
      labels: input.labels === undefined ? undefined : input.labels.join(','),
      sort: input.sort,
      direction: input.direction,
      since: text(input.since),
      per_page: perPage,
      page: input.page,
    },
  })

  return {
    // `pull_request` 字段存在就说明这一条其实是 PR。`== null` 同时覆盖 undefined 与 null。
    issues: page.filter(issue => issue.pull_request == null),
    // 过滤前的原始页长 —— 调用方唯一的"还有下一页"判据,见文件头第 1 点。
    pageInfo: { fetched: page.length },
  }
}

export function createIssue(
  input: z.infer<typeof createIssueInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: repoPath(input.owner, input.repo, '/issues'),
    body: compact({
      title: input.title,
      body: input.body,
      assignees: input.assignees,
      labels: input.labels,
      milestone: input.milestone,
    }),
  })
}

export function getIssue(
  input: z.infer<typeof getIssueInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, { path: issuePath(input) })
}

export function updateIssue(
  input: z.infer<typeof updateIssueInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'PATCH',
    path: issuePath(input),
    body: compact({
      title: input.title,
      body: input.body,
      state: input.state,
      // 传空数组是"清空"的正规写法(与"不传"不同),故不做空数组过滤。
      assignees: input.assignees,
      labels: input.labels,
      // 上游这里用 nullableInteger,允许 null 表示"摘掉 milestone";但生成的 schema 把
      // milestone 声明成 `z.int().min(1).optional()`,null 进不来 —— 那条路径在本产物里
      // 不可达。照声明走,不自行放宽。
      milestone: input.milestone,
    }),
  })
}

export async function lockIssue(
  input: z.infer<typeof lockIssueInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, {
    method: 'PUT',
    path: issuePath(input, '/lock'),
    body: compact({ lock_reason: input.lockReason }),
  })
  return { locked: true }
}

export async function unlockIssue(
  input: z.infer<typeof unlockIssueInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, { method: 'DELETE', path: issuePath(input, '/lock') })
  return { locked: false }
}

export function addIssueAssignees(
  input: z.infer<typeof addIssueAssigneesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: issuePath(input, '/assignees'),
    body: { assignees: input.assignees },
  })
}

export function removeIssueAssignees(
  input: z.infer<typeof removeIssueAssigneesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // DELETE 带 body 并返回更新后的 issue —— 不是 204。
  return requestRecord(ctx, {
    method: 'DELETE',
    path: issuePath(input, '/assignees'),
    body: { assignees: input.assignees },
  })
}

export async function listAssignees(
  input: z.infer<typeof listAssigneesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const assignees = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, '/assignees'),
    query: { per_page: input.perPage, page: input.page },
  })
  return { assignees }
}

export function createIssueReaction(
  input: z.infer<typeof createIssueReactionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: issuePath(input, '/reactions'),
    body: { content: input.content },
  })
}

// ---------------------------------------------------------------------------
// labels
// ---------------------------------------------------------------------------

export async function listRepositoryLabels(
  input: z.infer<typeof listRepositoryLabelsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const labels = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, '/labels'),
    query: { per_page: input.perPage, page: input.page },
  })
  return { labels }
}

export function createLabel(
  input: z.infer<typeof createLabelInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: repoPath(input.owner, input.repo, '/labels'),
    body: compact({
      name: input.name,
      color: input.color,
      description: input.description,
    }),
  })
}

export function getLabel(
  input: z.infer<typeof getLabelInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, { path: labelPath(input) })
}

/** 6 位 hex,不带 `#`。GitHub 对非法值只回 "Validation Failed",故在本地先说清。 */
function requireHexColor(color: string): string {
  if (!/^[0-9a-f]{6}$/i.test(color)) {
    throw new TBError('invalid_argument', 'color 必须是不带 # 的 6 位十六进制颜色')
  }
  return color
}

export function updateLabel(
  input: z.infer<typeof updateLabelInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'PATCH',
    path: labelPath(input),
    body: compact({
      new_name: input.newName,
      color: input.color === undefined ? undefined : requireHexColor(input.color),
      description: input.description,
    }),
  })
}

export async function deleteLabel(
  input: z.infer<typeof deleteLabelInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, { method: 'DELETE', path: labelPath(input) })
  return { ok: true }
}

export async function listIssueLabels(
  input: z.infer<typeof listIssueLabelsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const labels = await requestArray(ctx, {
    path: issuePath(input, '/labels'),
    query: { per_page: input.perPage, page: input.page },
  })
  return { labels }
}

export async function addIssueLabels(
  input: z.infer<typeof addIssueLabelsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // POST 是"追加",返回追加后的全集。
  const labels = await requestArray(ctx, {
    method: 'POST',
    path: issuePath(input, '/labels'),
    body: { labels: input.labels },
  })
  return { labels }
}

export async function setIssueLabels(
  input: z.infer<typeof setIssueLabelsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // PUT 是"替换全集";传空数组就等于清空。
  const labels = await requestArray(ctx, {
    method: 'PUT',
    path: issuePath(input, '/labels'),
    body: { labels: input.labels },
  })
  return { labels }
}

export async function removeIssueLabel(
  input: z.infer<typeof removeIssueLabelInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 摘掉单个 label 的 DELETE 会返回**剩下的** label 列表,不是 204。
  const labels = await requestArray(ctx, {
    method: 'DELETE',
    path: issuePath(input, `/labels/${encodeURIComponent(input.label)}`),
  })
  return { labels }
}

export async function clearIssueLabels(
  input: z.infer<typeof clearIssueLabelsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 不带 label 名的 DELETE 清空全部,这个才是 204。
  await requestNoContent(ctx, { method: 'DELETE', path: issuePath(input, '/labels') })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// comments
// ---------------------------------------------------------------------------

export async function listIssueComments(
  input: z.infer<typeof listIssueCommentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const comments = await requestArray(ctx, {
    path: issuePath(input, '/comments'),
    query: { per_page: input.perPage, page: input.page },
  })
  return { comments }
}

export function createIssueComment(
  input: z.infer<typeof createIssueCommentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: issuePath(input, '/comments'),
    body: { body: input.body },
  })
}

export function getIssueComment(
  input: z.infer<typeof getIssueCommentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, { path: commentPath(input) })
}

export function updateIssueComment(
  input: z.infer<typeof updateIssueCommentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'PATCH',
    path: commentPath(input),
    body: { body: input.body },
  })
}

export async function deleteIssueComment(
  input: z.infer<typeof deleteIssueCommentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, { method: 'DELETE', path: commentPath(input) })
  return { ok: true }
}

export function createIssueCommentReaction(
  input: z.infer<typeof createIssueCommentReactionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: commentPath(input, '/reactions'),
    body: { content: input.content },
  })
}

// ---------------------------------------------------------------------------
// milestones
// ---------------------------------------------------------------------------

export async function listMilestones(
  input: z.infer<typeof listMilestonesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const milestones = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, '/milestones'),
    query: {
      state: input.state,
      sort: input.sort,
      direction: input.direction,
      per_page: input.perPage,
      page: input.page,
    },
  })
  return { milestones }
}

export function getMilestone(
  input: z.infer<typeof getMilestoneInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, { path: milestonePath(input) })
}

export function createMilestone(
  input: z.infer<typeof createMilestoneInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: repoPath(input.owner, input.repo, '/milestones'),
    body: compact({
      title: input.title,
      state: input.state,
      description: input.description,
      due_on: text(input.dueOn),
    }),
  })
}

export function updateMilestone(
  input: z.infer<typeof updateMilestoneInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'PATCH',
    path: milestonePath(input),
    body: compact({
      title: input.title,
      state: input.state,
      description: input.description,
      due_on: text(input.dueOn),
    }),
  })
}

export async function deleteMilestone(
  input: z.infer<typeof deleteMilestoneInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, { method: 'DELETE', path: milestonePath(input) })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

export async function listIssueTimelineEvents(
  input: z.infer<typeof listIssueTimelineEventsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const events = await requestArray(ctx, {
    path: issuePath(input, '/timeline'),
    query: { per_page: input.perPage, page: input.page },
  })
  return { events }
}

export async function listIssueEvents(
  input: z.infer<typeof listIssueEventsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const events = await requestArray(ctx, {
    path: issuePath(input, '/events'),
    query: { per_page: input.perPage, page: input.page },
  })
  return { events }
}

export async function listRepositoryIssueEvents(
  input: z.infer<typeof listRepositoryIssueEventsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const events = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, '/issues/events'),
    query: { per_page: input.perPage, page: input.page },
  })
  return { events }
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

/** 带空白的 qualifier 值必须加引号,否则会在空格处断开(`label:needs triage` ≠ 想要的)。 */
function quote(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value
}

/**
 * 把结构化入参编译成 GitHub 搜索语法。自由文本(`query` 或它的别名 `q`)排在最前,
 * 后面跟按固定顺序拼出的 qualifier。
 *
 * 三处不显然的规则,都照上游:
 * - `owner` + `repo` → `repo:owner/repo`;只给 `repo` 且它自带斜杠 → 直接当全名用;
 *   只给 `owner` → `user:owner`(搜这个账号下的全部仓库)。
 * - `state: 'all'` 表示"不加 state 限定",故不发出 qualifier。
 * - `isMerged` 是布尔:false 要发 `is:unmerged`,不是"不发"。
 */
export function buildSearchQuery(input: z.infer<typeof searchIssuesAndPullRequestsInput>): string {
  const free = text(input.query) ?? text(input.q)
  const qualifiers: string[] = []

  const owner = text(input.owner)
  const repo = text(input.repo)
  if (owner !== undefined && repo !== undefined) {
    qualifiers.push(`repo:${owner}/${repo}`)
  } else if (repo?.includes('/') === true) {
    qualifiers.push(`repo:${repo}`)
  } else if (owner !== undefined) {
    qualifiers.push(`user:${owner}`)
  }

  const state = text(input.state)
  if (state !== undefined && state !== 'all') qualifiers.push(`state:${state}`)
  if (input.type === 'issue') qualifiers.push('is:issue')
  else if (input.type === 'pr') qualifiers.push('is:pr')

  const label = text(input.label)
  if (label !== undefined) qualifiers.push(`label:${quote(label)}`)

  // 入参名 → qualifier 名。顺序即出现顺序,改了会让已有调用方的查询串变样。
  const mapped: [keyof typeof input, string][] = [
    ['author', 'author'],
    ['assignee', 'assignee'],
    ['mentions', 'mentions'],
    ['language', 'language'],
    ['baseBranch', 'base'],
    ['headBranch', 'head'],
  ]
  for (const [key, qualifier] of mapped) {
    const value = text(input[key])
    if (value !== undefined) qualifiers.push(`${qualifier}:${quote(value)}`)
  }

  if (typeof input.isMerged === 'boolean') {
    qualifiers.push(input.isMerged ? 'is:merged' : 'is:unmerged')
  }

  return [...(free === undefined ? [] : [free]), ...qualifiers].join(' ').trim()
}

export async function searchIssuesAndPullRequests(
  input: z.infer<typeof searchIssuesAndPullRequestsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const response = await requestRecord(ctx, {
    path: '/search/issues',
    query: {
      q: buildSearchQuery(input),
      sort: input.sort,
      order: input.order,
      per_page: input.perPage,
      page: input.page,
    },
  })
  return {
    total_count: count(response.total_count),
    incomplete_results: Boolean(response.incomplete_results),
    items: objectArray(response.items),
  }
}
