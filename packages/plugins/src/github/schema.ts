/**
 * GitHub 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrentUserInput = z.strictObject({})

export const getCurrentUserOutput = z.looseObject({
  id: z.int().optional(),
  login: z.string().optional(),
  avatar_url: z.string().optional(),
  html_url: z.string().optional(),
  type: z.string().optional(),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
})

export const listMyRepositoriesInput = z.strictObject({
  visibility: z.enum(['all', 'public', 'private']).optional(),
  sort: z.enum(['created', 'updated', 'pushed', 'full_name']).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listMyRepositoriesOutput = z.strictObject({
  repositories: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    full_name: z.string().optional(),
    private: z.boolean().optional(),
    html_url: z.string().optional(),
    clone_url: z.string().optional(),
    ssh_url: z.string().optional(),
    description: z.string().nullable().optional(),
    default_branch: z.string().optional(),
    visibility: z.string().optional(),
    fork: z.boolean().optional(),
    owner: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
  })).optional(),
})

export const createRepositoryInput = z.strictObject({
  name: z.string().min(1),
  description: z.string().optional(),
  homepage: z.url().optional(),
  private: z.boolean().optional(),
  autoInit: z.boolean().optional(),
  hasIssues: z.boolean().optional(),
  hasProjects: z.boolean().optional(),
  hasWiki: z.boolean().optional(),
  hasDiscussions: z.boolean().optional(),
  gitignoreTemplate: z.string().optional(),
  licenseTemplate: z.string().optional(),
})

export const createRepositoryOutput = z.looseObject({}).describe('A GitHub API object.')

export const listBranchesInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  protectedOnly: z.boolean().optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listBranchesOutput = z.strictObject({
  branches: z.array(z.looseObject({
    name: z.string().optional(),
    commit: z.looseObject({}).describe('A GitHub API object.').optional(),
    protected: z.boolean().optional(),
  })).optional(),
})

export const getBranchInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1),
})

export const getBranchOutput = z.looseObject({
  name: z.string().optional(),
  commit: z.looseObject({}).describe('A GitHub API object.').optional(),
  protected: z.boolean().optional(),
})

export const getRepositoryInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
})

export const getRepositoryOutput = z.looseObject({
  id: z.int().optional(),
  name: z.string().optional(),
  full_name: z.string().optional(),
  private: z.boolean().optional(),
  html_url: z.string().optional(),
  clone_url: z.string().optional(),
  ssh_url: z.string().optional(),
  description: z.string().nullable().optional(),
  default_branch: z.string().optional(),
  visibility: z.string().optional(),
  fork: z.boolean().optional(),
  owner: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
})

export const deleteRepositoryInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
})

export const deleteRepositoryOutput = z.strictObject({
  ok: z.boolean().optional(),
})

export const listCommitsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  sha: z.string().optional(),
  path: z.string().optional(),
  author: z.string().optional(),
  committer: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listCommitsOutput = z.strictObject({
  commits: z.array(z.looseObject({
    sha: z.string().optional(),
    html_url: z.string().optional(),
    url: z.string().optional(),
    commit: z.looseObject({}).describe('A GitHub API object.').optional(),
    author: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    committer: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    parents: z.array(z.looseObject({}).describe('A GitHub API object.')).optional(),
    stats: z.looseObject({}).describe('A GitHub API object.').optional(),
    files: z.array(z.looseObject({}).describe('A GitHub API object.')).optional(),
  })).optional(),
})

export const createRefInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  ref: z.string().min(1),
  sha: z.string().min(1),
})

export const createRefOutput = z.looseObject({}).describe('A GitHub API object.')

export const getCommitInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  ref: z.string().min(1),
})

export const getCommitOutput = z.looseObject({
  sha: z.string().optional(),
  html_url: z.string().optional(),
  url: z.string().optional(),
  commit: z.looseObject({}).describe('A GitHub API object.').optional(),
  author: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  committer: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  parents: z.array(z.looseObject({}).describe('A GitHub API object.')).optional(),
  stats: z.looseObject({}).describe('A GitHub API object.').optional(),
  files: z.array(z.looseObject({}).describe('A GitHub API object.')).optional(),
})

export const compareCommitsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  basehead: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const compareCommitsOutput = z.strictObject({
  comparison: z.looseObject({}).describe('A GitHub API object.').optional(),
  commits: z.array(z.looseObject({
    sha: z.string().optional(),
    html_url: z.string().optional(),
    url: z.string().optional(),
    commit: z.looseObject({}).describe('A GitHub API object.').optional(),
    author: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    committer: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    parents: z.array(z.looseObject({}).describe('A GitHub API object.')).optional(),
    stats: z.looseObject({}).describe('A GitHub API object.').optional(),
    files: z.array(z.looseObject({}).describe('A GitHub API object.')).optional(),
  })).optional(),
  files: z.array(z.looseObject({}).describe('A GitHub API object.')).optional(),
})

export const listRepositoryIssuesInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  state: z.enum(['open', 'closed', 'all']).optional(),
  labels: z.array(z.string()).optional(),
  sort: z.enum(['created', 'updated', 'comments']).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
  since: z.string().optional(),
  perPage: z.int().min(1).max(100).default(30).describe('Number of results requested per page. Defaults to 30.').optional(),
  page: z.int().optional(),
})

export const listRepositoryIssuesOutput = z.strictObject({
  issues: z.array(z.looseObject({
    id: z.int().optional(),
    number: z.int().optional(),
    title: z.string().optional(),
    state: z.string().optional(),
    html_url: z.string().optional(),
    body: z.string().nullable().optional(),
    comments: z.int().optional(),
    user: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    assignees: z.array(z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    })).optional(),
    labels: z.array(z.union([z.looseObject({
      id: z.int().optional(),
      name: z.string().optional(),
      color: z.string().optional(),
      description: z.string().nullable().optional(),
    }), z.string()])).optional(),
    pull_request: z.looseObject({}).describe('A GitHub API object.').optional(),
  })).optional(),
  pageInfo: z.strictObject({
    fetched: z.int().min(0).describe('Number of items GitHub returned on this page before filtering. Continue paginating while this equals perPage, which defaults to 30.'),
  }).describe('Pagination signals from the raw GitHub page, before pull requests are filtered out.').optional(),
})

export const createIssueInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  title: z.string().min(1),
  body: z.string().optional(),
  assignees: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  milestone: z.int().min(1).optional(),
})

export const createIssueOutput = z.looseObject({
  id: z.int().optional(),
  number: z.int().optional(),
  title: z.string().optional(),
  state: z.string().optional(),
  html_url: z.string().optional(),
  body: z.string().nullable().optional(),
  comments: z.int().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  assignees: z.array(z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  })).optional(),
  labels: z.array(z.union([z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    color: z.string().optional(),
    description: z.string().nullable().optional(),
  }), z.string()])).optional(),
  pull_request: z.looseObject({}).describe('A GitHub API object.').optional(),
})

export const getIssueInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.int().min(1),
})

export const getIssueOutput = z.looseObject({
  id: z.int().optional(),
  number: z.int().optional(),
  title: z.string().optional(),
  state: z.string().optional(),
  html_url: z.string().optional(),
  body: z.string().nullable().optional(),
  comments: z.int().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  assignees: z.array(z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  })).optional(),
  labels: z.array(z.union([z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    color: z.string().optional(),
    description: z.string().nullable().optional(),
  }), z.string()])).optional(),
  pull_request: z.looseObject({}).describe('A GitHub API object.').optional(),
})

export const updateIssueInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.int().min(1),
  title: z.string().optional(),
  body: z.string().optional(),
  state: z.enum(['open', 'closed']).optional(),
  assignees: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  milestone: z.int().min(1).optional(),
})

export const updateIssueOutput = z.looseObject({
  id: z.int().optional(),
  number: z.int().optional(),
  title: z.string().optional(),
  state: z.string().optional(),
  html_url: z.string().optional(),
  body: z.string().nullable().optional(),
  comments: z.int().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  assignees: z.array(z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  })).optional(),
  labels: z.array(z.union([z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    color: z.string().optional(),
    description: z.string().nullable().optional(),
  }), z.string()])).optional(),
  pull_request: z.looseObject({}).describe('A GitHub API object.').optional(),
})

export const listRepositoryLabelsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listRepositoryLabelsOutput = z.strictObject({
  labels: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    color: z.string().optional(),
    description: z.string().nullable().optional(),
  })).optional(),
})

export const createLabelInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  name: z.string().min(1),
  color: z.string(),
  description: z.string().optional(),
})

export const createLabelOutput = z.looseObject({}).describe('A GitHub API object.')

export const listIssueLabelsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.int().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listIssueLabelsOutput = z.strictObject({
  labels: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    color: z.string().optional(),
    description: z.string().nullable().optional(),
  })).optional(),
})

export const addIssueLabelsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.int().min(1),
  labels: z.array(z.string().min(1)),
})

export const addIssueLabelsOutput = z.strictObject({
  labels: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    color: z.string().optional(),
    description: z.string().nullable().optional(),
  })).optional(),
})

export const setIssueLabelsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.int().min(1),
  labels: z.array(z.string().min(1)),
})

export const setIssueLabelsOutput = z.strictObject({
  labels: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    color: z.string().optional(),
    description: z.string().nullable().optional(),
  })).optional(),
})

export const removeIssueLabelInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.int().min(1),
  label: z.string().min(1),
})

export const removeIssueLabelOutput = z.strictObject({
  labels: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    color: z.string().optional(),
    description: z.string().nullable().optional(),
  })).optional(),
})

export const clearIssueLabelsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.int().min(1),
})

export const clearIssueLabelsOutput = z.strictObject({
  ok: z.boolean().optional(),
})

export const addIssueAssigneesInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.int().min(1),
  assignees: z.array(z.string().min(1)),
})

export const addIssueAssigneesOutput = z.looseObject({
  id: z.int().optional(),
  number: z.int().optional(),
  title: z.string().optional(),
  state: z.string().optional(),
  html_url: z.string().optional(),
  body: z.string().nullable().optional(),
  comments: z.int().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  assignees: z.array(z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  })).optional(),
  labels: z.array(z.union([z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    color: z.string().optional(),
    description: z.string().nullable().optional(),
  }), z.string()])).optional(),
  pull_request: z.looseObject({}).describe('A GitHub API object.').optional(),
})

export const removeIssueAssigneesInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.int().min(1),
  assignees: z.array(z.string().min(1)),
})

export const removeIssueAssigneesOutput = z.looseObject({
  id: z.int().optional(),
  number: z.int().optional(),
  title: z.string().optional(),
  state: z.string().optional(),
  html_url: z.string().optional(),
  body: z.string().nullable().optional(),
  comments: z.int().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  assignees: z.array(z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  })).optional(),
  labels: z.array(z.union([z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    color: z.string().optional(),
    description: z.string().nullable().optional(),
  }), z.string()])).optional(),
  pull_request: z.looseObject({}).describe('A GitHub API object.').optional(),
})

export const lockIssueInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.int().min(1),
  lockReason: z.enum(['off-topic', 'too heated', 'resolved', 'spam']).optional(),
})

export const lockIssueOutput = z.strictObject({
  locked: z.literal(true).optional(),
})

export const unlockIssueInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.int().min(1),
})

export const unlockIssueOutput = z.strictObject({
  locked: z.literal(false).optional(),
})

export const listIssueCommentsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.int().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listIssueCommentsOutput = z.strictObject({
  comments: z.array(z.looseObject({
    id: z.int().optional(),
    html_url: z.string().optional(),
    body: z.string().optional(),
    user: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })).optional(),
})

export const createIssueCommentInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.int().min(1),
  body: z.string().min(1),
})

export const createIssueCommentOutput = z.looseObject({
  id: z.int().optional(),
  html_url: z.string().optional(),
  body: z.string().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export const searchIssuesAndPullRequestsInput = z.strictObject({
  query: z.string().optional(),
  q: z.string().optional(),
  owner: z.string().optional(),
  repo: z.string().optional(),
  state: z.enum(['open', 'closed', 'all']).optional(),
  label: z.string().optional(),
  author: z.string().optional(),
  assignee: z.string().optional(),
  mentions: z.string().optional(),
  language: z.string().optional(),
  baseBranch: z.string().optional(),
  headBranch: z.string().optional(),
  isMerged: z.boolean().optional(),
  type: z.enum(['issue', 'pr']).optional(),
  sort: z.enum(['comments', 'reactions', 'reactions-+1', 'reactions--1', 'reactions-smile', 'reactions-thinking_face', 'reactions-heart', 'reactions-tada', 'interactions', 'created', 'updated']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const searchIssuesAndPullRequestsOutput = z.strictObject({
  total_count: z.int().optional(),
  incomplete_results: z.boolean().optional(),
  items: z.array(z.looseObject({
    id: z.int().optional(),
    number: z.int().optional(),
    title: z.string().optional(),
    html_url: z.string().optional(),
    state: z.string().optional(),
    body: z.string().nullable().optional(),
    repository_url: z.string().optional(),
    pull_request: z.looseObject({}).describe('A GitHub API object.').optional(),
    user: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
  })).optional(),
})

export const listPullRequestsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  state: z.enum(['open', 'closed', 'all']).optional(),
  head: z.string().optional(),
  base: z.string().optional(),
  sort: z.enum(['created', 'updated', 'popularity', 'long-running']).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listPullRequestsOutput = z.strictObject({
  pull_requests: z.array(z.looseObject({
    id: z.int().optional(),
    number: z.int().optional(),
    state: z.string().optional(),
    title: z.string().optional(),
    body: z.string().nullable().optional(),
    html_url: z.string().optional(),
    draft: z.boolean().optional(),
    user: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    head: z.looseObject({}).describe('A GitHub API object.').optional(),
    base: z.looseObject({}).describe('A GitHub API object.').optional(),
  })).optional(),
})

export const listPullRequestsAssociatedWithCommitInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  commitSha: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listPullRequestsAssociatedWithCommitOutput = z.strictObject({
  pull_requests: z.array(z.looseObject({
    id: z.int().optional(),
    number: z.int().optional(),
    state: z.string().optional(),
    title: z.string().optional(),
    body: z.string().nullable().optional(),
    html_url: z.string().optional(),
    draft: z.boolean().optional(),
    user: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    head: z.looseObject({}).describe('A GitHub API object.').optional(),
    base: z.looseObject({}).describe('A GitHub API object.').optional(),
  })).optional(),
})

export const listPullRequestFilesInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listPullRequestFilesOutput = z.strictObject({
  files: z.array(z.looseObject({}).describe('A GitHub API object.')).optional(),
})

export const listPullRequestCommitsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listPullRequestCommitsOutput = z.strictObject({
  commits: z.array(z.looseObject({
    sha: z.string().optional(),
    html_url: z.string().optional(),
    url: z.string().optional(),
    commit: z.looseObject({}).describe('A GitHub API object.').optional(),
    author: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    committer: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    parents: z.array(z.looseObject({}).describe('A GitHub API object.')).optional(),
    stats: z.looseObject({}).describe('A GitHub API object.').optional(),
    files: z.array(z.looseObject({}).describe('A GitHub API object.')).optional(),
  })).optional(),
})

export const listPullRequestRequestedReviewersInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
})

export const listPullRequestRequestedReviewersOutput = z.strictObject({
  users: z.array(z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  })).optional(),
  teams: z.array(z.looseObject({}).describe('A GitHub API object.')).optional(),
})

export const listPullRequestReviewsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listPullRequestReviewsOutput = z.strictObject({
  reviews: z.array(z.looseObject({
    id: z.int().optional(),
    user: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).nullable().optional(),
    body: z.string().nullable().optional(),
    state: z.string().optional(),
    html_url: z.string().optional(),
    commit_id: z.string().nullable().optional(),
    submitted_at: z.string().nullable().optional(),
  })).optional(),
})

export const listPullRequestReviewCommentsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
  sort: z.enum(['created', 'updated']).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
  since: z.string().optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listPullRequestReviewCommentsOutput = z.strictObject({
  comments: z.array(z.looseObject({
    id: z.int().optional(),
    path: z.string().optional(),
    body: z.string().optional(),
    user: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).nullable().optional(),
    commit_id: z.string().optional(),
    original_commit_id: z.string().optional(),
    diff_hunk: z.string().optional(),
    html_url: z.string().optional(),
    line: z.int().nullable().optional(),
    start_line: z.int().nullable().optional(),
    side: z.string().optional(),
    start_side: z.string().nullable().optional(),
  })).optional(),
})

export const createPullRequestReviewInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
  body: z.string().optional(),
  event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']).optional(),
  commitId: z.string().optional(),
  comments: z.array(z.strictObject({
    path: z.string().min(1).optional(),
    body: z.string().min(1).optional(),
    line: z.int().min(1).optional(),
    side: z.enum(['LEFT', 'RIGHT']).optional(),
    startLine: z.int().min(1).optional(),
    startSide: z.enum(['LEFT', 'RIGHT']).optional(),
  })).optional(),
})

export const createPullRequestReviewOutput = z.looseObject({
  id: z.int().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).nullable().optional(),
  body: z.string().nullable().optional(),
  state: z.string().optional(),
  html_url: z.string().optional(),
  commit_id: z.string().nullable().optional(),
  submitted_at: z.string().nullable().optional(),
})

export const submitPullRequestReviewInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
  reviewId: z.int().min(1),
  event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
  body: z.string().optional(),
})

export const submitPullRequestReviewOutput = z.looseObject({
  id: z.int().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).nullable().optional(),
  body: z.string().nullable().optional(),
  state: z.string().optional(),
  html_url: z.string().optional(),
  commit_id: z.string().nullable().optional(),
  submitted_at: z.string().nullable().optional(),
})

export const createPullRequestReviewCommentInput = z.strictObject({
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  pullNumber: z.int().min(1).optional(),
  body: z.string().min(1).optional(),
  commitId: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  line: z.int().min(1).optional(),
  side: z.enum(['LEFT', 'RIGHT']).optional(),
  startLine: z.int().min(1).optional(),
  startSide: z.enum(['LEFT', 'RIGHT']).optional(),
})

export const createPullRequestReviewCommentOutput = z.looseObject({
  id: z.int().optional(),
  path: z.string().optional(),
  body: z.string().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).nullable().optional(),
  commit_id: z.string().optional(),
  original_commit_id: z.string().optional(),
  diff_hunk: z.string().optional(),
  html_url: z.string().optional(),
  line: z.int().nullable().optional(),
  start_line: z.int().nullable().optional(),
  side: z.string().optional(),
  start_side: z.string().nullable().optional(),
})

export const replyPullRequestReviewCommentInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
  commentId: z.int().min(1),
  body: z.string().min(1),
})

export const replyPullRequestReviewCommentOutput = z.looseObject({
  id: z.int().optional(),
  path: z.string().optional(),
  body: z.string().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).nullable().optional(),
  commit_id: z.string().optional(),
  original_commit_id: z.string().optional(),
  diff_hunk: z.string().optional(),
  html_url: z.string().optional(),
  line: z.int().nullable().optional(),
  start_line: z.int().nullable().optional(),
  side: z.string().optional(),
  start_side: z.string().nullable().optional(),
})

export const getPullRequestInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
})

export const getPullRequestOutput = z.looseObject({
  id: z.int().optional(),
  number: z.int().optional(),
  state: z.string().optional(),
  title: z.string().optional(),
  body: z.string().nullable().optional(),
  html_url: z.string().optional(),
  draft: z.boolean().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  head: z.looseObject({}).describe('A GitHub API object.').optional(),
  base: z.looseObject({}).describe('A GitHub API object.').optional(),
})

export const createPullRequestInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  title: z.string().min(1),
  head: z.string().min(1),
  base: z.string().min(1),
  body: z.string().optional(),
  draft: z.boolean().optional(),
  maintainerCanModify: z.boolean().optional(),
})

export const createPullRequestOutput = z.looseObject({
  id: z.int().optional(),
  number: z.int().optional(),
  state: z.string().optional(),
  title: z.string().optional(),
  body: z.string().nullable().optional(),
  html_url: z.string().optional(),
  draft: z.boolean().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  head: z.looseObject({}).describe('A GitHub API object.').optional(),
  base: z.looseObject({}).describe('A GitHub API object.').optional(),
})

export const updatePullRequestInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
  title: z.string().optional(),
  body: z.string().optional(),
  state: z.enum(['open', 'closed']).optional(),
  base: z.string().optional(),
  maintainerCanModify: z.boolean().optional(),
})

export const updatePullRequestOutput = z.looseObject({
  id: z.int().optional(),
  number: z.int().optional(),
  state: z.string().optional(),
  title: z.string().optional(),
  body: z.string().nullable().optional(),
  html_url: z.string().optional(),
  draft: z.boolean().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  head: z.looseObject({}).describe('A GitHub API object.').optional(),
  base: z.looseObject({}).describe('A GitHub API object.').optional(),
})

export const updatePullRequestBranchInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
  expectedHeadSha: z.string().optional(),
})

export const updatePullRequestBranchOutput = z.strictObject({
  message: z.string().optional(),
  url: z.string().optional(),
})

export const requestPullRequestReviewersInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
  reviewers: z.array(z.string().min(1)).optional(),
  teamReviewers: z.array(z.string().min(1)).optional(),
})

export const requestPullRequestReviewersOutput = z.strictObject({
  pull_request: z.looseObject({
    id: z.int().optional(),
    number: z.int().optional(),
    state: z.string().optional(),
    title: z.string().optional(),
    body: z.string().nullable().optional(),
    html_url: z.string().optional(),
    draft: z.boolean().optional(),
    user: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    head: z.looseObject({}).describe('A GitHub API object.').optional(),
    base: z.looseObject({}).describe('A GitHub API object.').optional(),
  }).optional(),
  requested_reviewers: z.array(z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  })).optional(),
  requested_teams: z.array(z.looseObject({}).describe('A GitHub API object.')).optional(),
})

export const removePullRequestReviewersInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
  reviewers: z.array(z.string().min(1)).optional(),
  teamReviewers: z.array(z.string().min(1)).optional(),
})

export const removePullRequestReviewersOutput = z.strictObject({
  pull_request: z.looseObject({
    id: z.int().optional(),
    number: z.int().optional(),
    state: z.string().optional(),
    title: z.string().optional(),
    body: z.string().nullable().optional(),
    html_url: z.string().optional(),
    draft: z.boolean().optional(),
    user: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    head: z.looseObject({}).describe('A GitHub API object.').optional(),
    base: z.looseObject({}).describe('A GitHub API object.').optional(),
  }).optional(),
  requested_reviewers: z.array(z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  })).optional(),
  requested_teams: z.array(z.looseObject({}).describe('A GitHub API object.')).optional(),
})

export const mergePullRequestInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
  commitTitle: z.string().optional(),
  commitMessage: z.string().optional(),
  sha: z.string().optional(),
  mergeMethod: z.enum(['merge', 'squash', 'rebase']).optional(),
})

export const mergePullRequestOutput = z.strictObject({
  sha: z.string().optional(),
  merged: z.boolean().optional(),
  message: z.string().optional(),
})

export const checkPullRequestMergedInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
})

export const checkPullRequestMergedOutput = z.strictObject({
  merged: z.boolean().optional(),
})

export const createCommitStatusInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  sha: z.string().min(1),
  state: z.enum(['error', 'failure', 'pending', 'success']),
  context: z.string().optional(),
  targetUrl: z.string().optional(),
  description: z.string().optional(),
})

export const createCommitStatusOutput = z.looseObject({
  id: z.int().optional(),
  state: z.string().optional(),
  context: z.string().optional(),
  description: z.string().nullable().optional(),
  target_url: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export const getCommitStatusesInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  ref: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const getCommitStatusesOutput = z.strictObject({
  statuses: z.array(z.looseObject({
    id: z.int().optional(),
    state: z.string().optional(),
    context: z.string().optional(),
    description: z.string().nullable().optional(),
    target_url: z.string().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })).optional(),
})

export const listCheckRunsForRefInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  ref: z.string().min(1),
  appId: z.int().min(1).optional(),
  checkName: z.string().optional(),
  filter: z.enum(['latest', 'all']).optional(),
  status: z.string().optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listCheckRunsForRefOutput = z.strictObject({
  total_count: z.int().optional(),
  check_runs: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    status: z.string().optional(),
    conclusion: z.string().nullable().optional(),
    head_sha: z.string().optional(),
    html_url: z.string().nullable().optional(),
    details_url: z.string().nullable().optional(),
    started_at: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
  })).optional(),
})

export const rerequestCheckRunInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  checkRunId: z.int().min(1),
})

export const rerequestCheckRunOutput = z.strictObject({
  ok: z.boolean().optional(),
})

export const rerequestCheckSuiteInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  checkSuiteId: z.int().min(1),
})

export const rerequestCheckSuiteOutput = z.strictObject({
  ok: z.boolean().optional(),
})

export const listRepositoryWorkflowsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listRepositoryWorkflowsOutput = z.strictObject({
  total_count: z.int().optional(),
  workflows: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    path: z.string().optional(),
    state: z.string().optional(),
    html_url: z.string().optional(),
  })).optional(),
})

export const listWorkflowRunsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  actor: z.string().optional(),
  branch: z.string().optional(),
  created: z.string().optional(),
  checkSuiteId: z.int().min(1).optional(),
  event: z.string().optional(),
  headSha: z.string().optional(),
  status: z.string().optional(),
  excludePullRequests: z.boolean().optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listWorkflowRunsOutput = z.strictObject({
  total_count: z.int().optional(),
  workflow_runs: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    display_title: z.string().optional(),
    workflow_id: z.int().optional(),
    event: z.string().optional(),
    status: z.string().optional(),
    conclusion: z.string().nullable().optional(),
    head_branch: z.string().optional(),
    head_sha: z.string().optional(),
    html_url: z.string().optional(),
    run_number: z.int().optional(),
  })).optional(),
})

export const getWorkflowRunInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  runId: z.int().min(1),
})

export const getWorkflowRunOutput = z.looseObject({
  id: z.int().optional(),
  name: z.string().optional(),
  display_title: z.string().optional(),
  workflow_id: z.int().optional(),
  event: z.string().optional(),
  status: z.string().optional(),
  conclusion: z.string().nullable().optional(),
  head_branch: z.string().optional(),
  head_sha: z.string().optional(),
  html_url: z.string().optional(),
  run_number: z.int().optional(),
})

export const listWorkflowRunJobsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  runId: z.int().min(1),
  filter: z.enum(['latest', 'all']).optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listWorkflowRunJobsOutput = z.strictObject({
  total_count: z.int().optional(),
  jobs: z.array(z.looseObject({
    id: z.int().optional(),
    run_id: z.int().optional(),
    name: z.string().optional(),
    status: z.string().optional(),
    conclusion: z.string().nullable().optional(),
    html_url: z.string().optional(),
    started_at: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
    steps: z.array(z.looseObject({}).describe('A GitHub API object.')).optional(),
  })).optional(),
})

export const rerunWorkflowInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  runId: z.int().min(1),
  enableDebugLogging: z.boolean().optional(),
})

export const rerunWorkflowOutput = z.strictObject({
  rerun_requested: z.boolean().optional(),
})

export const listReleasesInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listReleasesOutput = z.strictObject({
  releases: z.array(z.looseObject({
    id: z.int().optional(),
    tag_name: z.string().optional(),
    name: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
    draft: z.boolean().optional(),
    prerelease: z.boolean().optional(),
    html_url: z.string().optional(),
    assets_url: z.string().optional(),
    tarball_url: z.string().nullable().optional(),
    zipball_url: z.string().nullable().optional(),
    target_commitish: z.string().optional(),
    author: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    created_at: z.string().optional(),
    published_at: z.string().nullable().optional(),
  })).optional(),
})

export const createReleaseInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  tagName: z.string().min(1),
  targetCommitish: z.string().optional(),
  name: z.string().optional(),
  body: z.string().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  generateReleaseNotes: z.boolean().optional(),
  makeLatest: z.enum(['true', 'false', 'legacy']).optional(),
})

export const createReleaseOutput = z.looseObject({}).describe('A GitHub API object.')

export const getReleaseInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  releaseId: z.int().min(1),
})

export const getReleaseOutput = z.looseObject({
  id: z.int().optional(),
  tag_name: z.string().optional(),
  name: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  html_url: z.string().optional(),
  assets_url: z.string().optional(),
  tarball_url: z.string().nullable().optional(),
  zipball_url: z.string().nullable().optional(),
  target_commitish: z.string().optional(),
  author: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  created_at: z.string().optional(),
  published_at: z.string().nullable().optional(),
})

export const getLatestReleaseInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
})

export const getLatestReleaseOutput = z.looseObject({
  id: z.int().optional(),
  tag_name: z.string().optional(),
  name: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  html_url: z.string().optional(),
  assets_url: z.string().optional(),
  tarball_url: z.string().nullable().optional(),
  zipball_url: z.string().nullable().optional(),
  target_commitish: z.string().optional(),
  author: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  created_at: z.string().optional(),
  published_at: z.string().nullable().optional(),
})

export const getReleaseByTagInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  tag: z.string().min(1),
})

export const getReleaseByTagOutput = z.looseObject({
  id: z.int().optional(),
  tag_name: z.string().optional(),
  name: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  html_url: z.string().optional(),
  assets_url: z.string().optional(),
  tarball_url: z.string().nullable().optional(),
  zipball_url: z.string().nullable().optional(),
  target_commitish: z.string().optional(),
  author: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  created_at: z.string().optional(),
  published_at: z.string().nullable().optional(),
})

export const listReleaseAssetsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  releaseId: z.int().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listReleaseAssetsOutput = z.strictObject({
  assets: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    label: z.string().nullable().optional(),
    state: z.string().optional(),
    content_type: z.string().optional(),
    size: z.int().optional(),
    download_count: z.int().optional(),
    browser_download_url: z.string().optional(),
    uploader: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })).optional(),
})

export const listIssueTimelineEventsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.int().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listIssueTimelineEventsOutput = z.strictObject({
  events: z.array(z.looseObject({
    id: z.int().optional(),
    event: z.string().optional(),
    actor: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    created_at: z.string().optional(),
    commit_id: z.string().optional(),
  })).optional(),
})

export const listIssueEventsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.int().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listIssueEventsOutput = z.strictObject({
  events: z.array(z.looseObject({
    id: z.int().optional(),
    event: z.string().optional(),
    actor: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    created_at: z.string().optional(),
    commit_id: z.string().optional(),
  })).optional(),
})

export const listRepositoryIssueEventsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listRepositoryIssueEventsOutput = z.strictObject({
  events: z.array(z.looseObject({
    id: z.int().optional(),
    event: z.string().optional(),
    actor: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    created_at: z.string().optional(),
    commit_id: z.string().optional(),
  })).optional(),
})

export const listPublicEventsInput = z.strictObject({
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listPublicEventsOutput = z.strictObject({
  events: z.array(z.looseObject({
    id: z.string().optional(),
    type: z.string().optional(),
    actor: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    repo: z.looseObject({}).describe('A GitHub API object.').optional(),
    org: z.looseObject({}).describe('A GitHub API object.').optional(),
    payload: z.looseObject({}).describe('A GitHub API object.').optional(),
    public: z.boolean().optional(),
    created_at: z.string().optional(),
  })).optional(),
})

export const listUserPublicEventsInput = z.strictObject({
  username: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listUserPublicEventsOutput = z.strictObject({
  events: z.array(z.looseObject({
    id: z.string().optional(),
    type: z.string().optional(),
    actor: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    repo: z.looseObject({}).describe('A GitHub API object.').optional(),
    org: z.looseObject({}).describe('A GitHub API object.').optional(),
    payload: z.looseObject({}).describe('A GitHub API object.').optional(),
    public: z.boolean().optional(),
    created_at: z.string().optional(),
  })).optional(),
})

export const listUserReceivedPublicEventsInput = z.strictObject({
  username: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listUserReceivedPublicEventsOutput = z.strictObject({
  events: z.array(z.looseObject({
    id: z.string().optional(),
    type: z.string().optional(),
    actor: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    repo: z.looseObject({}).describe('A GitHub API object.').optional(),
    org: z.looseObject({}).describe('A GitHub API object.').optional(),
    payload: z.looseObject({}).describe('A GitHub API object.').optional(),
    public: z.boolean().optional(),
    created_at: z.string().optional(),
  })).optional(),
})

export const listAuthenticatedUserEventsInput = z.strictObject({
  username: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listAuthenticatedUserEventsOutput = z.strictObject({
  events: z.array(z.looseObject({
    id: z.string().optional(),
    type: z.string().optional(),
    actor: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    repo: z.looseObject({}).describe('A GitHub API object.').optional(),
    org: z.looseObject({}).describe('A GitHub API object.').optional(),
    payload: z.looseObject({}).describe('A GitHub API object.').optional(),
    public: z.boolean().optional(),
    created_at: z.string().optional(),
  })).optional(),
})

export const listAuthenticatedUserReceivedEventsInput = z.strictObject({
  username: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listAuthenticatedUserReceivedEventsOutput = z.strictObject({
  events: z.array(z.looseObject({
    id: z.string().optional(),
    type: z.string().optional(),
    actor: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    repo: z.looseObject({}).describe('A GitHub API object.').optional(),
    org: z.looseObject({}).describe('A GitHub API object.').optional(),
    payload: z.looseObject({}).describe('A GitHub API object.').optional(),
    public: z.boolean().optional(),
    created_at: z.string().optional(),
  })).optional(),
})

export const listRepositoryEventsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listRepositoryEventsOutput = z.strictObject({
  events: z.array(z.looseObject({
    id: z.string().optional(),
    type: z.string().optional(),
    actor: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    repo: z.looseObject({}).describe('A GitHub API object.').optional(),
    org: z.looseObject({}).describe('A GitHub API object.').optional(),
    payload: z.looseObject({}).describe('A GitHub API object.').optional(),
    public: z.boolean().optional(),
    created_at: z.string().optional(),
  })).optional(),
})

export const listDirectoryContentsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  path: z.string().optional(),
  ref: z.string().optional(),
})

export const listDirectoryContentsOutput = z.strictObject({
  entries: z.array(z.looseObject({
    type: z.enum(['file', 'dir', 'symlink', 'submodule']).optional(),
    name: z.string().optional(),
    path: z.string().optional(),
    sha: z.string().optional(),
    size: z.int().optional(),
    html_url: z.string().nullable().optional(),
    download_url: z.string().nullable().optional(),
  })).optional(),
})

export const getFileContentsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  path: z.string().min(1),
  ref: z.string().optional(),
})

export const getFileContentsOutput = z.looseObject({
  type: z.literal('file').optional(),
  name: z.string().optional(),
  path: z.string().optional(),
  sha: z.string().optional(),
  size: z.int().optional(),
  html_url: z.string().nullable().optional(),
  download_url: z.string().nullable().optional(),
  content_base64: z.string().optional(),
  decoded_content: z.string().optional(),
  encoding: z.string().optional(),
})

export const mergeBranchInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  base: z.string().min(1),
  head: z.string().min(1),
  commitMessage: z.string().optional(),
})

export const mergeBranchOutput = z.looseObject({
  sha: z.string().optional(),
  html_url: z.string().optional(),
  url: z.string().optional(),
  commit: z.looseObject({}).describe('A GitHub API object.').optional(),
  author: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  committer: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  parents: z.array(z.looseObject({}).describe('A GitHub API object.')).optional(),
  stats: z.looseObject({}).describe('A GitHub API object.').optional(),
  files: z.array(z.looseObject({}).describe('A GitHub API object.')).optional(),
})

export const renameBranchInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1),
  newName: z.string().min(1),
})

export const renameBranchOutput = z.looseObject({
  name: z.string().optional(),
  commit: z.looseObject({}).describe('A GitHub API object.').optional(),
  protected: z.boolean().optional(),
})

export const syncForkBranchWithUpstreamInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1),
})

export const syncForkBranchWithUpstreamOutput = z.looseObject({}).describe('A GitHub API object.')

export const searchRepositoriesInput = z.strictObject({
  query: z.string().min(1),
  sort: z.enum(['stars', 'forks', 'help-wanted-issues', 'updated']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const searchRepositoriesOutput = z.strictObject({
  total_count: z.int().optional(),
  incomplete_results: z.boolean().optional(),
  repositories: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    full_name: z.string().optional(),
    html_url: z.string().optional(),
    description: z.string().nullable().optional(),
    private: z.boolean().optional(),
    stargazers_count: z.int().optional(),
    language: z.string().nullable().optional(),
    owner: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
  })).optional(),
})

export const searchUsersInput = z.strictObject({
  query: z.string().min(1),
  sort: z.enum(['followers', 'repositories', 'joined']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const searchUsersOutput = z.strictObject({
  total_count: z.int().optional(),
  incomplete_results: z.boolean().optional(),
  items: z.array(z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    type: z.string().optional(),
    html_url: z.string().optional(),
    avatar_url: z.string().optional(),
    score: z.number().optional(),
  })).optional(),
})

export const searchCommitsInput = z.strictObject({
  query: z.string().min(1),
  sort: z.enum(['author-date', 'committer-date']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const searchCommitsOutput = z.strictObject({
  total_count: z.int().optional(),
  incomplete_results: z.boolean().optional(),
  items: z.array(z.looseObject({
    sha: z.string().optional(),
    html_url: z.string().optional(),
    url: z.string().optional(),
    commit: z.looseObject({}).describe('A GitHub API object.').optional(),
    author: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    committer: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    repository: z.looseObject({
      id: z.int().optional(),
      full_name: z.string().optional(),
      html_url: z.string().optional(),
    }).optional(),
    score: z.number().optional(),
  })).optional(),
})

export const searchCodeInput = z.strictObject({
  query: z.string().min(1),
  sort: z.enum(['indexed', 'updated']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const searchCodeOutput = z.strictObject({
  total_count: z.int().optional(),
  incomplete_results: z.boolean().optional(),
  items: z.array(z.looseObject({
    name: z.string().optional(),
    path: z.string().optional(),
    sha: z.string().optional(),
    url: z.string().optional(),
    git_url: z.string().optional(),
    html_url: z.string().optional(),
    repository: z.looseObject({
      id: z.int().optional(),
      full_name: z.string().optional(),
      html_url: z.string().optional(),
      owner: z.looseObject({
        id: z.int().optional(),
        login: z.string().optional(),
        avatar_url: z.string().optional(),
        html_url: z.string().optional(),
        type: z.string().optional(),
      }).optional(),
    }).optional(),
  })).optional(),
})

export const searchLabelsInput = z.strictObject({
  repositoryId: z.int().min(1),
  query: z.string().min(1),
  sort: z.enum(['created', 'updated']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const searchLabelsOutput = z.strictObject({
  total_count: z.int().optional(),
  incomplete_results: z.boolean().optional(),
  items: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    color: z.string().optional(),
    description: z.string().nullable().optional(),
    score: z.number().optional(),
  })).optional(),
})

export const searchTopicsInput = z.strictObject({
  query: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const searchTopicsOutput = z.strictObject({
  total_count: z.int().optional(),
  incomplete_results: z.boolean().optional(),
  items: z.array(z.looseObject({
    name: z.string().optional(),
    display_name: z.string().optional(),
    short_description: z.string().optional(),
    description: z.string().optional(),
    featured: z.boolean().optional(),
    curated: z.boolean().optional(),
    score: z.number().optional(),
  })).optional(),
})

export const createOrUpdateFileInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  path: z.string().min(1),
  message: z.string().min(1),
  content: z.string().optional(),
  contentBase64: z.string().optional(),
  sha: z.string().optional(),
  branch: z.string().optional(),
})

export const createOrUpdateFileOutput = z.strictObject({
  content: z.looseObject({
    type: z.enum(['file', 'dir', 'symlink', 'submodule']).optional(),
    name: z.string().optional(),
    path: z.string().optional(),
    sha: z.string().optional(),
    size: z.int().optional(),
    html_url: z.string().nullable().optional(),
    download_url: z.string().nullable().optional(),
  }).optional(),
  commit: z.looseObject({}).describe('A GitHub API object.').optional(),
})

export const deleteFileInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  path: z.string().min(1),
  message: z.string().min(1),
  sha: z.string().min(1),
  branch: z.string().optional(),
})

export const deleteFileOutput = z.strictObject({
  content: z.looseObject({
    type: z.enum(['file', 'dir', 'symlink', 'submodule']).optional(),
    name: z.string().optional(),
    path: z.string().optional(),
    sha: z.string().optional(),
    size: z.int().optional(),
    html_url: z.string().nullable().optional(),
    download_url: z.string().nullable().optional(),
  }).optional(),
  commit: z.looseObject({}).describe('A GitHub API object.').optional(),
})

export const updateRepositoryInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  homepage: z.url().optional(),
  private: z.boolean().optional(),
  visibility: z.enum(['public', 'private']).optional(),
  defaultBranch: z.string().optional(),
  hasIssues: z.boolean().optional(),
  hasProjects: z.boolean().optional(),
  hasWiki: z.boolean().optional(),
  hasDiscussions: z.boolean().optional(),
  allowSquashMerge: z.boolean().optional(),
  allowMergeCommit: z.boolean().optional(),
  allowRebaseMerge: z.boolean().optional(),
  allowAutoMerge: z.boolean().optional(),
  deleteBranchOnMerge: z.boolean().optional(),
  archived: z.boolean().optional(),
})

export const updateRepositoryOutput = z.looseObject({
  id: z.int().optional(),
  name: z.string().optional(),
  full_name: z.string().optional(),
  private: z.boolean().optional(),
  html_url: z.string().optional(),
  clone_url: z.string().optional(),
  ssh_url: z.string().optional(),
  description: z.string().nullable().optional(),
  default_branch: z.string().optional(),
  visibility: z.string().optional(),
  fork: z.boolean().optional(),
  owner: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
})

export const forkRepositoryInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  organization: z.string().optional(),
  name: z.string().optional(),
  defaultBranchOnly: z.boolean().optional(),
})

export const forkRepositoryOutput = z.looseObject({
  id: z.int().optional(),
  name: z.string().optional(),
  full_name: z.string().optional(),
  private: z.boolean().optional(),
  html_url: z.string().optional(),
  clone_url: z.string().optional(),
  ssh_url: z.string().optional(),
  description: z.string().nullable().optional(),
  default_branch: z.string().optional(),
  visibility: z.string().optional(),
  fork: z.boolean().optional(),
  owner: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
})

export const listRepositoryForksInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  sort: z.enum(['newest', 'oldest', 'stargazers', 'watchers']).optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listRepositoryForksOutput = z.strictObject({
  repositories: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    full_name: z.string().optional(),
    private: z.boolean().optional(),
    html_url: z.string().optional(),
    clone_url: z.string().optional(),
    ssh_url: z.string().optional(),
    description: z.string().nullable().optional(),
    default_branch: z.string().optional(),
    visibility: z.string().optional(),
    fork: z.boolean().optional(),
    owner: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
  })).optional(),
})

export const listRepositoryTagsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listRepositoryTagsOutput = z.strictObject({
  tags: z.array(z.looseObject({
    name: z.string().optional(),
    commit: z.looseObject({}).describe('A GitHub API object.').optional(),
    zipball_url: z.string().optional(),
    tarball_url: z.string().optional(),
  })).optional(),
})

export const listRepositoryLanguagesInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
})

export const listRepositoryLanguagesOutput = z.strictObject({
  languages: z.record(z.string(), z.int()).optional(),
})

export const listRepositoryContributorsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  anon: z.boolean().describe('Whether to include anonymous contributors.').optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listRepositoryContributorsOutput = z.strictObject({
  contributors: z.array(z.looseObject({
    contributions: z.int().optional(),
    login: z.string().optional(),
    id: z.int().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  })).optional(),
})

export const listRepositoryTopicsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listRepositoryTopicsOutput = z.strictObject({
  names: z.array(z.string()).optional(),
})

export const replaceRepositoryTopicsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  names: z.array(z.string()).describe('The full set of lowercase topic names to set on the repository.'),
})

export const replaceRepositoryTopicsOutput = z.strictObject({
  names: z.array(z.string()).optional(),
})

export const getRepositoryReadmeInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  ref: z.string().optional(),
})

export const getRepositoryReadmeOutput = z.looseObject({
  type: z.literal('file').optional(),
  name: z.string().optional(),
  path: z.string().optional(),
  sha: z.string().optional(),
  size: z.int().optional(),
  html_url: z.string().nullable().optional(),
  download_url: z.string().nullable().optional(),
  content_base64: z.string().optional(),
  decoded_content: z.string().optional(),
  encoding: z.string().optional(),
})

export const listOrganizationRepositoriesInput = z.strictObject({
  org: z.string().min(1),
  type: z.enum(['all', 'public', 'private', 'forks', 'sources', 'member']).optional(),
  sort: z.enum(['created', 'updated', 'pushed', 'full_name']).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listOrganizationRepositoriesOutput = z.strictObject({
  repositories: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    full_name: z.string().optional(),
    private: z.boolean().optional(),
    html_url: z.string().optional(),
    clone_url: z.string().optional(),
    ssh_url: z.string().optional(),
    description: z.string().nullable().optional(),
    default_branch: z.string().optional(),
    visibility: z.string().optional(),
    fork: z.boolean().optional(),
    owner: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
  })).optional(),
})

export const listUserRepositoriesInput = z.strictObject({
  username: z.string().min(1),
  type: z.enum(['all', 'owner', 'member']).optional(),
  sort: z.enum(['created', 'updated', 'pushed', 'full_name']).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listUserRepositoriesOutput = z.strictObject({
  repositories: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    full_name: z.string().optional(),
    private: z.boolean().optional(),
    html_url: z.string().optional(),
    clone_url: z.string().optional(),
    ssh_url: z.string().optional(),
    description: z.string().nullable().optional(),
    default_branch: z.string().optional(),
    visibility: z.string().optional(),
    fork: z.boolean().optional(),
    owner: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
  })).optional(),
})

export const getUserInput = z.strictObject({
  username: z.string().min(1),
})

export const getUserOutput = z.looseObject({
  id: z.int().optional(),
  login: z.string().optional(),
  avatar_url: z.string().optional(),
  html_url: z.string().optional(),
  type: z.string().optional(),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  followers: z.int().optional(),
  following: z.int().optional(),
  public_repos: z.int().optional(),
})

export const listRepositoryCollaboratorsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  affiliation: z.enum(['outside', 'direct', 'all']).optional(),
  permission: z.enum(['pull', 'triage', 'push', 'maintain', 'admin']).optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listRepositoryCollaboratorsOutput = z.strictObject({
  collaborators: z.array(z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
    permissions: z.looseObject({}).describe('A GitHub API object.').optional(),
    role_name: z.string().optional(),
  })).optional(),
})

export const addRepositoryCollaboratorInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  username: z.string().min(1),
  permission: z.string().describe('The permission to grant: pull, triage, push, maintain, admin, or a custom repository role name.').optional(),
})

export const addRepositoryCollaboratorOutput = z.strictObject({
  invited: z.boolean().optional(),
  invitation: z.looseObject({}).describe('A GitHub API object.').nullable().optional(),
})

export const removeRepositoryCollaboratorInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  username: z.string().min(1),
})

export const removeRepositoryCollaboratorOutput = z.strictObject({
  ok: z.boolean().optional(),
})

export const getRepositoryPermissionForUserInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  username: z.string().min(1),
})

export const getRepositoryPermissionForUserOutput = z.looseObject({
  permission: z.string().optional(),
  role_name: z.string().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).nullable().optional(),
})

export const getRefInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  ref: z.string().min(1).describe('The fully qualified reference without the refs/ prefix, such as heads/main or tags/v1.0.0.'),
})

export const getRefOutput = z.looseObject({
  ref: z.string().optional(),
  node_id: z.string().optional(),
  url: z.string().optional(),
  object: z.looseObject({}).describe('A GitHub API object.').optional(),
})

export const listMatchingRefsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  ref: z.string().min(1).describe('The reference prefix to match, such as heads/feature. The endpoint is not paginated and always returns all matching references.'),
})

export const listMatchingRefsOutput = z.strictObject({
  refs: z.array(z.looseObject({
    ref: z.string().optional(),
    node_id: z.string().optional(),
    url: z.string().optional(),
    object: z.looseObject({}).describe('A GitHub API object.').optional(),
  })).optional(),
})

export const updateRefInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  ref: z.string().min(1).describe('The fully qualified reference without the refs/ prefix, such as heads/main or tags/v1.0.0.'),
  sha: z.string().min(1),
  force: z.boolean().optional(),
})

export const updateRefOutput = z.looseObject({
  ref: z.string().optional(),
  node_id: z.string().optional(),
  url: z.string().optional(),
  object: z.looseObject({}).describe('A GitHub API object.').optional(),
})

export const deleteRefInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  ref: z.string().min(1).describe('The fully qualified reference without the refs/ prefix, such as heads/main or tags/v1.0.0.'),
})

export const deleteRefOutput = z.strictObject({
  ok: z.boolean().optional(),
})

export const createCommitCommentInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  commitSha: z.string().min(1),
  body: z.string().min(1),
  path: z.string().optional(),
  position: z.int().min(1).describe('The line index in the diff to comment on.').optional(),
})

export const createCommitCommentOutput = z.looseObject({
  id: z.int().optional(),
  body: z.string().optional(),
  html_url: z.string().optional(),
  path: z.string().nullable().optional(),
  position: z.int().nullable().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export const listCommitCommentsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  commitSha: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listCommitCommentsOutput = z.strictObject({
  comments: z.array(z.looseObject({
    id: z.int().optional(),
    body: z.string().optional(),
    html_url: z.string().optional(),
    path: z.string().nullable().optional(),
    position: z.int().nullable().optional(),
    user: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })).optional(),
})

export const starRepositoryInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
})

export const starRepositoryOutput = z.strictObject({
  ok: z.boolean().optional(),
})

export const unstarRepositoryInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
})

export const unstarRepositoryOutput = z.strictObject({
  ok: z.boolean().optional(),
})

export const checkRepositoryStarredInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
})

export const checkRepositoryStarredOutput = z.strictObject({
  starred: z.boolean().optional(),
})

export const listRepositoryStargazersInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listRepositoryStargazersOutput = z.strictObject({
  stargazers: z.array(z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  })).optional(),
})

export const listMyStarredRepositoriesInput = z.strictObject({
  sort: z.enum(['created', 'updated']).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listMyStarredRepositoriesOutput = z.strictObject({
  repositories: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    full_name: z.string().optional(),
    private: z.boolean().optional(),
    html_url: z.string().optional(),
    clone_url: z.string().optional(),
    ssh_url: z.string().optional(),
    description: z.string().nullable().optional(),
    default_branch: z.string().optional(),
    visibility: z.string().optional(),
    fork: z.boolean().optional(),
    owner: z.looseObject({
      id: z.int().optional(),
      login: z.string().optional(),
      avatar_url: z.string().optional(),
      html_url: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
  })).optional(),
})

export const listRepositoryWatchersInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listRepositoryWatchersOutput = z.strictObject({
  watchers: z.array(z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  })).optional(),
})

export const listMilestonesInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  state: z.enum(['open', 'closed', 'all']).optional(),
  sort: z.enum(['due_on', 'completeness']).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listMilestonesOutput = z.strictObject({
  milestones: z.array(z.looseObject({
    id: z.int().optional(),
    number: z.int().optional(),
    title: z.string().optional(),
    state: z.string().optional(),
    description: z.string().nullable().optional(),
    due_on: z.string().nullable().optional(),
    open_issues: z.int().optional(),
    closed_issues: z.int().optional(),
    html_url: z.string().optional(),
  })).optional(),
})

export const getMilestoneInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  milestoneNumber: z.int().min(1),
})

export const getMilestoneOutput = z.looseObject({
  id: z.int().optional(),
  number: z.int().optional(),
  title: z.string().optional(),
  state: z.string().optional(),
  description: z.string().nullable().optional(),
  due_on: z.string().nullable().optional(),
  open_issues: z.int().optional(),
  closed_issues: z.int().optional(),
  html_url: z.string().optional(),
})

export const createMilestoneInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  title: z.string().min(1),
  state: z.enum(['open', 'closed']).optional(),
  description: z.string().optional(),
  dueOn: z.iso.datetime({ offset: true }).optional(),
})

export const createMilestoneOutput = z.looseObject({
  id: z.int().optional(),
  number: z.int().optional(),
  title: z.string().optional(),
  state: z.string().optional(),
  description: z.string().nullable().optional(),
  due_on: z.string().nullable().optional(),
  open_issues: z.int().optional(),
  closed_issues: z.int().optional(),
  html_url: z.string().optional(),
})

export const updateMilestoneInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  milestoneNumber: z.int().min(1),
  title: z.string().optional(),
  state: z.enum(['open', 'closed']).optional(),
  description: z.string().optional(),
  dueOn: z.iso.datetime({ offset: true }).optional(),
})

export const updateMilestoneOutput = z.looseObject({
  id: z.int().optional(),
  number: z.int().optional(),
  title: z.string().optional(),
  state: z.string().optional(),
  description: z.string().nullable().optional(),
  due_on: z.string().nullable().optional(),
  open_issues: z.int().optional(),
  closed_issues: z.int().optional(),
  html_url: z.string().optional(),
})

export const deleteMilestoneInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  milestoneNumber: z.int().min(1),
})

export const deleteMilestoneOutput = z.strictObject({
  ok: z.boolean().optional(),
})

export const getIssueCommentInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  commentId: z.int().min(1),
})

export const getIssueCommentOutput = z.looseObject({
  id: z.int().optional(),
  html_url: z.string().optional(),
  body: z.string().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export const updateIssueCommentInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  commentId: z.int().min(1),
  body: z.string().min(1),
})

export const updateIssueCommentOutput = z.looseObject({
  id: z.int().optional(),
  html_url: z.string().optional(),
  body: z.string().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export const deleteIssueCommentInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  commentId: z.int().min(1),
})

export const deleteIssueCommentOutput = z.strictObject({
  ok: z.boolean().optional(),
})

export const getLabelInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  name: z.string().min(1),
})

export const getLabelOutput = z.looseObject({
  id: z.int().optional(),
  name: z.string().optional(),
  color: z.string().optional(),
  description: z.string().nullable().optional(),
})

export const updateLabelInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  name: z.string().min(1),
  newName: z.string().optional(),
  color: z.string().describe('The label color as a 6-character hex value without #.').optional(),
  description: z.string().optional(),
})

export const updateLabelOutput = z.looseObject({
  id: z.int().optional(),
  name: z.string().optional(),
  color: z.string().optional(),
  description: z.string().nullable().optional(),
})

export const deleteLabelInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  name: z.string().min(1),
})

export const deleteLabelOutput = z.strictObject({
  ok: z.boolean().optional(),
})

export const listAssigneesInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listAssigneesOutput = z.strictObject({
  assignees: z.array(z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  })).optional(),
})

export const createIssueReactionInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.int().min(1),
  content: z.enum(['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes']),
})

export const createIssueReactionOutput = z.looseObject({
  id: z.int().optional(),
  content: z.string().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).nullable().optional(),
  created_at: z.string().optional(),
})

export const createIssueCommentReactionInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  commentId: z.int().min(1),
  content: z.enum(['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes']),
})

export const createIssueCommentReactionOutput = z.looseObject({
  id: z.int().optional(),
  content: z.string().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).nullable().optional(),
  created_at: z.string().optional(),
})

export const getPullRequestReviewInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
  reviewId: z.int().min(1),
})

export const getPullRequestReviewOutput = z.looseObject({
  id: z.int().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).nullable().optional(),
  body: z.string().nullable().optional(),
  state: z.string().optional(),
  html_url: z.string().optional(),
  commit_id: z.string().nullable().optional(),
  submitted_at: z.string().nullable().optional(),
})

export const dismissPullRequestReviewInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
  reviewId: z.int().min(1),
  message: z.string().min(1),
})

export const dismissPullRequestReviewOutput = z.looseObject({
  id: z.int().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).nullable().optional(),
  body: z.string().nullable().optional(),
  state: z.string().optional(),
  html_url: z.string().optional(),
  commit_id: z.string().nullable().optional(),
  submitted_at: z.string().nullable().optional(),
})

export const deletePendingPullRequestReviewInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.int().min(1),
  reviewId: z.int().min(1),
})

export const deletePendingPullRequestReviewOutput = z.looseObject({
  id: z.int().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).nullable().optional(),
  body: z.string().nullable().optional(),
  state: z.string().optional(),
  html_url: z.string().optional(),
  commit_id: z.string().nullable().optional(),
  submitted_at: z.string().nullable().optional(),
})

export const updatePullRequestReviewCommentInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  commentId: z.int().min(1),
  body: z.string().min(1),
})

export const updatePullRequestReviewCommentOutput = z.looseObject({
  id: z.int().optional(),
  path: z.string().optional(),
  body: z.string().optional(),
  user: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).nullable().optional(),
  commit_id: z.string().optional(),
  original_commit_id: z.string().optional(),
  diff_hunk: z.string().optional(),
  html_url: z.string().optional(),
  line: z.int().nullable().optional(),
  start_line: z.int().nullable().optional(),
  side: z.string().optional(),
  start_side: z.string().nullable().optional(),
})

export const deletePullRequestReviewCommentInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  commentId: z.int().min(1),
})

export const deletePullRequestReviewCommentOutput = z.strictObject({
  ok: z.boolean().optional(),
})

export const getWorkflowInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  workflowId: z.union([z.string().min(1), z.int().min(1)]).describe('The workflow ID or workflow file name, such as ci.yml.'),
})

export const getWorkflowOutput = z.looseObject({
  id: z.int().optional(),
  name: z.string().optional(),
  path: z.string().optional(),
  state: z.string().optional(),
  html_url: z.string().optional(),
})

export const dispatchWorkflowInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  workflowId: z.union([z.string().min(1), z.int().min(1)]).describe('The workflow ID or workflow file name, such as ci.yml.'),
  ref: z.string().min(1).describe('The branch or tag name to run the workflow on.'),
  inputs: z.record(z.string(), z.string()).describe('The workflow inputs. All values must be strings.').optional(),
})

export const dispatchWorkflowOutput = z.strictObject({
  dispatched: z.boolean().optional(),
})

export const cancelWorkflowRunInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  runId: z.int().min(1),
})

export const cancelWorkflowRunOutput = z.strictObject({
  cancel_requested: z.boolean().optional(),
})

export const rerunFailedJobsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  runId: z.int().min(1),
  enableDebugLogging: z.boolean().optional(),
})

export const rerunFailedJobsOutput = z.strictObject({
  rerun_requested: z.boolean().optional(),
})

export const enableWorkflowInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  workflowId: z.union([z.string().min(1), z.int().min(1)]).describe('The workflow ID or workflow file name, such as ci.yml.'),
})

export const enableWorkflowOutput = z.strictObject({
  ok: z.boolean().optional(),
})

export const disableWorkflowInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  workflowId: z.union([z.string().min(1), z.int().min(1)]).describe('The workflow ID or workflow file name, such as ci.yml.'),
})

export const disableWorkflowOutput = z.strictObject({
  ok: z.boolean().optional(),
})

export const listWorkflowRunArtifactsInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  runId: z.int().min(1),
  name: z.string().describe('Filter artifacts by exact name.').optional(),
  perPage: z.int().optional(),
  page: z.int().optional(),
})

export const listWorkflowRunArtifactsOutput = z.strictObject({
  total_count: z.int().optional(),
  artifacts: z.array(z.looseObject({
    id: z.int().optional(),
    name: z.string().optional(),
    size_in_bytes: z.int().optional(),
    archive_download_url: z.string().optional(),
    expired: z.boolean().optional(),
    created_at: z.string().nullable().optional(),
    expires_at: z.string().nullable().optional(),
  })).optional(),
})

export const updateReleaseInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  releaseId: z.int().min(1),
  tagName: z.string().optional(),
  targetCommitish: z.string().optional(),
  name: z.string().optional(),
  body: z.string().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  makeLatest: z.enum(['true', 'false', 'legacy']).optional(),
})

export const updateReleaseOutput = z.looseObject({
  id: z.int().optional(),
  tag_name: z.string().optional(),
  name: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  html_url: z.string().optional(),
  assets_url: z.string().optional(),
  tarball_url: z.string().nullable().optional(),
  zipball_url: z.string().nullable().optional(),
  target_commitish: z.string().optional(),
  author: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  created_at: z.string().optional(),
  published_at: z.string().nullable().optional(),
})

export const deleteReleaseInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  releaseId: z.int().min(1),
})

export const deleteReleaseOutput = z.strictObject({
  ok: z.boolean().optional(),
})

export const generateReleaseNotesInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  tagName: z.string().min(1),
  targetCommitish: z.string().optional(),
  previousTagName: z.string().optional(),
  configurationFilePath: z.string().optional(),
})

export const generateReleaseNotesOutput = z.strictObject({
  name: z.string().optional(),
  body: z.string().optional(),
})

export const getReleaseAssetInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  assetId: z.int().min(1),
})

export const getReleaseAssetOutput = z.looseObject({
  id: z.int().optional(),
  name: z.string().optional(),
  label: z.string().nullable().optional(),
  state: z.string().optional(),
  content_type: z.string().optional(),
  size: z.int().optional(),
  download_count: z.int().optional(),
  browser_download_url: z.string().optional(),
  uploader: z.looseObject({
    id: z.int().optional(),
    login: z.string().optional(),
    avatar_url: z.string().optional(),
    html_url: z.string().optional(),
    type: z.string().optional(),
  }).nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export const deleteReleaseAssetInput = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  assetId: z.int().min(1),
})

export const deleteReleaseAssetOutput = z.strictObject({
  ok: z.boolean().optional(),
})

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const githubActions = {
  get_current_user: {
    description: 'Get the current authenticated GitHub user profile.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_my_repositories: {
    description: 'List repositories visible to the authenticated GitHub user.',
    effect: 'read',
    inputSchema: listMyRepositoriesInput,
    outputSchema: z.toJSONSchema(listMyRepositoriesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_repository: {
    description: 'Create a repository for the authenticated GitHub user.',
    effect: 'write',
    inputSchema: createRepositoryInput,
    outputSchema: z.toJSONSchema(createRepositoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_branches: {
    description: 'List branches in a GitHub repository.',
    effect: 'read',
    inputSchema: listBranchesInput,
    outputSchema: z.toJSONSchema(listBranchesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_branch: {
    description: 'Get a GitHub branch by name.',
    effect: 'read',
    inputSchema: getBranchInput,
    outputSchema: z.toJSONSchema(getBranchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_repository: {
    description: 'Get metadata for a GitHub repository by owner and name.',
    effect: 'read',
    inputSchema: getRepositoryInput,
    outputSchema: z.toJSONSchema(getRepositoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_repository: {
    description: 'Delete a GitHub repository by owner and name.',
    effect: 'destructive',
    inputSchema: deleteRepositoryInput,
    outputSchema: z.toJSONSchema(deleteRepositoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_commits: {
    description: 'List commits in a GitHub repository with optional branch, path, author, and date filters.',
    effect: 'read',
    inputSchema: listCommitsInput,
    outputSchema: z.toJSONSchema(listCommitsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_ref: {
    description: 'Create a Git reference in a GitHub repository.',
    effect: 'write',
    inputSchema: createRefInput,
    outputSchema: z.toJSONSchema(createRefOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_commit: {
    description: 'Get a commit by SHA in a GitHub repository.',
    effect: 'read',
    inputSchema: getCommitInput,
    outputSchema: z.toJSONSchema(getCommitOutput, { io: 'output', unrepresentable: 'any' }),
  },
  compare_commits: {
    description: 'Compare two commit references in a GitHub repository.',
    effect: 'write',
    inputSchema: compareCommitsInput,
    outputSchema: z.toJSONSchema(compareCommitsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_repository_issues: {
    description: 'List issues for a GitHub repository. Pull requests are filtered out of the response; pageInfo.fetched reports the raw page length before filtering, so paginating callers must continue while fetched equals perPage (30 by default) even when the issues array comes back short or empty.',
    effect: 'read',
    inputSchema: listRepositoryIssuesInput,
    outputSchema: z.toJSONSchema(listRepositoryIssuesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_issue: {
    description: 'Create an issue in a GitHub repository.',
    effect: 'write',
    inputSchema: createIssueInput,
    outputSchema: z.toJSONSchema(createIssueOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_issue: {
    description: 'Get a GitHub issue by number.',
    effect: 'read',
    inputSchema: getIssueInput,
    outputSchema: z.toJSONSchema(getIssueOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_issue: {
    description: 'Update a GitHub issue by number.',
    effect: 'write',
    inputSchema: updateIssueInput,
    outputSchema: z.toJSONSchema(updateIssueOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_repository_labels: {
    description: 'List labels available in a GitHub repository.',
    effect: 'read',
    inputSchema: listRepositoryLabelsInput,
    outputSchema: z.toJSONSchema(listRepositoryLabelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_label: {
    description: 'Create a label in a GitHub repository.',
    effect: 'write',
    inputSchema: createLabelInput,
    outputSchema: z.toJSONSchema(createLabelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_issue_labels: {
    description: 'List labels applied to a GitHub issue.',
    effect: 'read',
    inputSchema: listIssueLabelsInput,
    outputSchema: z.toJSONSchema(listIssueLabelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_issue_labels: {
    description: 'Add labels to a GitHub issue.',
    effect: 'write',
    inputSchema: addIssueLabelsInput,
    outputSchema: z.toJSONSchema(addIssueLabelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  set_issue_labels: {
    description: 'Replace all labels on a GitHub issue.',
    effect: 'write',
    inputSchema: setIssueLabelsInput,
    outputSchema: z.toJSONSchema(setIssueLabelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  remove_issue_label: {
    description: 'Remove one label from a GitHub issue.',
    effect: 'destructive',
    inputSchema: removeIssueLabelInput,
    outputSchema: z.toJSONSchema(removeIssueLabelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  clear_issue_labels: {
    description: 'Remove all labels from a GitHub issue.',
    effect: 'write',
    inputSchema: clearIssueLabelsInput,
    outputSchema: z.toJSONSchema(clearIssueLabelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_issue_assignees: {
    description: 'Add assignees to a GitHub issue.',
    effect: 'write',
    inputSchema: addIssueAssigneesInput,
    outputSchema: z.toJSONSchema(addIssueAssigneesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  remove_issue_assignees: {
    description: 'Remove assignees from a GitHub issue.',
    effect: 'destructive',
    inputSchema: removeIssueAssigneesInput,
    outputSchema: z.toJSONSchema(removeIssueAssigneesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  lock_issue: {
    description: 'Lock a GitHub issue conversation.',
    effect: 'write',
    inputSchema: lockIssueInput,
    outputSchema: z.toJSONSchema(lockIssueOutput, { io: 'output', unrepresentable: 'any' }),
  },
  unlock_issue: {
    description: 'Unlock a GitHub issue conversation.',
    effect: 'write',
    inputSchema: unlockIssueInput,
    outputSchema: z.toJSONSchema(unlockIssueOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_issue_comments: {
    description: 'List comments under a GitHub issue.',
    effect: 'read',
    inputSchema: listIssueCommentsInput,
    outputSchema: z.toJSONSchema(listIssueCommentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_issue_comment: {
    description: 'Create a comment on a GitHub issue.',
    effect: 'write',
    inputSchema: createIssueCommentInput,
    outputSchema: z.toJSONSchema(createIssueCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_issues_and_pull_requests: {
    description: 'Search GitHub issues and pull requests with raw GitHub search syntax or structured filters.',
    effect: 'read',
    inputSchema: searchIssuesAndPullRequestsInput,
    outputSchema: z.toJSONSchema(searchIssuesAndPullRequestsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_pull_requests: {
    description: 'List pull requests for a GitHub repository.',
    effect: 'read',
    inputSchema: listPullRequestsInput,
    outputSchema: z.toJSONSchema(listPullRequestsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_pull_requests_associated_with_commit: {
    description: 'List pull requests associated with a commit SHA.',
    effect: 'read',
    inputSchema: listPullRequestsAssociatedWithCommitInput,
    outputSchema: z.toJSONSchema(listPullRequestsAssociatedWithCommitOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_pull_request_files: {
    description: 'List files changed in a GitHub pull request.',
    effect: 'read',
    inputSchema: listPullRequestFilesInput,
    outputSchema: z.toJSONSchema(listPullRequestFilesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_pull_request_commits: {
    description: 'List commits on a GitHub pull request.',
    effect: 'read',
    inputSchema: listPullRequestCommitsInput,
    outputSchema: z.toJSONSchema(listPullRequestCommitsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_pull_request_requested_reviewers: {
    description: 'List requested reviewers on a GitHub pull request.',
    effect: 'read',
    inputSchema: listPullRequestRequestedReviewersInput,
    outputSchema: z.toJSONSchema(listPullRequestRequestedReviewersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_pull_request_reviews: {
    description: 'List reviews for a GitHub pull request.',
    effect: 'read',
    inputSchema: listPullRequestReviewsInput,
    outputSchema: z.toJSONSchema(listPullRequestReviewsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_pull_request_review_comments: {
    description: 'List review comments on a GitHub pull request.',
    effect: 'read',
    inputSchema: listPullRequestReviewCommentsInput,
    outputSchema: z.toJSONSchema(listPullRequestReviewCommentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_pull_request_review: {
    description: 'Create a review for a GitHub pull request, optionally with inline comments.',
    effect: 'write',
    inputSchema: createPullRequestReviewInput,
    outputSchema: z.toJSONSchema(createPullRequestReviewOutput, { io: 'output', unrepresentable: 'any' }),
  },
  submit_pull_request_review: {
    description: 'Submit a pending GitHub pull request review.',
    effect: 'write',
    inputSchema: submitPullRequestReviewInput,
    outputSchema: z.toJSONSchema(submitPullRequestReviewOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_pull_request_review_comment: {
    description: 'Create a review comment on a GitHub pull request diff.',
    effect: 'write',
    inputSchema: createPullRequestReviewCommentInput,
    outputSchema: z.toJSONSchema(createPullRequestReviewCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  reply_pull_request_review_comment: {
    description: 'Reply to a top-level GitHub pull request review comment.',
    effect: 'write',
    inputSchema: replyPullRequestReviewCommentInput,
    outputSchema: z.toJSONSchema(replyPullRequestReviewCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_pull_request: {
    description: 'Get a GitHub pull request by number.',
    effect: 'read',
    inputSchema: getPullRequestInput,
    outputSchema: z.toJSONSchema(getPullRequestOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_pull_request: {
    description: 'Create a pull request in a GitHub repository.',
    effect: 'write',
    inputSchema: createPullRequestInput,
    outputSchema: z.toJSONSchema(createPullRequestOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_pull_request: {
    description: 'Update a GitHub pull request title, body, state, base branch, or maintainer-can-modify flag.',
    effect: 'write',
    inputSchema: updatePullRequestInput,
    outputSchema: z.toJSONSchema(updatePullRequestOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_pull_request_branch: {
    description: 'Update a GitHub pull request branch with the latest base branch changes.',
    effect: 'write',
    inputSchema: updatePullRequestBranchInput,
    outputSchema: z.toJSONSchema(updatePullRequestBranchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  request_pull_request_reviewers: {
    description: 'Request reviewers on a GitHub pull request.',
    effect: 'write',
    inputSchema: requestPullRequestReviewersInput,
    outputSchema: z.toJSONSchema(requestPullRequestReviewersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  remove_pull_request_reviewers: {
    description: 'Remove requested reviewers from a GitHub pull request.',
    effect: 'destructive',
    inputSchema: removePullRequestReviewersInput,
    outputSchema: z.toJSONSchema(removePullRequestReviewersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  merge_pull_request: {
    description: 'Merge a GitHub pull request.',
    effect: 'write',
    inputSchema: mergePullRequestInput,
    outputSchema: z.toJSONSchema(mergePullRequestOutput, { io: 'output', unrepresentable: 'any' }),
  },
  check_pull_request_merged: {
    description: 'Check whether a GitHub pull request has been merged.',
    effect: 'read',
    inputSchema: checkPullRequestMergedInput,
    outputSchema: z.toJSONSchema(checkPullRequestMergedOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_commit_status: {
    description: 'Create a commit status for a GitHub commit SHA.',
    effect: 'write',
    inputSchema: createCommitStatusInput,
    outputSchema: z.toJSONSchema(createCommitStatusOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_commit_statuses: {
    description: 'List statuses for a commit reference in reverse chronological order.',
    effect: 'read',
    inputSchema: getCommitStatusesInput,
    outputSchema: z.toJSONSchema(getCommitStatusesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_check_runs_for_ref: {
    description: 'List GitHub check runs for a commit SHA, branch, or tag.',
    effect: 'read',
    inputSchema: listCheckRunsForRefInput,
    outputSchema: z.toJSONSchema(listCheckRunsForRefOutput, { io: 'output', unrepresentable: 'any' }),
  },
  rerequest_check_run: {
    description: 'Re-request a GitHub check run.',
    effect: 'write',
    inputSchema: rerequestCheckRunInput,
    outputSchema: z.toJSONSchema(rerequestCheckRunOutput, { io: 'output', unrepresentable: 'any' }),
  },
  rerequest_check_suite: {
    description: 'Re-request a GitHub check suite.',
    effect: 'write',
    inputSchema: rerequestCheckSuiteInput,
    outputSchema: z.toJSONSchema(rerequestCheckSuiteOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_repository_workflows: {
    description: 'List workflows configured in a GitHub repository.',
    effect: 'read',
    inputSchema: listRepositoryWorkflowsInput,
    outputSchema: z.toJSONSchema(listRepositoryWorkflowsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_workflow_runs: {
    description: 'List GitHub workflow runs for a repository.',
    effect: 'read',
    inputSchema: listWorkflowRunsInput,
    outputSchema: z.toJSONSchema(listWorkflowRunsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_workflow_run: {
    description: 'Get a GitHub workflow run by id.',
    effect: 'read',
    inputSchema: getWorkflowRunInput,
    outputSchema: z.toJSONSchema(getWorkflowRunOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_workflow_run_jobs: {
    description: 'List jobs for a GitHub workflow run.',
    effect: 'read',
    inputSchema: listWorkflowRunJobsInput,
    outputSchema: z.toJSONSchema(listWorkflowRunJobsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  rerun_workflow: {
    description: 'Re-run a GitHub Actions workflow run.',
    effect: 'write',
    inputSchema: rerunWorkflowInput,
    outputSchema: z.toJSONSchema(rerunWorkflowOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_releases: {
    description: 'List releases for a GitHub repository.',
    effect: 'read',
    inputSchema: listReleasesInput,
    outputSchema: z.toJSONSchema(listReleasesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_release: {
    description: 'Create a release in a GitHub repository.',
    effect: 'write',
    inputSchema: createReleaseInput,
    outputSchema: z.toJSONSchema(createReleaseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_release: {
    description: 'Get a GitHub release by numeric id.',
    effect: 'read',
    inputSchema: getReleaseInput,
    outputSchema: z.toJSONSchema(getReleaseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_latest_release: {
    description: 'Get the latest published release for a GitHub repository.',
    effect: 'read',
    inputSchema: getLatestReleaseInput,
    outputSchema: z.toJSONSchema(getLatestReleaseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_release_by_tag: {
    description: 'Get a GitHub release by tag name.',
    effect: 'read',
    inputSchema: getReleaseByTagInput,
    outputSchema: z.toJSONSchema(getReleaseByTagOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_release_assets: {
    description: 'List assets attached to a GitHub release.',
    effect: 'read',
    inputSchema: listReleaseAssetsInput,
    outputSchema: z.toJSONSchema(listReleaseAssetsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_issue_timeline_events: {
    description: 'List timeline events for a GitHub issue.',
    effect: 'read',
    inputSchema: listIssueTimelineEventsInput,
    outputSchema: z.toJSONSchema(listIssueTimelineEventsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_issue_events: {
    description: 'List events for a GitHub issue.',
    effect: 'read',
    inputSchema: listIssueEventsInput,
    outputSchema: z.toJSONSchema(listIssueEventsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_repository_issue_events: {
    description: 'List issue events across a GitHub repository.',
    effect: 'read',
    inputSchema: listRepositoryIssueEventsInput,
    outputSchema: z.toJSONSchema(listRepositoryIssueEventsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_public_events: {
    description: 'List the global public GitHub event feed.',
    effect: 'read',
    inputSchema: listPublicEventsInput,
    outputSchema: z.toJSONSchema(listPublicEventsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_user_public_events: {
    description: 'List public GitHub events performed by a user.',
    effect: 'read',
    inputSchema: listUserPublicEventsInput,
    outputSchema: z.toJSONSchema(listUserPublicEventsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_user_received_public_events: {
    description: 'List public GitHub events received by a user.',
    effect: 'read',
    inputSchema: listUserReceivedPublicEventsInput,
    outputSchema: z.toJSONSchema(listUserReceivedPublicEventsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_authenticated_user_events: {
    description: 'List activity events for a GitHub user and include private events when the authenticated credential belongs to that user.',
    effect: 'read',
    inputSchema: listAuthenticatedUserEventsInput,
    outputSchema: z.toJSONSchema(listAuthenticatedUserEventsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_authenticated_user_received_events: {
    description: 'List received activity events for a GitHub user and include private events when the authenticated credential belongs to that user.',
    effect: 'read',
    inputSchema: listAuthenticatedUserReceivedEventsInput,
    outputSchema: z.toJSONSchema(listAuthenticatedUserReceivedEventsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_repository_events: {
    description: 'List recent GitHub events for a repository.',
    effect: 'read',
    inputSchema: listRepositoryEventsInput,
    outputSchema: z.toJSONSchema(listRepositoryEventsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_directory_contents: {
    description: 'List entries under a repository directory path. Empty path means repository root.',
    effect: 'read',
    inputSchema: listDirectoryContentsInput,
    outputSchema: z.toJSONSchema(listDirectoryContentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_file_contents: {
    description: 'Read a repository file and return both base64 and decoded text when available.',
    effect: 'read',
    inputSchema: getFileContentsInput,
    outputSchema: z.toJSONSchema(getFileContentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  merge_branch: {
    description: 'Merge one branch into another in a GitHub repository.',
    effect: 'write',
    inputSchema: mergeBranchInput,
    outputSchema: z.toJSONSchema(mergeBranchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  rename_branch: {
    description: 'Rename a branch in a GitHub repository.',
    effect: 'write',
    inputSchema: renameBranchInput,
    outputSchema: z.toJSONSchema(renameBranchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  sync_fork_branch_with_upstream: {
    description: 'Sync a fork branch with its upstream branch.',
    effect: 'write',
    inputSchema: syncForkBranchWithUpstreamInput,
    outputSchema: z.toJSONSchema(syncForkBranchWithUpstreamOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_repositories: {
    description: 'Search GitHub repositories with GitHub search syntax.',
    effect: 'read',
    inputSchema: searchRepositoriesInput,
    outputSchema: z.toJSONSchema(searchRepositoriesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_users: {
    description: 'Search GitHub users with GitHub search syntax.',
    effect: 'read',
    inputSchema: searchUsersInput,
    outputSchema: z.toJSONSchema(searchUsersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_commits: {
    description: 'Search GitHub commits by commit-message text and qualifiers.',
    effect: 'read',
    inputSchema: searchCommitsInput,
    outputSchema: z.toJSONSchema(searchCommitsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_code: {
    description: 'Search GitHub code with GitHub search syntax.',
    effect: 'read',
    inputSchema: searchCodeInput,
    outputSchema: z.toJSONSchema(searchCodeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_labels: {
    description: 'Search labels within a GitHub repository by repository id and query.',
    effect: 'read',
    inputSchema: searchLabelsInput,
    outputSchema: z.toJSONSchema(searchLabelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_topics: {
    description: 'Search GitHub topics with GitHub search syntax.',
    effect: 'read',
    inputSchema: searchTopicsInput,
    outputSchema: z.toJSONSchema(searchTopicsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_or_update_file: {
    description: 'Create or update a repository file through the GitHub contents API. Writing under .github/workflows may require GitHub workflow scope.',
    effect: 'write',
    inputSchema: createOrUpdateFileInput,
    outputSchema: z.toJSONSchema(createOrUpdateFileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_file: {
    description: 'Delete a repository file through the GitHub contents API. Deleting under .github/workflows may require GitHub workflow scope.',
    effect: 'destructive',
    inputSchema: deleteFileInput,
    outputSchema: z.toJSONSchema(deleteFileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_repository: {
    description: 'Update settings and metadata for a GitHub repository.',
    effect: 'write',
    inputSchema: updateRepositoryInput,
    outputSchema: z.toJSONSchema(updateRepositoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  fork_repository: {
    description: 'Fork a GitHub repository. Forking happens asynchronously, so the returned repository may not be immediately ready.',
    effect: 'write',
    inputSchema: forkRepositoryInput,
    outputSchema: z.toJSONSchema(forkRepositoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_repository_forks: {
    description: 'List forks of a GitHub repository.',
    effect: 'read',
    inputSchema: listRepositoryForksInput,
    outputSchema: z.toJSONSchema(listRepositoryForksOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_repository_tags: {
    description: 'List tags in a GitHub repository.',
    effect: 'read',
    inputSchema: listRepositoryTagsInput,
    outputSchema: z.toJSONSchema(listRepositoryTagsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_repository_languages: {
    description: 'List languages used in a GitHub repository with byte counts.',
    effect: 'read',
    inputSchema: listRepositoryLanguagesInput,
    outputSchema: z.toJSONSchema(listRepositoryLanguagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_repository_contributors: {
    description: 'List contributors to a GitHub repository.',
    effect: 'read',
    inputSchema: listRepositoryContributorsInput,
    outputSchema: z.toJSONSchema(listRepositoryContributorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_repository_topics: {
    description: 'List topics of a GitHub repository.',
    effect: 'read',
    inputSchema: listRepositoryTopicsInput,
    outputSchema: z.toJSONSchema(listRepositoryTopicsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  replace_repository_topics: {
    description: 'Replace all topics of a GitHub repository.',
    effect: 'write',
    inputSchema: replaceRepositoryTopicsInput,
    outputSchema: z.toJSONSchema(replaceRepositoryTopicsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_repository_readme: {
    description: 'Get the README of a GitHub repository and return both base64 and decoded text when available.',
    effect: 'read',
    inputSchema: getRepositoryReadmeInput,
    outputSchema: z.toJSONSchema(getRepositoryReadmeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_organization_repositories: {
    description: 'List repositories for a GitHub organization.',
    effect: 'read',
    inputSchema: listOrganizationRepositoriesInput,
    outputSchema: z.toJSONSchema(listOrganizationRepositoriesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_user_repositories: {
    description: 'List public repositories for a GitHub user.',
    effect: 'read',
    inputSchema: listUserRepositoriesInput,
    outputSchema: z.toJSONSchema(listUserRepositoriesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_user: {
    description: 'Get a GitHub user profile by username.',
    effect: 'read',
    inputSchema: getUserInput,
    outputSchema: z.toJSONSchema(getUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_repository_collaborators: {
    description: 'List collaborators of a GitHub repository.',
    effect: 'read',
    inputSchema: listRepositoryCollaboratorsInput,
    outputSchema: z.toJSONSchema(listRepositoryCollaboratorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_repository_collaborator: {
    description: 'Add a collaborator to a GitHub repository or update their permission.',
    effect: 'write',
    inputSchema: addRepositoryCollaboratorInput,
    outputSchema: z.toJSONSchema(addRepositoryCollaboratorOutput, { io: 'output', unrepresentable: 'any' }),
  },
  remove_repository_collaborator: {
    description: 'Remove a collaborator from a GitHub repository.',
    effect: 'destructive',
    inputSchema: removeRepositoryCollaboratorInput,
    outputSchema: z.toJSONSchema(removeRepositoryCollaboratorOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_repository_permission_for_user: {
    description: 'Get the repository permission level of a GitHub user.',
    effect: 'read',
    inputSchema: getRepositoryPermissionForUserInput,
    outputSchema: z.toJSONSchema(getRepositoryPermissionForUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_ref: {
    description: 'Get a Git reference in a GitHub repository.',
    effect: 'read',
    inputSchema: getRefInput,
    outputSchema: z.toJSONSchema(getRefOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_matching_refs: {
    description: 'List Git references matching a prefix in a GitHub repository.',
    effect: 'read',
    inputSchema: listMatchingRefsInput,
    outputSchema: z.toJSONSchema(listMatchingRefsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_ref: {
    description: 'Update a Git reference in a GitHub repository.',
    effect: 'write',
    inputSchema: updateRefInput,
    outputSchema: z.toJSONSchema(updateRefOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_ref: {
    description: 'Delete a Git reference in a GitHub repository.',
    effect: 'destructive',
    inputSchema: deleteRefInput,
    outputSchema: z.toJSONSchema(deleteRefOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_commit_comment: {
    description: 'Create a comment on a commit in a GitHub repository.',
    effect: 'write',
    inputSchema: createCommitCommentInput,
    outputSchema: z.toJSONSchema(createCommitCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_commit_comments: {
    description: 'List comments on a commit in a GitHub repository.',
    effect: 'read',
    inputSchema: listCommitCommentsInput,
    outputSchema: z.toJSONSchema(listCommitCommentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  star_repository: {
    description: 'Star a GitHub repository for the authenticated user.',
    effect: 'write',
    inputSchema: starRepositoryInput,
    outputSchema: z.toJSONSchema(starRepositoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  unstar_repository: {
    description: 'Unstar a GitHub repository for the authenticated user.',
    effect: 'write',
    inputSchema: unstarRepositoryInput,
    outputSchema: z.toJSONSchema(unstarRepositoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  check_repository_starred: {
    description: 'Check whether the authenticated user has starred a GitHub repository.',
    effect: 'read',
    inputSchema: checkRepositoryStarredInput,
    outputSchema: z.toJSONSchema(checkRepositoryStarredOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_repository_stargazers: {
    description: 'List users who starred a GitHub repository.',
    effect: 'read',
    inputSchema: listRepositoryStargazersInput,
    outputSchema: z.toJSONSchema(listRepositoryStargazersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_my_starred_repositories: {
    description: 'List repositories starred by the authenticated GitHub user.',
    effect: 'read',
    inputSchema: listMyStarredRepositoriesInput,
    outputSchema: z.toJSONSchema(listMyStarredRepositoriesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_repository_watchers: {
    description: 'List users watching a GitHub repository.',
    effect: 'read',
    inputSchema: listRepositoryWatchersInput,
    outputSchema: z.toJSONSchema(listRepositoryWatchersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_milestones: {
    description: 'List milestones for a GitHub repository.',
    effect: 'read',
    inputSchema: listMilestonesInput,
    outputSchema: z.toJSONSchema(listMilestonesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_milestone: {
    description: 'Get a GitHub milestone by number.',
    effect: 'read',
    inputSchema: getMilestoneInput,
    outputSchema: z.toJSONSchema(getMilestoneOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_milestone: {
    description: 'Create a milestone in a GitHub repository.',
    effect: 'write',
    inputSchema: createMilestoneInput,
    outputSchema: z.toJSONSchema(createMilestoneOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_milestone: {
    description: 'Update a GitHub milestone by number.',
    effect: 'write',
    inputSchema: updateMilestoneInput,
    outputSchema: z.toJSONSchema(updateMilestoneOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_milestone: {
    description: 'Delete a GitHub milestone by number.',
    effect: 'destructive',
    inputSchema: deleteMilestoneInput,
    outputSchema: z.toJSONSchema(deleteMilestoneOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_issue_comment: {
    description: 'Get a GitHub issue comment by ID.',
    effect: 'read',
    inputSchema: getIssueCommentInput,
    outputSchema: z.toJSONSchema(getIssueCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_issue_comment: {
    description: 'Update a GitHub issue comment by ID.',
    effect: 'write',
    inputSchema: updateIssueCommentInput,
    outputSchema: z.toJSONSchema(updateIssueCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_issue_comment: {
    description: 'Delete a GitHub issue comment by ID.',
    effect: 'destructive',
    inputSchema: deleteIssueCommentInput,
    outputSchema: z.toJSONSchema(deleteIssueCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_label: {
    description: 'Get a GitHub label by name.',
    effect: 'read',
    inputSchema: getLabelInput,
    outputSchema: z.toJSONSchema(getLabelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_label: {
    description: 'Update a GitHub label by name.',
    effect: 'write',
    inputSchema: updateLabelInput,
    outputSchema: z.toJSONSchema(updateLabelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_label: {
    description: 'Delete a GitHub label by name.',
    effect: 'destructive',
    inputSchema: deleteLabelInput,
    outputSchema: z.toJSONSchema(deleteLabelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_assignees: {
    description: 'List available assignees for issues in a GitHub repository.',
    effect: 'read',
    inputSchema: listAssigneesInput,
    outputSchema: z.toJSONSchema(listAssigneesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_issue_reaction: {
    description: 'Add a reaction to a GitHub issue.',
    effect: 'write',
    inputSchema: createIssueReactionInput,
    outputSchema: z.toJSONSchema(createIssueReactionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_issue_comment_reaction: {
    description: 'Add a reaction to a GitHub issue comment.',
    effect: 'write',
    inputSchema: createIssueCommentReactionInput,
    outputSchema: z.toJSONSchema(createIssueCommentReactionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_pull_request_review: {
    description: 'Get a GitHub pull request review by ID.',
    effect: 'read',
    inputSchema: getPullRequestReviewInput,
    outputSchema: z.toJSONSchema(getPullRequestReviewOutput, { io: 'output', unrepresentable: 'any' }),
  },
  dismiss_pull_request_review: {
    description: 'Dismiss a GitHub pull request review.',
    effect: 'write',
    inputSchema: dismissPullRequestReviewInput,
    outputSchema: z.toJSONSchema(dismissPullRequestReviewOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_pending_pull_request_review: {
    description: 'Delete a pending GitHub pull request review and return the deleted review.',
    effect: 'destructive',
    inputSchema: deletePendingPullRequestReviewInput,
    outputSchema: z.toJSONSchema(deletePendingPullRequestReviewOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_pull_request_review_comment: {
    description: 'Update a GitHub pull request review comment by ID.',
    effect: 'write',
    inputSchema: updatePullRequestReviewCommentInput,
    outputSchema: z.toJSONSchema(updatePullRequestReviewCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_pull_request_review_comment: {
    description: 'Delete a GitHub pull request review comment by ID.',
    effect: 'destructive',
    inputSchema: deletePullRequestReviewCommentInput,
    outputSchema: z.toJSONSchema(deletePullRequestReviewCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_workflow: {
    description: 'Get a GitHub Actions workflow by ID or file name.',
    effect: 'read',
    inputSchema: getWorkflowInput,
    outputSchema: z.toJSONSchema(getWorkflowOutput, { io: 'output', unrepresentable: 'any' }),
  },
  dispatch_workflow: {
    description: 'Trigger a GitHub Actions workflow dispatch event.',
    effect: 'write',
    inputSchema: dispatchWorkflowInput,
    outputSchema: z.toJSONSchema(dispatchWorkflowOutput, { io: 'output', unrepresentable: 'any' }),
  },
  cancel_workflow_run: {
    description: 'Cancel a GitHub Actions workflow run.',
    effect: 'destructive',
    inputSchema: cancelWorkflowRunInput,
    outputSchema: z.toJSONSchema(cancelWorkflowRunOutput, { io: 'output', unrepresentable: 'any' }),
  },
  rerun_failed_jobs: {
    description: 'Re-run failed jobs of a GitHub Actions workflow run.',
    effect: 'write',
    inputSchema: rerunFailedJobsInput,
    outputSchema: z.toJSONSchema(rerunFailedJobsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  enable_workflow: {
    description: 'Enable a GitHub Actions workflow.',
    effect: 'write',
    inputSchema: enableWorkflowInput,
    outputSchema: z.toJSONSchema(enableWorkflowOutput, { io: 'output', unrepresentable: 'any' }),
  },
  disable_workflow: {
    description: 'Disable a GitHub Actions workflow.',
    effect: 'write',
    inputSchema: disableWorkflowInput,
    outputSchema: z.toJSONSchema(disableWorkflowOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_workflow_run_artifacts: {
    description: 'List artifacts for a GitHub Actions workflow run.',
    effect: 'read',
    inputSchema: listWorkflowRunArtifactsInput,
    outputSchema: z.toJSONSchema(listWorkflowRunArtifactsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_release: {
    description: 'Update a GitHub release by numeric id.',
    effect: 'write',
    inputSchema: updateReleaseInput,
    outputSchema: z.toJSONSchema(updateReleaseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_release: {
    description: 'Delete a GitHub release by numeric id.',
    effect: 'destructive',
    inputSchema: deleteReleaseInput,
    outputSchema: z.toJSONSchema(deleteReleaseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  generate_release_notes: {
    description: 'Generate release notes content for a GitHub release.',
    effect: 'read',
    inputSchema: generateReleaseNotesInput,
    outputSchema: z.toJSONSchema(generateReleaseNotesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_release_asset: {
    description: 'Get a GitHub release asset by numeric id.',
    effect: 'read',
    inputSchema: getReleaseAssetInput,
    outputSchema: z.toJSONSchema(getReleaseAssetOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_release_asset: {
    description: 'Delete a GitHub release asset by numeric id.',
    effect: 'destructive',
    inputSchema: deleteReleaseAssetInput,
    outputSchema: z.toJSONSchema(deleteReleaseAssetOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
