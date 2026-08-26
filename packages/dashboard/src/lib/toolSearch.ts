import type { ToolSearchRequest } from '@tool-bridge/sdk/client'

export type ToolSearchOptions = Omit<NonNullable<ToolSearchRequest['opts']>, 'cursor'>

export const DEFAULT_TOOL_SEARCH_OPTIONS = {
  detail: 'compact',
  limit: 10,
  matching: 'best',
  mode: 'keyword',
} as const satisfies ToolSearchOptions

/** 补齐 Dashboard 搜索默认值，并复制数组，供请求和 queryKey 共用同一份稳定快照。 */
export function resolveToolSearchOptions(
  options: ToolSearchOptions = {},
): ToolSearchOptions {
  return {
    ...options,
    detail: options.detail ?? DEFAULT_TOOL_SEARCH_OPTIONS.detail,
    ...(options.effects === undefined ? {} : { effects: [...options.effects] }),
    ...(options.federation === undefined ? {} : { federation: options.federation }),
    limit: options.limit ?? DEFAULT_TOOL_SEARCH_OPTIONS.limit,
    matching: options.matching ?? DEFAULT_TOOL_SEARCH_OPTIONS.matching,
    mode: options.mode ?? DEFAULT_TOOL_SEARCH_OPTIONS.mode,
  }
}

export function toolSearchQueryKey(
  base: readonly unknown[],
  query: string,
  options: ToolSearchOptions,
) {
  return [...base, 'tool-search', query, options] as const
}
