import { ChevronDown, Menu, Moon, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, Sun } from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { type ManageLink, RESOURCE_LINKS, SETTINGS_LINKS, WORKSPACE_LINKS } from '@/components/layout/navigation'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AddToolWizard } from '@/components/add-tool/AddToolWizard'
import { CommandPalette } from '@/components/CommandPalette'
import { useSession } from '@/lib/session-context'
import { Button } from '@/components/ui/button'
import { useHealthz } from '@/lib/queries'
import { cn } from '@/lib/utils'

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

function ConnectionMenu() {
  const { active, profiles, switchTo, logout } = useSession()
  const navigate = useNavigate()
  const health = useHealthz()
  const status = health.isError ? '网关不可达' : health.data?.healthy ? '网关运行正常' : '正在检查网关'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="连接档案" className="max-w-44 gap-2" variant="ghost">
          <span aria-label={status} className={cn('size-2 shrink-0 rounded-full', health.isError ? 'bg-destructive' : health.data?.healthy ? 'bg-ok' : 'bg-warn')} role="img" title={status} />
          <span className="hidden truncate sm:inline">{active?.name ?? '连接档案'}</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          当前连接
          <span className="mt-1 block truncate text-xs font-normal text-muted-foreground">{active?.baseUrl || window.location.origin}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {profiles.map(profile => (
          <DropdownMenuItem
            key={profile.id}
            onClick={() => {
              switchTo(profile.name)
              navigate('/')
            }}
          >
            <span className="truncate">{profile.name}</span>
            {profile.id === active?.id && <span className="ml-auto text-xs text-muted-foreground">当前</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout} variant="destructive">退出登录</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function RailLink({ item, collapsed }: { collapsed: boolean, item: ManageLink }) {
  const location = useLocation()
  const { icon: Icon, label, to } = item
  const related = (to === '/tools' && location.pathname === '/search') || (to === '/canvas' && location.pathname.startsWith('/nodes/'))
  const link = (
    <NavLink
      aria-label={label}
      className={({ isActive }) => cn('flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', (isActive || related) && 'bg-secondary font-medium text-foreground', collapsed && 'justify-center px-0')}
      end={to === '/'}
      to={to}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  )
  return collapsed
    ? (
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      )
    : link
}

function Navigation({ collapsed }: { collapsed: boolean }) {
  const location = useLocation()
  const inSettings = SETTINGS_LINKS.some(item => item.to === location.pathname)
  const [settingsOpen, setSettingsOpen] = useState(inSettings)
  useEffect(() => {
    if (inSettings) setSettingsOpen(true)
  }, [inSettings])
  return (
    <TooltipProvider delayDuration={200}>
      <nav aria-label="工作区导航" className="flex flex-col gap-1 px-3 py-4">
        {WORKSPACE_LINKS.map(item => <RailLink collapsed={collapsed} item={item} key={item.to} />)}
        <div className="my-4 border-t" />
        {!collapsed && <p className="mb-2 px-3 text-xs text-muted-foreground">资源管理</p>}
        {RESOURCE_LINKS.map(item => <RailLink collapsed={collapsed} item={item} key={item.to} />)}
        <div className="my-3 border-t" />
        {collapsed
          ? <RailLink collapsed item={SETTINGS_LINKS[0]!} />
          : (
              <>
                <button aria-controls="workspace-settings" aria-expanded={settingsOpen} className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground hover:bg-secondary/60 hover:text-foreground" onClick={() => setSettingsOpen(value => !value)} type="button">
                  <Settings className="size-4" />
                  实例管理
                  <ChevronDown className={cn('ml-auto size-3.5 transition-transform', settingsOpen && 'rotate-180')} />
                </button>
                <div hidden={!settingsOpen} id="workspace-settings">{SETTINGS_LINKS.map(item => <RailLink collapsed={false} item={item} key={item.to} />)}</div>
              </>
            )}
      </nav>
    </TooltipProvider>
  )
}

export function WorkspaceShell() {
  const paletteTrigger = useRef<HTMLButtonElement>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [mobileRailOpen, setMobileRailOpen] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  const location = useLocation()
  const { active, revision } = useSession()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !addOpen && (!document.querySelector('[role=dialog]') || paletteOpen)) {
        event.preventDefault()
        setMobileRailOpen(false)
        setPaletteOpen(open => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addOpen, paletteOpen])
  useEffect(() => {
    setMobileRailOpen(false)
  }, [location.pathname, location.search])
  useEffect(() => {
    setPaletteOpen(false)
    setAddOpen(false)
  }, [revision])

  return (
    <div className="flex h-svh overflow-hidden bg-background">
      <aside className={cn('hidden shrink-0 flex-col border-r bg-panel lg:flex', railCollapsed ? 'w-16' : 'w-56')}>
        <NavLink aria-label="Tool Bridge 工作台" className="flex h-16 shrink-0 items-center gap-2.5 border-b px-5" to="/">
          <img alt="" className="size-6 shrink-0 dark:invert" src="/ui/icon-light.png" />
          {!railCollapsed && <span className="text-sm font-semibold tracking-tight">tool-bridge</span>}
        </NavLink>
        <div className="min-h-0 flex-1 overflow-y-auto"><Navigation collapsed={railCollapsed} /></div>
        <button aria-label={railCollapsed ? '展开侧栏' : '收起侧栏'} className="flex h-12 shrink-0 items-center gap-3 border-t px-5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setRailCollapsed(value => !value)} type="button">
          {railCollapsed
            ? <PanelLeftOpen className="size-4" />
            : (
                <>
                  <PanelLeftClose className="size-4" />
                  收起侧栏
                </>
              )}
        </button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 shrink-0 items-center gap-2 border-b px-3 sm:gap-3 sm:px-6">
          <Button aria-label="打开导航" className="lg:hidden" onClick={() => setMobileRailOpen(true)} size="icon" variant="ghost"><Menu /></Button>
          <button aria-label="搜索工具、设备或操作" className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" onClick={() => setPaletteOpen(true)} ref={paletteTrigger} type="button">
            <Search className="size-4 shrink-0" />
            <span className="truncate text-left">搜索工具、设备或操作…</span>
            <kbd className="ml-auto hidden rounded border px-1.5 text-xs md:inline">{isMac ? '⌘ K' : 'Ctrl K'}</kbd>
          </button>
          <AddToolWizard
            key={`${active?.id}:${revision}:add`}
            onOpenChange={setAddOpen}
            open={addOpen}
            trigger={(
              <Button aria-label="添加工具">
                <Plus />
                <span className="hidden sm:inline">添加工具</span>
              </Button>
            )}
          />
          <Button aria-label="切换主题" onClick={() => setTheme(resolvedTheme === 'light' ? 'dark' : 'light')} size="icon" variant="ghost">{resolvedTheme === 'light' ? <Moon /> : <Sun />}</Button>
          <ConnectionMenu />
        </header>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto" key={`${active?.id}:${active?.baseUrl}:${revision}`}><Outlet /></main>
      </div>
      <Dialog onOpenChange={setMobileRailOpen} open={mobileRailOpen}>
        <DialogContent className="inset-y-0 left-0 flex h-auto max-h-none w-64 max-w-[85vw] translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-l-0 bg-panel p-0 sm:max-w-64">
          <DialogHeader className="shrink-0 border-b p-5 text-left">
            <DialogTitle>tool-bridge</DialogTitle>
            <DialogDescription className="sr-only">工作区与管理页面导航</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto"><Navigation collapsed={false} /></div>
        </DialogContent>
      </Dialog>
      <CommandPalette
        key={`${active?.id}:${revision}`}
        onAddTool={() => setAddOpen(true)}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!addOpen) paletteTrigger.current?.focus()
        }}
        onOpenChange={setPaletteOpen}
        open={paletteOpen}
      />
    </div>
  )
}
