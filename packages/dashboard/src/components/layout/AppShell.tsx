import {
  Boxes,
  ChevronsUpDown,
  Cpu,
  KeySquare,
  LogOut,
  Moon,
  ShieldEllipsis,
  Sun,
} from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { TreeNav } from '@/components/layout/TreeNav'
import { Button } from '@/components/ui/button'
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
import { useStatus } from '@/lib/queries'
import { useSession } from '@/lib/session'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

const MANAGE_LINKS = [
  { to: '/manage/registry', label: '节点注册', icon: Boxes },
  { to: '/manage/sk', label: 'Secret Key', icon: KeySquare },
  { to: '/manage/secrets', label: '凭证保管', icon: ShieldEllipsis },
  { to: '/manage/devices', label: '设备', icon: Cpu },
] as const

/** 主布局:左侧树导航 + 管理区,右侧路由内容。 */
export function AppShell() {
  const { active, profiles, switchTo, logout } = useSession()
  const [theme, toggleTheme] = useTheme()
  const status = useStatus()
  const navigate = useNavigate()

  return (
    <div className="flex h-svh overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-card/40">
        <NavLink to="/" className="flex items-baseline gap-2 px-4 pt-4 pb-3">
          <span className="font-mono text-base tracking-tight">
            tool<span className="text-primary">-</span>bridge
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {status.data?.version ? `v${status.data.version}` : ''}
          </span>
        </NavLink>

        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span
              className={cn(
                'size-1.5 rounded-full',
                status.isError
                  ? 'bg-destructive'
                  : status.data?.healthy
                    ? 'bg-ok shadow-[0_0_6px_var(--ok)]'
                    : 'bg-warn',
              )}
            />
            {status.isError ? 'unreachable' : status.data?.healthy ? 'operational' : 'checking…'}
            {status.data && (
              <span className="ml-auto font-mono">{status.data.nodeCount} nodes</span>
            )}
          </div>
        </div>

        <Separator />

        <ScrollArea className="min-h-0 flex-1 px-1 py-2">
          <p className="px-3 pb-1 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
            树
          </p>
          <TreeNav />
          <p className="px-3 pt-4 pb-1 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
            管理
          </p>
          <nav className="grid gap-px" aria-label="管理">
            {MANAGE_LINKS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'mx-1 flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-[13px]',
                    'hover:bg-secondary/80',
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

        <footer className="flex items-center gap-1 p-2">
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
                  onClick={() => {
                    switchTo(p.name)
                    navigate('/')
                  }}
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
          <Button variant="ghost" size="icon-sm" aria-label="退出登录" onClick={logout}>
            <LogOut className="size-3.5" />
          </Button>
        </footer>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
