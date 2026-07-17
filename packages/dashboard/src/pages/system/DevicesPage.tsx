import {
  ArrowRight,
  Clock3,
  Cpu,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { Link } from 'react-router'
import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PaginationFooter } from '@/components/PaginationFooter'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/lib/session-context'
import { Button } from '@/components/ui/button'
import { useRegistryList } from '@/lib/queries'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

function formatActivity(value?: string): string {
  if (!value) return '暂无记录'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  const elapsed = Math.max(0, Date.now() - timestamp)
  if (elapsed < 60_000) return '刚刚'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`
  return new Date(timestamp).toLocaleString()
}

/**
 * 设备列表(对等 `tb device ls`)。`tb connect` / `tb mount fs` 是设备侧长驻 WS 进程,
 * 属三入口对等的天然例外——Dashboard 负责展示与引导,不承担设备接入或递归清理。
 * registry delete 只允许叶节点,不能把带 shell/fs 后代的设备根伪装成可一键删除。
 */
export function DevicesPage() {
  const list = useRegistryList('device')
  const { active } = useSession()
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)
  const baseUrl = active?.baseUrl || window.location.origin

  const devices = (list.data?.items ?? []).filter(
    n => n.kind === 'directory' && n.online !== undefined,
  )
  const online = devices.filter(d => d.online).length
  const offline = devices.length - online
  const connectCmd = `tb connect ${baseUrl}`

  const refresh = async () => {
    const result = await list.refetch()
    if (!result.isError) setRefreshedAt(Date.now())
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <PageHeader
        actions={(
          <Button
            disabled={list.isRefetching}
            onClick={() => void refresh()}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw className={cn(list.isRefetching && 'animate-spin')} />
            {list.isRefetching ? '正在刷新' : '刷新状态'}
          </Button>
        )}
        description="查看反向注册机器的实时会话状态，并把新设备安全接入同一棵能力树。"
        eyebrow="SYSTEM / DEVICES"
        title="设备接入"
      />

      <section className="mt-6 overflow-hidden rounded-xl border bg-card/70">
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)] lg:items-center lg:p-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-primary">
              <span className="grid size-9 place-items-center rounded-lg border border-primary/20 bg-primary/8">
                <Terminal className="size-4" />
              </span>
              <p className="text-xs font-semibold tracking-[0.14em] uppercase">Connect a device</p>
            </div>
            <h2 className="mt-4 text-lg font-semibold tracking-tight">让内网机器主动连接网关</h2>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
              在目标机器执行命令，保持进程运行。连接成功后，设备声明的 shell / fs
              能力会出现在左侧能力树中。
            </p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-ok" />
                需要具备 register 权限的 SK
              </span>
              <Link
                className="inline-flex items-center gap-1 text-foreground underline decoration-border underline-offset-4 hover:text-primary"
                to="/manage/sk"
              >
                管理 Secret Key
                <ArrowRight className="size-3" />
              </Link>
            </div>
          </div>

          <div className="min-w-0 rounded-lg border bg-background/75 p-3 shadow-[inset_0_1px_0_color-mix(in_oklch,var(--foreground)_5%,transparent)]">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
                Terminal
              </span>
              <CopyButton label="复制 connect 命令" value={connectCmd} />
            </div>
            <code className="block overflow-x-auto rounded-md bg-muted/35 px-3 py-3 font-mono text-xs leading-5 whitespace-nowrap text-foreground">
              {connectCmd}
            </code>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              登录档案中的 SK 会由 CLI 提示输入或读取本机配置，不会写入这条命令。
            </p>
          </div>
        </div>
      </section>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card/55 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">已加载设备</span>
            <Cpu className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{devices.length}</p>
        </div>
        <div className="rounded-lg border border-ok/20 bg-ok/[0.035] p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">在线会话</span>
            <Wifi className="size-4 text-ok" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-ok tabular-nums">{online}</p>
        </div>
        <div className="rounded-lg border bg-card/55 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">离线保留</span>
            <WifiOff className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{offline}</p>
        </div>
      </div>

      <section className="mt-4 overflow-hidden rounded-lg border bg-card/45">
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">设备会话</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              离线设备保留注册路径，重新连接后自动复用。
            </p>
          </div>
          <p
            aria-live="polite"
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <Clock3 className="size-3.5" />
            {list.isRefetching
              ? '正在同步会话状态…'
              : refreshedAt
                ? `刚刚更新 · ${new Date(refreshedAt).toLocaleTimeString()}`
                : '状态来自最近一次列表读取'}
          </p>
        </div>

        {list.isPending
          ? (
              <div className="grid gap-2 p-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-4/6" />
              </div>
            )
          : list.isError
            ? (
                <EmptyState
                  action={(
                    <Button onClick={() => void refresh()} size="sm" variant="outline">
                      <RefreshCw />
                      重试
                    </Button>
                  )}
                  className="m-4"
                  icon={WifiOff}
                  title="设备状态读取失败"
                  tone="danger"
                >
                  <p>{list.error.message}</p>
                </EmptyState>
              )
            : devices.length === 0
              ? (
                  <EmptyState className="m-4" icon={Cpu} title="还没有设备接入">
                    <p>在目标机器上运行上方 connect 命令，shell / fs 将自动挂上能力树。</p>
                  </EmptyState>
                )
              : (
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>设备路径</TableHead>
                        <TableHead className="w-28">会话状态</TableHead>
                        <TableHead>能力说明</TableHead>
                        <TableHead className="w-44">最近活动</TableHead>
                        <TableHead className="w-16">
                          <span className="sr-only">操作</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {devices.map(device => (
                        <TableRow key={device.path}>
                          <TableCell>
                            <div className="flex min-w-52 items-center gap-3">
                              <span
                                className={cn(
                                  'grid size-8 shrink-0 place-items-center rounded-md border',
                                  device.online
                                    ? 'border-ok/25 bg-ok/[0.06] text-ok'
                                    : 'bg-muted/20 text-muted-foreground',
                                )}
                              >
                                <Cpu className="size-3.5" />
                              </span>
                              <div className="min-w-0">
                                <p className="font-mono text-xs text-foreground">{device.path}</p>
                                <p className="mt-0.5 text-[11px] text-muted-foreground">device namespace</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={cn(
                                'font-mono text-[10px]',
                                device.online
                                  ? 'border-ok/35 bg-ok/[0.045] text-ok'
                                  : 'bg-muted/20 text-muted-foreground',
                              )}
                              variant="outline"
                            >
                              {device.online ? <Wifi /> : <WifiOff />}
                              {device.online ? 'online' : 'offline'}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-80 whitespace-normal">
                            <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {device.description || '设备通过反向通道注册的能力集合'}
                            </p>
                          </TableCell>
                          <TableCell title={device.updatedAt}>
                            <p className="font-mono text-xs text-foreground">
                              {formatActivity(device.updatedAt)}
                            </p>
                            {device.updatedAt && (
                              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                {new Date(device.updatedAt).toLocaleString()}
                              </p>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              aria-label={`打开 ${device.path}`}
                              asChild
                              size="icon-sm"
                              variant="ghost"
                            >
                              <Link to={`/nodes/${device.path}`}>
                                <ExternalLink />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
        {!list.isPending && !list.isError && (
          <PaginationFooter
            count={devices.length}
            hasNextPage={Boolean(list.hasNextPage)}
            isFetchingNextPage={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
            unit="台设备"
          />
        )}
      </section>

      <div className="mt-4 rounded-lg border border-dashed bg-muted/10 px-4 py-3 text-xs leading-5 text-muted-foreground">
        <p>
          普通 registry delete 只允许删除叶节点，不支持递归删除带 shell / fs
          后代的设备根，因此此页不会提供必然失败的“清理设备”按钮。 offline
          仅表示当前会话不可用，调用会返回可重试的 503。
        </p>
      </div>
    </div>
  )
}
