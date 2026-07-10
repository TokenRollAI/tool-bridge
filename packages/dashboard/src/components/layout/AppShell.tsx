import { Menu, Search } from 'lucide-react'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { CommandPalette } from '@/components/CommandPalette'
import { ActivityRail } from '@/components/layout/ActivityRail'
import { ExplorerPanel } from '@/components/layout/ExplorerPanel'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useHealthz, useStatus } from '@/lib/queries'
import { cn } from '@/lib/utils'

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

interface HealthView {
  data?: { healthy: boolean; version: string }
  isError: boolean
}

/**
 * 主框架：桌面为 ActivityRail + Resource Explorer + Workspace；平板/移动使用顶栏抽屉。
 * Explorer 的显式折叠只改变布局，不卸载 Workspace，也不改变树查询边界。
 */
export function AppShell() {
  const health = useHealthz()
  const status = useStatus()
  const location = useLocation()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const mobileNavButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setMobileNavOpen(false)
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 进入大屏三栏布局时关闭移动 Dialog，避免 overlay 跨断点残留。
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileNavOpen(false)
    }
    closeOnDesktop()
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  useEffect(() => {
    if (location.pathname) setMobileNavOpen(false)
  }, [location.pathname])

  const openPalette = () => {
    setMobileNavOpen(false)
    setPaletteOpen(true)
  }

  return (
    <div className="flex h-svh min-w-0 overflow-hidden">
      <a
        href="#main-content"
        className={cn(
          'fixed top-3 left-3 z-[100] -translate-y-20 rounded-md border bg-background px-3 py-2 text-sm shadow-lg',
          'focus-visible:translate-y-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        )}
      >
        跳到主内容
      </a>

      <ActivityRail
        explorerOpen={explorerOpen}
        onToggleExplorer={() => setExplorerOpen((open) => !open)}
        onOpenPalette={openPalette}
        health={health.data}
        healthError={health.isError}
      />

      {explorerOpen && (
        <aside className="hidden h-svh w-80 shrink-0 border-r lg:flex" aria-label="资源浏览器">
          <ExplorerPanel
            health={health.data}
            healthError={health.isError}
            nodeCount={status.data?.nodeCount}
            nodeCountRestricted={status.isError}
          />
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader
          health={health}
          navButtonRef={mobileNavButtonRef}
          onOpenNav={() => setMobileNavOpen(true)}
          onOpenPalette={openPalette}
        />

        <main
          id="main-content"
          tabIndex={-1}
          className="app-workspace min-h-0 min-w-0 flex-1 overflow-y-auto focus:outline-none"
        >
          <Outlet />
        </main>
      </div>

      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent
          showCloseButton={false}
          className={cn(
            'top-0 left-0 h-svh w-[min(92vw,22.5rem)] max-w-none translate-x-0 translate-y-0 gap-0',
            'rounded-none border-y-0 border-l-0 bg-background p-0 shadow-2xl lg:hidden',
            'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
          )}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            mobileNavButtonRef.current?.focus()
          }}
        >
          <DialogTitle className="sr-only">资源与管理导航</DialogTitle>
          <DialogDescription className="sr-only">
            浏览工具树、管理页面与当前连接档案。
          </DialogDescription>
          <ExplorerPanel
            mobile
            health={health.data}
            healthError={health.isError}
            nodeCount={status.data?.nodeCount}
            nodeCountRestricted={status.isError}
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
    <header className="app-mobile-header flex h-14 shrink-0 items-center gap-2 border-b px-2 lg:hidden">
      <Button
        ref={navButtonRef}
        variant="ghost"
        size="icon-sm"
        aria-label="打开资源与管理导航"
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
      <Button variant="ghost" size="icon-sm" aria-label="打开全局跳转" onClick={onOpenPalette}>
        <Search />
        <span className="sr-only">{isMac ? '快捷键 Command K' : '快捷键 Control K'}</span>
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
