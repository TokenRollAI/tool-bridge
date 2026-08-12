/**
 * GitHub 的 activity / star 类 action(12 个)。迁移自 open-connector `runtime-activity.ts`。
 *
 * 一处上游细节决定了这里的形状:`check_repository_starred` 用**状态码**表达布尔结果
 * (204 = 已 star,404 = 未 star),两者都是成功。走普通的 requestJson 会把 404 抛成
 * `not_found`,于是"没 star 过"变成一个错误 —— 这是迁移时最容易丢的一处。
 */

import type { z } from 'zod/v4'
import type {
  checkRepositoryStarredInput,
  listAuthenticatedUserEventsInput,
  listAuthenticatedUserReceivedEventsInput,
  listMyStarredRepositoriesInput,
  listPublicEventsInput,
  listRepositoryEventsInput,
  listRepositoryStargazersInput,
  listRepositoryWatchersInput,
  listUserPublicEventsInput,
  listUserReceivedPublicEventsInput,
  starRepositoryInput,
  unstarRepositoryInput,
} from '../schema'
import {
  githubError,
  type Json,
  type ProviderContext,
  repoPath,
  requestArray,
  requestNoContent,
  requestRaw,
} from './shared'

/** 六个 events 端点只在路径上不同,分页参数完全一致。 */
async function listEvents(
  ctx: ProviderContext,
  path: string,
  input: { page?: number, perPage?: number },
): Promise<Json> {
  return { events: await requestArray(ctx, { path, query: { per_page: input.perPage, page: input.page } }) }
}

export function listPublicEvents(
  input: z.infer<typeof listPublicEventsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listEvents(ctx, '/events', input)
}

export function listUserPublicEvents(
  input: z.infer<typeof listUserPublicEventsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listEvents(ctx, `/users/${encodeURIComponent(input.username)}/events/public`, input)
}

export function listUserReceivedPublicEvents(
  input: z.infer<typeof listUserReceivedPublicEventsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listEvents(ctx, `/users/${encodeURIComponent(input.username)}/received_events/public`, input)
}

/**
 * 名字里的 "authenticated user" 有误导:上游打的是 `/users/{username}/events`,username
 * 来自入参而不是凭证。要拿到私有事件,这个 username 必须与令牌所有者一致 —— 照抄上游。
 */
export function listAuthenticatedUserEvents(
  input: z.infer<typeof listAuthenticatedUserEventsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listEvents(ctx, `/users/${encodeURIComponent(input.username)}/events`, input)
}

export function listAuthenticatedUserReceivedEvents(
  input: z.infer<typeof listAuthenticatedUserReceivedEventsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listEvents(ctx, `/users/${encodeURIComponent(input.username)}/received_events`, input)
}

export function listRepositoryEvents(
  input: z.infer<typeof listRepositoryEventsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listEvents(ctx, repoPath(input.owner, input.repo, '/events'), input)
}

export async function starRepository(
  input: z.infer<typeof starRepositoryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, {
    method: 'PUT',
    path: `/user/starred/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`,
  })
  return { ok: true }
}

export async function unstarRepository(
  input: z.infer<typeof unstarRepositoryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, {
    method: 'DELETE',
    path: `/user/starred/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`,
  })
  return { ok: true }
}

export async function checkRepositoryStarred(
  input: z.infer<typeof checkRepositoryStarredInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const { payload, response } = await requestRaw(ctx, {
    path: `/user/starred/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`,
  })
  // 204 与 404 都是**成功**的答案,只是答案不同。
  if (response.status === 204) return { starred: true }
  if (response.status === 404) return { starred: false }
  throw githubError(response, payload)
}

export async function listRepositoryStargazers(
  input: z.infer<typeof listRepositoryStargazersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const stargazers = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, '/stargazers'),
    query: { per_page: input.perPage, page: input.page },
  })
  return { stargazers }
}

export async function listMyStarredRepositories(
  input: z.infer<typeof listMyStarredRepositoriesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const repositories = await requestArray(ctx, {
    path: '/user/starred',
    query: {
      sort: input.sort,
      direction: input.direction,
      per_page: input.perPage,
      page: input.page,
    },
  })
  return { repositories }
}

export async function listRepositoryWatchers(
  input: z.infer<typeof listRepositoryWatchersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // watchers 在 REST 上叫 subscribers(GitHub 自己的历史包袱:`/watchers` 是 stargazers)。
  const watchers = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, '/subscribers'),
    query: { per_page: input.perPage, page: input.page },
  })
  return { watchers }
}
