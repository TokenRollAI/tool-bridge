/**
 * GitHub —— 从 open-connector 迁移的 provider(145 个 action,本批最大的一个)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api/` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * `api.ts` 按上游的 runtime-* 维度拆成了六个模块 —— 145 个 handler 塞一个文件没法 review。
 * 每个模块顶部都交代了"上游哪几处细节决定了它的形状",共用的请求层在 `api/shared.ts`。
 *
 * **凭证在 header**(`authorization: Bearer <token>`),不在 URL,日志脱敏只需要盯这一个头。
 * 上游同时支持 PAT 与平台托管的 OAuth2;这里只声明单值 API key,因为 GitHub 的两种凭证
 * 打在线上是**同一个 Bearer 头**,拿 OAuth access token 当 apiKey 配进来一样能用 ——
 * 而声明了 `oauth` 就不能再声明 `credentialProbe`(SDK 当场拒),挂载时验不了凭证。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import * as pullRequest from './api/pull-request'
import * as repository from './api/repository'
import * as activity from './api/activity'
import * as release from './api/release'
import { githubActions } from './schema'
import * as search from './api/search'
import * as issue from './api/issue'

export type { ProviderEnv as Env }

export function createGithubPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'GitHub',
    actions: githubActions,
    // 挂载时用真实凭证调一次 `GET /user`:只读、零副作用、无必填入参,配错的 token 当场拒。
    credentialProbe: 'get_current_user',
    handlers: {
      // repository / user / git ref / contents(40)
      get_current_user: repository.getCurrentUser,
      list_my_repositories: repository.listMyRepositories,
      create_repository: repository.createRepository,
      list_branches: repository.listBranches,
      get_branch: repository.getBranch,
      get_repository: repository.getRepository,
      delete_repository: repository.deleteRepository,
      list_commits: repository.listCommits,
      create_ref: repository.createRef,
      get_commit: repository.getCommit,
      compare_commits: repository.compareCommits,
      list_directory_contents: repository.listDirectoryContents,
      get_file_contents: repository.getFileContents,
      merge_branch: repository.mergeBranch,
      rename_branch: repository.renameBranch,
      sync_fork_branch_with_upstream: repository.syncForkBranchWithUpstream,
      create_or_update_file: repository.createOrUpdateFile,
      delete_file: repository.deleteFile,
      update_repository: repository.updateRepository,
      fork_repository: repository.forkRepository,
      list_repository_forks: repository.listRepositoryForks,
      list_repository_tags: repository.listRepositoryTags,
      list_repository_languages: repository.listRepositoryLanguages,
      list_repository_contributors: repository.listRepositoryContributors,
      list_repository_topics: repository.listRepositoryTopics,
      replace_repository_topics: repository.replaceRepositoryTopics,
      get_repository_readme: repository.getRepositoryReadme,
      list_organization_repositories: repository.listOrganizationRepositories,
      list_user_repositories: repository.listUserRepositories,
      get_user: repository.getUser,
      list_repository_collaborators: repository.listRepositoryCollaborators,
      add_repository_collaborator: repository.addRepositoryCollaborator,
      remove_repository_collaborator: repository.removeRepositoryCollaborator,
      get_repository_permission_for_user: repository.getRepositoryPermissionForUser,
      get_ref: repository.getRef,
      list_matching_refs: repository.listMatchingRefs,
      update_ref: repository.updateRef,
      delete_ref: repository.deleteRef,
      create_commit_comment: repository.createCommitComment,
      list_commit_comments: repository.listCommitComments,
      // issue / label / milestone / comment(35)
      list_repository_issues: issue.listRepositoryIssues,
      create_issue: issue.createIssue,
      get_issue: issue.getIssue,
      update_issue: issue.updateIssue,
      list_repository_labels: issue.listRepositoryLabels,
      create_label: issue.createLabel,
      list_issue_labels: issue.listIssueLabels,
      add_issue_labels: issue.addIssueLabels,
      set_issue_labels: issue.setIssueLabels,
      remove_issue_label: issue.removeIssueLabel,
      clear_issue_labels: issue.clearIssueLabels,
      add_issue_assignees: issue.addIssueAssignees,
      remove_issue_assignees: issue.removeIssueAssignees,
      lock_issue: issue.lockIssue,
      unlock_issue: issue.unlockIssue,
      list_issue_comments: issue.listIssueComments,
      create_issue_comment: issue.createIssueComment,
      search_issues_and_pull_requests: issue.searchIssuesAndPullRequests,
      list_issue_timeline_events: issue.listIssueTimelineEvents,
      list_issue_events: issue.listIssueEvents,
      list_repository_issue_events: issue.listRepositoryIssueEvents,
      list_milestones: issue.listMilestones,
      get_milestone: issue.getMilestone,
      create_milestone: issue.createMilestone,
      update_milestone: issue.updateMilestone,
      delete_milestone: issue.deleteMilestone,
      get_issue_comment: issue.getIssueComment,
      update_issue_comment: issue.updateIssueComment,
      delete_issue_comment: issue.deleteIssueComment,
      get_label: issue.getLabel,
      update_label: issue.updateLabel,
      delete_label: issue.deleteLabel,
      list_assignees: issue.listAssignees,
      create_issue_reaction: issue.createIssueReaction,
      create_issue_comment_reaction: issue.createIssueCommentReaction,
      // pull request / review / check / workflow(41)
      list_pull_requests: pullRequest.listPullRequests,
      list_pull_requests_associated_with_commit: pullRequest.listPullRequestsAssociatedWithCommit,
      list_pull_request_files: pullRequest.listPullRequestFiles,
      list_pull_request_commits: pullRequest.listPullRequestCommits,
      list_pull_request_requested_reviewers: pullRequest.listPullRequestRequestedReviewers,
      list_pull_request_reviews: pullRequest.listPullRequestReviews,
      list_pull_request_review_comments: pullRequest.listPullRequestReviewComments,
      create_pull_request_review: pullRequest.createPullRequestReview,
      submit_pull_request_review: pullRequest.submitPullRequestReview,
      create_pull_request_review_comment: pullRequest.createPullRequestReviewComment,
      reply_pull_request_review_comment: pullRequest.replyPullRequestReviewComment,
      get_pull_request: pullRequest.getPullRequest,
      create_pull_request: pullRequest.createPullRequest,
      update_pull_request: pullRequest.updatePullRequest,
      update_pull_request_branch: pullRequest.updatePullRequestBranch,
      request_pull_request_reviewers: pullRequest.requestPullRequestReviewers,
      remove_pull_request_reviewers: pullRequest.removePullRequestReviewers,
      merge_pull_request: pullRequest.mergePullRequest,
      check_pull_request_merged: pullRequest.checkPullRequestMerged,
      create_commit_status: pullRequest.createCommitStatus,
      get_commit_statuses: pullRequest.getCommitStatuses,
      list_check_runs_for_ref: pullRequest.listCheckRunsForRef,
      rerequest_check_run: pullRequest.rerequestCheckRun,
      rerequest_check_suite: pullRequest.rerequestCheckSuite,
      list_repository_workflows: pullRequest.listRepositoryWorkflows,
      list_workflow_runs: pullRequest.listWorkflowRuns,
      get_workflow_run: pullRequest.getWorkflowRun,
      list_workflow_run_jobs: pullRequest.listWorkflowRunJobs,
      rerun_workflow: pullRequest.rerunWorkflow,
      get_pull_request_review: pullRequest.getPullRequestReview,
      dismiss_pull_request_review: pullRequest.dismissPullRequestReview,
      delete_pending_pull_request_review: pullRequest.deletePendingPullRequestReview,
      update_pull_request_review_comment: pullRequest.updatePullRequestReviewComment,
      delete_pull_request_review_comment: pullRequest.deletePullRequestReviewComment,
      get_workflow: pullRequest.getWorkflow,
      dispatch_workflow: pullRequest.dispatchWorkflow,
      cancel_workflow_run: pullRequest.cancelWorkflowRun,
      rerun_failed_jobs: pullRequest.rerunFailedJobs,
      enable_workflow: pullRequest.enableWorkflow,
      disable_workflow: pullRequest.disableWorkflow,
      list_workflow_run_artifacts: pullRequest.listWorkflowRunArtifacts,
      // release(11)
      list_releases: release.listReleases,
      create_release: release.createRelease,
      get_release: release.getRelease,
      get_latest_release: release.getLatestRelease,
      get_release_by_tag: release.getReleaseByTag,
      list_release_assets: release.listReleaseAssets,
      update_release: release.updateRelease,
      delete_release: release.deleteRelease,
      generate_release_notes: release.generateReleaseNotes,
      get_release_asset: release.getReleaseAsset,
      delete_release_asset: release.deleteReleaseAsset,
      // activity / star(12)
      list_public_events: activity.listPublicEvents,
      list_user_public_events: activity.listUserPublicEvents,
      list_user_received_public_events: activity.listUserReceivedPublicEvents,
      list_authenticated_user_events: activity.listAuthenticatedUserEvents,
      list_authenticated_user_received_events: activity.listAuthenticatedUserReceivedEvents,
      list_repository_events: activity.listRepositoryEvents,
      star_repository: activity.starRepository,
      unstar_repository: activity.unstarRepository,
      check_repository_starred: activity.checkRepositoryStarred,
      list_repository_stargazers: activity.listRepositoryStargazers,
      list_my_starred_repositories: activity.listMyStarredRepositories,
      list_repository_watchers: activity.listRepositoryWatchers,
      // search(6)
      search_repositories: search.searchRepositories,
      search_users: search.searchUsers,
      search_commits: search.searchCommits,
      search_code: search.searchCode,
      search_labels: search.searchLabels,
      search_topics: search.searchTopics,
    },
  })
}

export default createGithubPlugin()
