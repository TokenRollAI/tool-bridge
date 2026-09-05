import {
  ArrowRight,
  Clock3,
  Cpu,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wifi,
  WifiLow,
  WifiOff,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  derivePresence,
  PRESENCE_HINT,
  PRESENCE_TONE,
} from '@/lib/presence'
import { DeviceMailboxPanel } from '@/components/device/DeviceMailboxPanel'
import { mailboxTargetForRegistryNode } from '@/lib/deviceMailbox'
import { PaginationFooter } from '@/components/PaginationFooter'
import { PresenceBadge } from '@/components/PresenceBadge'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/lib/session-context'
import { Button } from '@/components/ui/button'
import { useRegistryList } from '@/lib/queries'
import { encodeTreePath } from '@/lib/path'
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
  const [searchParams, setSearchParams] = useSearchParams()
  const connectOpen = searchParams.get('connect') === '1'
  const changeConnectOpen = (open: boolean) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (open) next.set('connect', '1')
      else next.delete('connect')
      return next
    }, { replace: true })
  }
  const { active } = useSession()
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)
  const baseUrl = active?.baseUrl || window.location.origin

  // 数据源是 system/registry(存储态 TreeNode):只有裸 online + lastSeenAt,没有投影好的
  // presence。三态要在客户端派生 —— 这正是本页要解决的问题:online 位可能因拆除事件丢失
  // 而永久停在 true,只看布尔会把已失联的设备报成在线。
  const devices = (list.data?.items ?? [])
    .filter(n => n.kind === 'directory' && n.online !== undefined)
    .map(node => ({
      node,
      presence: derivePresence({
        now: new Date().toISOString(),
        online: node.online,
        ...(node.lastSeenAt !== undefined ? { lastSeenAt: node.lastSeenAt } : {}),
      }),
    }))
  const counts = {
    offline: devices.filter(d => d.presence.state === 'offline').length,
    online: devices.filter(d => d.presence.state === 'online').length,
    stale: devices.filter(d => d.presence.state === 'stale').length,
  }
  const connectCmd = `tb connect ${baseUrl}`

  const refresh = async () => {
    const result = await list.refetch()
    if (!result.isError) setRefreshedAt(Date.now())
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <PageHeader
        actions={(
          <>
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
            <Button onClick={() => changeConnectOpen(true)} size="sm">
              <Plus />
              连接设备
            </Button>
          </>
        )}
        description="查看设备状态、打开已注册工具，管理离线任务。"
        title="设备"
      />

      <Dialog onOpenChange={changeConnectOpen} open={connectOpen}>
        <DialogContent className="overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>连接设备</DialogTitle>
            <DialogDescription>在目标机器运行连接命令，把设备工具接入当前网关。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 py-2">
            <div className="min-w-0">
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                在目标机器执行命令，保持进程运行。连接成功后，设备声明的 shell / fs
                工具将出现在设备列表与能力树中。
              </p>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-ok" />
                  需要具备 register 权限的 SK
                </span>
                <Link
                  className="inline-flex items-center gap-1 text-foreground underline decoration-border underline-offset-4 hover:text-primary"
                  onClick={() => changeConnectOpen(false)}
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
                  连接命令
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
          <Button onClick={() => {
            changeConnectOpen(false)
            void refresh()
          }}
          >
            已运行命令，刷新设备列表
          </Button>
        </DialogContent>
      </Dialog>

      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        <div className="bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">已加载设备</span>
            <Cpu className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{devices.length}</p>
        </div>
        <div className="bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">在线会话</span>
            <Wifi className="size-4 text-ok" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-ok tabular-nums">
            {counts.online}
          </p>
        </div>
        <div className="bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground" title={PRESENCE_HINT.stale}>
              疑似失联
            </span>
            <WifiLow className="size-4 text-warn" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-warn tabular-nums">
            {counts.stale}
          </p>
        </div>
        <div className="bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">离线保留</span>
            <WifiOff className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{counts.offline}</p>
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
                  <EmptyState
                    action={(
                      <Button onClick={() => changeConnectOpen(true)} size="sm">
                        <Plus />
                        连接第一台设备
                      </Button>
                    )}
                    className="m-4"
                    icon={Cpu}
                    title="还没有设备接入"
                  >
                    <p>连接一台电脑或服务器，即可在这里查看和使用它声明的工具。</p>
                  </EmptyState>
                )
              : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>设备路径</TableHead>
                        <TableHead className="hidden w-28 sm:table-cell">会话状态</TableHead>
                        <TableHead className="hidden md:table-cell">能力说明</TableHead>
                        <TableHead className="hidden w-44 lg:table-cell">最近活动</TableHead>
                        <TableHead className="w-28">
                          <span className="sr-only">操作</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {devices.map(({ node: device, presence }) => (
                        <TableRow key={device.path}>
                          <TableCell>
                            <div className="flex items-center gap-2 sm:gap-3">
                              <span
                                className={cn(
                                  'hidden size-8 shrink-0 place-items-center rounded-md border sm:grid',
                                  PRESENCE_TONE[presence.state],
                                )}
                              >
                                <Cpu className="size-3.5" />
                              </span>
                              <div className="min-w-0">
                                <Link className="block max-w-32 truncate font-mono text-xs text-foreground hover:underline sm:max-w-64 sm:text-sm" to={`/nodes/${encodeTreePath(device.path)}?tab=invoke`}>{device.path}</Link>
                                <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">设备</p>
                                <div className="mt-1.5 sm:hidden"><PresenceBadge state={presence.state} /></div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            <PresenceBadge state={presence.state} />
                          </TableCell>
                          <TableCell className="hidden max-w-80 whitespace-normal md:table-cell">
                            <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {device.description || '设备通过反向通道注册的能力集合'}
                            </p>
                          </TableCell>
                          {/*
                            最近活动优先取 lastSeenAt(存活观察:hello / 心跳 / 成功调用)。
                            心跳刷 lastSeenAt 但**不动** updatedAt(心跳不是元数据变更),所以
                            updatedAt 只能表示"注册信息最后一次改动",拿它当活跃度会低报。
                            旧数据没有 lastSeenAt 时回落到 updatedAt。
                          */}
                          <TableCell className="hidden lg:table-cell" title={presence.lastSeenAt ?? device.updatedAt}>
                            <p className="font-mono text-xs text-foreground">
                              {formatActivity(presence.lastSeenAt ?? device.updatedAt)}
                            </p>
                            {(presence.lastSeenAt ?? device.updatedAt) && (
                              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                {new Date(
                                  (presence.lastSeenAt ?? device.updatedAt) as string,
                                ).toLocaleString()}
                              </p>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              aria-label={`打开 ${device.path}`}
                              asChild
                              size="sm"
                              variant="ghost"
                            >
                              <Link to={`/nodes/${encodeTreePath(device.path)}?tab=invoke`}>
                                查看工具
                                <ArrowRight className="hidden sm:block" />
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

      <DeviceMailboxPanel
        targets={devices.flatMap(({ node }) => {
          const target = mailboxTargetForRegistryNode(node)
          return target === null ? [] : [target]
        })}
      />

      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        离线设备的工具仍可查看。支持离线投递的命令可排队等待设备上线；实时调用需要在线会话。
        疑似失联表示近期未收到存活信号，设备重连后将自动恢复状态。
      </p>
    </div>
  )
}
