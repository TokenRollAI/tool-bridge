import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import { ArrowLeft, ArrowUpRight, TerminalSquare } from 'lucide-react'
import { CommandWorkspace } from '@/components/node/CommandWorkspace'
import { FavoriteToolButton } from '@/components/FavoriteToolButton'
import { decodeTreePath, encodeTreePath } from '@/lib/path'
import { safeToolReturnPath } from '@/lib/toolNavigation'
import { CmdPanel } from '@/components/node/CmdPanel'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/lib/session-context'
import { Button } from '@/components/ui/button'
import { useHelp } from '@/lib/queries'

/** 独立调用页只持有定位信息；表单、确认与执行继续由 CmdPanel 单点负责。 */
export function ToolPage() {
  const { '*': splat = '' } = useParams()
  const [params] = useSearchParams()
  const location = useLocation()
  const { active, revision } = useSession()
  const path = decodeTreePath(splat).replace(/\/+$/, '')
  const tool = params.get('tool')
  const help = useHelp(path)
  const command = help.data?.cmds.find(cmd => cmd.name === tool)
  const from = safeToolReturnPath((location.state as { from?: unknown } | null)?.from)
  const returnLabel = from.startsWith('/search')
    ? '返回搜索结果'
    : from === '/' ? '返回工作台' : from.startsWith('/nodes/') || from === '/canvas' ? '返回能力树' : from.startsWith('/manage/devices') ? '返回设备' : '返回工具列表'

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 lg:px-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Button asChild size="sm" variant="ghost">
          <Link to={from}>
            <ArrowLeft />
            {returnLabel}
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to={`/nodes/${encodeTreePath(path)}`}>
            <ArrowUpRight />
            查看所属节点
          </Link>
        </Button>
      </div>
      <header className="mb-7 flex min-w-0 items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl border bg-card text-primary"><TerminalSquare className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">工具调用</p>
          <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight">{tool || '选择一个命令'}</h1>
          <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
            /
            {path}
          </p>
        </div>
        {command && <FavoriteToolButton path={path} tool={command.name} />}
      </header>
      {help.isPending
        ? (
            <div aria-label="正在加载工具" className="grid gap-5 lg:grid-cols-2">
              <Skeleton className="h-96" />
              <Skeleton className="h-96" />
            </div>
          )
        : help.isError
          ? (
              <EmptyState
                action={<Button onClick={() => void help.refetch()} variant="outline">重新加载</Button>}
                icon={TerminalSquare}
                title="暂时无法打开工具"
                tone="danger"
              >
                工具可能已移除、当前连接没有访问权限，或网关暂时不可用。请检查当前连接后重试。
              </EmptyState>
            )
          : tool && !command
            ? <EmptyState icon={TerminalSquare} title="此命令已不可用">该工具的命令或访问权限已改变，请返回工具列表重新选择。</EmptyState>
            : command
              ? (
                  <CmdPanel
                    cmd={command}
                    key={`${active?.id}:${active?.baseUrl}:${revision}:${path}:${command.name}`}
                    lazySchema={help.data?.node.kind === 'mcp' || help.data?.node.kind === 'http'}
                    path={path}
                    variant="page"
                  />
                )
              : <CommandWorkspace cmds={help.data?.cmds ?? []} lazySchema={false} path={path} />}
    </div>
  )
}
