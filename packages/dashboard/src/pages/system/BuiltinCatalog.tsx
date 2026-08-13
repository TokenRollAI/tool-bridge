import { useQueryClient } from '@tanstack/react-query'
import { PlugZap, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { PluginCatalogItem, PluginRegistration } from '@/lib/types'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useInvoke, usePluginCatalog } from '@/lib/queries'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

/**
 * 宿主装配的内置插件目录(对等 `tb plugin catalog`)。
 *
 * 为什么要有这个视图:**装配 ≠ 注册 ≠ 挂载**。此前 Dashboard 只列已注册的 plugin,
 * 于是"这个部署带了哪些可用插件"在界面上完全不可见 —— 生产实测 99 个装配、0 个注册,
 * 用户看到的是一张空表,无从知道有东西可用。
 *
 * 注册按钮走的是与 `RegisterPluginDialog` 同一个 `system/plugin` write,
 * 只是 endpoint / protocolVersion / auth 都由目录项直接给出,不需要用户填 ——
 * 从目录注册一个内置插件本来就没有可填的东西。
 */
export function BuiltinCatalog({ onToken }: { onToken: (v: { id: string, token: string }) => void }) {
  const catalog = usePluginCatalog()
  const invoke = useInvoke()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<string | null>(null)

  const items = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const all = catalog.data ?? []
    return needle === '' ? all : all.filter(i => i.name.toLowerCase().includes(needle))
  }, [catalog.data, search])

  const register = (item: PluginCatalogItem) => {
    setPending(item.name)
    invoke.mutate(
      {
        path: 'system/plugin',
        tool: 'write',
        args: {
          id: item.name,
          protocolVersion: 'plugin/v2',
          endpoint: item.endpoint,
          // 进程内 binding 不走网络,平台用 mint 出的 token 调它。
          auth: { kind: 'platform-token' },
          healthPath: '/healthz',
          enabled: true,
        },
      },
      {
        onSuccess: (response) => {
          const reg = response.json as PluginRegistration
          toast.success(`${reg.id} 已注册(下一步:挂到树上才能被调用)`)
          // pluginToken 只在这一次响应里出现,交给页面展示。
          if (reg.pluginToken) onToken({ id: reg.id, token: reg.pluginToken })
          void qc.invalidateQueries({ queryKey: ['tb'] })
        },
        onError: e => toast.error(`注册 ${item.name} 失败:${e.message}`),
        onSettled: () => setPending(null),
      },
    )
  }

  if (catalog.isLoading) return <Skeleton className="h-40 w-full" />

  if (catalog.isError) {
    return (
      <p className="rounded-lg border bg-card/55 p-4 text-sm text-muted-foreground">
        读取内置目录失败:
        {catalog.error.message}
      </p>
    )
  }

  const all = catalog.data ?? []
  const registered = all.filter(i => i.registered).length

  if (all.length === 0) {
    return (
      <div className="rounded-lg border bg-card/55 p-4 text-sm text-muted-foreground">
        <p>这个宿主没有装配任何内置插件。</p>
        <p className="mt-1 text-xs">
          装配发生在**构建期**(宿主调用 `builtinPluginBindings`)。Workers 宿主见
          {' '}
          <code className="font-mono">packages/gateway/src/deployEntry.ts</code>
          。
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          宿主装配
          {' '}
          <span className="font-mono text-foreground">{all.length}</span>
          {' '}
          个 · 已注册
          {' '}
          <span className="font-mono text-foreground">{registered}</span>
          {' '}
          · 注册后还需挂到树上才能被调用
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            onChange={e => setSearch(e.target.value)}
            placeholder="过滤插件名"
            value={search}
          />
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Binding</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(item => (
              <TableRow key={item.name}>
                <TableCell className="font-mono text-xs">{item.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {item.endpoint}
                </TableCell>
                <TableCell>
                  <Badge variant={item.registered ? 'default' : 'outline'}>
                    {item.registered ? `已注册${item.pluginId && item.pluginId !== item.name ? ` · ${item.pluginId}` : ''}` : '可用'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {item.registered
                    ? <span className="text-xs text-muted-foreground">—</span>
                    : (
                        <Button
                          aria-label={`注册 ${item.name}`}
                          disabled={pending !== null}
                          onClick={() => register(item)}
                          size="sm"
                          variant="outline"
                        >
                          <PlugZap className="mr-1 size-3.5" />
                          {pending === item.name ? '注册中…' : '注册'}
                        </Button>
                      )}
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell className="text-sm text-muted-foreground" colSpan={4}>
                  没有匹配「
                  {search}
                  」的插件。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
