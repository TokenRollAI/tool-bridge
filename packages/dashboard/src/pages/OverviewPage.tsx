import {
  Activity,
  Boxes,
  Cpu,
  History,
  KeySquare,
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
import { clearHistory } from '@/lib/history'
import { useHistory, useStatus, useTree } from '@/lib/queries'
import { useSession } from '@/lib/session'
import type { NodeKind, TreeJson } from '@/lib/types'
import { cn } from '@/lib/utils'

const QUICK_LINKS = [
  {
    to: '/manage/registry',
    label: '节点注册',
    desc: '挂载 mcp/http 工具、context、联邦服务',
    icon: Boxes,
  },
  { to: '/manage/sk', label: 'Secret Key', desc: '签发、限定 scope、吊销', icon: KeySquare },
  {
    to: '/manage/secrets',
    label: '凭证保管',
    desc: '上游凭证只写不读,authRef 引用',
    icon: ShieldEllipsis,
  },
  { to: '/manage/devices', label: '设备', desc: '反向注册的机器与离线清理', icon: Cpu },
] as const

function countKinds(
  node: TreeJson,
  acc: Map<NodeKind, number>,
  devices: { on: number; off: number },
) {
  if (node.path !== '') {
    acc.set(node.kind, (acc.get(node.kind) ?? 0) + 1)
    if (node.kind === 'device' || (node.online !== undefined && node.path.startsWith('device/'))) {
      if (node.online) devices.on += 1
      else devices.off += 1
    }
  }
  for (const c of node.children ?? []) countKinds(c, acc, devices)
}

function relTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  if (Number.isNaN(diff)) return iso
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(iso).toLocaleDateString()
}

/** 首页:健康摘要 + kind 分布 + 根级子树 + 最近调用 + 管理入口(对等 tb status / tb ls)。 */
export function OverviewPage() {
  const status = useStatus()
  const tree = useTree('', 8)
  const { active } = useSession()
  const history = useHistory()

  const kinds = new Map<NodeKind, number>()
  const devices = { on: 0, off: 0 }
  if (tree.data) countKinds(tree.data, kinds, devices)
  const kindOrder: NodeKind[] = ['builtin', 'mcp', 'http', 'context', 'device', 'remote']

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <PageHeader
        title="控制台"
        description={
          <span className="font-mono text-xs">{active?.baseUrl || window.location.origin}</span>
        }
      />

      <div className="mt-6 grid grid-cols-4 gap-3">
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
        <StatCard
          icon={<Cpu className="size-3.5" />}
          label="设备在线"
          value={
            tree.data
              ? `${devices.on}${devices.off > 0 ? ` / ${devices.on + devices.off}` : ''}`
              : '…'
          }
          pending={tree.isPending}
        />
      </div>

      {kinds.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {kindOrder
            .filter((k) => (kinds.get(k) ?? 0) > 0)
            .map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <KindBadge kind={k} />
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {kinds.get(k)}
                </span>
              </span>
            ))}
        </div>
      )}

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

      <section className="mt-8">
        <div className="mb-2 flex items-center">
          <h2 className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
            最近调用
          </h2>
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="清空历史"
              title="清空历史"
              className="ml-auto text-muted-foreground"
              onClick={() => clearHistory(active?.name ?? '')}
            >
              <Trash2 />
            </Button>
          )}
        </div>
        {history.length === 0 ? (
          <EmptyState icon={History} title="还没有调用记录">
            <p>在任意节点的「调用」面板发起第一次调用,记录会出现在这里(仅存本机)。</p>
          </EmptyState>
        ) : (
          <div className="grid gap-px overflow-hidden rounded-md border">
            {history.slice(0, 8).map((r) => (
              <Link
                key={`${r.at}:${r.path}:${r.tool}`}
                to={`/nodes/${r.path}`}
                className="flex items-center gap-2 bg-card/60 px-4 py-2 hover:bg-secondary/60"
              >
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    r.ok ? 'bg-ok' : 'bg-destructive',
                  )}
                  title={r.ok ? 'ok' : (r.code ?? 'error')}
                />
                <span className="truncate font-mono text-xs">
                  {r.path}
                  <span className="text-muted-foreground"> · {r.tool}</span>
                </span>
                {!r.ok && <span className="font-mono text-[10px] text-destructive">{r.code}</span>}
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                  {r.ok ? `${r.ms} ms · ` : ''}
                  {relTime(r.at)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8 grid grid-cols-2 gap-3">
        {QUICK_LINKS.map(({ to, label, desc, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="group rounded-md border bg-card/60 px-4 py-3 hover:border-primary/40"
          >
            <Icon className="size-4 text-muted-foreground group-hover:text-primary" />
            <p className="mt-2 text-sm">{label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
          </Link>
        ))}
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
          className={`mt-1.5 font-mono text-sm tabular-nums ${
            tone === 'bad' ? 'text-destructive' : tone === 'ok' ? 'text-ok' : ''
          }`}
        >
          {value}
        </p>
      )}
    </div>
  )
}
