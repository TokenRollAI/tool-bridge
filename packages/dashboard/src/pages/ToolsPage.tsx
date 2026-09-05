import { ArrowRight, Blocks, ChevronRight, Folder, GitBranch, Search } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { type FormEvent, useState } from 'react'
import { CommandWorkspace } from '@/components/node/CommandWorkspace'
import { AddToolWizard } from '@/components/add-tool/AddToolWizard'
import { PresenceBadge } from '@/components/PresenceBadge'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { KIND_ICON } from '@/components/kind-icon'
import { useHelp, useTree } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { encodeTreePath } from '@/lib/path'

/** 列表浏览与画布消费同一可见树，按当前目录加载一层，不预拉远端全部命令。 */
export function ToolsPage() {
  const [params] = useSearchParams()
  const path = (params.get('path') ?? '').replace(/^\/+|\/+$/g, '')
  const tree = useTree(path, 1)
  const help = useHelp(path)
  const navigate = useNavigate()
  const [draft, setDraft] = useState('')
  const parts = path.split('/').filter(Boolean)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (draft.trim()) navigate(`/search?q=${encodeURIComponent(draft.trim())}`)
  }

  return (
    <div className="workspace-page">
      <PageHeader
        actions={(
          <Button asChild variant="outline">
            <Link to={path ? `/nodes/${encodeTreePath(path)}` : '/canvas'}>
              <GitBranch />
              在能力树中查看
            </Link>
          </Button>
        )}
        description="按连接浏览可见能力，或搜索命令直接开始使用。"
        title="工具"
      />
      <form className="mt-6 flex gap-2" onSubmit={submit}>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
          <Input aria-label="搜索工具命令" className="h-10 pl-10" maxLength={1024} onChange={event => setDraft(event.target.value)} placeholder="搜索工具名称或描述…" value={draft} />
        </div>
        <Button disabled={!draft.trim()} type="submit">搜索</Button>
      </form>
      <nav aria-label="工具目录路径" className="mt-7 mb-5 flex flex-wrap items-center gap-1.5 text-sm">
        <Link className="rounded px-1 py-1 text-muted-foreground hover:text-foreground" to="/tools">全部连接</Link>
        {parts.map((part, index) => (
          <span className="flex min-w-0 items-center gap-1.5" key={index}>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            <Link className="break-all" to={`/tools?path=${encodeURIComponent(parts.slice(0, index + 1).join('/'))}`}>{part}</Link>
          </span>
        ))}
      </nav>
      {tree.isPending
        ? (
            <div aria-label="正在加载工具连接" className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          )
        : tree.isError
          ? <EmptyState action={<Button onClick={() => void tree.refetch()} size="sm" variant="outline">重新加载</Button>} icon={Blocks} title="暂时无法读取连接" tone="danger">连接可能已移除、当前档案没有访问权限，或网关暂时不可用。</EmptyState>
          : (
              <>
                {tree.data?.description && <p className="mb-5 text-sm text-muted-foreground">{tree.data.description}</p>}
                {(tree.data?.children ?? []).length > 0 && (
                  <section aria-label="工具连接" className="mb-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {tree.data?.children?.map((node) => {
                      const { icon: Icon } = KIND_ICON[node.kind] ?? KIND_ICON.directory
                      return (
                        <Link className="flex min-w-0 items-start gap-3 rounded-xl border bg-card p-4 hover:border-input focus-visible:ring-2 focus-visible:ring-ring" key={node.path} to={`/tools?path=${encodeURIComponent(node.path)}`}>
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary/60"><Icon className="size-4 text-muted-foreground" /></span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{node.path.split('/').at(-1) || '/'}</p>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{node.description || '打开查看可用工具'}</p>
                            {node.presence && <div className="mt-2"><PresenceBadge state={node.presence.state} /></div>}
                          </div>
                          <ArrowRight className="mt-2 size-4 shrink-0 text-muted-foreground" />
                        </Link>
                      )
                    })}
                  </section>
                )}
              </>
            )}
      {help.isPending ? <Skeleton aria-label="正在读取命令目录" className="mt-5 h-32" /> : help.isError ? <EmptyState action={<Button onClick={() => void help.refetch()} size="sm" variant="outline">重新读取命令</Button>} icon={Blocks} title="命令目录暂不可用" tone="danger">请检查连接或访问权限后重试。</EmptyState> : (help.data?.cmds.length ?? 0) > 0 ? <CommandWorkspace cmds={help.data?.cmds ?? []} key={path} lazySchema={help.data?.node.kind === 'mcp' || help.data?.node.kind === 'http'} path={path} /> : !tree.isPending && !tree.isError && (tree.data?.children?.length ?? 0) === 0 ? <EmptyState action={<AddToolWizard />} icon={Folder} title="这里还没有可见工具">添加一个工具连接，或切换到有访问权限的连接档案。</EmptyState> : null}
    </div>
  )
}
