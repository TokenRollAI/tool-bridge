import { Activity, CircleCheck, CircleX, GitBranch, Plus, TerminalSquare, Trash2, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import type { ApiError } from '@/lib/api'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useHelp, useHistory, useInvalidate, useInvoke } from '@/lib/queries'
import { CommandWorkspace } from '@/components/node/CommandWorkspace'
import { ContextBrowser } from '@/components/node/ContextBrowser'
import { FeedbackPanel } from '@/components/node/FeedbackPanel'
import { MountDialog } from '@/pages/system/forms/MountDialog'
import { SkillBrowser } from '@/components/node/SkillBrowser'
import { ConfirmAction } from '@/components/ConfirmAction'
import { NoteCard } from '@/components/node/NoteCard'
import { Skeleton } from '@/components/ui/skeleton'
import { KindBadge } from '@/components/KindBadge'
import { KIND_ICON } from '@/components/kind-icon'
import { Button } from '@/components/ui/button'
import { encodeTreePath } from '@/lib/path'
import { cn } from '@/lib/utils'
import { InspectorHelpDoc } from './InspectorHelpDoc'

function invokeTime(iso: string): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return iso
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000))
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时前`
  return new Date(time).toLocaleDateString()
}

/** 子节点跳转卡片(画布点击子节点会选中它;这里给一个列表入口)。 */
function ChildList({
  path,
  children,
  onNavigate,
}: {
  children: NonNullable<ReturnType<typeof useHelp>['data']>['children']
  onNavigate: (path: string) => void
  path: string
}) {
  return (
    <section className="rounded-xl border bg-card/40 p-3">
      <div className="mb-2.5 flex items-center gap-2">
        <GitBranch className="size-4 text-primary" />
        <h3 className="text-sm font-medium">子节点</h3>
      </div>
      <div className="grid gap-1.5">
        {children?.map((ch) => {
          const name = ch.path.split('/').pop() ?? ch.path
          const target = path === '' ? ch.path : `${path}/${name}`
          return (
            <button
              className="flex min-w-0 items-center gap-2.5 rounded-lg border bg-background/50 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-secondary/40"
              key={ch.path}
              onClick={() => onNavigate(target)}
              type="button"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{name}</span>
              <KindBadge kind={ch.kind} />
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** 抽屉外壳:标题条 + 关闭按钮 + 内容槽。 */
function InspectorFrame({
  path,
  title,
  kind,
  icon,
  onClose,
  children,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  kind?: React.ComponentProps<typeof KindBadge>['kind']
  onClose: () => void
  path: string
  title?: string
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <header className="flex shrink-0 items-start gap-3 border-b px-5 py-4">
        {icon && (
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border bg-background/70 shadow-sm">
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="min-w-0 truncate font-mono text-lg tracking-tight">{title ?? path}</h2>
            {kind && <KindBadge kind={kind} />}
          </div>
          <div
            aria-label={`节点路径：/${path}`}
            className="mt-1 flex min-w-0 items-center gap-1 overflow-hidden font-mono text-[10px] text-muted-foreground"
            title={`/${path}`}
          >
            <span className="shrink-0 text-primary">/</span>
            {path.split('/').filter(Boolean).map((part, index) => (
              <span className="flex min-w-0 items-center gap-1" key={`${part}-${index}`}>
                {index > 0 && <span className="shrink-0 opacity-55">/</span>}
                <span className="truncate">{part}</span>
              </span>
            ))}
          </div>
        </div>
        <Button aria-label="关闭" onClick={onClose} size="icon-sm" variant="ghost">
          <X />
        </Button>
      </header>
      {children}
    </div>
  )
}

/**
 * 节点操作抽屉:画布选中一个节点后从右侧滑出。取代旧的整页 NodePage —— 同一份
 * `~help` 渲染 + 命令工作台 + context/skill 浏览器 + 反馈 + note + 挂载/卸载动作,
 * 只是不再离开画布。所有 node 子组件原样复用,数据面契约不变。
 *
 * key={path} 由父级控制,切换节点时整体 remount,避免 tab/表单状态跨节点残留。
 */
export function NodeInspector({
  path,
  initialTool,
  initialView,
  onClose,
  onUnmounted,
}: {
  /** 从搜索或画布命令叶直达时，自动打开对应调用弹窗。 */
  initialTool?: string
  /** “查看完整目录”直达调用 tab，不影响普通节点的默认浏览 tab。 */
  initialView?: 'invoke'
  onClose: () => void
  /** 卸载成功后通知画布把选中清掉(并让树失效)。 */
  onUnmounted: (path: string) => void
  path: string
}) {
  const help = useHelp(path)
  const history = useHistory()
  const invoke = useInvoke()
  const invalidate = useInvalidate()
  const navigate = useNavigate()

  const unmount = async (target: string) => {
    try {
      await invoke.mutateAsync({ commandPath: 'system/registry/delete', args: { path: target } })
      toast.success(`已卸载 ${target}`)
      await invalidate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '卸载节点失败')
      throw error
    }
  }

  const unmountSelf = async () => {
    await unmount(path)
    onUnmounted(path)
  }

  if (help.isPending) {
    return (
      <InspectorFrame onClose={onClose} path={path}>
        <div className="p-5">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-3 h-4 w-64" />
          <Skeleton className="mt-6 h-48 w-full rounded-xl" />
        </div>
      </InspectorFrame>
    )
  }

  if (help.isError) {
    const err = help.error as ApiError
    return (
      <InspectorFrame onClose={onClose} path={path}>
        <div className="p-5">
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
            <p className="font-mono text-xs text-destructive">
              {err.code}
              {' · HTTP '}
              {err.status}
            </p>
            <p className="mt-1 text-sm">
              {err.status === 404 ? '节点不存在或当前 SK 无权可见(可见性即权限)' : err.message}
            </p>
          </div>
        </div>
      </InspectorFrame>
    )
  }

  const { node, cmds, children, note, feedback } = help.data
  const isContext = node.kind === 'context'
  const isSkillhub = node.kind === 'skillhub'
  const hasBrowser = isContext || isSkillhub
  const { icon: NodeIcon, className: nodeIconClass } = KIND_ICON[node.kind] ?? KIND_ICON.directory
  const isSystem = node.kind === 'builtin' || path === 'system' || path.startsWith('system/')
  const canMountChild = !isSystem
  const canUnmountSelf = path !== '' && !isSystem
  const childDefaultPath = path === '' ? '' : `${path}/`
  const shortName = path === '' ? '/' : path.split('/').pop()
  const nodeHistory = history.filter(record => record.path === path)
  const latestInvoke = nodeHistory[0]

  return (
    <InspectorFrame
      icon={<NodeIcon className={cn('size-5', nodeIconClass)} strokeWidth={1.7} />}
      kind={node.kind}
      onClose={onClose}
      path={path}
      title={shortName}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b px-5 py-4">
          <p className="text-sm leading-6 text-muted-foreground">
            {node.description || '该节点没有提供说明。'}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 font-mono">
              <TerminalSquare className="size-3 text-primary" />
              {cmds.length}
              {' 命令'}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 font-mono">
              <GitBranch className="size-3 text-primary" />
              {children?.length ?? 0}
              {' 子节点'}
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 font-mono"
              title="只统计此浏览器、当前连接档案最近保存的 50 次调用"
            >
              <Activity className="size-3 text-primary" />
              本机调用
              {' '}
              {nodeHistory.length}
            </span>
            {latestInvoke && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono',
                  latestInvoke.ok
                    ? 'border-ok/25 bg-ok/5 text-ok'
                    : 'border-destructive/25 bg-destructive/5 text-destructive',
                )}
                title={`本机最近调用 · ${latestInvoke.tool} · ${invokeTime(latestInvoke.at)}`}
              >
                {latestInvoke.ok
                  ? <CircleCheck className="size-3" />
                  : <CircleX className="size-3" />}
                {latestInvoke.tool}
                {' · '}
                {latestInvoke.ok ? `${latestInvoke.ms} ms` : latestInvoke.code ?? '失败'}
              </span>
            )}
          </div>
          {(canMountChild || canUnmountSelf) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {canMountChild && (
                <MountDialog
                  defaultPath={childDefaultPath}
                  existingPaths={children?.map(c => c.path) ?? []}
                  trigger={(
                    <Button size="sm" variant="outline">
                      <Plus />
                      挂载子节点
                    </Button>
                  )}
                />
              )}
              {canUnmountSelf && (
                <ConfirmAction
                  actionLabel="卸载"
                  description={<p>卸载后该子树不可见；空的中间目录将被回收。</p>}
                  onConfirm={unmountSelf}
                  title={`卸载 ${path}?`}
                  trigger={(
                    <Button size="sm" variant="outline">
                      <Trash2 className="text-destructive" />
                      卸载此节点
                    </Button>
                  )}
                />
              )}
            </div>
          )}
          <div className="mt-3">
            <NoteCard path={path} {...(note !== undefined ? { note } : {})} />
          </div>
        </div>

        <Tabs
          className="gap-0"
          defaultValue={initialTool || initialView === 'invoke' ? 'invoke' : hasBrowser ? 'browse' : 'invoke'}
          key={path}
        >
          <div className="overflow-x-auto border-b px-5">
            <TabsList className="h-11 min-w-max gap-5 p-0" variant="line">
              {hasBrowser && (
                <TabsTrigger className="px-0 text-xs" value="browse">
                  {isSkillhub ? '技能目录' : '条目'}
                </TabsTrigger>
              )}
              <TabsTrigger className="px-0 text-xs" value="invoke">
                调用
              </TabsTrigger>
              {path !== '' && (
                <TabsTrigger className="px-0 text-xs" value="feedback">
                  反馈
                  {feedback && feedback.length > 0 ? ` · ${feedback.length}` : ''}
                </TabsTrigger>
              )}
              <TabsTrigger className="px-0 text-xs" value="doc">
                ~help
              </TabsTrigger>
            </TabsList>
          </div>

          {hasBrowser && (
            <TabsContent className="p-5" value="browse">
              {isSkillhub
                ? <SkillBrowser cmds={cmds} path={path} />
                : <ContextBrowser cmds={cmds} path={path} />}
            </TabsContent>
          )}

          <TabsContent className="grid gap-5 p-5" value="invoke">
            {children && children.length > 0 && (
              <ChildList onNavigate={p => navigate(`/nodes/${encodeTreePath(p)}`)} path={path}>
                {children}
              </ChildList>
            )}
            {cmds.length > 0
              ? (
                  <CommandWorkspace
                    cmds={cmds}
                    initialTool={initialTool}
                    lazySchema={node.kind === 'mcp' || node.kind === 'http'}
                    path={path}
                  />
                )
              : (children?.length ?? 0) === 0 && (
                  <p className="text-sm text-muted-foreground">该节点没有可调用的命令。</p>
                )}
          </TabsContent>

          {path !== '' && (
            <TabsContent className="p-5" value="feedback">
              <FeedbackPanel path={path} />
            </TabsContent>
          )}

          <TabsContent className="p-5" value="doc">
            <InspectorHelpDoc path={path} />
          </TabsContent>
        </Tabs>
      </div>
    </InspectorFrame>
  )
}
