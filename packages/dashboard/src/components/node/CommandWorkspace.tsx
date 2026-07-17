import { Loader2, Search, TerminalSquare, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { HelpCmd } from '@/lib/types'
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
}: {
  cmds: HelpCmd[]
  lazySchema: boolean
  path: string
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(() => cmds[0]?.name ?? '')
  const [invocationPending, setInvocationPending] = useState(false)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const busyStatusId = useId()

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return cmds
    return cmds.filter(cmd =>
      `${cmd.name} ${cmd.h ?? ''} ${cmd.scope} ${cmd.effect ?? ''}`.toLowerCase().includes(needle),
    )
  }, [cmds, query])

  useEffect(() => {
    if (invocationPending || visible.length === 0) return
    if (!visible.some(cmd => cmd.name === selected)) setSelected(visible[0]!.name)
  }, [invocationPending, selected, visible])

  const active = cmds.find(cmd => cmd.name === selected) ?? cmds[0]

  const moveSelection = (current: string, delta: number) => {
    if (invocationPending) return
    const index = visible.findIndex(cmd => cmd.name === current)
    if (index < 0 || visible.length === 0) return
    const next = visible[(index + delta + visible.length) % visible.length]!
    setSelected(next.name)
    requestAnimationFrame(() => itemRefs.current.get(next.name)?.focus())
  }

  return (
    <section
      aria-label="命令工作区"
      className="grid min-w-0 gap-3 xl:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)]"
    >
      <aside className="min-w-0 overflow-hidden rounded-xl border bg-card/45 xl:sticky xl:top-0 xl:max-h-[calc(100svh-8rem)] xl:self-start">
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
                aria-describedby={invocationPending ? busyStatusId : undefined}
                aria-label="筛选命令"
                className={cn(
                  'h-9 w-full rounded-lg border bg-background/60 pr-8 pl-8 font-mono text-xs',
                  'placeholder:text-muted-foreground/65 focus:border-primary/55 focus:ring-2 focus:ring-ring/35 focus:outline-none',
                  'disabled:cursor-not-allowed disabled:opacity-55',
                )}
                disabled={invocationPending}
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
          {invocationPending && (
            <div
              aria-live="polite"
              className="mt-3 flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/[0.06] px-2.5 py-2 text-[11px] leading-4 text-muted-foreground"
              id={busyStatusId}
              role="status"
            >
              <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin text-primary" />
              <span>
                正在执行
                {' '}
                <span className="font-mono text-foreground">{active?.name}</span>
                ，完成后可切换命令。
              </span>
            </div>
          )}
        </div>

        <div
          aria-busy={invocationPending}
          aria-describedby={invocationPending ? busyStatusId : undefined}
          aria-label="选择命令"
          className="max-h-[22rem] overflow-y-auto p-2 xl:max-h-[calc(100svh-15rem)]"
          role="listbox"
        >
          {visible.length === 0
            ? (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                  没有匹配的命令
                </div>
              )
            : (
                visible.map((cmd) => {
                  const isActive = cmd.name === active?.name
                  return (
                    <button
                      aria-disabled={invocationPending && !isActive}
                      aria-selected={isActive}
                      className={cn(
                        'group relative mb-1 flex w-full min-w-0 flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors',
                        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        isActive
                          ? 'border-primary/35 bg-primary/[0.08] text-foreground shadow-[inset_3px_0_0_var(--primary)]'
                          : 'border-transparent text-foreground/78 hover:border-border hover:bg-secondary/55 hover:text-foreground',
                        invocationPending
                        && !isActive
                        && 'cursor-not-allowed opacity-45 hover:border-transparent hover:bg-transparent hover:text-foreground/78',
                      )}
                      key={cmd.name}
                      onClick={() => {
                        if (!invocationPending) setSelected(cmd.name)
                      }}
                      onKeyDown={(event) => {
                        if (
                          invocationPending
                          && (event.key === 'ArrowDown' || event.key === 'ArrowUp')
                        ) {
                          event.preventDefault()
                          return
                        }
                        if (event.key === 'ArrowDown') {
                          event.preventDefault()
                          moveSelection(cmd.name, 1)
                        }
                        if (event.key === 'ArrowUp') {
                          event.preventDefault()
                          moveSelection(cmd.name, -1)
                        }
                      }}
                      ref={(element) => {
                        if (element) itemRefs.current.set(cmd.name, element)
                        else itemRefs.current.delete(cmd.name)
                      }}
                      role="option"
                      title={
                        invocationPending && !isActive
                          ? `正在执行 ${active?.name ?? '当前命令'}，完成后可切换`
                          : undefined
                      }
                      type="button"
                    >
                      <span className="flex w-full min-w-0 items-center gap-2">
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
                        <span className="line-clamp-2 pr-1 text-[11px] leading-4 text-muted-foreground">
                          {cmd.h}
                        </span>
                      )}
                      {(cmd.effect || cmd.confirm) && (
                        <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[9px] text-warn">
                          {cmd.effect === 'destructive' && <TriangleAlert className="size-2.5" />}
                          {[cmd.effect, cmd.confirm ? 'confirm' : undefined]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </button>
                  )
                })
              )}
        </div>
      </aside>

      <div aria-busy={invocationPending} className="min-w-0">
        {active && (
          <CmdPanel
            cmd={active}
            defaultOpen
            key={`${path}:${active.name}`}
            lazySchema={lazySchema}
            onPendingChange={setInvocationPending}
            path={path}
            variant="workbench"
          />
        )}
      </div>
    </section>
  )
}
