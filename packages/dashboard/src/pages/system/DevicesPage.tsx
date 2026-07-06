import { ExternalLink, TerminalSquare } from 'lucide-react'
import { Link } from 'react-router'
import { KindBadge, OnlineDot } from '@/components/KindBadge'
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
import { useRegistryList } from '@/lib/queries'

/**
 * 设备列表(对等 `tb device ls`)。`tb connect` / `tb mount fs` 是设备侧长驻 WS 进程,
 * 属三入口对等的天然例外——Dashboard 负责展示与引导,不承担设备接入本身。
 */
export function DevicesPage() {
  const list = useRegistryList('device')
  const devices = (list.data?.items ?? []).filter(
    (n) => n.kind === 'directory' && n.online !== undefined,
  )

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="font-mono text-xl tracking-tight">设备</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        反向注册接入的机器(Case 3);断线节点保留并标记 offline,调用返回 503 retryable
      </p>

      <div className="mt-6 overflow-hidden rounded-md border">
        {list.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/6" />
          </div>
        ) : list.isError ? (
          <p className="p-4 text-sm text-destructive">{list.error.message}</p>
        ) : devices.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            <p className="flex items-center gap-2">
              <TerminalSquare className="size-4" />
              还没有设备接入。在目标机器上执行:
            </p>
            <pre className="mt-3 rounded-sm border bg-card px-3 py-2 font-mono text-xs">
              tb connect {window.location.origin}
            </pre>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>path</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>描述</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((d) => (
                <TableRow key={d.path}>
                  <TableCell className="font-mono text-xs">{d.path}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 font-mono text-xs">
                      <OnlineDot online={d.online} />
                      {d.online ? 'online' : 'offline'}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                    {d.description}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon-xs" asChild aria-label="查看节点">
                      <Link to={`/nodes/${d.path}`}>
                        <ExternalLink />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {devices.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          <KindBadge kind="device" className="mr-1.5" />
          子节点 shell/fs 可在树导航中直接调用(shell 默认白名单全拒,须设备侧声明)
        </p>
      )}
    </div>
  )
}
