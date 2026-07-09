import { useQueryClient } from '@tanstack/react-query'
import {
  Boxes,
  ChevronsUpDown,
  Cpu,
  Globe,
  KeySquare,
  ListFilter,
  LogOut,
  Menu,
  Moon,
  Plug2,
  RefreshCw,
  Search,
  ShieldEllipsis,
  Sun,
  X,
} from 'lucide-react'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { CommandPalette } from '@/components/CommandPalette'
import { TreeNav } from '@/components/layout/TreeNav'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useHealthz, useStatus } from '@/lib/queries'
import { useSession } from '@/lib/session'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

const MANAGE_LINKS = [
  { to: '/manage/registry', label: '节点注册', icon: Boxes },
  { to: '/manage/sk', label: 'Secret Key', icon: KeySquare },
  { to: '/manage/secrets', label: '凭证保管', icon: ShieldEllipsis },
  { to: '/manage/devices', label: '设备', icon: Cpu },
  { to: '/manage/plugins', label: 'Plugin', icon: Plug2 },
  { to: '/manage/federation', label: '联邦白名单', icon: Globe },
] as const

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

interface HealthView {
  data?: { healthy: boolean; version: string }
  isError: boolean
}

/** 主布局:桌面固定树导航;移动端为顶栏 + 抽屉;⌘K 全局命令面板。 */
export function AppShell() {
  const health = useHealthz()
  const status = useStatus()
  const location = useLocation()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const mobileNavButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setMobileNavOpen(false)
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 旋转屏幕或放大窗口进入 desktop 时关闭移动 Dialog，避免透明 overlay 留在桌面层。
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)')
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileNavOpen(false)
    }
    closeOnDesktop()
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  // TreeNav 中任意节点链接也会触发关闭，不必把回调层层透传到树分支。
  useEffect(() => {
    if (location.pathname) setMobileNavOpen(false)
  }, [location.pathname])

  const openPalette = () => {
    setMobileNavOpen(false)
    setPaletteOpen(true)
  }

  return (
    <div className="flex h-svh min-w-0 flex-col overflow-hidden md:flex-row">
      <a
        href="#main-content"
        className={cn(
          'fixed top-3 left-3 z-[100] -translate-y-20 rounded-sm border bg-background px-3 py-2 text-sm shadow-lg',
          'focus-visible:translate-y-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        )}
      >
        跳到主内容
      </a>

      <MobileHeader
        health={health}
        navButtonRef={mobileNavButtonRef}
        onOpenNav={() => setMobileNavOpen(true)}
        onOpenPalette={openPalette}
      />

      <aside className="app-navigation hidden w-64 shrink-0 border-r md:flex" aria-label="主导航">
        <NavigationPanel
          health={health}
          nodeCount={status.data?.nodeCount}
          nodeCountRestricted={status.isError}
          onOpenPalette={openPalette}
        />
      </aside>

      <main
        id="main-content"
        tabIndex={-1}
        className="app-workspace min-h-0 min-w-0 flex-1 overflow-y-auto focus:outline-none"
      >
        <Outlet />
      </main>

      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent
          showCloseButton={false}
          className={cn(
            'top-0 left-0 h-svh w-[calc(100%-3rem)] max-w-80 translate-x-0 translate-y-0 gap-0',
            'rounded-none border-y-0 border-l-0 bg-background p-0 shadow-2xl sm:max-w-80 md:hidden',
            'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
          )}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            mobileNavButtonRef.current?.focus()
          }}
        >
          <DialogTitle className="sr-only">导航</DialogTitle>
          <DialogDescription className="sr-only">
            浏览工具树、管理页面与当前连接档案。
          </DialogDescription>
          <NavigationPanel
            health={health}
            nodeCount={status.data?.nodeCount}
            nodeCountRestricted={status.isError}
            onOpenPalette={openPalette}
            onClose={() => setMobileNavOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}

function MobileHeader({
  health,
  navButtonRef,
  onOpenNav,
  onOpenPalette,
}: {
  health: HealthView
  navButtonRef: RefObject<HTMLButtonElement | null>
  onOpenNav: () => void
  onOpenPalette: () => void
}) {
  return (
    <header className="app-navigation flex h-14 shrink-0 items-center gap-2 border-b px-2 md:hidden">
      <Button
        ref={navButtonRef}
        variant="ghost"
        size="icon-sm"
        aria-label="打开导航"
        onClick={onOpenNav}
      >
        <Menu />
      </Button>
      <NavLink to="/" className="flex min-w-0 items-center gap-2">
        <img src="/ui/icon-light.png" alt="" className="size-5 shrink-0 dark:invert" />
        <span className="truncate font-mono text-sm tracking-tight">
          tool<span className="text-primary">-</span>bridge
        </span>
      </NavLink>
      <span
        role="img"
        aria-label={healthLabel(health)}
        title={healthLabel(health)}
        className={cn(
          'ml-auto size-2 shrink-0 rounded-full',
          health.isError
            ? 'bg-destructive'
            : health.data?.healthy
              ? 'bg-ok shadow-[0_0_6px_var(--ok)]'
              : 'bg-warn',
        )}
      />
      <Button variant="ghost" size="icon-sm" aria-label="打开全局搜索" onClick={onOpenPalette}>
        <Search />
      </Button>
    </header>
  )
}

function healthLabel(health: HealthView): string {
  if (health.isError) return '网关不可达'
  if (health.data?.healthy) return '网关运行正常'
  if (health.data) return '网关状态异常'
  return '正在检查网关状态'
}

function NavigationPanel({
  health,
  nodeCount,
  nodeCountRestricted,
  onOpenPalette,
  onClose,
}: {
  health: HealthView
  nodeCount?: number
  nodeCountRestricted: boolean
  onOpenPalette: () => void
  onClose?: () => void
}) {
  const { active, profiles, switchTo, logout } = useSession()
  const [theme, toggleTheme] = useTheme()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [treeFilter, setTreeFilter] = useState('')

  const goHome = () => onClose?.()
  const switchProfile = (name: string) => {
    switchTo(name)
    navigate('/')
    onClose?.()
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col bg-[var(--panel)]">
      <div className="flex items-center gap-1 pr-2">
        <NavLink
          to="/"
          onClick={goHome}
          className="flex min-w-0 flex-1 items-center gap-2 px-4 pt-4 pb-3"
        >
          <img src="/ui/icon-light.png" alt="" className="size-6 shrink-0 dark:invert" />
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-mono text-base tracking-tight">
              tool<span className="text-primary">-</span>bridge
            </span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {health.data?.version ? `v${health.data.version}` : ''}
            </span>
          </span>
        </NavLink>
        {onClose && (
          <Button variant="ghost" size="icon-sm" aria-label="关闭导航" onClick={onClose}>
            <X />
          </Button>
        )}
      </div>

      <div className="px-4 pb-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span
            className={cn(
              'size-1.5 rounded-full',
              health.isError
                ? 'bg-destructive'
                : health.data?.healthy
                  ? 'bg-ok shadow-[0_0_6px_var(--ok)]'
                  : 'bg-warn',
            )}
          />
          {health.isError
            ? 'unreachable'
            : health.data?.healthy
              ? 'operational'
              : health.data
                ? 'degraded'
                : 'checking…'}
          {nodeCount !== undefined ? (
            <span className="ml-auto font-mono tabular-nums">{nodeCount} nodes</span>
          ) : (
            nodeCountRestricted && <span className="ml-auto font-mono text-[10px]">受限</span>
          )}
        </div>
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={onOpenPalette}
          className={cn(
            'flex h-8 w-full items-center gap-2 rounded-sm border bg-background/60 px-2.5',
            'text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          )}
        >
          <Search className="size-3" />
          搜索节点…
          <kbd className="ml-auto rounded-xs border bg-secondary px-1 font-mono text-[10px] leading-4">
            {isMac ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>
      </div>

      <Separator />

      <ScrollArea className="min-h-0 flex-1 px-1 py-2">
        <div className="flex items-center px-3 pb-1">
          <p className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
            树
          </p>
          <button
            type="button"
            aria-label="刷新树"
            title="刷新树"
            onClick={() => qc.invalidateQueries({ queryKey: ['tb'] })}
            className={cn(
              'ml-auto grid size-6 place-items-center rounded-xs text-muted-foreground/80 hover:text-foreground',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            )}
          >
            <RefreshCw className="size-3" />
          </button>
        </div>
        <div className="relative mx-2 mb-1.5">
          <ListFilter className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground/70" />
          <input
            value={treeFilter}
            onChange={(e) => setTreeFilter(e.target.value)}
            placeholder="过滤…"
            aria-label="过滤树"
            className={cn(
              'h-8 w-full rounded-sm border bg-transparent pr-2 pl-7 font-mono text-xs',
              'placeholder:text-muted-foreground/70 focus:border-primary/50 focus:ring-2 focus:ring-ring/40 focus:outline-none',
            )}
          />
        </div>
        <TreeNav filter={treeFilter} onNavigate={onClose} />
        <p className="px-3 pt-4 pb-1 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
          管理
        </p>
        <nav className="grid gap-px" aria-label="管理">
          {MANAGE_LINKS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'mx-1 flex min-h-8 items-center gap-2 rounded-sm px-2.5 py-1.5 text-[13px]',
                  'hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  isActive ? 'bg-secondary text-primary' : 'text-foreground/85',
                )
              }
            >
              <Icon className="size-3.5 text-muted-foreground" />
              {label}
            </NavLink>
          ))}
        </nav>
      </ScrollArea>

      <Separator />

      <footer className="flex items-center gap-1 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0 flex-1 justify-start font-mono text-xs"
            >
              <span className="truncate">{active?.name}</span>
              <ChevronsUpDown className="ml-auto size-3 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel className="font-mono text-[11px] break-all text-muted-foreground">
              {active?.baseUrl || window.location.origin}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {profiles.map((p) => (
              <DropdownMenuItem
                key={p.name}
                className="font-mono text-xs"
                onClick={() => switchProfile(p.name)}
              >
                {p.name}
                {p.name === active?.name && <span className="ml-auto text-primary">●</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon-sm" aria-label="切换主题" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="退出登录"
          onClick={() => {
            onClose?.()
            logout()
          }}
        >
          <LogOut className="size-3.5" />
        </Button>
      </footer>
    </div>
  )
}
