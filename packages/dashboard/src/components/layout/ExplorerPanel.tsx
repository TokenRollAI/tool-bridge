import { ChevronsUpDown, ListFilter, LogOut, Moon, RefreshCw, Sun, X } from 'lucide-react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TreeNav } from '@/components/layout/TreeNav'
import { useSession } from '@/lib/session-context'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { MANAGE_LINKS } from './navigation'

interface ExplorerPanelProps {
  health?: { healthy: boolean, version: string }
  healthError: boolean
  mobile?: boolean
  nodeCount?: number
  nodeCountRestricted: boolean
  onClose?: () => void
}

function nodePathFromLocation(pathname: string): string | null {
  if (pathname === '/') return ''
  if (!pathname.startsWith('/nodes/')) return null
  const encoded = pathname.slice('/nodes/'.length).replace(/\/+$/, '')
  try {
    return decodeURIComponent(encoded)
  } catch {
    return encoded
  }
}

function MobileAccountFooter({ onClose }: { onClose?: () => void }) {
  const { active, profiles, switchTo, logout } = useSession()
  const [theme, toggleTheme] = useTheme()
  const navigate = useNavigate()

  const switchProfile = (name: string) => {
    switchTo(name)
    navigate('/')
    onClose?.()
  }

  return (
    <footer className="flex shrink-0 items-center gap-1 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className="min-w-0 flex-1 justify-start font-mono text-xs"
            size="sm"
            variant="ghost"
          >
            <span className="truncate">{active?.name}</span>
            <ChevronsUpDown className="ml-auto size-3 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="font-mono text-[10px] break-all text-muted-foreground">
            {active?.baseUrl || window.location.origin}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {profiles.map(profile => (
            <DropdownMenuItem
              className="font-mono text-xs"
              key={profile.id}
              onClick={() => switchProfile(profile.name)}
            >
              {profile.name}
              {profile.id === active?.id && <span className="ml-auto text-primary">●</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button aria-label="切换主题" onClick={toggleTheme} size="icon-sm" variant="ghost">
        {theme === 'dark' ? <Sun /> : <Moon />}
      </Button>
      <Button
        aria-label="退出登录"
        onClick={() => {
          onClose?.()
          logout()
        }}
        size="icon-sm"
        variant="ghost"
      >
        <LogOut />
      </Button>
    </footer>
  )
}

/** 资源浏览器：树是唯一主任务；移动端通过显式分段切到管理入口。 */
export function ExplorerPanel({
  health,
  healthError,
  nodeCount,
  nodeCountRestricted,
  mobile = false,
  onClose,
}: ExplorerPanelProps) {
  const [filter, setFilter] = useState('')
  const [mobileMode, setMobileMode] = useState<'resources' | 'manage'>('resources')
  const location = useLocation()
  const qc = useQueryClient()
  const currentPath = nodePathFromLocation(location.pathname)
  const healthLabel = healthError
    ? 'unreachable'
    : health?.healthy
      ? 'operational'
      : health
        ? 'degraded'
        : 'checking…'

  return (
    <div className="app-explorer flex min-h-0 w-full flex-1 flex-col">
      <header className="shrink-0 border-b px-3.5 pt-3 pb-3">
        <div className="flex min-w-0 items-start gap-2">
          {mobile && (
            <NavLink className="mt-0.5 shrink-0" onClick={onClose} to="/">
              <img alt="" className="size-6 dark:invert" src="/ui/icon-light.png" />
            </NavLink>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-mono text-[11px] font-medium tracking-[0.14em] uppercase">
                Resource Explorer
              </h2>
              {health?.version && (
                <span className="font-mono text-[9px] text-muted-foreground">
                  gateway v
                  {health.version}
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  healthError
                    ? 'bg-destructive'
                    : health?.healthy
                      ? 'bg-ok shadow-[0_0_6px_var(--ok)]'
                      : 'bg-warn',
                )}
              />
              <span>{healthLabel}</span>
              {nodeCount !== undefined
                ? (
                    <span className="ml-auto font-mono tabular-nums">
                      {nodeCount}
                      {' '}
                      nodes
                    </span>
                  )
                : (
                    nodeCountRestricted && <span className="ml-auto font-mono">受限</span>
                  )}
            </div>
          </div>
          {mobile && (
            <Button aria-label="关闭导航" onClick={onClose} size="icon-sm" variant="ghost">
              <X />
            </Button>
          )}
        </div>

        {mobile && (
          <div className="mt-3 grid grid-cols-2 rounded-md bg-background/55 p-1" role="tablist">
            <button
              aria-selected={mobileMode === 'resources'}
              className={cn(
                'h-8 rounded-sm text-xs font-medium',
                mobileMode === 'resources'
                  ? 'bg-secondary text-foreground shadow-sm'
                  : 'text-muted-foreground',
              )}
              onClick={() => setMobileMode('resources')}
              role="tab"
              type="button"
            >
              资源树
            </button>
            <button
              aria-selected={mobileMode === 'manage'}
              className={cn(
                'h-8 rounded-sm text-xs font-medium',
                mobileMode === 'manage'
                  ? 'bg-secondary text-foreground shadow-sm'
                  : 'text-muted-foreground',
              )}
              onClick={() => setMobileMode('manage')}
              role="tab"
              type="button"
            >
              管理
            </button>
          </div>
        )}
      </header>

      {(!mobile || mobileMode === 'resources') && (
        <>
          <div className="shrink-0 border-b px-3 py-2.5">
            <p className="mb-1 font-mono text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
              Current path
            </p>
            <div
              className="flex min-h-8 min-w-0 items-center rounded-md border bg-background/45 px-2.5"
              title={currentPath === null ? '当前位于管理页面' : currentPath || '~'}
            >
              <span className="mr-1.5 font-mono text-xs text-primary">~</span>
              <span className="min-w-0 truncate font-mono text-[11px] text-foreground/90">
                {currentPath === null ? '管理控制面' : currentPath ? `/ ${currentPath}` : '/'}
              </span>
            </div>
          </div>

          <div className="shrink-0 px-3 pt-2.5 pb-2">
            <div className="mb-1.5 flex items-center gap-2">
              <p className="font-mono text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
                Resources
              </p>
              <button
                aria-label="刷新资源树"
                className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => qc.invalidateQueries({ queryKey: ['tb'] })}
                title="刷新资源树"
                type="button"
              >
                <RefreshCw className="size-3.5" />
              </button>
            </div>
            <div className="relative">
              <ListFilter className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
              <input
                aria-label="筛选资源树"
                className={cn(
                  'h-9 w-full rounded-md border bg-background/45 pr-8 pl-8 font-mono text-xs',
                  'placeholder:text-muted-foreground/65 focus:border-primary/50 focus:ring-2 focus:ring-ring/35 focus:outline-none',
                )}
                onChange={event => setFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && filter !== '') {
                    event.preventDefault()
                    setFilter('')
                  }
                }}
                placeholder="筛选资源路径…"
                value={filter}
              />
              {filter !== '' && (
                <button
                  aria-label="清除筛选"
                  className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => setFilter('')}
                  type="button"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1 px-1 pb-2">
            <TreeNav filter={filter} onNavigate={onClose} />
          </ScrollArea>
        </>
      )}

      {mobile && mobileMode === 'manage' && (
        <ScrollArea className="min-h-0 flex-1 p-3">
          <nav aria-label="管理入口" className="grid gap-2">
            {MANAGE_LINKS.map(({ to, label, shortLabel, icon: Icon }) => (
              <NavLink
                className={({ isActive }) =>
                  cn(
                    'flex min-h-12 items-center gap-3 rounded-lg border px-3 text-sm',
                    'hover:border-primary/30 hover:bg-secondary/65 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    isActive
                      ? 'border-primary/35 bg-primary/10 text-primary'
                      : 'bg-background/35 text-foreground/90',
                  )}
                key={to}
                onClick={onClose}
                to={to}
              >
                <span className="grid size-8 place-items-center rounded-md bg-secondary">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">{label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{shortLabel}</span>
              </NavLink>
            ))}
          </nav>
        </ScrollArea>
      )}

      {mobile && <MobileAccountFooter onClose={onClose} />}
    </div>
  )
}
