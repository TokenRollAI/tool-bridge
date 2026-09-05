import { ChevronRight, Search, TerminalSquare, TriangleAlert } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { useMemo, useState } from 'react'
import type { HelpCmd } from '@/lib/types'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { safeToolReturnPath, toolHref } from '@/lib/toolNavigation'
import { CmdPanel } from '@/components/node/CmdPanel'
import { cn } from '@/lib/utils'

/**
 * 命令目录打开独立调用页；旧 ?tool 深链接继续在 Inspector 内自动打开弹窗。
 */
export function CommandWorkspace({
  path,
  cmds,
  lazySchema,
  initialTool,
}: {
  cmds: HelpCmd[]
  initialTool?: string
  lazySchema: boolean
  path: string
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  // 点击命令即在弹窗里打开调用编辑器(而不是再挤一个侧栏列)。null = 关闭。
  const [openTool, setOpenTool] = useState<string | null>(
    () => (cmds.some(cmd => cmd.name === initialTool) ? initialTool ?? null : null),
  )

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return cmds
    return cmds.filter(cmd =>
      `${cmd.name} ${cmd.h ?? ''} ${cmd.scope} ${cmd.effect ?? ''}`.toLowerCase().includes(needle),
    )
  }, [cmds, query])

  const active = openTool ? cmds.find(cmd => cmd.name === openTool) : undefined

  return (
    <section
      aria-label="命令工作区"
      className="min-w-0 overflow-hidden rounded-xl border bg-card/45"
    >
      <div className="border-b px-3.5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg border bg-background/70 text-primary">
            <TerminalSquare className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-medium">命令目录</h2>
            <p className="text-xs text-muted-foreground">
              {cmds.length}
              {' '}
              个命令
            </p>
          </div>
        </div>
        {cmds.length > 5 && (
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              aria-label="筛选命令"
              className={cn(
                'h-9 w-full rounded-lg border bg-background/60 pr-8 pl-8 font-mono text-xs',
                'placeholder:text-muted-foreground/65 focus:border-primary/55 focus:ring-2 focus:ring-ring/35 focus:outline-none',
              )}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setQuery('')
              }}
              placeholder="筛选命令…"
              value={query}
            />
            {query && (
              <span className="absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
                {visible.length}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="p-2">
        {visible.length === 0
          ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                没有匹配的命令
              </div>
            )
          : (
              visible.map(cmd => (
                <button
                  className={cn(
                    'group mb-1 flex w-full min-w-0 items-start gap-2.5 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors',
                    'text-foreground/85 hover:border-border hover:bg-secondary/55 hover:text-foreground',
                    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  )}
                  key={cmd.name}
                  onClick={() => navigate(toolHref(path, cmd.name), {
                    state: { from: safeToolReturnPath(`${location.pathname}${location.search}`) },
                  })}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                        {cmd.name}
                      </span>
                      <span className="shrink-0 rounded-md border bg-muted/35 px-2 py-0.5 text-xs text-muted-foreground">
                        {cmd.scope}
                      </span>
                    </span>
                    {cmd.h && (
                      <span className="mt-1.5 line-clamp-2 block pr-1 text-sm leading-5 text-muted-foreground">
                        {cmd.h}
                      </span>
                    )}
                    {(cmd.effect || cmd.confirm) && (
                      <span className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        {cmd.effect === 'destructive' && <TriangleAlert className="size-3.5 text-warn" />}
                        {[cmd.effect, cmd.confirm ? 'confirm' : undefined]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
                </button>
              ))
            )}
      </div>

      <Dialog onOpenChange={open => !open && setOpenTool(null)} open={active != null}>
        <DialogContent
          className="flex max-h-[85svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        >
          {active && (
            <>
              <DialogTitle className="sr-only">
                调用
                {' '}
                {active.name}
              </DialogTitle>
              <div className="flex min-h-0 flex-1 flex-col px-5 pt-5 pb-2">
                <CmdPanel
                  cmd={active}
                  key={`${path}:${active.name}`}
                  lazySchema={lazySchema}
                  path={path}
                  variant="dialog"
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
