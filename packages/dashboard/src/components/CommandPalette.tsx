import { ArrowRight, Cpu, LogOut, Moon, Plus, RefreshCw, Search, Star, Sun, Terminal } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import type { TreeJson } from '@/lib/types'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { MANAGE_LINKS, WORKSPACE_LINKS } from '@/components/layout/navigation'
import { useInvalidate, useToolSearch, useTree } from '@/lib/queries'
import { useSession } from '@/lib/session-context'
import { useDebounced } from '@/lib/useDebounced'
import { useFavorites } from '@/lib/useFavorites'
import { toolHref } from '@/lib/toolNavigation'
import { PresenceBadge } from './PresenceBadge'
import { KIND_ICON } from './kind-icon'

function flatten(node: TreeJson): TreeJson[] {
  return [...(node.path ? [node] : []), ...(node.children ?? []).flatMap(flatten)]
}

/** 本地入口与服务端命令搜索共享一个面板；命令排序由服务端决定。 */
export function CommandPalette({ open, onOpenChange, onAddTool, onCloseAutoFocus }: {
  onAddTool: () => void
  onCloseAutoFocus?: (event: Event) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const [draft, setDraft] = useState('')
  const [selectedValue, setSelectedValue] = useState('')
  const debounced = useDebounced(draft.trim())
  const query = open ? debounced : ''
  const search = useToolSearch(query)
  const tree = useTree('', 8, { enabled: open })
  const navigate = useNavigate()
  const location = useLocation()
  const { resolvedTheme, setTheme } = useTheme()
  const { logout } = useSession()
  const invalidate = useInvalidate()
  const { favorites } = useFavorites()
  useEffect(() => {
    if (!open) setDraft('')
  }, [open])

  const matches = (text: string) => text.toLowerCase().includes(draft.trim().toLowerCase())
  const nodes = tree.data ? flatten(tree.data).filter(node => matches(`${node.path} ${node.description} ${node.kind}`)).slice(0, 12) : []
  const pages = [...WORKSPACE_LINKS, ...MANAGE_LINKS.filter(item => !WORKSPACE_LINKS.some(page => page.to === item.to))].filter(item => matches(item.label))
  const tools = query === draft.trim() ? search.data?.pages.flatMap(page => page.items) ?? [] : []
  const firstTool = tools[0]
  const firstToolValue = firstTool ? `tool:${firstTool.path}:${firstTool.tool.name}` : ''
  useEffect(() => {
    if (firstToolValue) setSelectedValue(firstToolValue)
  }, [firstToolValue, query])
  const waiting = draft.trim() !== '' && (query !== draft.trim() || search.isFetching)
  const go = (to: string, from = `${location.pathname}${location.search}`) => {
    onOpenChange(false)
    navigate(to, { state: { from } })
  }
  const actions = [
    { label: '添加工具', keywords: '添加工具 连接 集成 add tool', icon: Plus, run: onAddTool },
    { label: '连接设备', keywords: '连接设备 connect device', icon: Cpu, run: () => go('/manage/devices?connect=1') },
    { label: resolvedTheme === 'light' ? '切换到深色主题' : '切换到浅色主题', keywords: '切换主题 dark light', icon: resolvedTheme === 'light' ? Moon : Sun, run: () => setTheme(resolvedTheme === 'light' ? 'dark' : 'light') },
    { label: '刷新当前连接数据', keywords: '刷新数据 refresh', icon: RefreshCw, run: () => { void invalidate() } },
    { label: '退出登录', keywords: '退出登录 logout', icon: LogOut, run: logout },
  ].filter(action => matches(action.keywords) || matches(action.label))

  return (
    <CommandDialog className="max-h-[calc(100svh-2rem)] sm:max-w-2xl" commandValue={selectedValue} description="查找工具命令、设备、页面或操作" onCloseAutoFocus={onCloseAutoFocus} onCommandValueChange={setSelectedValue} onOpenChange={onOpenChange} open={open} shouldFilter={false} showCloseButton={false} title="搜索与操作">
      <CommandInput maxLength={1024} onValueChange={setDraft} placeholder="搜索工具、设备或操作…" value={draft} />
      <CommandList className="max-h-[min(30rem,65svh)] p-2">
        <CommandEmpty>没有匹配的入口</CommandEmpty>
        {draft.trim() && (
          <CommandGroup heading="工具命令">
            {waiting && <p aria-live="polite" className="px-3 py-2 text-xs text-muted-foreground">正在搜索工具…</p>}
            {search.isError && <p className="px-3 py-2 text-sm text-destructive" role="status">命令搜索暂不可用，可重试或浏览工具。</p>}
            {search.data?.pages.some(page => page.partial) && <p className="px-3 py-2 text-xs text-warn" role="status">部分来源未完成，结果可能不完整。</p>}
            {tools.map(({ path, source, tool }) => (
              <CommandItem key={`${source?.path ?? ''}:${path}:${tool.name}`} onSelect={() => go(toolHref(path, tool.name), `/search?q=${encodeURIComponent(draft.trim())}`)} value={`tool:${path}:${tool.name}`}>
                <Terminal />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{tool.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {path || '/'}
                    {' '}
                    ·
                    {' '}
                    {source?.path || '本实例'}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{tool.description}</p>
                </div>
                <span className="text-xs text-muted-foreground">{tool.confirm ? '需要确认' : tool.effect === 'read' ? '读取' : '命令'}</span>
                <ArrowRight className="size-4" />
              </CommandItem>
            ))}
            {!waiting && !search.isError && tools.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">没有匹配的可见命令</p>}
            <CommandItem onSelect={() => go(`/search?q=${encodeURIComponent(draft.trim())}`)} value="all-results">
              <Search />
              <span>查看全部搜索结果与范围筛选</span>
            </CommandItem>
          </CommandGroup>
        )}
        {!draft.trim() && favorites.length > 0 && (
          <CommandGroup heading="收藏工具 · 本机 / 当前连接">
            {favorites.slice(0, 6).map(item => (
              <CommandItem key={`${item.path}:${item.tool}`} onSelect={() => go(toolHref(item.path, item.tool))} value={`favorite:${item.path}:${item.tool}`}>
                <Star />
                <span>{item.tool}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">{item.path || '/'}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {actions.length > 0 && (
          <CommandGroup heading="快捷操作">
            {actions.map(({ label, icon: Icon, run }) => (
              <CommandItem
                key={label}
                onSelect={() => {
                  onOpenChange(false)
                  run()
                }}
                value={`action:${label}`}
              >
                <Icon />
                <span>{label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {nodes.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="连接与设备">
              {nodes.map((node) => {
                const { icon: Icon } = KIND_ICON[node.kind] ?? KIND_ICON.directory
                return (
                  <CommandItem key={node.path} onSelect={() => go(`/tools?path=${encodeURIComponent(node.path)}`)} value={`node:${node.path}`}>
                    <Icon />
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{node.description || node.path.split('/').at(-1)}</p>
                      <p className="truncate text-xs text-muted-foreground">{node.path}</p>
                    </div>
                    {node.presence && <PresenceBadge state={node.presence.state} />}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </>
        )}
        {tree.isError && <p className="px-3 py-2 text-xs text-muted-foreground" role="status">连接与设备未能加载，工具搜索仍可使用。</p>}
        {pages.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="页面">
              {pages.map(({ label, to, icon: Icon }) => (
                <CommandItem key={to} onSelect={() => go(to)} value={`page:${to}`}>
                  <Icon />
                  <span>{label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {tree.data?.truncated && (
          <CommandItem onSelect={() => go('/canvas')} value="browse-tree">
            <Search />
            浏览完整能力树
          </CommandItem>
        )}
      </CommandList>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
        <span>↑ ↓ 选择 · Enter 打开</span>
        <span>Esc 关闭</span>
      </div>
    </CommandDialog>
  )
}
