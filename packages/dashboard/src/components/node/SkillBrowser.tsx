import { useQueryClient } from '@tanstack/react-query'
import {
  BookMarked,
  ExternalLink,
  FilePlus2,
  FileText,
  Loader2,
  PanelRight,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useInvoke, useSkill, useSkillFile, useSkills } from '@/lib/queries'
import type { HelpCmd, SkillDetail, SkillFile } from '@/lib/types'
import { cn } from '@/lib/utils'

function humanSize(n?: number): string {
  if (n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`
}

function humanTime(iso?: string): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(t).toLocaleString()
}

/** 大对象文件:content 是 { $ref } 而非内联。 */
function refOf(content: SkillFile['content']): string | null {
  if (typeof content === 'object' && content !== null && '$ref' in content) {
    const v = content.$ref
    return typeof v === 'string' ? v : null
  }
  return null
}

/** 300ms 防抖(搜索输入 → 查询参数)。 */
function useDebounced(value: string): string {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), 300)
    return () => clearTimeout(t)
  }, [value])
  return v
}

/** 详情只在桌面常驻；移动端继续使用 Dialog，避免隐藏的 Portal 意外打开。 */
function useDesktopLayout(): boolean {
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
 * skillhub 节点的技能浏览器(context 浏览器的姊妹形制):
 * List(目录)/ Search / Get 详情(SKILL.md + 文件清单)/ Publish 发布 / Remove。
 * 与 `tb skill ls|cat|publish|rm` 走同一数据面,无管理旁路。
 */
export function SkillBrowser({ path, cmds }: { path: string; cmds: HelpCmd[] }) {
  const canPublish = cmds.some((c) => c.name === 'Publish')
  const canRemove = cmds.some((c) => c.name === 'Remove')
  const canSearch = cmds.some((c) => c.name === 'Search')

  const [queryInput, setQueryInput] = useState('')
  const query = useDebounced(queryInput)
  const effectiveQuery = canSearch ? query.trim() : ''

  const skills = useSkills(path, effectiveQuery)
  const invoke = useInvoke()
  const qc = useQueryClient()
  const desktop = useDesktopLayout()

  const [selected, setSelected] = useState<string | null>(null)
  const [mobileViewing, setMobileViewing] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['tb'] })

  const remove = async (id: string) => {
    try {
      await invoke.mutateAsync({ path, tool: 'Remove', args: { id } })
      toast.success(`已删除 ${id}`)
      setSelected((current) => (current === id ? null : current))
      setMobileViewing((current) => (current === id ? null : current))
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除技能失败')
      throw error
    }
  }

  const items = skills.data?.pages.flatMap((p) => p.items) ?? []
  const openSkill = (id: string) => {
    setSelected(id)
    if (!desktop) setMobileViewing(id)
  }

  return (
    <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(360px,0.9fr)_minmax(420px,1.1fr)] lg:items-start">
      <section className="min-w-0 overflow-hidden rounded-xl border bg-card/35">
        <header className="flex min-h-14 items-center justify-between gap-3 border-b px-3.5 py-3 sm:px-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BookMarked className="size-4 text-indigo-400" />
              <h2 className="text-sm font-medium">技能目录</h2>
              <span className="rounded border bg-background/60 px-1.5 font-mono text-[10px] leading-5 text-muted-foreground tabular-nums">
                {items.length}
              </span>
            </div>
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70">
              node://{path}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="刷新技能"
              title="刷新技能"
              className="text-muted-foreground"
              onClick={() => skills.refetch()}
            >
              <RefreshCw className={cn('size-3.5', skills.isFetching && 'animate-spin')} />
            </Button>
            {canPublish && (
              <Button size="sm" onClick={() => setPublishing(true)}>
                <FilePlus2 />
                发布
              </Button>
            )}
          </div>
        </header>

        {canSearch && (
          <div className="border-b bg-background/25 p-3">
            <div className="grid min-w-0 gap-1.5">
              <span className="font-mono text-[9px] tracking-[0.13em] text-muted-foreground">
                SEARCH
              </span>
              <div className="relative min-w-0">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  placeholder="检索技能…"
                  aria-label="检索技能"
                  className="h-9 w-full pl-8 font-mono text-xs"
                />
              </div>
            </div>
          </div>
        )}

        <div className="min-h-72 lg:min-h-[32rem] lg:max-h-[calc(100dvh-18rem)] lg:overflow-y-auto">
          {skills.isPending ? (
            <div className="grid gap-3 p-4" role="status" aria-label="正在加载技能">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-4/5" />
            </div>
          ) : skills.isError ? (
            <div className="p-4" role="alert">
              <p className="text-sm text-destructive">{skills.error.message}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={skills.isFetching}
                onClick={() => skills.refetch()}
              >
                <RefreshCw className={cn(skills.isFetching && 'animate-spin')} />
                重试
              </Button>
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={BookMarked}
              title={effectiveQuery ? '无匹配技能' : '技能目录是空的'}
              className="min-h-72 border-0"
            >
              {canPublish && !effectiveQuery && (
                <p>
                  点「发布」写入第一个技能,或用 CLI:
                  <code className="ml-1 font-mono">tb skill publish {path}</code>
                </p>
              )}
            </EmptyState>
          ) : (
            <ul className="divide-y" aria-label="技能列表">
              {items.map((s) => {
                const active = selected === s.id
                return (
                  <li
                    key={s.id}
                    className={cn(
                      'group relative flex min-w-0 items-stretch transition-colors hover:bg-secondary/35',
                      active && 'bg-primary/[0.065]',
                    )}
                  >
                    {active && (
                      <span className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-primary" />
                    )}
                    <button
                      type="button"
                      className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left outline-none focus-visible:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                      aria-label={`查看技能 ${s.name}`}
                      aria-pressed={active}
                      onClick={() => openSkill(s.id)}
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-background/75 text-indigo-400">
                        <BookMarked className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="block truncate text-sm font-medium text-foreground"
                            title={s.name}
                          >
                            {s.name}
                          </span>
                          {s.version && (
                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                              v:{s.version.slice(0, 8)}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground/70">
                          {s.id}
                        </span>
                        <span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                          {s.description}
                        </span>
                      </span>
                    </button>
                    {canRemove && (
                      <div className="flex shrink-0 items-center gap-0.5 pr-2">
                        <ConfirmAction
                          title={`删除技能 ${s.id}?`}
                          description={<p>删除是幂等的，但内容不可恢复。</p>}
                          actionLabel="删除"
                          onConfirm={() => remove(s.id)}
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="size-10 sm:size-8"
                              aria-label={`删除 ${s.id}`}
                              title="删除"
                            >
                              <Trash2 className="text-destructive" />
                            </Button>
                          }
                        />
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
            已加载 {items.length} 个{effectiveQuery ? ' · Search 结果' : ' · List 结果'}
          </p>
          {skills.hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto text-xs"
              disabled={skills.isFetchingNextPage}
              onClick={() => skills.fetchNextPage()}
            >
              {skills.isFetchingNextPage && <Loader2 className="animate-spin" />}
              加载更多
            </Button>
          )}
        </footer>
      </section>

      <SkillDetailPane
        path={path}
        id={desktop ? selected : null}
        canRemove={canRemove}
        onDelete={remove}
      />

      <SkillDetailDialog
        path={path}
        id={desktop ? null : mobileViewing}
        canRemove={canRemove}
        onClose={() => setMobileViewing(null)}
        onDelete={remove}
      />

      {publishing && (
        <SkillPublishDialog
          path={path}
          onClose={() => setPublishing(false)}
          onSaved={() => {
            setPublishing(false)
            refresh()
          }}
        />
      )}
    </section>
  )
}

function SkillDetailPane({
  path,
  id,
  canRemove,
  onDelete,
}: {
  path: string
  id: string | null
  canRemove: boolean
  onDelete: (id: string) => Promise<void>
}) {
  const skill = useSkill(path, id)
  const s = skill.data

  return (
    <aside className="hidden min-w-0 overflow-hidden rounded-xl border bg-card/35 lg:sticky lg:top-4 lg:flex lg:min-h-[40rem] lg:max-h-[calc(100dvh-8rem)] lg:flex-col">
      {id === null ? (
        <div className="grid min-h-[40rem] place-items-center p-8 text-center">
          <div className="max-w-64">
            <span className="mx-auto grid size-12 place-items-center rounded-xl border bg-background/70 text-muted-foreground">
              <PanelRight className="size-5" />
            </span>
            <h2 className="mt-4 text-sm font-medium">选择技能查看详情</h2>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              详情会固定在这里,筛选与翻页上下文都不会丢失。
            </p>
          </div>
        </div>
      ) : (
        <>
          <header className="flex min-h-16 items-start justify-between gap-4 border-b px-4 py-3.5">
            <div className="min-w-0">
              <p className="font-mono text-[9px] tracking-[0.14em] text-muted-foreground">SKILL</p>
              <h2 className="mt-1 break-words text-sm font-medium">{s?.name ?? id}</h2>
              {s && <SkillFacts skill={s} />}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="刷新详情"
                title="刷新详情"
                disabled={skill.isFetching}
                onClick={() => skill.refetch()}
              >
                <RefreshCw className={cn(skill.isFetching && 'animate-spin')} />
              </Button>
              {canRemove && (
                <ConfirmAction
                  title={`删除技能 ${id}?`}
                  description={<p>删除是幂等的，但内容不可恢复。</p>}
                  actionLabel="删除"
                  onConfirm={() => onDelete(id)}
                  trigger={
                    <Button variant="ghost" size="icon-sm" aria-label="删除技能" title="删除">
                      <Trash2 className="text-destructive" />
                    </Button>
                  }
                />
              )}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {skill.isPending ? (
              <div className="grid gap-3" role="status" aria-label="正在读取技能">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-5/6" />
                <Skeleton className="h-48 w-full" />
              </div>
            ) : skill.isError ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/10 p-3"
              >
                <p className="text-sm text-destructive">{skill.error.message}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  disabled={skill.isFetching}
                  onClick={() => skill.refetch()}
                >
                  <RefreshCw className={cn(skill.isFetching && 'animate-spin')} />
                  重试读取
                </Button>
              </div>
            ) : s ? (
              <SkillBody path={path} skill={s} />
            ) : null}
          </div>

          {s && (
            <footer className="flex min-h-12 items-center justify-between gap-3 border-t bg-background/25 px-4 py-2.5">
              <p
                className="min-w-0 truncate font-mono text-[10px] text-muted-foreground"
                title={s.version}
              >
                {s.version ? `version · ${s.version}` : `${s.files.length} 个文件`}
              </p>
              <CopyButton value={s.content} label="复制 SKILL.md" size="icon-sm" />
            </footer>
          )}
        </>
      )}
    </aside>
  )
}

function SkillFacts({ skill }: { skill: SkillDetail }) {
  return (
    <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
      <span className="break-all">{skill.id}</span>
      <span>{skill.files.length} 个文件</span>
      {skill.updatedAt && <span title={skill.updatedAt}>{humanTime(skill.updatedAt)}</span>}
    </p>
  )
}

/** 技能详情:描述 + SKILL.md(Markdown)+ 文件清单(点击取文件内容)。 */
function SkillBody({ path, skill }: { path: string; skill: SkillDetail }) {
  const [openFile, setOpenFile] = useState<string | null>(null)
  return (
    <div className="grid gap-5">
      {skill.description && (
        <p className="text-xs leading-5 text-muted-foreground">{skill.description}</p>
      )}
      <section>
        <p className="mb-2 font-mono text-[9px] tracking-[0.14em] text-muted-foreground">
          SKILL.md
        </p>
        <div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto rounded-lg border bg-background/55 px-4 py-4 break-words prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:bg-background prose-pre:text-xs prose-code:font-mono">
          <Markdown remarkPlugins={[remarkGfm]}>{skill.content}</Markdown>
        </div>
      </section>
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="font-mono text-[9px] tracking-[0.14em] text-muted-foreground">FILES</p>
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
            {skill.files.length} 个
          </span>
        </div>
        {skill.files.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-4 text-xs text-muted-foreground">
            此技能没有附加文件。
          </p>
        ) : (
          <ul className="overflow-hidden rounded-lg border bg-background/45">
            {skill.files.map((f) => (
              <li key={f.path} className="border-b last:border-b-0">
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-secondary/40 focus-visible:bg-secondary/60"
                  onClick={() => setOpenFile(f.path)}
                >
                  <FileText className="size-4 shrink-0 text-sky-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs" title={f.path}>
                      {f.path}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[10px] text-muted-foreground">
                      <span className="max-w-44 truncate">{f.contentType}</span>
                      <span className="tabular-nums">{humanSize(f.size)}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {openFile !== null && (
        <SkillFileDialog
          path={path}
          id={skill.id}
          file={openFile}
          onClose={() => setOpenFile(null)}
        />
      )}
    </div>
  )
}

/** 技能内单文件预览:文本内联渲染;大对象($ref)给下载链接。 */
function SkillFileDialog({
  path,
  id,
  file,
  onClose,
}: {
  path: string
  id: string
  file: string
  onClose: () => void
}) {
  const query = useSkillFile(path, id, file)
  const f = query.data
  const ref = f ? refOf(f.content) : null
  const text = f && ref === null && typeof f.content === 'string' ? f.content : ''

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto p-4 sm:max-h-[85vh] sm:max-w-2xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="min-w-0 break-all pr-6 font-mono text-sm">{file}</DialogTitle>
          {f && (
            <DialogDescription asChild>
              <p className="flex flex-wrap gap-x-3 font-mono text-[10px] text-muted-foreground">
                <span>{f.contentType}</span>
                <span>{humanSize(f.size)}</span>
                <span title={`version ${f.version}`}>v:{f.version.slice(0, 12)}</span>
              </p>
            </DialogDescription>
          )}
        </DialogHeader>

        {query.isPending ? (
          <div className="grid gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/6" />
          </div>
        ) : query.isError ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 p-3"
          >
            <p className="text-sm text-destructive">{query.error.message}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={query.isFetching}
              onClick={() => query.refetch()}
            >
              <RefreshCw className={cn(query.isFetching && 'animate-spin')} />
              重试读取
            </Button>
          </div>
        ) : f && ref !== null ? (
          <section className="rounded-lg border border-warn/40 bg-warn/5 p-3.5 text-sm">
            <p className="font-medium">大对象通过 $ref 提供</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              内容超过内联阈值,链接可能有时效,请及时下载。
            </p>
            <Button variant="outline" size="sm" className="mt-3 font-mono text-xs" asChild>
              <a href={ref} target="_blank" rel="noreferrer">
                <ExternalLink />
                打开 $ref
              </a>
            </Button>
          </section>
        ) : f ? (
          <pre className="max-h-[34rem] max-w-full overflow-auto rounded-lg border bg-background/55 px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
            {text}
          </pre>
        ) : null}

        <DialogFooter className="items-center sm:justify-between">
          <div className="flex items-center gap-1">
            {ref === null && f && <CopyButton value={text} label="复制内容" size="icon-sm" />}
          </div>
          <Button onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 移动端技能详情对话框(桌面走常驻 pane)。 */
function SkillDetailDialog({
  path,
  id,
  canRemove,
  onClose,
  onDelete,
}: {
  path: string
  id: string | null
  canRemove: boolean
  onClose: () => void
  onDelete: (id: string) => Promise<void>
}) {
  const skill = useSkill(path, id)
  const s = skill.data

  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto p-4 sm:max-h-[85vh] sm:max-w-2xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="min-w-0 break-words pr-6 text-base">{s?.name ?? id}</DialogTitle>
          {s && (
            <DialogDescription asChild>
              <div>
                <SkillFacts skill={s} />
              </div>
            </DialogDescription>
          )}
        </DialogHeader>

        {skill.isPending ? (
          <div className="grid gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/6" />
          </div>
        ) : skill.isError ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 p-3"
          >
            <p className="text-sm text-destructive">{skill.error.message}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={skill.isFetching}
              onClick={() => skill.refetch()}
            >
              <RefreshCw className={cn(skill.isFetching && 'animate-spin')} />
              重试读取
            </Button>
          </div>
        ) : s ? (
          <SkillBody path={path} skill={s} />
        ) : null}

        <DialogFooter className="items-center sm:justify-between">
          <div className="flex items-center gap-1">
            {s && <CopyButton value={s.content} label="复制 SKILL.md" size="icon-sm" />}
          </div>
          <div className="flex gap-2">
            {canRemove && id && (
              <ConfirmAction
                title={`删除技能 ${id}?`}
                description={<p>删除是幂等的，但内容不可恢复。</p>}
                actionLabel="删除"
                onConfirm={() => onDelete(id)}
                trigger={
                  <Button variant="outline" aria-label="删除技能">
                    <Trash2 className="text-destructive" />
                    删除
                  </Button>
                }
              />
            )}
            <Button onClick={onClose}>关闭</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface DraftFile {
  path: string
  content: string
}

const SKILL_MD_PLACEHOLDER = `---
name: my-skill
description: 一句话说明这个技能做什么、何时用。
---

# 用法

在这里写技能正文(Markdown)。`

/**
 * 发布技能(对等 `tb skill publish`):Publish 是幂等 upsert。
 * 必须包含一个 SKILL.md 文件,其 frontmatter 含 name + description;可选追加更多文件。
 */
function SkillPublishDialog({
  path,
  onClose,
  onSaved,
}: {
  path: string
  onClose: () => void
  onSaved: () => void
}) {
  const invoke = useInvoke()
  const [id, setId] = useState('')
  const [skillMd, setSkillMd] = useState('')
  const [extraFiles, setExtraFiles] = useState<DraftFile[]>([])
  const [err, setErr] = useState<string | null>(null)

  const addFile = () => setExtraFiles((prev) => [...prev, { path: '', content: '' }])
  const updateFile = (index: number, patch: Partial<DraftFile>) =>
    setExtraFiles((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  const removeFile = (index: number) => setExtraFiles((prev) => prev.filter((_, i) => i !== index))

  const submit = async () => {
    if (!skillMd.trim()) {
      setErr('SKILL.md 必填(frontmatter 需含 name 与 description)')
      return
    }
    const files: Array<{ path: string; content: string }> = [{ path: 'SKILL.md', content: skillMd }]
    for (const f of extraFiles) {
      const p = f.path.trim().replace(/^\/+/, '')
      if (p === '') {
        setErr('每个追加文件都需要一个路径')
        return
      }
      if (p === 'SKILL.md') {
        setErr('SKILL.md 已由上方文本框提供,追加文件请用其他路径')
        return
      }
      files.push({ path: p, content: f.content })
    }
    try {
      const r = await invoke.mutateAsync({
        path,
        tool: 'Publish',
        args: { ...(id.trim() ? { id: id.trim() } : {}), files },
      })
      const published = (r.json as { id?: string })?.id ?? id.trim()
      toast.success(published ? `已发布 ${published}` : '已发布技能')
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
    <Dialog open onOpenChange={requestOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!invoke.isPending}
        onEscapeKeyDown={(event) => invoke.isPending && event.preventDefault()}
        onPointerDownOutside={(event) => invoke.isPending && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="break-words text-base">发布技能</DialogTitle>
          <DialogDescription>
            Publish 是幂等 upsert;必须含 SKILL.md(frontmatter 提供 name 与
            description),可追加更多文件。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="skill-id" className="text-xs">
              技能 id(可空;留空由服务端从 SKILL.md 生成)
            </Label>
            <Input
              id="skill-id"
              className="font-mono text-sm"
              placeholder="my-skill"
              value={id}
              onChange={(e) => setId(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="skill-md" className="text-xs">
              SKILL.md *
            </Label>
            <Textarea
              id="skill-md"
              className="font-mono text-xs"
              rows={12}
              spellCheck={false}
              placeholder={SKILL_MD_PLACEHOLDER}
              value={skillMd}
              onChange={(e) => setSkillMd(e.target.value)}
            />
          </div>
          <div className="grid gap-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">附加文件(可空)</Label>
              <Button type="button" variant="ghost" size="xs" onClick={addFile}>
                <Plus />
                添加文件
              </Button>
            </div>
            {extraFiles.map((f, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 草稿行顺序稳定,无稳定 id
              <div key={index} className="grid gap-2 rounded-lg border bg-muted/10 p-3">
                <div className="flex items-center gap-2">
                  <Input
                    className="h-8 font-mono text-xs"
                    placeholder="reference/example.txt"
                    value={f.path}
                    onChange={(e) => updateFile(index, { path: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="移除文件"
                    onClick={() => removeFile(index)}
                  >
                    <X />
                  </Button>
                </div>
                <Textarea
                  className="font-mono text-xs"
                  rows={4}
                  spellCheck={false}
                  placeholder="文件内容…"
                  value={f.content}
                  onChange={(e) => updateFile(index, { content: e.target.value })}
                />
              </div>
            ))}
          </div>
          {err && (
            <p role="alert" className="text-xs text-destructive">
              {err}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button disabled={invoke.isPending} onClick={() => void submit()}>
            {invoke.isPending && <Loader2 className="animate-spin" />}
            发布
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
