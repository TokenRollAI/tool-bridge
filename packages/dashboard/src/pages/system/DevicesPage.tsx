import { useQueryClient } from '@tanstack/react-query'
import { Cpu, ExternalLink, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { ConfirmAction } from '@/components/ConfirmAction'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { OnlineDot } from '@/components/KindBadge'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useInvoke, useRegistryList } from '@/lib/queries'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

/**
 * 设备列表(对等 `tb device ls`)。`tb connect` / `tb mount fs` 是设备侧长驻 WS 进程,
 * 属三入口对等的天然例外——Dashboard 负责展示、引导与离线残骸清理,不承担设备接入本身。
 */
export function DevicesPage() {
  const list = useRegistryList('device')
  const invoke = useInvoke()
  const qc = useQueryClient()
  const { active } = useSession()
  const baseUrl = active?.baseUrl || window.location.origin

  const devices = (list.data?.items ?? []).filter(
    (n) => n.kind === 'directory' && n.online !== undefined,
  )
  const online = devices.filter((d) => d.online).length
  const offline = devices.length - online
  const connectCmd = `tb connect ${baseUrl}`

  /** 离线设备清理:与 CLI `tb device rm` 同一 registry delete(在线设备不提供删除)。 */
  const remove = (path: string) => {
    invoke.mutate(
      { path: 'system/registry', tool: 'delete', args: { path } },
      {
        onSuccess: () => {
          toast.success(`已清理 ${path}`)
          qc.invalidateQueries({ queryKey: ['tb'] })
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <PageHeader
        title="设备"
        description="反向注册接入的机器(Case 3);断线节点保留并标记 offline,调用返回 503 retryable"
        actions={
          devices.length > 0 && (
            <p className="font-mono text-xs text-muted-foreground tabular-nums">
              <span className="text-ok">{online} online</span>
              {offline > 0 && <span className="ml-2 opacity-70">{offline} offline</span>}
            </p>
          )
        }
      />

      <div className="mt-6 flex items-center gap-1.5 rounded-md border bg-card/60 px-3 py-2">
        <span className="font-mono text-[11px] text-muted-foreground">接入新设备:</span>
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{connectCmd}</code>
        <CopyButton value={connectCmd} label="复制 connect 命令" />
      </div>

      <div className="mt-3 overflow-hidden rounded-md border">
        {list.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/6" />
          </div>
        ) : list.isError ? (
          <p className="p-4 text-sm text-destructive">{list.error.message}</p>
        ) : devices.length === 0 ? (
          <EmptyState icon={Cpu} title="还没有设备接入" className="border-0">
            <p>在目标机器上运行上方 connect 命令,shell/fs 将自动挂上树。</p>
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>path</TableHead>
                <TableHead className="w-24">状态</TableHead>
                <TableHead>描述</TableHead>
                <TableHead className="w-28">最近活动</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((d) => (
                <TableRow key={d.path} className={cn(!d.online && 'opacity-60')}>
                  <TableCell className="font-mono text-xs">{d.path}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 font-mono text-xs">
                      <OnlineDot online={d.online} />
                      {d.online ? 'online' : 'offline'}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                    {d.description}
                  </TableCell>
                  <TableCell
                    className="font-mono text-[11px] text-muted-foreground"
                    title={d.updatedAt}
                  >
                    {d.updatedAt ? new Date(d.updatedAt).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon-xs" asChild aria-label="查看节点">
                        <Link to={`/nodes/${d.path}`}>
                          <ExternalLink />
                        </Link>
                      </Button>
                      {!d.online && (
                        <ConfirmAction
                          title={`清理离线设备 ${d.path}?`}
                          description={
                            <p>
                              删除其注册残骸(含 shell/fs 子节点)。设备重新 connect 会再次挂上树。
                            </p>
                          }
                          actionLabel="清理"
                          onConfirm={() => remove(d.path)}
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label="清理"
                              title="清理离线残骸"
                            >
                              <Trash2 className="text-destructive" />
                            </Button>
                          }
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {devices.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          子节点 shell/fs 可在树导航中直接调用(shell 默认白名单全拒,须设备侧声明)
        </p>
      )}
    </div>
  )
}
