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
  const prefix = useDebounced(prefixInput)
  const query = useDebounced(queryInput)

  const entries = useCtxEntries(path, prefix, canSearch ? query : '')
  const invoke = useInvoke()
  const qc = useQueryClient()

  const [viewing, setViewing] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ entryPath: string; entry?: ContextEntry } | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: ['tb'] })

  const remove = (entryPath: string) => {
    invoke.mutate(
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <ListFilter className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={prefixInput}
            onChange={(e) => setPrefixInput(e.target.value)}
            placeholder="前缀过滤,如 docs/"
            aria-label="前缀过滤"
            className="h-8 w-44 pl-7 font-mono text-xs"
          />
        </div>
        {canSearch && (
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="keyword 检索…"
              aria-label="keyword 检索"
              className="h-8 w-44 pl-7 font-mono text-xs"
            />
          </div>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="刷新"
          title="刷新"
          className="text-muted-foreground"
          onClick={() => entries.refetch()}
        >
          <RefreshCw className={cn('size-3.5', entries.isFetching && 'animate-spin')} />
        </Button>
        {canWrite && (
          <Button size="sm" className="ml-auto" onClick={() => setEditing({ entryPath: '' })}>
            <FilePlus2 />
            新建条目
          </Button>
        )}
      </div>

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
            title={query ? '无匹配条目' : 'namespace 是空的'}
            className="border-0"
          >
            {canWrite && !query && (
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

      <div className="flex items-center gap-3">
        <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {items.length} 条{query ? '(检索结果)' : ''}
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
          <DialogTitle className="min-w-0 truncate pr-6 font-mono text-sm">{entryPath}</DialogTitle>
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
          <div className="prose prose-sm dark:prose-invert max-w-none rounded-sm border bg-card px-4 py-3 prose-pre:bg-background prose-pre:text-xs prose-code:font-mono">
            <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
          </div>
        ) : (
          <pre className="max-h-96 overflow-auto rounded-sm border bg-card px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
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

/** 新建/编辑条目(Write 幂等 upsert;编辑先 Get 预填,带 ifVersion 乐观并发)。 */
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
  const [err, setErr] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  // 编辑模式:Get 到位后一次性预填(大对象 $ref 不可就地编辑)。
  const e = existing.data
  const ref = e ? refOf(e.content) : null
  useEffect(() => {
    if (isNew || !e || hydrated) return
    setContentType(e.contentType)
    setContent(typeof e.content === 'string' ? e.content : JSON.stringify(e.content, null, 2))
    setHydrated(true)
  }, [isNew, e, hydrated])

  const submit = () => {
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
            ...(!isNew && e ? { ifVersion: e.version } : {}),
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
          <DialogTitle className="text-base">{isNew ? '新建条目' : '编辑条目'}</DialogTitle>
          <DialogDescription>
            Write 是幂等 upsert{!isNew && ';携带 ifVersion,被并发修改时返回 conflict'}。
          </DialogDescription>
        </DialogHeader>

        {!isNew && ref !== null ? (
          <p className="rounded-sm border border-warn/40 bg-warn/5 px-3 py-2 text-sm">
            该条目是大对象($ref),不支持就地编辑;可新建同路径条目整体覆盖。
          </p>
        ) : (
          <div className="grid gap-4">
            <div className="grid grid-cols-[1fr_12rem] gap-3">
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
                  <SelectTrigger className="font-mono text-xs">
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
            {err && <p className="text-xs text-destructive">{err}</p>}
          </div>
        )}

        <DialogFooter>
          {(isNew || ref === null) && (
            <Button disabled={invoke.isPending || (!isNew && existing.isPending)} onClick={submit}>
              {invoke.isPending && <Loader2 className="animate-spin" />}
              写入
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
