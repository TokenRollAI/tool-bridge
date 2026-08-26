import { ArrowUpRight, Loader2, Search, SearchX, X } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { ToolSearchPage } from '@/lib/types'
import type { ApiError } from '@/lib/api'
import { PaginationFooter } from '@/components/PaginationFooter'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToolSearch } from '@/lib/queries'
import { encodeTreePath } from '@/lib/path'
import { cn } from '@/lib/utils'

function errorTitle(error: Error): string {
  const api = error as ApiError
  if (api.status === 404) return '当前网关未启用工具搜索'
  if (api.status === 401 || api.status === 403) return '当前连接无权执行搜索'
  return '工具搜索失败'
}

type SourceStatus = NonNullable<ToolSearchPage['sources']>[number]['status']
type SearchSource = NonNullable<ToolSearchPage['sources']>[number]

const SOURCE_STATUS_LABEL: Record<SourceStatus, string> = {
  budget_exhausted: '超出搜索预算',
  cycle: '检测到循环',
  hop_limit: '超出联邦深度',
  invalid_response: '响应无效',
  ok: '正常',
  timed_out: '超时',
  unavailable: '暂不可用',
  unsupported: '不支持搜索',
}

function sourceName(path: string): string {
  return path || '本实例'
}

function PartialSourceSummary({ sources }: { sources: SearchSource[] }) {
  return (
    <div
      aria-live="polite"
      className="border-b border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-xs text-amber-600 dark:text-amber-400"
      role="status"
    >
      <p className="font-medium">部分联邦来源未完成，结果可能不完整。</p>
      {sources.length > 0 && (
        <p className="mt-1 font-mono">
          {sources.map(source => (
            `${sourceName(source.path)}（${SOURCE_STATUS_LABEL[source.status]}）`
          )).join('、')}
        </p>
      )}
    </div>
  )
}

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const query = (params.get('q') ?? '').trim()
  const federationParam = params.get('federation')
  const federation = federationParam === 'local' || federationParam === 'recursive'
    ? federationParam
    : 'auto'
  const [draft, setDraft] = useState(query)
  const search = useToolSearch(query, federation === 'auto' ? {} : { federation })
  const pages = search.data?.pages ?? []
  const items = pages.flatMap(page => page.items)
  const partial = pages.some(page => page.partial === true)
  const degradedSources = [...new Map(
    pages
      .flatMap(page => page.sources ?? [])
      .filter(source => source.status !== 'ok')
      .map(source => [source.path, source] as const),
  ).values()]

  useEffect(() => setDraft(query), [query])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = draft.trim()
    const nextParams = new URLSearchParams()
    if (next) nextParams.set('q', next)
    if (federation !== 'auto') nextParams.set('federation', federation)
    setParams(nextParams, { replace: true })
  }

  const setFederation = (next: 'auto' | 'local' | 'recursive') => {
    const nextParams = new URLSearchParams(params)
    if (next === 'auto') nextParams.delete('federation')
    else nextParams.set('federation', next)
    setParams(nextParams, { replace: true })
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
      <PageHeader eyebrow="DISCOVERY" title="工具搜索" />

      <form className="mt-6 flex min-w-0 flex-col gap-2 sm:flex-row" onSubmit={submit}>
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="工具搜索关键词"
            autoComplete="off"
            className="h-11 bg-background pr-10 pl-10 text-sm"
            maxLength={1024}
            onChange={event => setDraft(event.target.value)}
            placeholder="工具名称、说明或反馈关键词"
            value={draft}
          />
          {draft && (
            <Button
              aria-label="清空搜索关键词"
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
              onClick={() => setDraft('')}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          )}
        </div>
        <select
          aria-label="搜索范围"
          className="h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(event) => {
            const value = event.target.value
            setFederation(value === 'local' || value === 'recursive' ? value : 'auto')
          }}
          value={federation}
        >
          <option value="auto">自动（网关默认）</option>
          <option value="recursive">递归联邦</option>
          <option value="local">仅本实例</option>
        </select>
        <Button className="h-11 sm:w-28" disabled={!draft.trim()} type="submit">
          <Search />
          搜索
        </Button>
      </form>

      <div className="mt-4 min-h-[24rem] overflow-hidden rounded-lg border bg-card/35">
        {!query
          ? (
              <EmptyState className="m-4" icon={Search} title="输入关键词开始搜索" />
            )
          : search.isPending
            ? (
                <div aria-label="正在搜索工具" className="grid gap-2 p-4">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-5/6" />
                  <Skeleton className="h-20 w-3/4" />
                </div>
              )
            : search.isError
              ? (
                  <EmptyState
                    action={(
                      <Button onClick={() => void search.refetch()} size="sm" variant="outline">
                        重试
                      </Button>
                    )}
                    className="m-4"
                    icon={SearchX}
                    title={errorTitle(search.error)}
                    tone="danger"
                  >
                    <p>{search.error.message}</p>
                  </EmptyState>
                )
              : items.length === 0
                ? (
                    <>
                      {partial && <PartialSourceSummary sources={degradedSources} />}
                      <EmptyState className="m-4" icon={SearchX} title="没有可见的匹配工具" />
                    </>
                  )
                : (
                    <>
                      {partial && <PartialSourceSummary sources={degradedSources} />}
                      <div className="border-b px-4 py-3">
                        <p aria-live="polite" className="text-xs text-muted-foreground">
                          已加载
                          {' '}
                          <span className="font-mono text-foreground tabular-nums">
                            {items.length}
                          </span>
                          {' '}
                          个工具
                        </p>
                      </div>
                      <ul aria-label="工具搜索结果" className="divide-y">
                        {items.map(({ path, relevance, source, tool }) => (
                          <li key={`${source?.path ?? ''}\u0000${path}\u0000${tool.name}`}>
                            <Link
                              className={cn(
                                'group grid min-w-0 gap-3 px-4 py-4 transition-colors sm:grid-cols-[minmax(12rem,0.7fr)_minmax(0,1fr)_auto] sm:items-center',
                                'hover:bg-secondary/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none',
                              )}
                              to={`/nodes/${encodeTreePath(path)}?tool=${encodeURIComponent(tool.name)}`}
                            >
                              <div className="min-w-0">
                                <p className="truncate font-mono text-sm font-medium text-foreground">
                                  {tool.name}
                                </p>
                                <p className="mt-1 truncate font-mono text-[11px] text-primary">
                                  {path}
                                </p>
                                <p
                                  aria-label={`来源 ${sourceName(source?.path ?? '')}`}
                                  className="mt-1 truncate font-mono text-[10px] text-muted-foreground"
                                >
                                  来源 ·
                                  {' '}
                                  {sourceName(source?.path ?? '')}
                                </p>
                              </div>
                              <p className="min-w-0 text-sm leading-5 break-words text-muted-foreground">
                                {tool.description || '无说明'}
                              </p>
                              <div className="flex items-center gap-2 sm:justify-end">
                                <span
                                  aria-label={`关键词覆盖 ${relevance.matchedTermCount}/${relevance.totalTermCount}`}
                                  className="rounded-sm border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                                  title={`覆盖率 ${Math.round(relevance.coverage * 100)}%`}
                                >
                                  覆盖
                                  {' '}
                                  {relevance.matchedTermCount}
                                  /
                                  {relevance.totalTermCount}
                                </span>
                                {tool.effect && (
                                  <span className="rounded-sm border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                    {tool.effect}
                                  </span>
                                )}
                                {tool.confirm === true && (
                                  <span className="rounded-sm border border-amber-500/25 bg-amber-500/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-amber-500">
                                    confirm
                                  </span>
                                )}
                                <ArrowUpRight
                                  aria-hidden="true"
                                  className="size-4 text-muted-foreground transition-colors group-hover:text-primary"
                                />
                              </div>
                            </Link>
                          </li>
                        ))}
                      </ul>
                      <PaginationFooter
                        count={items.length}
                        hasNextPage={search.hasNextPage}
                        isFetchingNextPage={search.isFetchingNextPage}
                        onLoadMore={() => void search.fetchNextPage()}
                        unit="个工具"
                      />
                    </>
                  )}
      </div>

      {search.isFetching && !search.isFetchingNextPage && !search.isPending && (
        <p
          aria-live="polite"
          className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Loader2 className="size-3.5 animate-spin" />
          正在刷新结果
        </p>
      )}
    </div>
  )
}
