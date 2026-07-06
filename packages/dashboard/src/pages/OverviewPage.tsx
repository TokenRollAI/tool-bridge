import { Activity, Boxes, KeySquare, TerminalSquare } from 'lucide-react'
import { Link } from 'react-router'
import { KindBadge } from '@/components/KindBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { useStatus, useTree } from '@/lib/queries'
import { useSession } from '@/lib/session'

/** 首页:健康摘要 + 根级子树入口(对等 tb status / tb ls)。 */
export function OverviewPage() {
  const status = useStatus()
  const tree = useTree('', 2)
  const { active } = useSession()

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="mb-1 h-px w-10 bg-primary" />
      <h1 className="font-mono text-xl tracking-tight">控制台</h1>
      <p className="mt-1 font-mono text-xs text-muted-foreground">
        {active?.baseUrl || window.location.origin}
      </p>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <StatCard
          icon={<Activity className="size-3.5" />}
          label="状态"
          value={status.isError ? 'unreachable' : status.data?.healthy ? 'operational' : '…'}
          tone={status.isError ? 'bad' : 'ok'}
          pending={status.isPending}
        />
        <StatCard
          icon={<TerminalSquare className="size-3.5" />}
          label="版本"
          value={status.data ? `v${status.data.version}` : '…'}
          pending={status.isPending}
        />
        <StatCard
          icon={<Boxes className="size-3.5" />}
          label="节点数"
          value={status.data ? String(status.data.nodeCount) : '…'}
          pending={status.isPending}
        />
      </div>

      <section className="mt-8">
        <h2 className="mb-2 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
          根级子树
        </h2>
        {tree.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : tree.isError ? (
          <p className="text-sm text-destructive">{tree.error.message}</p>
        ) : (tree.data.children?.length ?? 0) === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground">
            树是空的。去「
            <Link to="/manage/registry" className="text-primary hover:underline">
              节点注册
            </Link>
            」挂载第一个工具或 context,或用 CLI:
            <code className="ml-1 font-mono text-xs">tb tool mount / tb ctx mount</code>
          </div>
        ) : (
          <div className="grid gap-px overflow-hidden rounded-md border">
            {(tree.data.children ?? []).map((ch) => (
              <Link
                key={ch.path}
                to={`/nodes/${ch.path}`}
                className="flex items-center gap-2.5 bg-card/60 px-4 py-2.5 hover:bg-secondary/60"
              >
                <span className="font-mono text-sm">{ch.path}</span>
                <KindBadge kind={ch.kind} />
                <span className="ml-auto truncate pl-4 text-xs text-muted-foreground">
                  {ch.description}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8 grid grid-cols-2 gap-3">
        <Link
          to="/manage/registry"
          className="group rounded-md border bg-card/60 px-4 py-3 hover:border-primary/40"
        >
          <Boxes className="size-4 text-muted-foreground group-hover:text-primary" />
          <p className="mt-2 text-sm">节点注册</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            挂载 mcp/http 工具、context、联邦服务
          </p>
        </Link>
        <Link
          to="/manage/sk"
          className="group rounded-md border bg-card/60 px-4 py-3 hover:border-primary/40"
        >
          <KeySquare className="size-4 text-muted-foreground group-hover:text-primary" />
          <p className="mt-2 text-sm">Secret Key</p>
          <p className="mt-0.5 text-xs text-muted-foreground">签发、限定 scope、吊销</p>
        </Link>
      </section>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  tone,
  pending,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone?: 'ok' | 'bad'
  pending?: boolean
}) {
  return (
    <div className="rounded-md border bg-card/60 px-4 py-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[10px] tracking-widest uppercase">{label}</span>
      </div>
      {pending ? (
        <Skeleton className="mt-2 h-5 w-16" />
      ) : (
        <p
          className={`mt-1.5 font-mono text-sm ${
            tone === 'bad' ? 'text-destructive' : tone === 'ok' ? 'text-ok' : ''
          }`}
        >
          {value}
        </p>
      )}
    </div>
  )
}
