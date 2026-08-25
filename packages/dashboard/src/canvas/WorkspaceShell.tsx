import { Command, GitBranch, Menu, Moon, Search, Sun } from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { MANAGE_LINKS } from '@/components/layout/navigation'
import { CommandPalette } from '@/components/CommandPalette'
import { useHealthz, useStatus } from '@/lib/queries'
import { useSession } from '@/lib/session-context'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

function healthDot(healthy: boolean | undefined, error: boolean): string {
  if (error) return 'bg-destructive'
  if (healthy) return 'bg-ok shadow-[0_0_7px_var(--ok)]'
  return 'bg-warn'
}

function healthText(healthy: boolean | undefined, error: boolean): string {
  if (error) return '网关不可达'
  if (healthy) return '网关运行正常'
  return '正在检查网关'
}

/** 顶栏:品牌 + 全局搜索/跳转 + 健康 + 主题 + profile。 */
function TopBar({
  onOpenPalette,
  onToggleRail,
}: {
  onOpenPalette: () => void
  onToggleRail: () => void
}) {
  const health = useHealthz()
  const status = useStatus()
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'
  const navigate = useNavigate()
  const { active, profiles, switchTo, logout } = useSession()
  const healthy = health.data?.healthy

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-panel px-3">
      <Button
        aria-label="切换库务导航"
        className="lg:hidden"
        onClick={onToggleRail}
        size="icon-sm"
        variant="ghost"
      >
        <Menu />
      </Button>
      <NavLink className="flex items-center gap-2" to="/">
        <img alt="" className="size-6 dark:invert" src="/ui/icon-light.png" />
        <span className="hidden font-mono text-sm tracking-tight sm:inline">
          tool
          <span className="text-primary">-</span>
          bridge
        </span>
      </NavLink>

      <button
        className={cn(
          'ml-2 hidden h-9 min-w-64 flex-1 items-center gap-2 rounded-lg border bg-background/60 px-3 text-left text-sm text-muted-foreground sm:flex',
          'hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        )}
        onClick={onOpenPalette}
        type="button"
      >
        <Search className="size-4" />
        <span className="flex-1">搜索节点、页面、动作…</span>
        <kbd className="rounded border bg-card px-1.5 font-mono text-[10px]">
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <Button aria-label="工具搜索" asChild size="icon-sm" variant="ghost">
          <NavLink to="/search">
            <Search />
          </NavLink>
        </Button>
        <Button
          aria-label="全局跳转"
          className="sm:hidden"
          onClick={onOpenPalette}
          size="icon-sm"
          variant="ghost"
        >
          <Command />
        </Button>

        <span
          aria-label={healthText(healthy, health.isError)}
          className={cn('mx-1 size-2 shrink-0 rounded-full', healthDot(healthy, health.isError))}
          role="img"
          title={
            health.data?.version
              ? `${healthText(healthy, health.isError)} · v${health.data.version} · ${status.data?.nodeCount ?? '—'} 节点`
              : healthText(healthy, health.isError)
          }
        />

        <Button
          aria-label="切换主题"
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          size="icon-sm"
          variant="ghost"
        >
          {isDark ? <Sun /> : <Moon />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="连接档案"
              className="grid size-8 place-items-center rounded-lg border bg-background/60 font-mono text-[10px] font-medium hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              type="button"
            >
              {(active?.name ?? '--').slice(0, 2).toUpperCase()}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>
              <span className="block text-xs">连接档案</span>
              <span className="mt-0.5 block truncate font-mono text-[10px] font-normal text-muted-foreground">
                {active?.baseUrl || window.location.origin}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {profiles.map(profile => (
              <DropdownMenuItem
                className="font-mono text-xs"
                key={profile.id}
                onClick={() => {
                  switchTo(profile.name)
                  navigate('/')
                }}
              >
                <span className="truncate">{profile.name}</span>
                {profile.id === active?.id && <span className="ml-auto text-primary">●</span>}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} variant="destructive">
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

function RailLink({
  to,
  label,
  icon,
  collapsed,
  exact,
}: {
  collapsed: boolean
  exact?: boolean
  icon: React.ReactNode
  label: string
  to: string
}) {
  const link = (
    <NavLink
      className={({ isActive }) =>
        cn(
          'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-foreground/80 transition-colors',
          'hover:bg-secondary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          isActive && 'bg-primary/12 font-medium text-primary',
          collapsed && 'justify-center px-0',
        )}
      end={exact}
      to={to}
    >
      {icon}
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  )
  if (!collapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** 左侧库务栏:画布入口 + 管理页。桌面常驻(可折叠成图标),移动经抽屉。 */
function ManageRail({ collapsed }: { collapsed: boolean }) {
  return (
    <TooltipProvider delayDuration={200}>
      <nav aria-label="库务导航" className="flex h-full flex-col gap-1 p-2">
        <RailLink collapsed={collapsed} exact icon={<GitBranch className="size-4" />} label="能力树" to="/" />
        <div className="my-1 h-px bg-border/70" />
        <p
          className={cn(
            'px-2 pt-1 pb-0.5 font-mono text-[9px] tracking-[0.16em] text-muted-foreground/70 uppercase',
            collapsed && 'text-center',
          )}
        >
          {collapsed ? '库' : '库务管理'}
        </p>
        {MANAGE_LINKS.map(({ to, label, icon: Icon }) => (
          <RailLink collapsed={collapsed} icon={<Icon className="size-4" />} key={to} label={label} to={to} />
        ))}
      </nav>
    </TooltipProvider>
  )
}

/**
 * 新工作区骨架:顶栏 + 左侧库务栏 + 主内容(画布 / 管理页经 Outlet)。
 * 取代旧的三栏 AppShell。画布与 Inspector 由 CanvasPage(index 路由)承载。
 */
export function WorkspaceShell() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [mobileRailOpen, setMobileRailOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setMobileRailOpen(false)
        setPaletteOpen(open => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    setMobileRailOpen(false)
  }, [location.pathname])

  return (
    <div className="flex h-svh flex-col overflow-hidden">
      <TopBar
        onOpenPalette={() => {
          setMobileRailOpen(false)
          setPaletteOpen(true)
        }}
        onToggleRail={() => setMobileRailOpen(open => !open)}
      />

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            'hidden shrink-0 border-r bg-panel transition-[width] lg:block',
            railCollapsed ? 'w-14' : 'w-52',
          )}
        >
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ManageRail collapsed={railCollapsed} />
            </div>
            <button
              className="flex h-9 items-center justify-center border-t text-xs text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
              onClick={() => setRailCollapsed(c => !c)}
              title={railCollapsed ? '展开侧栏' : '收起侧栏'}
              type="button"
            >
              {railCollapsed ? '»' : '« 收起'}
            </button>
          </div>
        </aside>

        {mobileRailOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              aria-label="关闭导航"
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileRailOpen(false)}
              type="button"
            />
            <aside className="absolute inset-y-0 left-0 w-56 border-r bg-panel shadow-2xl">
              <ManageRail collapsed={false} />
            </aside>
          </div>
        )}

        {/* 纵向可滚动:管理页是长文档需要滚动;画布页自身用 h-full 精确占满,
            不产生溢出故不会出现滚动条,ReactFlow 的滚轮缩放也不受影响。 */}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <CommandPalette onOpenChange={setPaletteOpen} open={paletteOpen} />
    </div>
  )
}
