import {
  Activity,
  ArrowUpRight,
  Boxes,
  Cpu,
  History,
  KeySquare,
  Network,
  Plus,
  ShieldEllipsis,
  TerminalSquare,
  Trash2,
} from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/EmptyState'
import { KindBadge } from '@/components/KindBadge'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { clearHistory, historyScope } from '@/lib/history'
import { useHealthz, useHistory, useStatus, useTree } from '@/lib/queries'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

const QUICK_LINKS = [
  {
    to: '/manage/registry',
    label: '节点注册',
    desc: '挂载工具、Context 与联邦服务',
    icon: Boxes,
    accent: true,
  },
  {
    to: '/manage/sk',
    label: 'Secret Key',
    desc: '签发最小权限凭据',
    icon: KeySquare,
    accent: false,
  },
  {
    to: '/manage/secrets',
    label: '凭证保管',
    desc: '安全轮换上游 authRef',
    icon: ShieldEllipsis,
    accent: false,
  },
  {
    to: '/manage/devices',
    label: '设备通道',
    desc: '查看反向注册与在线状态',
    icon: Cpu,
    accent: false,
  },
] as const

function relTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  if (Number.isNaN(diff)) return iso
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(iso).toLocaleDateString()
}

/**
 * 首页仅读根树 depth=1,不统计整树 kind——避免在未展开 remote 时触发联邦聚合。
 * 全局节点数来自 system/status;连通性与版本来自免认证 healthz。
 */
export function OverviewPage() {
  const health = useHealthz()
  const status = useStatus()
  const tree = useTree('', 1)
  const { active } = useSession()
  const history = useHistory()
  const rootChildren = tree.data?.children ?? []
  const baseUrl = active?.baseUrl || window.location.origin
  const operational = health.data?.healthy === true

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-7 lg:px-10 lg:py-9">
      <PageHeader
        eyebrow="CONTROL PLANE"
        title="网关总览"
        description="从一棵自描述的 HTBP 树发现、授权并调用组织能力。"
        actions={
          <Button asChild size="sm">
            <Link to="/manage/registry">
              <Plus />
              挂载节点
            </Link>
          </Button>
        }
      />

      <section className="relative mt-6 overflow-hidden rounded-xl border bg-card/70 p-5 sm:p-6">
        <div
          aria-hidden
          className="absolute inset-0 opacity-35 [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:linear-gradient(90deg,black,transparent_80%)]"
        />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className={cn(
                  'size-2 rounded-full',
                  health.isError
                    ? 'bg-destructive'
                    : operational
                      ? 'bg-ok shadow-[0_0_10px_var(--ok)]'
                      : 'animate-pulse bg-warn',
                )}
              />
              {health.isError ? '网关不可达' : operational ? '网关运行正常' : '正在检查网关'}
            </div>
            <p
              className="mt-3 truncate font-mono text-sm text-foreground sm:text-base"
              title={baseUrl}
            >
              {baseUrl}
            </p>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Agent、CLI 和 Dashboard 共用同一个访问入口；在左侧树中展开命名空间，或用
              <span className="mx-1 font-mono text-foreground">⌘K</span>直接定位能力。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border/70 text-center sm:min-w-80">
            <HeroMetric
              label="VERSION"
              value={health.data ? `v${health.data.version}` : '—'}
              pending={health.isPending}
            />
            <HeroMetric
              label="NODES"
              value={status.data ? String(status.data.nodeCount) : status.isError ? '受限' : '—'}
              pending={status.isPending}
            />
            <HeroMetric
              label="ROOTS"
              value={tree.data ? String(rootChildren.length) : '—'}
              pending={tree.isPending}
            />
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.8fr)]">
        <div className="grid content-start gap-6">
          <section className="rounded-xl border bg-card/45">
            <SectionHeader
              icon={Network}
              title="根命名空间"
              meta={tree.data ? `${rootChildren.length} visible` : undefined}
            />
            <div className="border-t">
              {tree.isPending ? (
                <div className="grid gap-3 p-4">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : tree.isError ? (
                <div className="p-5 text-sm text-destructive">{tree.error.message}</div>
              ) : rootChildren.length === 0 ? (
                <EmptyState icon={Boxes} title="树还是空的" className="border-0">
                  <p>挂载第一个工具、Context 或联邦服务，它会立即出现在这里。</p>
                </EmptyState>
              ) : (
                <div className="divide-y">
                  {rootChildren.map((node) => (
                    <Link
                      key={node.path}
                      to={`/nodes/${node.path}`}
                      className="group flex min-w-0 items-center gap-3 px-4 py-3.5 transition-colors hover:bg-secondary/45 sm:px-5"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-background/60 font-mono text-xs text-primary">
                        {node.path.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-mono text-sm">{node.path}</span>
                          <KindBadge kind={node.kind} />
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {node.description}
                        </span>
                      </span>
                      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border bg-card/45">
            <SectionHeader
              icon={History}
              title="最近调用"
              meta={history.length > 0 ? `${history.length} local` : undefined}
              action={
                history.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="清空历史"
                    title="清空历史"
                    className="text-muted-foreground"
                    onClick={() => clearHistory(active ? historyScope(active) : '')}
                  >
                    <Trash2 />
                  </Button>
                ) : undefined
              }
            />
            <div className="border-t">
              {history.length === 0 ? (
                <EmptyState icon={TerminalSquare} title="还没有调用记录" className="border-0 py-9">
                  <p>从任意节点发起调用后，这里只保存路径、结果和耗时；参数不会落盘。</p>
                </EmptyState>
              ) : (
                <div className="divide-y">
                  {history.slice(0, 8).map((record) => (
                    <Link
                      key={`${record.at}:${record.path}:${record.tool}`}
                      to={`/nodes/${record.path}`}
                      className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-secondary/45 sm:px-5"
                    >
                      <span
                        className={cn(
                          'size-2 shrink-0 rounded-full',
                          record.ok ? 'bg-ok' : 'bg-destructive',
                        )}
                        title={record.ok ? 'ok' : (record.code ?? 'error')}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {record.path}
                        <span className="text-muted-foreground"> / {record.tool}</span>
                      </span>
                      {!record.ok && (
                        <span className="hidden font-mono text-[11px] text-destructive sm:inline">
                          {record.code}
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                        {record.ok ? `${record.ms} ms · ` : ''}
                        {relTime(record.at)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="grid content-start gap-3" aria-label="快捷管理入口">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
              Quick actions
            </p>
            <Activity className="size-4 text-primary" />
          </div>
          {QUICK_LINKS.map(({ to, label, desc, icon: Icon, ...item }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                'group rounded-xl border bg-card/45 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/45 hover:bg-card',
                item.accent && 'border-primary/35 bg-primary/[0.04]',
              )}
            >
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-background/70 text-muted-foreground group-hover:text-primary">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {label}
                    <ArrowUpRight className="size-3.5 text-muted-foreground group-hover:text-primary" />
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{desc}</span>
                </span>
              </div>
            </Link>
          ))}
        </aside>
      </div>
    </div>
  )
}

function HeroMetric({
  label,
  value,
  pending,
}: {
  label: string
  value: string
  pending?: boolean
}) {
  return (
    <div className="bg-background/80 px-3 py-3.5">
      <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground">{label}</p>
      {pending ? (
        <Skeleton className="mx-auto mt-2 h-5 w-12" />
      ) : (
        <p className="mt-1.5 font-mono text-sm text-foreground tabular-nums">{value}</p>
      )}
    </div>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  meta,
  action,
}: {
  icon: typeof Activity
  title: string
  meta?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-3 sm:px-5">
      <Icon className="size-4 text-primary" />
      <h2 className="text-sm font-medium">{title}</h2>
      {meta && <span className="font-mono text-[11px] text-muted-foreground">{meta}</span>}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  )
}
