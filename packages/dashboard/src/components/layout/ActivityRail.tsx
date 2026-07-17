import { NavLink, useLocation, useNavigate } from 'react-router'
import { Files, LogOut, Moon, Search, Sun } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useSession } from '@/lib/session'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { MANAGE_LINKS } from './navigation'

interface ActivityRailProps {
  explorerOpen: boolean
  health?: { healthy: boolean }
  healthError: boolean
  onOpenPalette: () => void
  onToggleExplorer: () => void
}

/**
 * 桌面活动栏：把全局入口从资源树滚动区剥离出来，保证控制面始终可达。
 * 图标按钮全部带 Tooltip / aria-label；移动端使用 ExplorerPanel 的文字入口。
 */
export function ActivityRail({
  explorerOpen,
  onToggleExplorer,
  onOpenPalette,
  health,
  healthError,
}: ActivityRailProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { active, profiles, switchTo, logout } = useSession()
  const [theme, toggleTheme] = useTheme()
  const resourceRoute = location.pathname === '/' || location.pathname.startsWith('/nodes/')
  const healthText = healthError ? '网关不可达' : health?.healthy ? '运行正常' : '正在检查'

  const switchProfile = (name: string) => {
    switchTo(name)
    navigate('/')
  }

  return (
    <TooltipProvider delayDuration={250}>
      <aside
        aria-label="全局活动栏"
        className="app-activity-rail hidden h-svh w-14 shrink-0 flex-col items-center border-r lg:flex"
      >
        <RailTip label="总览">
          <NavLink
            aria-label="前往总览"
            className={cn(
              'mt-2 grid size-10 place-items-center rounded-lg border border-transparent',
              'hover:border-border hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            )}
            to="/"
          >
            <img alt="" className="size-6 dark:invert" src="/ui/icon-light.png" />
          </NavLink>
        </RailTip>

        <div className="my-2 h-px w-7 bg-border/70" />

        <RailTip label={explorerOpen ? '收起资源浏览器' : '展开资源浏览器'}>
          <button
            aria-label={explorerOpen ? '收起资源浏览器' : '展开资源浏览器'}
            aria-pressed={explorerOpen}
            className={cn(
              'relative grid size-10 place-items-center rounded-lg text-muted-foreground',
              'hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              (explorerOpen || resourceRoute) && 'bg-primary/12 text-primary',
            )}
            onClick={onToggleExplorer}
            type="button"
          >
            <Files className="size-[18px]" />
            {(explorerOpen || resourceRoute) && (
              <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-primary" />
            )}
          </button>
        </RailTip>

        <RailTip label="全局跳转（⌘/Ctrl K）">
          <button
            aria-label="打开全局跳转"
            className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={onOpenPalette}
            type="button"
          >
            <Search className="size-[18px]" />
          </button>
        </RailTip>

        <p className="mt-3 mb-1 font-mono text-[8px] tracking-[0.16em] text-muted-foreground/70 uppercase">
          管理
        </p>
        <nav aria-label="管理入口" className="grid gap-0.5">
          {MANAGE_LINKS.map(({ to, label, icon: Icon }) => (
            <RailTip key={to} label={label}>
              <NavLink
                aria-label={label}
                className={({ isActive }) =>
                  cn(
                    'relative grid size-10 place-items-center rounded-lg text-muted-foreground',
                    'hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    isActive && 'bg-primary/12 text-primary',
                  )}
                to={to}
              >
                {({ isActive }) => (
                  <>
                    <Icon className="size-[17px]" />
                    {isActive && (
                      <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-primary" />
                    )}
                  </>
                )}
              </NavLink>
            </RailTip>
          ))}
        </nav>

        <div className="mt-auto grid justify-items-center gap-1 pb-2">
          <RailTip label={healthText}>
            <span
              aria-label={healthText}
              className={cn(
                'mb-1 size-2 rounded-full',
                healthError
                  ? 'bg-destructive'
                  : health?.healthy
                    ? 'bg-ok shadow-[0_0_7px_var(--ok)]'
                    : 'bg-warn',
              )}
              role="img"
            />
          </RailTip>

          <RailTip label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}>
            <button
              aria-label="切换主题"
              className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={toggleTheme}
              type="button"
            >
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </RailTip>

          <DropdownMenu>
            <RailTip label={`连接档案：${active?.name ?? '未选择'}`}>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="切换连接档案"
                  className="grid size-9 place-items-center rounded-lg border bg-background/45 font-mono text-[10px] font-medium text-foreground hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  type="button"
                >
                  {(active?.name ?? '--').slice(0, 2).toUpperCase()}
                </button>
              </DropdownMenuTrigger>
            </RailTip>
            <DropdownMenuContent align="end" className="w-60" side="right">
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
                  onClick={() => switchProfile(profile.name)}
                >
                  <span className="truncate">{profile.name}</span>
                  {profile.id === active?.id && <span className="ml-auto text-primary">●</span>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} variant="destructive">
                <LogOut />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </TooltipProvider>
  )
}

function RailTip({ label, children }: { children: React.ReactNode, label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
