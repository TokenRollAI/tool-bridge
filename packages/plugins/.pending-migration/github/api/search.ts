/**
 * GitHub 的 search action(6 个)。迁移自 open-connector `runtime-search.ts`。
 *
 * 六个端点形状一致:`q` 加排序分页,响应是 `{total_count, incomplete_results, items}` 信封。
 * 出参键名不统一是**上游的既有契约**:`search_repositories` 把 items 叫 `repositories`,
 * 其余五个都叫 `items` —— 照抄,改名会让已有调用方拿不到结果。
 */

import type { z } from 'zod/v4'
import type {
  searchCodeInput,
  searchCommitsInput,
  searchLabelsInput,
  searchRepositoriesInput,
  searchTopicsInput,
  searchUsersInput,
} from '../schema'
import { count, type Json, objectArray, type ProviderContext, type Query, requestRecord } from './shared'

/** 六个 search 端点共用的信封:总数 + 是否被截断 + 命中项。 */
async function search(ctx: ProviderContext, path: string, query: Query): Promise<Json> {
  const response = await requestRecord(ctx, { path, query })
  return {
    total_count: count(response.total_count),
    incomplete_results: Boolean(response.incomplete_results),
    items: objectArray(response.items),
  }
}

export async function searchRepositories(
  input: z.infer<typeof searchRepositoriesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const result = await search(ctx, '/search/repositories', {
    q: input.query,
    sort: input.sort,
    order: input.order,
    per_page: input.perPage,
    page: input.page,
  })
  // 只有这一个端点把命中项叫 repositories(上游如此,不是笔误)。
  return {
    total_count: result.total_count,
    incomplete_results: result.incomplete_results,
    repositories: result.items,
  }
}

export function searchUsers(
  input: z.infer<typeof searchUsersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return search(ctx, '/search/users', {
    q: input.query,
    sort: input.sort,
    order: input.order,
    per_page: input.perPage,
    page: input.page,
  })
}

export function searchCommits(
  input: z.infer<typeof searchCommitsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return search(ctx, '/search/commits', {
    q: input.query,
    sort: input.sort,
    order: input.order,
    per_page: input.perPage,
    page: input.page,
  })
}

export function searchCode(
  input: z.infer<typeof searchCodeInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return search(ctx, '/search/code', {
    q: input.query,
    sort: input.sort,
    order: input.order,
    per_page: input.perPage,
    page: input.page,
  })
}

export function searchLabels(
  input: z.infer<typeof searchLabelsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return search(ctx, '/search/labels', {
    // 这个端点按**仓库 id**(不是 owner/repo)定位仓库,是 GitHub search API 的特例。
    repository_id: input.repositoryId,
    q: input.query,
    sort: input.sort,
    order: input.order,
    per_page: input.perPage,
    page: input.page,
  })
}

export function searchTopics(
  input: z.infer<typeof searchTopicsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return search(ctx, '/search/topics', {
    q: input.query,
    per_page: input.perPage,
    page: input.page,
  })
}
