import { ChevronRight, Search, TerminalSquare, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { HelpCmd } from '@/lib/types'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { CmdPanel } from '@/components/node/CmdPanel'
import { cn } from '@/lib/utils'

const SCOPE_STYLE: Record<string, string> = {
  read: 'border-sky-400/25 bg-sky-400/8 text-sky-400',
  write: 'border-amber-400/25 bg-amber-400/8 text-amber-400',
  call: 'border-emerald-400/25 bg-emerald-400/8 text-emerald-400',
  register: 'border-violet-400/25 bg-violet-400/8 text-violet-400',
  admin: 'border-rose-400/25 bg-rose-400/8 text-rose-400',
}

/**
 * 节点调用工作区:左侧选择/筛选命令,右侧只挂载当前命令的编辑器。
 * 切换命令会 remount CmdPanel,避免参数、返回值或 mutation 状态跨工具残留。
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
            <p className="font-mono text-[10px] text-muted-foreground">
              {cmds.length}
              {' '}
              COMMANDS
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
              <span className="absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-[10px] text-muted-foreground">
                {visible.length}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="max-h-[26rem] overflow-y-auto p-2">
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
                  onClick={() => setOpenTool(cmd.name)}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                        {cmd.name}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-md border px-1.5 font-mono text-[9px] leading-4 uppercase',
                          SCOPE_STYLE[cmd.scope] ?? SCOPE_STYLE.read,
                        )}
                      >
                        {cmd.scope}
                      </span>
                    </span>
                    {cmd.h && (
                      <span className="mt-1 line-clamp-2 block pr-1 text-[11px] leading-4 text-muted-foreground">
                        {cmd.h}
                      </span>
                    )}
                    {(cmd.effect || cmd.confirm) && (
                      <span className="mt-1 flex items-center gap-1.5 font-mono text-[9px] text-warn">
                        {cmd.effect === 'destructive' && <TriangleAlert className="size-2.5" />}
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
