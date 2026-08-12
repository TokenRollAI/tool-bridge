/**
 * GitHub 的 repository / user / git-ref / contents action(40 个)。
 * 迁移自 open-connector `runtime-repository.ts`。
 *
 * 四处上游细节决定了这里的形状:
 *
 * 1. **contents 端点用同一个 URL 表达文件与目录**,回的是对象还是数组取决于路径指向什么。
 *    `list_directory_contents` 与 `get_file_contents` 打的是同一个端点,各自只接受一种形状,
 *    拿到另一种就报 `invalid_argument`("你要的是文件,但这是个目录")—— 这比把数组硬塞进
 *    文件出参、让调用方拿到一堆 undefined 字段有用得多。
 * 2. **`decoded_content` 缺席而不是 null**。上游的 `decodeGitHubContent` 解不出来时返回
 *    `null`,但生成的出参声明写的是 `z.string().optional()` —— null 不在契约里。二进制文件
 *    (解不成合法 UTF-8)走的正是这条路,故这里返回 `undefined` 让 `compact` 把键丢掉。
 *    这是以**声明**为准的一处有意偏离,理由是声明才是消费者看到的东西。
 * 3. **`add_repository_collaborator` 用状态码区分两种成功**:204 = 已是协作者(什么都没发生),
 *    201 = 发出了邀请(body 是邀请对象)。走普通的 requestJson 会把 204 的空 body 当成
 *    "响应不是对象"而报 unavailable。
 * 4. **空仓库的 contributors 回 204 空 body**,不是 `[]`。归一成空列表,否则"新建的空仓库"
 *    这个完全正常的状态会变成一个错误。
 *
 * `create_repository` 的 homepage 去空白、`update_repository` 的 homepage 保留原样(含空串)
 * 是上游有意的不对称:前者"空等于没填",后者"空等于把主页清掉"。照抄。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  addRepositoryCollaboratorInput,
  compareCommitsInput,
  createCommitCommentInput,
  createOrUpdateFileInput,
  createRefInput,
  createRepositoryInput,
  deleteFileInput,
  deleteRefInput,
  deleteRepositoryInput,
  forkRepositoryInput,
  getBranchInput,
  getCommitInput,
  getCurrentUserInput,
  getFileContentsInput,
  getRefInput,
  getRepositoryInput,
  getRepositoryPermissionForUserInput,
  getRepositoryReadmeInput,
  getUserInput,
  listBranchesInput,
  listCommitCommentsInput,
  listCommitsInput,
  listDirectoryContentsInput,
  listMatchingRefsInput,
  listMyRepositoriesInput,
  listOrganizationRepositoriesInput,
  listRepositoryCollaboratorsInput,
  listRepositoryContributorsInput,
  listRepositoryForksInput,
  listRepositoryLanguagesInput,
  listRepositoryTagsInput,
  listRepositoryTopicsInput,
  listUserRepositoriesInput,
  mergeBranchInput,
  removeRepositoryCollaboratorInput,
  renameBranchInput,
  replaceRepositoryTopicsInput,
  syncForkBranchWithUpstreamInput,
  updateRefInput,
  updateRepositoryInput,
} from '../schema'
import {
  compact,
  contentsPath,
  decodeContent,
  encodeContent,
  githubError,
  type Json,
  objectArray,
  type ProviderContext,
  refPath,
  repoPath,
  requestArray,
  requestJson,
  requestNoContent,
  requestRaw,
  requestRecord,
  requireArray,
  requireBranchOrTagRef,
  text,
} from './shared'

// ---------------------------------------------------------------------------
// user
// ---------------------------------------------------------------------------

export function getCurrentUser(
  _input: z.infer<typeof getCurrentUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, { path: '/user' })
}

export function getUser(
  input: z.infer<typeof getUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, { path: `/users/${encodeURIComponent(input.username)}` })
}

// ---------------------------------------------------------------------------
// repository CRUD
// ---------------------------------------------------------------------------

export async function listMyRepositories(
  input: z.infer<typeof listMyRepositoriesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const repositories = await requestArray(ctx, {
    path: '/user/repos',
    query: {
      visibility: input.visibility,
      sort: input.sort,
      direction: input.direction,
      per_page: input.perPage,
      page: input.page,
    },
  })
  return { repositories }
}

export function createRepository(
  input: z.infer<typeof createRepositoryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: '/user/repos',
    body: compact({
      name: input.name,
      description: input.description,
      // 建仓时空 homepage 等于没填(与 update_repository 相反,见文件头)。
      homepage: text(input.homepage),
      private: input.private,
      auto_init: input.autoInit,
      has_issues: input.hasIssues,
      has_projects: input.hasProjects,
      has_wiki: input.hasWiki,
      has_discussions: input.hasDiscussions,
      gitignore_template: text(input.gitignoreTemplate),
      license_template: text(input.licenseTemplate),
    }),
  })
}

export function getRepository(
  input: z.infer<typeof getRepositoryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, { path: repoPath(input.owner, input.repo) })
}

export function updateRepository(
  input: z.infer<typeof updateRepositoryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'PATCH',
    path: repoPath(input.owner, input.repo),
    body: compact({
      name: input.name,
      description: input.description,
      // 改仓设置时空 homepage 等于"把主页清掉",故原样发出。
      homepage: input.homepage,
      private: input.private,
      visibility: input.visibility,
      default_branch: text(input.defaultBranch),
      has_issues: input.hasIssues,
      has_projects: input.hasProjects,
      has_wiki: input.hasWiki,
      has_discussions: input.hasDiscussions,
      allow_squash_merge: input.allowSquashMerge,
      allow_merge_commit: input.allowMergeCommit,
      allow_rebase_merge: input.allowRebaseMerge,
      allow_auto_merge: input.allowAutoMerge,
      delete_branch_on_merge: input.deleteBranchOnMerge,
      archived: input.archived,
    }),
  })
}

export async function deleteRepository(
  input: z.infer<typeof deleteRepositoryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, { method: 'DELETE', path: repoPath(input.owner, input.repo) })
  return { ok: true }
}

export function forkRepository(
  input: z.infer<typeof forkRepositoryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: repoPath(input.owner, input.repo, '/forks'),
    body: compact({
      organization: text(input.organization),
      name: text(input.name),
      default_branch_only: input.defaultBranchOnly,
    }),
  })
}

export async function listRepositoryForks(
  input: z.infer<typeof listRepositoryForksInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const repositories = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, '/forks'),
    query: { sort: input.sort, per_page: input.perPage, page: input.page },
  })
  return { repositories }
}

export async function listOrganizationRepositories(
  input: z.infer<typeof listOrganizationRepositoriesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const repositories = await requestArray(ctx, {
    path: `/orgs/${encodeURIComponent(input.org)}/repos`,
    query: {
      type: input.type,
      sort: input.sort,
      direction: input.direction,
      per_page: input.perPage,
      page: input.page,
    },
  })
  return { repositories }
}

export async function listUserRepositories(
  input: z.infer<typeof listUserRepositoriesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const repositories = await requestArray(ctx, {
    path: `/users/${encodeURIComponent(input.username)}/repos`,
    query: {
      type: input.type,
      sort: input.sort,
      direction: input.direction,
      per_page: input.perPage,
      page: input.page,
    },
  })
  return { repositories }
}

// ---------------------------------------------------------------------------
// branches
// ---------------------------------------------------------------------------

export async function listBranches(
  input: z.infer<typeof listBranchesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const branches = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, '/branches'),
    // 入参叫 protectedOnly,query 参数叫 protected(`protected` 是保留字,上游为此改了入参名)。
    query: { protected: input.protectedOnly, per_page: input.perPage, page: input.page },
  })
  return { branches }
}

export function getBranch(
  input: z.infer<typeof getBranchInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    path: repoPath(input.owner, input.repo, `/branches/${encodeURIComponent(input.branch)}`),
  })
}

export function renameBranch(
  input: z.infer<typeof renameBranchInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: repoPath(input.owner, input.repo, `/branches/${encodeURIComponent(input.branch)}/rename`),
    body: { new_name: input.newName },
  })
}

export function mergeBranch(
  input: z.infer<typeof mergeBranchInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: repoPath(input.owner, input.repo, '/merges'),
    body: compact({
      base: input.base,
      head: input.head,
      commit_message: input.commitMessage,
    }),
  })
}

export function syncForkBranchWithUpstream(
  input: z.infer<typeof syncForkBranchWithUpstreamInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: repoPath(input.owner, input.repo, '/merge-upstream'),
    body: { branch: input.branch },
  })
}

// ---------------------------------------------------------------------------
// commits
// ---------------------------------------------------------------------------

export async function listCommits(
  input: z.infer<typeof listCommitsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const commits = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, '/commits'),
    query: {
      sha: text(input.sha),
      path: text(input.path),
      author: text(input.author),
      committer: text(input.committer),
      since: text(input.since),
      until: text(input.until),
      per_page: input.perPage,
      page: input.page,
    },
  })
  return { commits }
}

export function getCommit(
  input: z.infer<typeof getCommitInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    path: repoPath(input.owner, input.repo, `/commits/${encodeURIComponent(input.ref)}`),
  })
}

export async function compareCommits(
  input: z.infer<typeof compareCommitsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const comparison = await requestRecord(ctx, {
    // basehead 是 `base...head` 这种复合语法,整段编码(`...` 会变成 %2E%2E%2E,GitHub 收)。
    path: repoPath(input.owner, input.repo, `/compare/${encodeURIComponent(input.basehead)}`),
    query: { per_page: input.perPage, page: input.page },
  })
  // 两个子列表被提到顶层(它们是调用方真正要的),完整对比对象也一并留着。
  return {
    comparison,
    commits: objectArray(comparison.commits),
    files: objectArray(comparison.files),
  }
}

export function createCommitComment(
  input: z.infer<typeof createCommitCommentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: repoPath(input.owner, input.repo, `/commits/${encodeURIComponent(input.commitSha)}/comments`),
    body: compact({
      body: input.body,
      path: text(input.path),
      position: input.position,
    }),
  })
}

export async function listCommitComments(
  input: z.infer<typeof listCommitCommentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const comments = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, `/commits/${encodeURIComponent(input.commitSha)}/comments`),
    query: { per_page: input.perPage, page: input.page },
  })
  return { comments }
}

// ---------------------------------------------------------------------------
// contents
// ---------------------------------------------------------------------------

/**
 * 文件出参的公共整形:补 base64 原文与解码后的文本(见文件头第 2 点)。
 *
 * 上游 `content` 键**不透出**,这是一处有意偏离:生成的出参声明里没有它(只有
 * `content_base64` 与 `decoded_content`),它是上游 `{...response}` 顺手漏出来的。
 * `content_base64` 承载的是同一份信息(还去掉了折行),丢掉它没有任何损失。
 *
 * 附带一段历史:这个键当初还会撞上 `toToolResult` —— 那时它只看"有没有顶层 content 键"
 * 就把整个对象当成已成形的 ToolResult 透传,于是文件结果会退化成一串 base64。core 现在
 * 改成"键集合必须只含 ToolResult 的已知键"才透传(core/src/operation/registry.ts),
 * 这条碰撞已经不存在了;留着不透出纯粹是为了对齐声明。
 */
function fileContents(payload: Json): Json {
  // GitHub 的 base64 是按 60 字符折行的,`atob` 不吃换行,先去掉。
  const contentBase64 = typeof payload.content === 'string' ? payload.content.replace(/\n/g, '') : ''
  const rest = { ...payload }
  delete rest.content
  return compact({
    ...rest,
    content_base64: contentBase64,
    decoded_content: decodeContent(contentBase64, text(payload.encoding)),
  })
}

export async function listDirectoryContents(
  input: z.infer<typeof listDirectoryContentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestJson(ctx, {
    path: contentsPath(input.owner, input.repo, text(input.path)),
    query: { ref: text(input.ref) },
  })
  if (!Array.isArray(payload)) {
    // 同一个端点也返回文件对象;那是调用方给错了路径,不是上游故障。
    throw new TBError('invalid_argument', 'path 指向的不是目录')
  }
  return { entries: payload as Json[] }
}

export async function getFileContents(
  input: z.infer<typeof getFileContentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestJson(ctx, {
    path: contentsPath(input.owner, input.repo, input.path),
    query: { ref: text(input.ref) },
  })
  if (Array.isArray(payload)) {
    throw new TBError('invalid_argument', 'path 指向的是目录,不是文件')
  }
  const file = payload as Json
  // symlink / submodule 也回对象,但没有可读内容,故一并挡在这里。
  if (file.type !== 'file') {
    throw new TBError('invalid_argument', 'path 指向的不是普通文件')
  }
  return fileContents(file)
}

export async function getRepositoryReadme(
  input: z.infer<typeof getRepositoryReadmeInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestRecord(ctx, {
    path: repoPath(input.owner, input.repo, '/readme'),
    query: { ref: text(input.ref) },
  })
  if (payload.type !== 'file') {
    throw new TBError('invalid_argument', 'readme 指向的不是普通文件')
  }
  return fileContents(payload)
}

export function createOrUpdateFile(
  input: z.infer<typeof createOrUpdateFileInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'PUT',
    path: contentsPath(input.owner, input.repo, input.path),
    body: compact({
      message: input.message,
      content: encodeContent(input),
      // 改已有文件必须带 sha(乐观锁);不带就是新建。上游不在本地断言,交给 GitHub 判。
      sha: text(input.sha),
      branch: text(input.branch),
    }),
  })
}

export function deleteFile(
  input: z.infer<typeof deleteFileInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    // DELETE 带 JSON body —— contents API 就是这么设计的,不是笔误。
    method: 'DELETE',
    path: contentsPath(input.owner, input.repo, input.path),
    body: compact({
      message: input.message,
      sha: input.sha,
      branch: text(input.branch),
    }),
  })
}

// ---------------------------------------------------------------------------
// 仓库元信息
// ---------------------------------------------------------------------------

export async function listRepositoryTags(
  input: z.infer<typeof listRepositoryTagsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const tags = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, '/tags'),
    query: { per_page: input.perPage, page: input.page },
  })
  return { tags }
}

export async function listRepositoryLanguages(
  input: z.infer<typeof listRepositoryLanguagesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 这个端点回的是 `{TypeScript: 12345, ...}` 字节数映射,不是列表。
  const languages = await requestRecord(ctx, { path: repoPath(input.owner, input.repo, '/languages') })
  return { languages }
}

export async function listRepositoryContributors(
  input: z.infer<typeof listRepositoryContributorsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestJson(ctx, {
    path: repoPath(input.owner, input.repo, '/contributors'),
    query: { anon: input.anon, per_page: input.perPage, page: input.page },
  })
  // 空仓库回 204 无 body(见文件头第 4 点):这是正常状态,不是错误。
  if (payload === null) return { contributors: [] }
  return { contributors: requireArray(payload, 'GitHub contributors 响应') }
}

export function listRepositoryTopics(
  input: z.infer<typeof listRepositoryTopicsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 出参就是上游的 `{names: [...]}`,不做二次包装。
  return requestRecord(ctx, {
    path: repoPath(input.owner, input.repo, '/topics'),
    query: { per_page: input.perPage, page: input.page },
  })
}

export function replaceRepositoryTopics(
  input: z.infer<typeof replaceRepositoryTopicsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // PUT 语义:传的是**全集**,漏掉的 topic 会被删掉。
  return requestRecord(ctx, {
    method: 'PUT',
    path: repoPath(input.owner, input.repo, '/topics'),
    body: { names: input.names },
  })
}

// ---------------------------------------------------------------------------
// collaborators
// ---------------------------------------------------------------------------

export async function listRepositoryCollaborators(
  input: z.infer<typeof listRepositoryCollaboratorsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const collaborators = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, '/collaborators'),
    query: {
      affiliation: input.affiliation,
      permission: input.permission,
      per_page: input.perPage,
      page: input.page,
    },
  })
  return { collaborators }
}

export async function addRepositoryCollaborator(
  input: z.infer<typeof addRepositoryCollaboratorInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const { payload, response } = await requestRaw(ctx, {
    method: 'PUT',
    path: repoPath(
      input.owner,
      input.repo,
      `/collaborators/${encodeURIComponent(input.username)}`,
    ),
    // body 恒为对象(permission 缺省时是 `{}`)—— 保持与上游一致的 content-type: application/json。
    body: compact({ permission: input.permission }),
  })

  // 204:此人本来就是协作者,没有产生邀请。
  if (response.status === 204) return { invited: false, invitation: null }
  if (!response.ok) throw githubError(response, payload)
  // 201:发出了邀请,body 是邀请对象。
  if (response.status === 201) return { invited: true, invitation: payload }
  // 契约里只有 204/201 两种成功;别的 2xx 说明上游变了形状。
  throw new TBError('unavailable', `GitHub 协作者接口返回了意料之外的 ${response.status}`, {
    retryable: true,
  })
}

export async function removeRepositoryCollaborator(
  input: z.infer<typeof removeRepositoryCollaboratorInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, {
    method: 'DELETE',
    path: repoPath(input.owner, input.repo, `/collaborators/${encodeURIComponent(input.username)}`),
  })
  return { ok: true }
}

export function getRepositoryPermissionForUser(
  input: z.infer<typeof getRepositoryPermissionForUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    path: repoPath(
      input.owner,
      input.repo,
      `/collaborators/${encodeURIComponent(input.username)}/permission`,
    ),
  })
}

// ---------------------------------------------------------------------------
// git refs
// ---------------------------------------------------------------------------

export function createRef(
  input: z.infer<typeof createRefInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 建 ref 用的是**全限定** ref(`refs/heads/x`),与 get/update/delete 的"不带 refs/ 前缀"
  // 相反 —— GitHub API 自身的不一致,故这里不套 requireBranchOrTagRef。
  return requestRecord(ctx, {
    method: 'POST',
    path: repoPath(input.owner, input.repo, '/git/refs'),
    body: { ref: input.ref, sha: input.sha },
  })
}

export function getRef(
  input: z.infer<typeof getRefInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ref = requireBranchOrTagRef(input.ref)
  return requestRecord(ctx, {
    // 单数 `git/ref/`,不是 `git/refs/` —— 复数那个是"列出匹配项"。
    path: repoPath(input.owner, input.repo, `/git/ref/${refPath(ref)}`),
  })
}

export async function listMatchingRefs(
  input: z.infer<typeof listMatchingRefsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 这个端点不分页(上游也没给分页入参),总是回全部匹配项。
  const refs = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, `/git/matching-refs/${refPath(input.ref)}`),
  })
  return { refs }
}

export function updateRef(
  input: z.infer<typeof updateRefInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ref = requireBranchOrTagRef(input.ref)
  return requestRecord(ctx, {
    method: 'PATCH',
    path: repoPath(input.owner, input.repo, `/git/refs/${refPath(ref)}`),
    body: compact({ sha: input.sha, force: input.force }),
  })
}

export async function deleteRef(
  input: z.infer<typeof deleteRefInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ref = requireBranchOrTagRef(input.ref)
  await requestNoContent(ctx, {
    method: 'DELETE',
    path: repoPath(input.owner, input.repo, `/git/refs/${refPath(ref)}`),
  })
  return { ok: true }
}
