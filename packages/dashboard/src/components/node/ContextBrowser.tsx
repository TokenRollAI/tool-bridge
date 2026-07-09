import { useQueryClient } from '@tanstack/react-query'
import {
  Database,
  ExternalLink,
  Eye,
  FilePlus2,
  ListFilter,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { ConfirmAction } from '@/components/ConfirmAction'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useCtxEntries, useCtxEntry, useInvoke } from '@/lib/queries'
import type { ContextEntry, HelpCmd } from '@/lib/types'
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

/**
 * context 节点的条目浏览器(E2E-6 ③④ 的 Dashboard 路径):
 * List(前缀过滤)/ Search / Get 预览 / Write 新建编辑 / Delete。
 * 与 `tb ctx ls|cat|put|rm` 走同一数据面,无管理旁路。
 */
export function ContextBrowser({ path, cmds }: { path: string; cmds: HelpCmd[] }) {
  const canWrite = cmds.some((c) => c.name === 'Write')
  const canDelete = cmds.some((c) => c.name === 'Delete')
  const canSearch = cmds.some((c) => c.name === 'Search')

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

  const [viewing, setViewing] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ entryPath: string; entry?: ContextEntry } | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: ['tb'] })

  const remove = async (entryPath: string) => {
    await invoke.mutateAsync(
      { path, tool: 'Delete', args: { path: entryPath } },
      {
        onSuccess: () => {
          toast.success(`已删除 ${entryPath}`)
          refresh()
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  const items = entries.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <section className="grid gap-3">
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="relative min-w-0">
          <ListFilter className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={prefixInput}
            onChange={(e) => setPrefixInput(e.target.value)}
            placeholder={searchRequested || searchActive ? '检索时不使用前缀' : '前缀过滤,如 docs/'}
            aria-label="前缀过滤"
            aria-describedby={
              searchRequested || searchActive ? 'context-prefix-search-note' : undefined
            }
            disabled={searchRequested || searchActive}
            className="h-8 w-full pl-7 font-mono text-xs sm:w-44"
          />
        </div>
        {canSearch && (
          <>
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder={searchMode === 'semantic' ? 'semantic 检索…' : 'keyword 检索…'}
                aria-label="检索"
                className="h-8 w-full pl-7 font-mono text-xs sm:w-44"
              />
            </div>
            <Select
              value={searchMode}
              onValueChange={(v) => setSearchMode(v as 'keyword' | 'semantic')}
            >
              <SelectTrigger
                className="h-8 w-full font-mono text-xs sm:w-auto"
                aria-label="检索模式"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keyword" className="font-mono text-xs">
                  keyword
                </SelectItem>
                <SelectItem value="semantic" className="font-mono text-xs">
                  semantic
                </SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="刷新"
          title="刷新"
          className="justify-self-start text-muted-foreground"
          onClick={() => entries.refetch()}
        >
          <RefreshCw className={cn('size-3.5', entries.isFetching && 'animate-spin')} />
        </Button>
        {canWrite && (
          <Button
            size="sm"
            className="w-full sm:ml-auto sm:w-auto"
            onClick={() => setEditing({ entryPath: '' })}
          >
            <FilePlus2 />
            新建条目
          </Button>
        )}
      </div>
      {(searchRequested || searchActive) && (
        <p
          id="context-prefix-search-note"
          role="status"
          className="-mt-1 text-xs text-muted-foreground"
        >
          当前使用 Search；前缀过滤只适用于 List，检索期间不会生效。
        </p>
      )}

      <div className="overflow-hidden rounded-md border">
        {entries.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/6" />
          </div>
        ) : entries.isError ? (
          <p className="p-4 text-sm text-destructive">{entries.error.message}</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Database}
            title={effectiveQuery ? '无匹配条目' : 'namespace 是空的'}
            className="border-0"
          >
            {canWrite && !effectiveQuery && (
              <p>
                点「新建条目」写入第一条,或用 CLI:
                <code className="ml-1 font-mono">tb ctx put {path}/&lt;条目路径&gt;</code>
              </p>
            )}
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>条目</TableHead>
                <TableHead className="w-40">contentType</TableHead>
                <TableHead className="w-20 text-right">大小</TableHead>
                <TableHead className="w-28">更新</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((e) => {
                const rel = relPath(e.uri, path)
                const isDir = rel.endsWith('/')
                return (
                  <TableRow key={e.uri}>
                    <TableCell className="max-w-64">
                      {isDir ? (
                        <button
                          type="button"
                          className="truncate font-mono text-xs text-primary hover:underline"
                          onClick={() => setPrefixInput(rel)}
                        >
                          {rel}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="truncate font-mono text-xs hover:text-primary hover:underline"
                          onClick={() => setViewing(rel)}
                        >
                          {rel}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {isDir ? '—' : e.contentType}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] text-muted-foreground tabular-nums">
                      {isDir ? '—' : humanSize(e.size)}
                    </TableCell>
                    <TableCell
                      className="font-mono text-[11px] text-muted-foreground"
                      title={e.updatedAt}
                    >
                      {isDir ? '—' : humanTime(e.updatedAt)}
                    </TableCell>
                    <TableCell>
                      {!isDir && (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="查看"
                            title="查看"
                            onClick={() => setViewing(rel)}
                          >
                            <Eye />
                          </Button>
                          {canWrite && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label="编辑"
                              title="编辑"
                              onClick={() => setEditing({ entryPath: rel })}
                            >
                              <Pencil />
                            </Button>
                          )}
                          {canDelete && (
                            <ConfirmAction
                              title={`删除条目 ${rel}?`}
                              description={<p>删除是幂等的,但内容不可恢复。</p>}
                              actionLabel="删除"
                              onConfirm={() => remove(rel)}
                              trigger={
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-label="删除"
                                  title="删除"
                                >
                                  <Trash2 className="text-destructive" />
                                </Button>
                              }
                            />
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {items.length} 条{effectiveQuery ? '(检索结果)' : ''}
        </p>
        {entries.hasNextPage && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            disabled={entries.isFetchingNextPage}
            onClick={() => entries.fetchNextPage()}
          >
            {entries.isFetchingNextPage && <Loader2 className="animate-spin" />}
            加载更多
          </Button>
        )}
      </div>

      <EntryViewDialog
        path={path}
        entryPath={viewing}
        canWrite={canWrite}
        onClose={() => setViewing(null)}
        onEdit={(rel) => {
          setViewing(null)
          setEditing({ entryPath: rel })
        }}
      />
      {editing && (
        <EntryEditDialog
          path={path}
          entryPath={editing.entryPath}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            refresh()
          }}
        />
      )}
    </section>
  )
}

/** 条目预览:meta + 内容(markdown/json/text);大对象给 $ref 下载链接。 */
function EntryViewDialog({
  path,
  entryPath,
  canWrite,
  onClose,
  onEdit,
}: {
  path: string
  entryPath: string | null
  canWrite: boolean
  onClose: () => void
  onEdit: (rel: string) => void
}) {
  const entry = useCtxEntry(path, entryPath)
  const e = entry.data
  const ref = e ? refOf(e.content) : null
  const text =
    e && ref === null
      ? typeof e.content === 'string'
        ? e.content
        : JSON.stringify(e.content, null, 2)
      : ''

  return (
    <Dialog open={entryPath !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="min-w-0 break-all pr-6 font-mono text-sm">
            {entryPath}
          </DialogTitle>
          {e && (
            <DialogDescription asChild>
              <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
                <span>{e.contentType}</span>
                <span>{humanSize(e.size)}</span>
                <span title={e.updatedAt}>{humanTime(e.updatedAt)}</span>
                <span className="truncate" title={`version ${e.version}`}>
                  v:{e.version.slice(0, 12)}
                </span>
              </div>
            </DialogDescription>
          )}
        </DialogHeader>

        {entry.isPending ? (
          <div className="grid gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/6" />
          </div>
        ) : entry.isError ? (
          <p className="text-sm text-destructive">{entry.error.message}</p>
        ) : ref !== null ? (
          <div className="rounded-sm border border-warn/40 bg-warn/5 px-3 py-2.5 text-sm">
            <p>大对象未内联(&gt;1 MiB),经 $ref 下载:</p>
            <Button variant="outline" size="sm" className="mt-2 font-mono text-xs" asChild>
              <a href={ref} target="_blank" rel="noreferrer">
                <ExternalLink />
                打开 $ref
              </a>
            </Button>
          </div>
        ) : e?.contentType.includes('markdown') ? (
          <div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto rounded-sm border bg-card px-3 py-3 break-words prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:bg-background prose-pre:text-xs prose-code:font-mono sm:px-4">
            <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
          </div>
        ) : (
          <pre className="max-h-96 max-w-full overflow-auto rounded-sm border bg-card px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
            {text}
          </pre>
        )}

        {e && Object.keys(e.metadata ?? {}).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(e.metadata).map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center rounded-sm border px-1.5 font-mono text-[10px] leading-4 text-muted-foreground"
              >
                {k}={v}
              </span>
            ))}
          </div>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <div className="flex items-center gap-1">
            {ref === null && e && <CopyButton value={text} label="复制内容" size="icon-sm" />}
          </div>
          <div className="flex gap-2">
            {canWrite && entryPath && (
              <Button variant="outline" onClick={() => onEdit(entryPath)}>
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
  path: string
  /** '' = 新建。 */
  entryPath: string
  onClose: () => void
  onSaved: () => void
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

  const submit = () => {
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
      invoke.mutate(
        {
          path,
          tool: 'Update',
          args: {
            path: entryPath,
            patch: { metadata: metadata ?? {}, ifVersion: baselineVersion },
          },
        },
        {
          onSuccess: () => {
            toast.success(`已更新 ${entryPath} 的 metadata`)
            onSaved()
          },
          onError: (er) => setErr(er.message),
        },
      )
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
    invoke.mutate(
      {
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
      },
      {
        onSuccess: () => {
          toast.success(`已写入 ${p}`)
          onSaved()
        },
        onError: (er) => setErr(er.message),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
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

        {waitingForExisting ? (
          <div role="status" className="grid gap-2" aria-label="正在读取条目">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : !isNew && existing.isError && !hydrated ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3"
          >
            <p className="text-sm text-destructive">{existing.error.message}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={existing.isFetching}
              onClick={() => existing.refetch()}
            >
              <RefreshCw className={cn(existing.isFetching && 'animate-spin')} />
              重试读取
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            {(isNew || ref === null) && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                  <div className="grid gap-1.5">
                    <Label htmlFor="entry-path" className="text-xs">
                      条目路径 *
                    </Label>
                    <Input
                      id="entry-path"
                      className="font-mono text-sm"
                      placeholder="docs/notes.md"
                      value={rel}
                      disabled={!isNew}
                      onChange={(ev) => setRel(ev.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">contentType</Label>
                    <Select value={contentType} onValueChange={setContentType}>
                      <SelectTrigger className="w-full font-mono text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONTENT_TYPES.includes(
                          contentType as (typeof CONTENT_TYPES)[number],
                        ) ? null : (
                          <SelectItem value={contentType} className="font-mono text-xs">
                            {contentType}
                          </SelectItem>
                        )}
                        {CONTENT_TYPES.map((t) => (
                          <SelectItem key={t} value={t} className="font-mono text-xs">
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="entry-content" className="text-xs">
                    content
                  </Label>
                  <Textarea
                    id="entry-content"
                    className="font-mono text-xs"
                    rows={12}
                    spellCheck={false}
                    value={content}
                    onChange={(ev) => setContent(ev.target.value)}
                  />
                </div>
              </>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="entry-meta" className="text-xs">
                metadata(每行 key=value,可空)
              </Label>
              <Textarea
                id="entry-meta"
                className="font-mono text-xs"
                rows={2}
                spellCheck={false}
                placeholder={'source=manual\nowner=alice'}
                value={metaSpec}
                onChange={(ev) => setMetaSpec(ev.target.value)}
              />
            </div>
            {err && (
              <p role="alert" className="text-xs text-destructive">
                {err}
              </p>
            )}
          </div>
        )}

        {(isNew || hydrated) && (
          <DialogFooter>
            <Button disabled={invoke.isPending} onClick={submit}>
              {invoke.isPending && <Loader2 className="animate-spin" />}
              {!isNew && ref !== null ? '更新 metadata' : '写入'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
