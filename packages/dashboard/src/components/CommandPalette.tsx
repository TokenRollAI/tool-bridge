import {
  Boxes,
  Cpu,
  Globe,
  Home,
  KeySquare,
  LogOut,
  Moon,
  Plug2,
  RefreshCw,
  ShieldEllipsis,
  Sun,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import type { NodeKind, TreeJson } from '@/lib/types'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { KindBadge } from '@/components/KindBadge'
import { KIND_ICON } from '@/components/kind-icon'
import { useSession } from '@/lib/session-context'
import { useTree } from '@/lib/queries'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

interface FlatNode {
  description: string
  kind: NodeKind
  online?: boolean
  path: string
}

function flatten(node: TreeJson, acc: FlatNode[] = []): FlatNode[] {
  if (node.path !== '') {
    acc.push({
      path: node.path,
      kind: node.kind,
      description: node.description,
      online: node.online,
    })
  }
  for (const c of node.children ?? []) flatten(c, acc)
  return acc
}

const PAGES = [
  { to: '/', label: '控制台', icon: Home },
  { to: '/manage/registry', label: '节点注册', icon: Boxes },
  { to: '/manage/sk', label: 'Secret Key', icon: KeySquare },
  { to: '/manage/secrets', label: '凭证保管', icon: ShieldEllipsis },
  { to: '/manage/devices', label: '设备', icon: Cpu },
  { to: '/manage/plugins', label: 'Plugin', icon: Plug2 },
  { to: '/manage/federation', label: '联邦白名单', icon: Globe },
] as const

/**
 * ⌘K 全局命令面板:整棵树的节点模糊跳转 + 管理页 + 快捷动作。
 * 树数据与侧边栏同一 query(共享缓存),打开不额外发请求。
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  // 命令面板关闭时不拉全树,避免首屏绕过 TreeNav 的 remote 懒加载。
  const tree = useTree('', 8, { enabled: open })
  const navigate = useNavigate()
  const [theme, toggleTheme] = useTheme()
  const { logout } = useSession()
  const qc = useQueryClient()

  const nodes = tree.data ? flatten(tree.data) : []

  const go = (to: string) => {
    navigate(to)
    onOpenChange(false)
  }

  return (
    <CommandDialog
      className="top-[20%] translate-y-0 sm:max-w-xl"
      description="搜索节点、管理页与动作"
      onOpenChange={onOpenChange}
      open={open}
      showCloseButton={false}
      title="全局搜索"
    >
      <CommandInput placeholder="搜索节点路径、kind、描述…" />
      <CommandList className="max-h-[50vh]">
        <CommandEmpty>无匹配结果</CommandEmpty>

        {nodes.length > 0 && (
          <CommandGroup heading="节点">
            {nodes.map((n) => {
              const { icon: Icon, className: iconClass } = KIND_ICON[n.kind] ?? KIND_ICON.directory
              return (
                <CommandItem
                  key={n.path}
                  onSelect={() => go(`/nodes/${n.path}`)}
                  value={`${n.path} ${n.kind} ${n.description}`}
                >
                  <Icon className={cn('size-3.5', iconClass)} strokeWidth={1.75} />
                  <span className="truncate font-mono text-xs">{n.path}</span>
                  {n.online === false && (
                    <span className="font-mono text-[10px] text-muted-foreground">offline</span>
                  )}
                  <KindBadge className="ml-auto" kind={n.kind} />
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}

        <CommandSeparator />
        <CommandGroup heading="页面">
          {PAGES.map(({ to, label, icon: Icon }) => (
            <CommandItem key={to} onSelect={() => go(to)} value={`page ${label}`}>
              <Icon className="size-3.5" />
              <span className="text-xs">{label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="动作">
          <CommandItem
            onSelect={() => {
              toggleTheme()
              onOpenChange(false)
            }}
            value="action theme 切换主题 dark light"
          >
            {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            <span className="text-xs">
              切换到
              {theme === 'dark' ? '浅色' : '深色'}
              主题
            </span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              qc.invalidateQueries({ queryKey: ['tb'] })
              onOpenChange(false)
            }}
            value="action refresh 刷新数据"
          >
            <RefreshCw className="size-3.5" />
            <span className="text-xs">刷新全部数据</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onOpenChange(false)
              logout()
            }}
            value="action logout 退出登录"
          >
            <LogOut className="size-3.5" />
            <span className="text-xs">退出登录</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
