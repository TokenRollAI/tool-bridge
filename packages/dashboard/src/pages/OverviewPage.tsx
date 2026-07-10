import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Cpu,
  History,
  KeySquare,
  Loader2,
  Network,
  RefreshCw,
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
    desc: '挂载能力',
    icon: Boxes,
  },
  {
    to: '/manage/sk',
    label: 'Secret Key',
    desc: '签发权限',
    icon: KeySquare,
  },
  {
    to: '/manage/secrets',
    label: '凭证保管',
    desc: '轮换 authRef',
    icon: ShieldEllipsis,
  },
  {
    to: '/manage/devices',
    label: '设备通道',
    desc: '检查在线状态',
    icon: Cpu,
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
 * 首页仅读根树 depth=1，不统计整树 kind，避免在未展开 remote 时触发联邦聚合。
 * 全局节点数来自 system/status；连通性与版本来自免认证 healthz。
 */
export function OverviewPage() {
  const health = useHealthz()
  const status = useStatus()
  const tree = useTree('', 1)
  const { active } = useSession()
  const history = useHistory()
  const rootChildren = tree.data?.children ?? []
  const firstRoot = rootChildren[0]
  const baseUrl = active?.baseUrl || window.location.origin
  const operational = health.data?.healthy === true
  const healthLabel = health.isError
    ? '网关不可达'
    : operational
      ? '网关运行正常'
      : health.isPending
        ? '正在检查网关'
        : '网关报告异常'

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-7 lg:px-10 lg:py-9">
      <PageHeader
        eyebrow="WORKSPACE / OVERVIEW"
        title="网关总览"
        description="确认控制面状态，然后从根命名空间继续发现、授权与调用组织能力。"
      />

      <section className="relative mt-6 overflow-hidden rounded-xl border bg-card/70 p-5 sm:p-6">
        <div
          aria-hidden
          className="absolute inset-0 opacity-20 [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:linear-gradient(90deg,black,transparent_78%)]"
        />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-2">
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
                {healthLabel}
              </span>
              {health.isError && (
                <button
                  type="button"
                  className="text-[11px] text-primary underline-offset-4 hover:underline"
                  onClick={() => void health.refetch()}
                >
                  重新检测
                </button>
              )}
            </div>
            <p
              className="mt-3 truncate font-mono text-sm text-foreground sm:text-base"
              title={baseUrl}
            >
              {baseUrl}
            </p>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Dashboard、Agent 与 CLI 共用这个入口。能力按需展开，首页不会预取整棵树或远程联邦。
            </p>

            <div className="mt-5 flex flex-col items-start gap-2.5 sm:flex-row sm:items-center">
              {tree.isPending ? (
                <Button disabled>
                  <Loader2 className="animate-spin" />
                  正在读取能力树
                </Button>
              ) : tree.isError ? (
                <Button type="button" onClick={() => void tree.refetch()}>
                  <RefreshCw />
                  重新读取能力树
                </Button>
              ) : firstRoot ? (
                <Button asChild>
                  <Link to={`/nodes/${firstRoot.path}`}>
                    继续探索能力树
                    <ArrowRight />
                  </Link>
                </Button>
              ) : (
                <Button asChild>
                  <Link to="/manage/registry">
                    挂载第一个节点
                    <ArrowRight />
                  </Link>
                </Button>
              )}
              <span className="text-[11px] leading-5 text-muted-foreground">
                {firstRoot ? (
                  <>
                    从 <span className="font-mono text-foreground">{firstRoot.path}</span>{' '}
                    根节点开始
                  </>
                ) : tree.isError ? (
                  '保留当前页面并重试，不会清除已有档案。'
                ) : tree.isPending ? (
                  '仅读取 depth=1 的根命名空间。'
                ) : (
                  '新节点挂载后会立即成为树入口。'
                )}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border/70 text-center">
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
              value={tree.data ? String(rootChildren.length) : tree.isError ? '受限' : '—'}
              pending={tree.isPending}
            />
          </div>
        </div>
      </section>

      <nav
        className="mt-4 flex flex-col gap-1 rounded-lg border bg-card/40 p-2 lg:flex-row lg:items-stretch"
        aria-label="管理动作"
      >
        <div className="flex items-center gap-2 px-2 py-2 lg:w-36 lg:shrink-0">
          <Activity className="size-4 text-primary" />
          <span>
            <span className="block text-xs font-medium">管理动作</span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">Control plane</span>
          </span>
        </div>
        <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_LINKS.map(({ to, label, desc, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="group flex min-w-0 items-center gap-2.5 rounded-md px-3 py-2 transition-colors hover:bg-secondary/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-background/60 text-muted-foreground group-hover:text-primary">
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{label}</span>
                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                  {desc}
                </span>
              </span>
              <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
            </Link>
          ))}
        </div>
      </nav>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.85fr)]">
        <section className="rounded-lg border bg-card/45">
          <SectionHeader
            icon={Network}
            title="能力树入口"
            meta={tree.data ? `${rootChildren.length} 个根节点` : undefined}
          />
          <div className="border-t">
            {tree.isPending ? (
              <div className="grid gap-3 p-4">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : tree.isError ? (
              <EmptyState
                icon={Network}
                title="无法读取能力树"
                tone="danger"
                className="border-0"
                action={
                  <Button variant="outline" size="sm" onClick={() => void tree.refetch()}>
                    <RefreshCw />
                    重新读取
                  </Button>
                }
              >
                <p>{tree.error.message}</p>
              </EmptyState>
            ) : rootChildren.length === 0 ? (
              <EmptyState
                icon={Boxes}
                title="树还是空的"
                className="border-0"
                action={
                  <Button asChild size="sm">
                    <Link to="/manage/registry">挂载第一个节点</Link>
                  </Button>
                }
              >
                <p>工具、Context 或联邦服务挂载完成后，会立即成为这里的入口。</p>
              </EmptyState>
            ) : (
              <div className="divide-y">
                {rootChildren.map((node) => (
                  <Link
                    key={node.path}
                    to={`/nodes/${node.path}`}
                    className="group flex min-w-0 items-center gap-3 px-4 py-3.5 transition-colors hover:bg-secondary/45 sm:px-5"
                    title={`打开根节点 ${node.path}`}
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
                    <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground group-hover:text-primary sm:flex">
                      打开节点
                      <ArrowUpRight className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border bg-card/45">
          <SectionHeader
            icon={History}
            title="最近调用"
            meta={history.length > 0 ? `${history.length} 条本地记录` : undefined}
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
              <EmptyState
                icon={TerminalSquare}
                title="还没有调用记录"
                className="border-0 py-9"
                action={
                  firstRoot ? (
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/nodes/${firstRoot.path}`}>打开一个节点</Link>
                    </Button>
                  ) : undefined
                }
              >
                <p>从任意节点发起调用后，这里只保存路径、结果和耗时；参数不会落盘。</p>
              </EmptyState>
            ) : (
              <div className="divide-y">
                {history.slice(0, 8).map((record) => (
                  <Link
                    key={`${record.at}:${record.path}:${record.tool}`}
                    to={`/nodes/${record.path}`}
                    className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-secondary/45"
                  >
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        record.ok ? 'bg-ok' : 'bg-destructive',
                      )}
                      title={record.ok ? 'ok' : (record.code ?? 'error')}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs">{record.path}</span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                        {record.tool}
                      </span>
                    </span>
                    <span className="shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
                      {!record.ok && (
                        <span className="block max-w-20 truncate text-destructive">
                          {record.code}
                        </span>
                      )}
                      <span className="block">
                        {record.ok ? `${record.ms} ms · ` : ''}
                        {relTime(record.at)}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
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
    <div className="flex min-h-12 items-center gap-2.5 px-4 py-3 sm:px-5">
      <Icon className="size-4 text-primary" />
      <h2 className="text-sm font-medium">{title}</h2>
      {meta && <span className="font-mono text-[10px] text-muted-foreground">{meta}</span>}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  )
}
