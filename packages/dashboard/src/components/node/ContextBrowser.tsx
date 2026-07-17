import {
  Database,
  ExternalLink,
  Eye,
  FilePlus2,
  FileText,
  FolderOpen,
  ListFilter,
  Loader2,
  PanelRight,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import type { ContextEntry, HelpCmd } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCtxEntries, useCtxEntry, useInvoke } from '@/lib/queries'
import { ConfirmAction } from '@/components/ConfirmAction'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** node://<ns>/<entry> → namespace 内相对条目路径。 */
function relPath(uri: string, nodePath: string): string {
  const prefix = `node://${nodePath}/`
  return uri.startsWith(prefix) ? uri.slice(prefix.length) : uri.replace(/^node:\/\//, '')
}

function humanSize(n?: number): string {
  if (n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`
}

function humanTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(t).toLocaleString()
}

/** 大对象条目:content 是 { $ref } 而非内联。 */
function refOf(content: unknown): string | null {
  if (typeof content === 'object' && content !== null && '$ref' in content) {
    const v = (content as { $ref: unknown }).$ref
    return typeof v === 'string' ? v : null
  }
  return null
}

/** 300ms 防抖(前缀/搜索输入 → 查询参数)。 */
function useDebounced(value: string): string {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), 300)
    return () => clearTimeout(t)
  }, [value])
  return v
}

/** 预览只在桌面常驻；移动端继续使用 Dialog，避免隐藏的 Portal 意外打开。 */
function useDesktopContextLayout(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(min-width: 1024px)').matches,
  )
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const update = () => setDesktop(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return desktop
}

/**
 * context 节点的条目浏览器(E2E-6 ③④ 的 Dashboard 路径):
 * List(前缀过滤)/ Search / Get 预览 / Write 新建编辑 / Delete。
 * 与 `tb ctx ls|cat|put|rm` 走同一数据面,无管理旁路。
 */
export function ContextBrowser({ path, cmds }: { cmds: HelpCmd[], path: string }) {
  const canWrite = cmds.some(c => c.name === 'Write')
  const canDelete = cmds.some(c => c.name === 'Delete')
  const canSearch = cmds.some(c => c.name === 'Search')

  const [prefixInput, setPrefixInput] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [searchMode, setSearchMode] = useState<'keyword' | 'semantic'>('keyword')
  const prefix = useDebounced(prefixInput)
  const query = useDebounced(queryInput)
  const effectiveQuery = canSearch ? query.trim() : ''
  // Search 与 List(prefix) 是两个独立协议动作；检索期间明确停用 prefix，避免误以为会组合过滤。
  const searchRequested = canSearch && queryInput.trim() !== ''
  const searchActive = canSearch && effectiveQuery !== ''

  const entries = useCtxEntries(path, searchActive ? '' : prefix, effectiveQuery, searchMode)
  const invoke = useInvoke()
  const qc = useQueryClient()
  const desktop = useDesktopContextLayout()

  const [selected, setSelected] = useState<string | null>(null)
  const [mobileViewing, setMobileViewing] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ entry?: ContextEntry, entryPath: string } | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: ['tb'] })

  const remove = async (entryPath: string) => {
    try {
      await invoke.mutateAsync({ path, tool: 'Delete', args: { path: entryPath } })
      toast.success(`已删除 ${entryPath}`)
      setSelected(current => (current === entryPath ? null : current))
      setMobileViewing(current => (current === entryPath ? null : current))
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除 Context 条目失败')
      throw error
    }
  }

  const items = entries.data?.pages.flatMap(p => p.items) ?? []
  const openEntry = (entryPath: string) => {
    setSelected(entryPath)
    if (!desktop) setMobileViewing(entryPath)
  }

  return (
    <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(360px,0.9fr)_minmax(420px,1.1fr)] lg:items-start">
      <section className="min-w-0 overflow-hidden rounded-xl border bg-card/35">
        <header className="flex min-h-14 items-center justify-between gap-3 border-b px-3.5 py-3 sm:px-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Database className="size-4 text-emerald-400" />
              <h2 className="text-sm font-medium">Context 条目</h2>
              <span className="rounded border bg-background/60 px-1.5 font-mono text-[10px] leading-5 text-muted-foreground tabular-nums">
                {items.length}
              </span>
            </div>
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70">
              node://
              {path}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              aria-label="刷新条目"
              className="text-muted-foreground"
              onClick={() => entries.refetch()}
              size="icon-sm"
              title="刷新条目"
              variant="ghost"
            >
              <RefreshCw className={cn('size-3.5', entries.isFetching && 'animate-spin')} />
            </Button>
            {canWrite && (
              <Button onClick={() => setEditing({ entryPath: '' })} size="sm">
                <FilePlus2 />
                新建
              </Button>
            )}
          </div>
        </header>

        <div className="grid gap-2.5 border-b bg-background/25 p-3 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1.5">
            <span className="font-mono text-[9px] tracking-[0.13em] text-muted-foreground">
              LIST
            </span>
            <div className="relative min-w-0">
              <ListFilter className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                aria-describedby={
                  searchRequested || searchActive ? 'context-prefix-search-note' : undefined
                }
                aria-label="前缀过滤"
                className="h-9 w-full pl-8 font-mono text-xs"
                disabled={searchRequested || searchActive}
                onChange={e => setPrefixInput(e.target.value)}
                placeholder={
                  searchRequested || searchActive ? '检索时不使用前缀' : '前缀，如 docs/'
                }
                value={prefixInput}
              />
            </div>
          </div>
          {canSearch && (
            <div className="grid min-w-0 gap-1.5">
              <span className="font-mono text-[9px] tracking-[0.13em] text-muted-foreground">
                SEARCH
              </span>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_7.25rem] gap-1.5">
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
                  <Input
                    aria-label="检索"
                    className="h-9 w-full pl-8 font-mono text-xs"
                    onChange={e => setQueryInput(e.target.value)}
                    placeholder="检索条目…"
                    value={queryInput}
                  />
                </div>
                <Select
                  onValueChange={v => setSearchMode(v as 'keyword' | 'semantic')}
                  value={searchMode}
                >
                  <SelectTrigger aria-label="检索模式" className="h-9 w-full font-mono text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem className="font-mono text-xs" value="keyword">
                      keyword
                    </SelectItem>
                    <SelectItem className="font-mono text-xs" value="semantic">
                      semantic
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {(searchRequested || searchActive) && (
            <p
              className="text-[11px] leading-4 text-muted-foreground sm:col-span-2"
              id="context-prefix-search-note"
              role="status"
            >
              当前使用 Search；prefix 只属于 List，本次检索不会组合前缀过滤。
            </p>
          )}
        </div>

        <div className="min-h-72 lg:min-h-[32rem] lg:max-h-[calc(100dvh-18rem)] lg:overflow-y-auto">
          {entries.isPending
            ? (
                <div aria-label="正在加载条目" className="grid gap-3 p-4" role="status">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-4/5" />
                </div>
              )
            : entries.isError
              ? (
                  <div className="p-4" role="alert">
                    <p className="text-sm text-destructive">{entries.error.message}</p>
                    <Button
                      className="mt-3"
                      disabled={entries.isFetching}
                      onClick={() => entries.refetch()}
                      size="sm"
                      variant="outline"
                    >
                      <RefreshCw className={cn(entries.isFetching && 'animate-spin')} />
                      重试
                    </Button>
                  </div>
                )
              : items.length === 0
                ? (
                    <EmptyState
                      className="min-h-72 border-0"
                      icon={Database}
                      title={effectiveQuery ? '无匹配条目' : 'namespace 是空的'}
                    >
                      {canWrite && !effectiveQuery && (
                        <p>
                          点「新建」写入第一条，或用 CLI：
                          <code className="ml-1 font-mono">
                            tb ctx put
                            {path}
                            /&lt;条目路径&gt;
                          </code>
                        </p>
                      )}
                    </EmptyState>
                  )
                : (
                    <ul aria-label="Context 条目列表" className="divide-y">
                      {items.map((e) => {
                        const rel = relPath(e.uri, path)
                        const isDir = rel.endsWith('/')
                        const active = !isDir && selected === rel
                        const EntryIcon = isDir ? FolderOpen : FileText
                        return (
                          <li
                            className={cn(
                              'group relative flex min-w-0 items-stretch transition-colors hover:bg-secondary/35',
                              active && 'bg-primary/[0.065]',
                            )}
                            key={e.uri}
                          >
                            {active && (
                              <span className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-primary" />
                            )}
                            <button
                              aria-label={isDir ? `使用目录前缀 ${rel}` : `预览条目 ${rel}`}
                              aria-pressed={isDir ? undefined : active}
                              className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left outline-none focus-visible:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                              onClick={() => (isDir ? setPrefixInput(rel) : openEntry(rel))}
                              type="button"
                            >
                              <span
                                className={cn(
                                  'grid size-8 shrink-0 place-items-center rounded-lg border bg-background/75',
                                  isDir ? 'text-primary' : 'text-sky-400',
                                )}
                              >
                                <EntryIcon className="size-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span
                                  className="block truncate font-mono text-xs text-foreground"
                                  title={rel}
                                >
                                  {rel}
                                </span>
                                <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                                  {isDir
                                    ? (
                                        <span>目录 · 设为 List prefix</span>
                                      )
                                    : (
                                        <>
                                          <span className="max-w-44 truncate font-mono">{e.contentType}</span>
                                          <span className="font-mono tabular-nums">{humanSize(e.size)}</span>
                                          <span title={e.updatedAt}>{humanTime(e.updatedAt)}</span>
                                        </>
                                      )}
                                </span>
                              </span>
                            </button>
                            {!isDir && (
                              <div className="flex shrink-0 items-center gap-0.5 pr-2">
                                <Button
                                  aria-label={`查看 ${rel}`}
                                  className="size-10 sm:size-8"
                                  onClick={() => openEntry(rel)}
                                  size="icon-sm"
                                  title="查看"
                                  variant="ghost"
                                >
                                  <Eye />
                                </Button>
                                {canWrite && (
                                  <Button
                                    aria-label={`编辑 ${rel}`}
                                    className="size-10 sm:size-8"
                                    onClick={() => setEditing({ entryPath: rel })}
                                    size="icon-sm"
                                    title="编辑"
                                    variant="ghost"
                                  >
                                    <Pencil />
                                  </Button>
                                )}
                                {canDelete && (
                                  <ConfirmAction
                                    actionLabel="删除"
                                    description={<p>删除是幂等的，但内容不可恢复。</p>}
                                    onConfirm={() => remove(rel)}
                                    title={`删除条目 ${rel}?`}
                                    trigger={(
                                      <Button
                                        aria-label={`删除 ${rel}`}
                                        className="size-10 sm:size-8"
                                        size="icon-sm"
                                        title="删除"
                                        variant="ghost"
                                      >
                                        <Trash2 className="text-destructive" />
                                      </Button>
                                    )}
                                  />
                                )}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
        </div>

        <footer className="flex min-h-12 flex-wrap items-center gap-3 border-t bg-background/25 px-3.5 py-2.5 sm:px-4">
          <p className="font-mono text-[10px] text-muted-foreground tabular-nums">
            已加载
            {' '}
            {items.length}
            {' '}
            条
            {effectiveQuery ? ' · Search 结果' : ' · List 结果'}
          </p>
          {entries.hasNextPage && (
            <Button
              className="ml-auto text-xs"
              disabled={entries.isFetchingNextPage}
              onClick={() => entries.fetchNextPage()}
              size="sm"
              variant="outline"
            >
              {entries.isFetchingNextPage && <Loader2 className="animate-spin" />}
              加载更多
            </Button>
          )}
        </footer>
      </section>

      <EntryPreviewPane
        canDelete={canDelete}
        canWrite={canWrite}
        entryPath={desktop ? selected : null}
        onDelete={remove}
        onEdit={rel => setEditing({ entryPath: rel })}
        path={path}
      />

      <EntryViewDialog
        canDelete={canDelete}
        canWrite={canWrite}
        entryPath={desktop ? null : mobileViewing}
        onClose={() => setMobileViewing(null)}
        onDelete={remove}
        onEdit={(rel) => {
          setMobileViewing(null)
          setEditing({ entryPath: rel })
        }}
        path={path}
      />
      {editing && (
        <EntryEditDialog
          entryPath={editing.entryPath}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            refresh()
          }}
          path={path}
        />
      )}
    </section>
  )
}

function EntryPreviewPane({
  path,
  entryPath,
  canWrite,
  canDelete,
  onEdit,
  onDelete,
}: {
  canDelete: boolean
  canWrite: boolean
  entryPath: string | null
  onDelete: (rel: string) => Promise<void>
  onEdit: (rel: string) => void
  path: string
}) {
  const entry = useCtxEntry(path, entryPath)
  const e = entry.data
  const ref = e ? refOf(e.content) : null
  const text = e && ref === null ? entryText(e) : ''

  return (
    <aside className="hidden min-w-0 overflow-hidden rounded-xl border bg-card/35 lg:sticky lg:top-4 lg:flex lg:min-h-[40rem] lg:max-h-[calc(100dvh-8rem)] lg:flex-col">
      {entryPath === null
        ? (
            <div className="grid min-h-[40rem] place-items-center p-8 text-center">
              <div className="max-w-64">
                <span className="mx-auto grid size-12 place-items-center rounded-xl border bg-background/70 text-muted-foreground">
                  <PanelRight className="size-5" />
                </span>
                <h2 className="mt-4 text-sm font-medium">选择条目查看详情</h2>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                  预览会固定在这里，筛选、翻页和目录上下文都不会丢失。
                </p>
              </div>
            </div>
          )
        : (
            <>
              <header className="flex min-h-16 items-start justify-between gap-4 border-b px-4 py-3.5">
                <div className="min-w-0">
                  <p className="font-mono text-[9px] tracking-[0.14em] text-muted-foreground">
                    PREVIEW
                  </p>
                  <h2 className="mt-1 break-all font-mono text-sm font-medium">{entryPath}</h2>
                  {e && <EntryFacts entry={e} />}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    aria-label="刷新预览"
                    disabled={entry.isFetching}
                    onClick={() => entry.refetch()}
                    size="icon-sm"
                    title="刷新预览"
                    variant="ghost"
                  >
                    <RefreshCw className={cn(entry.isFetching && 'animate-spin')} />
                  </Button>
                  {canWrite && (
                    <Button onClick={() => onEdit(entryPath)} size="sm" variant="outline">
                      <Pencil />
                      编辑
                    </Button>
                  )}
                  {canDelete && (
                    <ConfirmAction
                      actionLabel="删除"
                      description={<p>删除是幂等的，但内容不可恢复。</p>}
                      onConfirm={() => onDelete(entryPath)}
                      title={`删除条目 ${entryPath}?`}
                      trigger={(
                        <Button aria-label="删除条目" size="icon-sm" title="删除" variant="ghost">
                          <Trash2 className="text-destructive" />
                        </Button>
                      )}
                    />
                  )}
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {entry.isPending
                  ? (
                      <div aria-label="正在读取条目" className="grid gap-3" role="status">
                        <Skeleton className="h-5 w-full" />
                        <Skeleton className="h-5 w-5/6" />
                        <Skeleton className="h-48 w-full" />
                      </div>
                    )
                  : entry.isError
                    ? (
                        <div
                          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3"
                          role="alert"
                        >
                          <p className="text-sm text-destructive">{entry.error.message}</p>
                          <Button
                            className="mt-3"
                            disabled={entry.isFetching}
                            onClick={() => entry.refetch()}
                            size="sm"
                            variant="outline"
                          >
                            <RefreshCw className={cn(entry.isFetching && 'animate-spin')} />
                            重试读取
                          </Button>
                        </div>
                      )
                    : e
                      ? (
                          <div className="grid gap-5">
                            <EntryContent entry={e} />
                            <EntryMetadata entry={e} />
                          </div>
                        )
                      : null}
              </div>

              {e && (
                <footer className="flex min-h-12 items-center justify-between gap-3 border-t bg-background/25 px-4 py-2.5">
                  <p
                    className="min-w-0 truncate font-mono text-[10px] text-muted-foreground"
                    title={e.version}
                  >
                    version ·
                    {' '}
                    {e.version}
                  </p>
                  {ref === null && <CopyButton label="复制内容" size="icon-sm" value={text} />}
                </footer>
              )}
            </>
          )}
    </aside>
  )
}

function entryText(entry: ContextEntry): string {
  return typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content, null, 2)
}

function EntryFacts({ entry }: { entry: ContextEntry }) {
  return (
    <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
      <span>{entry.contentType}</span>
      <span>{humanSize(entry.size)}</span>
      <span title={entry.updatedAt}>{humanTime(entry.updatedAt)}</span>
      <span title={`version ${entry.version}`}>
        v:
        {entry.version.slice(0, 12)}
      </span>
    </p>
  )
}

function EntryContent({ entry }: { entry: ContextEntry }) {
  const ref = refOf(entry.content)
  const text = ref === null ? entryText(entry) : ''
  if (ref !== null) {
    return (
      <section className="rounded-lg border border-warn/40 bg-warn/5 p-3.5 text-sm">
        <p className="font-medium">大对象通过 $ref 提供</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          内容超过内联阈值（1 MiB），链接可能有时效，请及时下载。
        </p>
        <Button asChild className="mt-3 font-mono text-xs" size="sm" variant="outline">
          <a href={ref} rel="noreferrer" target="_blank">
            <ExternalLink />
            打开 $ref
          </a>
        </Button>
      </section>
    )
  }
  if (entry.contentType.includes('markdown')) {
    return (
      <section>
        <p className="mb-2 font-mono text-[9px] tracking-[0.14em] text-muted-foreground">CONTENT</p>
        <div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto rounded-lg border bg-background/55 px-4 py-4 break-words prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:bg-background prose-pre:text-xs prose-code:font-mono">
          <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
        </div>
      </section>
    )
  }
  return (
    <section>
      <p className="mb-2 font-mono text-[9px] tracking-[0.14em] text-muted-foreground">CONTENT</p>
      <pre className="max-h-[34rem] max-w-full overflow-auto rounded-lg border bg-background/55 px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
        {text}
      </pre>
    </section>
  )
}

function EntryMetadata({ entry }: { entry: ContextEntry }) {
  const metadata = Object.entries(entry.metadata ?? {})
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="font-mono text-[9px] tracking-[0.14em] text-muted-foreground">METADATA</p>
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
          {metadata.length}
          {' '}
          FIELDS
        </span>
      </div>
      {metadata.length === 0
        ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-xs text-muted-foreground">
              此条目没有 metadata。
            </p>
          )
        : (
            <dl className="overflow-hidden rounded-lg border bg-background/45">
              {metadata.map(([key, value]) => (
                <div
                  className="grid min-w-0 grid-cols-[minmax(7rem,0.35fr)_minmax(0,1fr)] border-b last:border-b-0"
                  key={key}
                >
                  <dt className="border-r bg-secondary/20 px-3 py-2 font-mono text-[10px] text-muted-foreground">
                    {key}
                  </dt>
                  <dd className="min-w-0 break-all px-3 py-2 font-mono text-[10px]">{value}</dd>
                </div>
              ))}
            </dl>
          )}
    </section>
  )
}

/** 条目预览:meta + 内容(markdown/json/text);大对象给 $ref 下载链接。 */
function EntryViewDialog({
  path,
  entryPath,
  canWrite,
  canDelete,
  onClose,
  onEdit,
  onDelete,
}: {
  canDelete: boolean
  canWrite: boolean
  entryPath: string | null
  onClose: () => void
  onDelete: (rel: string) => Promise<void>
  onEdit: (rel: string) => void
  path: string
}) {
  const entry = useCtxEntry(path, entryPath)
  const e = entry.data
  const ref = e ? refOf(e.content) : null
  const text = e && ref === null ? entryText(e) : ''

  return (
    <Dialog onOpenChange={o => !o && onClose()} open={entryPath !== null}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto p-4 sm:max-h-[85vh] sm:max-w-2xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="min-w-0 break-all pr-6 font-mono text-sm">
            {entryPath}
          </DialogTitle>
          {e && (
            <DialogDescription asChild>
              <div>
                <EntryFacts entry={e} />
              </div>
            </DialogDescription>
          )}
        </DialogHeader>

        {entry.isPending
          ? (
              <div className="grid gap-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-3/6" />
              </div>
            )
          : entry.isError
            ? (
                <div
                  className="rounded-lg border border-destructive/40 bg-destructive/10 p-3"
                  role="alert"
                >
                  <p className="text-sm text-destructive">{entry.error.message}</p>
                  <Button
                    className="mt-3"
                    disabled={entry.isFetching}
                    onClick={() => entry.refetch()}
                    size="sm"
                    variant="outline"
                  >
                    <RefreshCw className={cn(entry.isFetching && 'animate-spin')} />
                    重试读取
                  </Button>
                </div>
              )
            : e
              ? (
                  <div className="grid gap-5">
                    <EntryContent entry={e} />
                    <EntryMetadata entry={e} />
                  </div>
                )
              : null}

        <DialogFooter className="items-center sm:justify-between">
          <div className="flex items-center gap-1">
            {ref === null && e && <CopyButton label="复制内容" size="icon-sm" value={text} />}
          </div>
          <div className="flex gap-2">
            {canDelete && entryPath && (
              <ConfirmAction
                actionLabel="删除"
                description={<p>删除是幂等的，但内容不可恢复。</p>}
                onConfirm={() => onDelete(entryPath)}
                title={`删除条目 ${entryPath}?`}
                trigger={(
                  <Button aria-label="删除条目" variant="outline">
                    <Trash2 className="text-destructive" />
                    删除
                  </Button>
                )}
              />
            )}
            {canWrite && entryPath && (
              <Button onClick={() => onEdit(entryPath)} variant="outline">
                <Pencil />
                编辑
              </Button>
            )}
            <Button onClick={onClose}>关闭</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const CONTENT_TYPES = ['text/markdown', 'text/plain', 'application/json'] as const

/** "key=value" 行 → metadata Record(空返回 undefined;非法行抛错,对等 CLI --meta)。 */
function parseMetaLines(spec: string): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const line of spec.split('\n')) {
    const s = line.trim()
    if (!s) continue
    const idx = s.indexOf('=')
    const k = idx < 0 ? '' : s.slice(0, idx).trim()
    if (!k) throw new Error(`metadata 每行须为 "key=value" 形式:"${s}"`)
    out[k] = s.slice(idx + 1).trim()
  }
  return Object.keys(out).length ? out : undefined
}

function metaToLines(metadata: Record<string, string> | undefined): string {
  return Object.entries(metadata ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

/**
 * 新建/编辑条目(对等 `tb ctx put/patch`):新建与内容编辑走 Write(幂等 upsert,
 * 带 ifVersion 乐观并发);大对象($ref)不可就地改内容,但可经 Update 只改 metadata。
 */
function EntryEditDialog({
  path,
  entryPath,
  onClose,
  onSaved,
}: {
  /** '' = 新建。 */
  entryPath: string
  onClose: () => void
  onSaved: () => void
  path: string
}) {
  const isNew = entryPath === ''
  const existing = useCtxEntry(path, isNew ? null : entryPath)
  const invoke = useInvoke()

  const [rel, setRel] = useState(entryPath)
  const [contentType, setContentType] = useState<string>('text/markdown')
  const [content, setContent] = useState('')
  const [metaSpec, setMetaSpec] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [baselineVersion, setBaselineVersion] = useState<string | null>(null)
  const [baselineRef, setBaselineRef] = useState<string | null>(null)

  // 编辑模式:Get 到位后一次性预填(大对象 $ref 不可就地编辑内容)。
  const e = existing.data
  useEffect(() => {
    if (isNew || !e || hydrated) return
    setContentType(e.contentType)
    setContent(typeof e.content === 'string' ? e.content : JSON.stringify(e.content, null, 2))
    setMetaSpec(metaToLines(e.metadata))
    // 内容与 version 必须原子取自同一次 Get。后台 refetch 即使更新 query data,
    // 提交仍使用这个 baseline,让服务端的乐观锁能阻止“旧正文 + 新 version”覆盖。
    setBaselineVersion(e.version)
    setBaselineRef(refOf(e.content))
    setHydrated(true)
  }, [isNew, e, hydrated])
  const waitingForExisting = !isNew && (existing.isPending || (existing.isSuccess && !hydrated))
  const ref = isNew ? null : baselineRef

  const submit = async () => {
    // 编辑必须基于成功 Get 的 version；缺少基线时绝不降级成无 ifVersion 的覆盖写。
    if (!isNew && (!hydrated || baselineVersion === null)) {
      setErr('未能读取现有条目，无法安全保存；请重试读取。')
      return
    }
    let metadata: Record<string, string> | undefined
    try {
      metadata = parseMetaLines(metaSpec)
    } catch (ex) {
      setErr((ex as Error).message)
      return
    }

    // 大对象:内容不可就地改,只走 Update 改 metadata(对等 tb ctx patch --meta)。
    if (!isNew && ref !== null) {
      try {
        await invoke.mutateAsync({
          path,
          tool: 'Update',
          args: {
            path: entryPath,
            patch: { metadata: metadata ?? {}, ifVersion: baselineVersion },
          },
        })
        toast.success(`已更新 ${entryPath} 的 metadata`)
        onSaved()
      } catch (error) {
        setErr((error as Error).message)
      }
      return
    }

    const p = rel.trim().replace(/^\/+/, '')
    if (p === '') {
      setErr('条目路径必填')
      return
    }
    let body: unknown = content
    if (contentType === 'application/json') {
      try {
        body = JSON.parse(content)
      } catch {
        setErr('content 不是合法 JSON(application/json 类型要求)')
        return
      }
    }
    try {
      await invoke.mutateAsync({
        path,
        tool: 'Write',
        args: {
          path: p,
          entry: {
            content: body,
            ...(typeof body === 'string' ? { contentType } : {}),
            ...(metadata ? { metadata } : {}),
            ...(!isNew && baselineVersion !== null ? { ifVersion: baselineVersion } : {}),
          },
        },
      })
      toast.success(`已写入 ${p}`)
      onSaved()
    } catch (error) {
      setErr((error as Error).message)
    }
  }

  const requestOpenChange = (next: boolean) => {
    if (invoke.isPending) return
    if (!next) onClose()
  }

  return (
    <Dialog onOpenChange={requestOpenChange} open>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        onEscapeKeyDown={event => invoke.isPending && event.preventDefault()}
        onPointerDownOutside={event => invoke.isPending && event.preventDefault()}
        showCloseButton={!invoke.isPending}
      >
        <DialogHeader>
          <DialogTitle className="break-words text-base">
            {isNew ? '新建条目' : `编辑条目 · ${entryPath}`}
          </DialogTitle>
          <DialogDescription>
            {waitingForExisting
              ? '正在读取现有条目与 version；读取完成前不会允许保存。'
              : !isNew && existing.isError && !hydrated
                  ? '读取现有条目失败。为避免无 version 覆盖，保存已被阻止。'
                  : !isNew && ref !== null
                      ? '大对象($ref)不支持就地编辑内容;metadata 可经 Update 部分更新。'
                      : `Write 是幂等 upsert${isNew ? '' : ';携带 ifVersion,被并发修改时返回 conflict'}。`}
          </DialogDescription>
        </DialogHeader>

        {waitingForExisting
          ? (
              <div aria-label="正在读取条目" className="grid gap-2" role="status">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-36 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            )
          : !isNew && existing.isError && !hydrated
              ? (
                  <div
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3"
                    role="alert"
                  >
                    <p className="text-sm text-destructive">{existing.error.message}</p>
                    <Button
                      className="mt-3"
                      disabled={existing.isFetching}
                      onClick={() => existing.refetch()}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <RefreshCw className={cn(existing.isFetching && 'animate-spin')} />
                      重试读取
                    </Button>
                  </div>
                )
              : (
                  <div className="grid gap-4">
                    {(isNew || ref === null) && (
                      <>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                          <div className="grid gap-1.5">
                            <Label className="text-xs" htmlFor="entry-path">
                              条目路径 *
                            </Label>
                            <Input
                              className="font-mono text-sm"
                              disabled={!isNew}
                              id="entry-path"
                              onChange={ev => setRel(ev.target.value)}
                              placeholder="docs/notes.md"
                              value={rel}
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label className="text-xs">contentType</Label>
                            <Select onValueChange={setContentType} value={contentType}>
                              <SelectTrigger className="w-full font-mono text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CONTENT_TYPES.includes(
                                  contentType as (typeof CONTENT_TYPES)[number],
                                )
                                  ? null
                                  : (
                                      <SelectItem className="font-mono text-xs" value={contentType}>
                                        {contentType}
                                      </SelectItem>
                                    )}
                                {CONTENT_TYPES.map(t => (
                                  <SelectItem className="font-mono text-xs" key={t} value={t}>
                                    {t}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs" htmlFor="entry-content">
                            content
                          </Label>
                          <Textarea
                            className="font-mono text-xs"
                            id="entry-content"
                            onChange={ev => setContent(ev.target.value)}
                            rows={12}
                            spellCheck={false}
                            value={content}
                          />
                        </div>
                      </>
                    )}
                    <div className="grid gap-1.5">
                      <Label className="text-xs" htmlFor="entry-meta">
                        metadata(每行 key=value,可空)
                      </Label>
                      <Textarea
                        className="font-mono text-xs"
                        id="entry-meta"
                        onChange={ev => setMetaSpec(ev.target.value)}
                        placeholder={'source=manual\nowner=alice'}
                        rows={2}
                        spellCheck={false}
                        value={metaSpec}
                      />
                    </div>
                    {err && (
                      <p className="text-xs text-destructive" role="alert">
                        {err}
                      </p>
                    )}
                  </div>
                )}

        {(isNew || hydrated) && (
          <DialogFooter>
            <Button disabled={invoke.isPending} onClick={() => void submit()}>
              {invoke.isPending && <Loader2 className="animate-spin" />}
              {!isNew && ref !== null ? '更新 metadata' : '写入'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
