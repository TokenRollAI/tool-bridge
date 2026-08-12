/**
 * GitHub 的 release action(11 个)。迁移自 open-connector `runtime-release.ts`。
 *
 * 注意 `name` / `body` 走的是"原样"取值(含空串)而不是去空白:release 说明清空是个
 * 正当操作。`tagName` / `targetCommitish` / `makeLatest` 则去空白 —— 空的 tag 名没有意义。
 */

import type { z } from 'zod/v4'
import type {
  createReleaseInput,
  deleteReleaseAssetInput,
  deleteReleaseInput,
  generateReleaseNotesInput,
  getLatestReleaseInput,
  getReleaseAssetInput,
  getReleaseByTagInput,
  getReleaseInput,
  listReleaseAssetsInput,
  listReleasesInput,
  updateReleaseInput,
} from '../schema'
import {
  compact,
  type Json,
  type ProviderContext,
  repoPath,
  requestArray,
  requestNoContent,
  requestRecord,
  text,
} from './shared'

export async function listReleases(
  input: z.infer<typeof listReleasesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const releases = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, '/releases'),
    query: { per_page: input.perPage, page: input.page },
  })
  return { releases }
}

export function createRelease(
  input: z.infer<typeof createReleaseInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'POST',
    path: repoPath(input.owner, input.repo, '/releases'),
    body: compact({
      tag_name: input.tagName,
      target_commitish: text(input.targetCommitish),
      name: input.name,
      body: input.body,
      draft: input.draft,
      prerelease: input.prerelease,
      generate_release_notes: input.generateReleaseNotes,
      make_latest: text(input.makeLatest),
    }),
  })
}

export function getRelease(
  input: z.infer<typeof getReleaseInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, { path: repoPath(input.owner, input.repo, `/releases/${input.releaseId}`) })
}

export function getLatestRelease(
  input: z.infer<typeof getLatestReleaseInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, { path: repoPath(input.owner, input.repo, '/releases/latest') })
}

export function getReleaseByTag(
  input: z.infer<typeof getReleaseByTagInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    path: repoPath(input.owner, input.repo, `/releases/tags/${encodeURIComponent(input.tag)}`),
  })
}

export async function listReleaseAssets(
  input: z.infer<typeof listReleaseAssetsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const assets = await requestArray(ctx, {
    path: repoPath(input.owner, input.repo, `/releases/${input.releaseId}/assets`),
    query: { per_page: input.perPage, page: input.page },
  })
  return { assets }
}

export function updateRelease(
  input: z.infer<typeof updateReleaseInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    method: 'PATCH',
    path: repoPath(input.owner, input.repo, `/releases/${input.releaseId}`),
    body: compact({
      tag_name: text(input.tagName),
      target_commitish: text(input.targetCommitish),
      name: input.name,
      body: input.body,
      draft: input.draft,
      prerelease: input.prerelease,
      make_latest: text(input.makeLatest),
    }),
  })
}

export async function deleteRelease(
  input: z.infer<typeof deleteReleaseInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, {
    method: 'DELETE',
    path: repoPath(input.owner, input.repo, `/releases/${input.releaseId}`),
  })
  return { ok: true }
}

/**
 * 名字带 generate,但它只是**算一遍** release notes 并回给你,不落任何东西 —— 故 effect 是 read
 * (虽然 HTTP 方法是 POST)。
 */
export async function generateReleaseNotes(
  input: z.infer<typeof generateReleaseNotesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestRecord(ctx, {
    method: 'POST',
    path: repoPath(input.owner, input.repo, '/releases/generate-notes'),
    body: compact({
      tag_name: input.tagName,
      target_commitish: text(input.targetCommitish),
      previous_tag_name: text(input.previousTagName),
      configuration_file_path: text(input.configurationFilePath),
    }),
  })
  return {
    name: String(payload.name ?? ''),
    body: String(payload.body ?? ''),
  }
}

export function getReleaseAsset(
  input: z.infer<typeof getReleaseAssetInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    path: repoPath(input.owner, input.repo, `/releases/assets/${input.assetId}`),
  })
}

export async function deleteReleaseAsset(
  input: z.infer<typeof deleteReleaseAssetInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, {
    method: 'DELETE',
    path: repoPath(input.owner, input.repo, `/releases/assets/${input.assetId}`),
  })
  return { ok: true }
}
