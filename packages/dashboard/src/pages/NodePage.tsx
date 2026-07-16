import { useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, GitBranch, Plus, TerminalSquare, Trash2 } from 'lucide-react'
import { Fragment } from 'react'
import Markdown from 'react-markdown'
import { Link, useNavigate, useParams } from 'react-router'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { ConfirmAction } from '@/components/ConfirmAction'
import { KIND_ICON, KindBadge } from '@/components/KindBadge'
import { CommandWorkspace } from '@/components/node/CommandWorkspace'
import { ContextBrowser } from '@/components/node/ContextBrowser'
import { FeedbackPanel } from '@/components/node/FeedbackPanel'
import { NoteCard } from '@/components/node/NoteCard'
import { SkillBrowser } from '@/components/node/SkillBrowser'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ApiError } from '@/lib/api'
import { useHelp, useHelpMarkdown, useInvoke } from '@/lib/queries'
import { MountDialog } from './system/RegistryPage'

/**
 * 节点页 = `~help` 的通用渲染器:
 * 描述 + 子节点导航 + 每条 cmd 的表单调用面板;"~help 文档" tab 展示可读 Markdown
 * 表现(协议默认),对等 `tb help <path>`。
 */
export function NodePage() {
  const { '*': splat } = useParams()
  const path = (splat ?? '').replace(/\/+$/, '')
  const help = useHelp(path)
  const invoke = useInvoke()
  const qc = useQueryClient()
  const navigate = useNavigate()

  // 卸载 = registry delete;成功后失效 ['tb'](刷新树 + 本页)。错误由此处 toast,再抛给
  // ConfirmAction 以保留其弹窗(允许重试)。
  const unmount = async (target: string) => {
    try {
      await invoke.mutateAsync({ path: 'system/registry', tool: 'delete', args: { path: target } })
      toast.success(`已卸载 ${target}`)
      await qc.invalidateQueries({ queryKey: ['tb'] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '卸载节点失败')
      throw error
    }
  }

  const unmountSelf = async () => {
    await unmount(path)
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    navigate(parent === '' ? '/' : `/nodes/${parent}`)
  }

  if (help.isPending) {
    return (
      <div className="mx-auto w-full max-w-[100rem] px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8 xl:px-10">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="mt-3 h-4 w-96" />
        <Skeleton className="mt-8 h-48 w-full rounded-xl" />
      </div>
    )
  }
  if (help.isError) {
    const err = help.error as ApiError
    return (
      <div className="mx-auto w-full max-w-[100rem] px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8 xl:px-10">
        <Crumbs path={path} />
        <div className="mt-6 rounded-sm border border-destructive/40 bg-destructive/10 px-4 py-3">
          <p className="font-mono text-xs text-destructive-foreground/90">
            {err.code} · HTTP {err.status}
          </p>
          <p className="mt-1 text-sm">
            {err.status === 404 ? '节点不存在或当前 SK 无权可见(可见性即权限)' : err.message}
          </p>
        </div>
      </div>
    )
  }

  const { node, cmds, children, note, feedback } = help.data
  const isContext = node.kind === 'context'
  const isSkillhub = node.kind === 'skillhub'
  // context / skillhub 均是内容服务节点,默认落「浏览」tab(条目 / 技能目录)。
  const hasBrowser = isContext || isSkillhub
  const { icon: NodeIcon, className: nodeIconClass } = KIND_ICON[node.kind] ?? KIND_ICON.directory
  // system builtin 子树与 root 不可由用户卸载;挂载子节点在非 system 任意处均可。
  const isSystem = node.kind === 'builtin' || path === 'system' || path.startsWith('system/')
  const canMountChild = !isSystem
  const canUnmountSelf = path !== '' && !isSystem
  const childDefaultPath = path === '' ? '' : `${path}/`
  return (
    <div className="mx-auto w-full max-w-[100rem] px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8 xl:px-10">
      <Crumbs path={path} />

      <section className="relative mt-3 overflow-hidden rounded-2xl border bg-card/55 px-4 py-5 sm:px-6 sm:py-6">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary via-primary/45 to-transparent" />
        <div className="absolute -top-24 right-0 size-64 rounded-full bg-primary/[0.045] blur-3xl" />
        <div className="relative flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3.5 sm:gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl border bg-background/75 shadow-sm sm:size-12">
              <NodeIcon className={`size-5 sm:size-5.5 ${nodeIconClass}`} strokeWidth={1.7} />
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <h1 className="min-w-0 truncate font-mono text-2xl tracking-tight sm:text-3xl">
                  {path === '' ? '/' : path.split('/').pop()}
                </h1>
                <KindBadge kind={node.kind} className="leading-5" />
              </div>
              <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
                {node.description || '该节点没有提供说明。'}
              </p>
              <p
                className="mt-2 max-w-full truncate font-mono text-[11px] text-muted-foreground/70"
                title={path || '/'}
              >
                node://{path || '/'}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-3 lg:items-end">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border/70 lg:min-w-56">
              <NodeMetric icon={TerminalSquare} label="COMMANDS" value={cmds.length} />
              <NodeMetric icon={GitBranch} label="CHILDREN" value={children?.length ?? 0} />
            </div>
            {(canMountChild || canUnmountSelf) && (
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {canMountChild && (
                  <MountDialog
                    existingPaths={children?.map((c) => c.path) ?? []}
                    defaultPath={childDefaultPath}
                    trigger={
                      <Button size="sm" variant="outline">
                        <Plus />
                        挂载子节点
                      </Button>
                    }
                  />
                )}
                {canUnmountSelf && (
                  <ConfirmAction
                    title={`卸载 ${path}?`}
                    description={<p>卸载后该子树不可见；空的中间目录将被回收。</p>}
                    actionLabel="卸载"
                    onConfirm={unmountSelf}
                    trigger={
                      <Button size="sm" variant="outline">
                        <Trash2 className="text-destructive" />
                        卸载此节点
                      </Button>
                    }
                  />
                )}
              </div>
            )}
          </div>
        </div>
        <div className="relative mt-5 border-t pt-4">
          <NoteCard path={path} {...(note !== undefined ? { note } : {})} />
        </div>
      </section>

      {/* key=path:切换节点时重置 tab 选择(context / skillhub 节点默认落「浏览」) */}
      <Tabs key={path} defaultValue={hasBrowser ? 'browse' : 'invoke'} className="mt-6 gap-0">
        <div className="-mx-1 overflow-x-auto border-b px-1">
          <TabsList variant="line" className="h-11 min-w-max gap-5 p-0">
            {hasBrowser && (
              <TabsTrigger value="browse" className="px-0 text-xs">
                {isSkillhub ? '技能目录' : '条目'}
              </TabsTrigger>
            )}
            <TabsTrigger value="invoke" className="px-0 text-xs">
              调用工作台
            </TabsTrigger>
            {path !== '' && (
              <TabsTrigger value="feedback" className="px-0 text-xs">
                反馈{feedback && feedback.length > 0 ? ` · ${feedback.length}` : ''}
              </TabsTrigger>
            )}
            <TabsTrigger value="markdown" className="px-0 text-xs">
              ~help 文档
            </TabsTrigger>
          </TabsList>
        </div>

        {hasBrowser && (
          <TabsContent value="browse" className="mt-4">
            {isSkillhub ? (
              <SkillBrowser path={path} cmds={cmds} />
            ) : (
              <ContextBrowser path={path} cmds={cmds} />
            )}
          </TabsContent>
        )}

        <TabsContent value="invoke" className="mt-5 grid gap-5">
          {children && children.length > 0 && (
            <section className="rounded-xl border bg-card/35 p-3 sm:p-4">
              <div className="mb-3 flex items-center gap-2">
                <GitBranch className="size-4 text-primary" />
                <h2 className="text-sm font-medium">子节点</h2>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {children.length} BRANCHES
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {/*
                 * ch.path 对本地节点是树内绝对路径;对 remote 透传节点则是「远端树内路径」
                 * (不含本地挂载前缀,如 remote/djj 下的上游节点回 `tipsy` 而非 `remote/djj/tipsy`)。
                 * 统一以「当前 path + 子节点名(path 末段)」构造本地可导航路径:本地节点下
                 * target 恒等于 ch.path(行为不变),remote 子节点则补回挂载前缀(修 remote 子节点 404)。
                 */}
                {children.map((ch) => {
                  const name = ch.path.split('/').pop() ?? ch.path
                  const target = path === '' ? ch.path : `${path}/${name}`
                  const childIsSystem =
                    ch.kind === 'builtin' || target === 'system' || target.startsWith('system/')
                  return (
                    <div key={ch.path} className="group flex items-stretch gap-1">
                      <Link
                        to={`/nodes/${target}`}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border bg-background/50 px-3 py-3 transition-colors hover:border-primary/35 hover:bg-secondary/45"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="min-w-0 truncate font-mono text-sm">{name}</span>
                            <KindBadge kind={ch.kind} />
                          </span>
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {ch.description}
                          </span>
                        </span>
                        <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                      </Link>
                      {/* 卸载按钮置于 Link 之外,点击不会触发卡片跳转。 */}
                      {!childIsSystem && (
                        <ConfirmAction
                          title={`卸载 ${target}?`}
                          description={<p>卸载后该子树不可见；空的中间目录将被回收。</p>}
                          actionLabel="卸载"
                          onConfirm={() => unmount(target)}
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="self-center"
                              aria-label={`卸载 ${target}`}
                            >
                              <Trash2 className="text-destructive" />
                            </Button>
                          }
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {cmds.length > 0 ? (
            <CommandWorkspace
              path={path}
              cmds={cmds}
              // mcp/http 节点级 ~help 是索引形态:仅为当前选中工具懒取 schema
              lazySchema={node.kind === 'mcp' || node.kind === 'http'}
            />
          ) : (
            (children?.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">该节点没有可调用的命令。</p>
            )
          )}
        </TabsContent>

        {path !== '' && (
          <TabsContent value="feedback" className="mt-4">
            <FeedbackPanel path={path} />
          </TabsContent>
        )}

        <TabsContent value="markdown" className="mt-4">
          <HelpMarkdownView path={path} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function NodeMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof TerminalSquare
  label: string
  value: number
}) {
  return (
    <div className="bg-background/75 px-3.5 py-3">
      <div className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.13em] text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <p className="mt-1.5 font-mono text-lg text-foreground tabular-nums">{value}</p>
    </div>
  )
}

function HelpMarkdownView({ path }: { path: string }) {
  const md = useHelpMarkdown(path)
  if (md.isPending) return <Skeleton className="h-40 w-full" />
  if (md.isError) return <p className="text-sm text-destructive">{md.error.message}</p>
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto rounded-md border bg-card/60 px-3 py-3 break-words prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:bg-background prose-pre:text-xs prose-code:font-mono sm:px-4">
      <Markdown remarkPlugins={[remarkGfm]}>{md.data}</Markdown>
    </div>
  )
}

function Crumbs({ path }: { path: string }) {
  const segs = path === '' ? [] : path.split('/')
  return (
    <nav
      aria-label="路径"
      className="flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-[11px]"
    >
      <Link
        to="/"
        className="rounded-md border bg-card/45 px-2 py-1 text-muted-foreground hover:border-primary/35 hover:text-foreground"
      >
        ROOT
      </Link>
      {segs.map((seg, i) => {
        const prefix = segs.slice(0, i + 1).join('/')
        return (
          <Fragment key={prefix}>
            <span className="text-muted-foreground/35">/</span>
            {i === segs.length - 1 ? (
              <span className="rounded-md bg-primary/8 px-1.5 py-1 text-primary">{seg}</span>
            ) : (
              <Link
                to={`/nodes/${prefix}`}
                className="rounded-md px-1.5 py-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                {seg}
              </Link>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}
