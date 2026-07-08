import { Fragment } from 'react'
import { Link, useParams } from 'react-router'
import { KindBadge } from '@/components/KindBadge'
import { CmdPanel } from '@/components/node/CmdPanel'
import { ContextBrowser } from '@/components/node/ContextBrowser'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ApiError } from '@/lib/api'
import { useHelp, useHelpDsl } from '@/lib/queries'

/**
 * 节点页 = `~help` 的通用渲染器:
 * 描述 + 子节点导航 + 每条 cmd 的表单调用面板;"~help 原文" tab 对等 `tb help <path>`。
 */
export function NodePage() {
  const { '*': splat } = useParams()
  const path = (splat ?? '').replace(/\/+$/, '')
  const help = useHelp(path)

  if (help.isPending) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-8">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="mt-3 h-4 w-96" />
        <Skeleton className="mt-8 h-40 w-full" />
      </div>
    )
  }
  if (help.isError) {
    const err = help.error as ApiError
    return (
      <div className="mx-auto max-w-3xl px-8 py-8">
        <Crumbs path={path} />
        <div className="mt-6 rounded-sm border border-destructive/40 bg-destructive/10 px-4 py-3">
          <p className="font-mono text-xs text-destructive-foreground/90">
            {err.code} · HTTP {err.status}
          </p>
          <p className="mt-1 text-sm">
            {err.status === 404 ? '节点不存在或当前 SK 无权可见(可见性即权限)' : err.message}
          </p>
        </div>
      </div>
    )
  }

  const { node, cmds, children } = help.data
  const isContext = node.kind === 'context'
  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <Crumbs path={path} />
      <header className="mt-2 flex items-center gap-3">
        <h1 className="min-w-0 truncate font-mono text-xl tracking-tight">
          {path === '' ? '/' : path.split('/').pop()}
        </h1>
        <KindBadge kind={node.kind} />
      </header>
      <p className="mt-1.5 text-sm text-muted-foreground">{node.description}</p>

      {/* key=path:切换节点时重置 tab 选择(context 节点默认落「条目」) */}
      <Tabs key={path} defaultValue={isContext ? 'browse' : 'invoke'} className="mt-6">
        <TabsList className="h-8">
          {isContext && (
            <TabsTrigger value="browse" className="px-3 text-xs">
              条目
            </TabsTrigger>
          )}
          <TabsTrigger value="invoke" className="px-3 text-xs">
            调用
          </TabsTrigger>
          <TabsTrigger value="dsl" className="px-3 text-xs">
            ~help 原文
          </TabsTrigger>
        </TabsList>

        {isContext && (
          <TabsContent value="browse" className="mt-4">
            <ContextBrowser path={path} cmds={cmds} />
          </TabsContent>
        )}

        <TabsContent value="invoke" className="mt-4 grid gap-6">
          {children && children.length > 0 && (
            <section>
              <h2 className="mb-2 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
                子节点
              </h2>
              <div className="grid gap-px overflow-hidden rounded-md border">
                {/*
                 * ch.path 对本地节点是树内绝对路径;对 remote 透传节点则是「远端树内路径」
                 * (不含本地挂载前缀,如 remote/djj 下的上游节点回 `tipsy` 而非 `remote/djj/tipsy`)。
                 * 统一以「当前 path + 子节点名(path 末段)」构造本地可导航路径:本地节点下
                 * target 恒等于 ch.path(行为不变),remote 子节点则补回挂载前缀(修 remote 子节点 404)。
                 */}
                {children.map((ch) => {
                  const name = ch.path.split('/').pop() ?? ch.path
                  const target = path === '' ? ch.path : `${path}/${name}`
                  return (
                    <Link
                      key={ch.path}
                      to={`/nodes/${target}`}
                      className="flex items-center gap-2.5 bg-card/60 px-4 py-2.5 hover:bg-secondary/60"
                    >
                      <span className="font-mono text-sm">{name}</span>
                      <KindBadge kind={ch.kind} />
                      <span className="ml-auto truncate pl-4 text-xs text-muted-foreground">
                        {ch.description}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </section>
          )}

          {cmds.length > 0 ? (
            <section className="grid gap-2">
              <h2 className="mb-1 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
                命令 · {cmds.length}
              </h2>
              {cmds.map((cmd) => (
                <CmdPanel
                  key={cmd.name}
                  path={path}
                  cmd={cmd}
                  defaultOpen={cmds.length === 1}
                  // mcp/http 节点级 ~help 是索引形态:展开时懒取工具级 schema
                  lazySchema={node.kind === 'mcp' || node.kind === 'http'}
                />
              ))}
            </section>
          ) : (
            (children?.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">该节点没有可调用的命令。</p>
            )
          )}
        </TabsContent>

        <TabsContent value="dsl" className="mt-4">
          <DslView path={path} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function DslView({ path }: { path: string }) {
  const dsl = useHelpDsl(path)
  if (dsl.isPending) return <Skeleton className="h-40 w-full" />
  if (dsl.isError) return <p className="text-sm text-destructive">{dsl.error.message}</p>
  return (
    <pre className="overflow-auto rounded-md border bg-card/60 px-4 py-3 font-mono text-xs leading-relaxed">
      {dsl.data}
    </pre>
  )
}

function Crumbs({ path }: { path: string }) {
  const segs = path === '' ? [] : path.split('/')
  return (
    <nav aria-label="路径" className="flex flex-wrap items-center gap-1 font-mono text-xs">
      <Link to="/" className="text-muted-foreground hover:text-foreground">
        ~
      </Link>
      {segs.map((seg, i) => {
        const prefix = segs.slice(0, i + 1).join('/')
        return (
          <Fragment key={prefix}>
            <span className="text-muted-foreground/50">/</span>
            {i === segs.length - 1 ? (
              <span className="text-primary">{seg}</span>
            ) : (
              <Link to={`/nodes/${prefix}`} className="text-muted-foreground hover:text-foreground">
                {seg}
              </Link>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}
