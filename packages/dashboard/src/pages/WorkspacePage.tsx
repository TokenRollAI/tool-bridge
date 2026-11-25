import { ArrowRight, Clock3, Cpu, Search, Star } from 'lucide-react'
import { Link } from 'react-router'
import { useState } from 'react'
import { FavoriteToolButton } from '@/components/FavoriteToolButton'
import { useHistory, useRegistryList } from '@/lib/queries'
import { PresenceBadge } from '@/components/PresenceBadge'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { useFavorites } from '@/lib/useFavorites'
import { Button } from '@/components/ui/button'
import { derivePresence } from '@/lib/presence'
import { toolHref } from '@/lib/toolNavigation'
import { cn } from '@/lib/utils'

function recordTime(at: string): string {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function WorkspacePage() {
  const { favorites } = useFavorites()
  const history = useHistory()
  const devices = useRegistryList('device')
  const [showAll, setShowAll] = useState(false)
  const visibleFavorites = showAll ? favorites : favorites.slice(0, 6)
  const seen = new Set<string>()
  const recent = history.filter((record) => {
    const key = JSON.stringify([record.path, record.tool])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 8)
  const deviceItems = (devices.data?.items ?? []).filter(node => node.kind === 'directory' && node.online !== undefined).slice(0, 3)

  return (
    <div className="workspace-page">
      <PageHeader
        actions={(
          <Button asChild>
            <Link to="/tools">
              <Search />
              浏览工具
            </Link>
          </Button>
        )}
        description="收藏和最近调用仅保存在本机，按当前连接档案显示。"
        title="工作台"
      />
      <div className="mt-9 grid gap-8 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="favorite-title" className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold" id="favorite-title">常用工具</h2>
          </div>
          {favorites.length === 0
            ? (
                <EmptyState
                  action={(
                    <Button asChild size="sm" variant="outline">
                      <Link to="/tools">
                        查找工具
                        <ArrowRight />
                      </Link>
                    </Button>
                  )}
                  icon={Star}
                  title="把常用工具放在手边"
                >
                  打开一个工具，点击收藏，下次从这里直接使用。
                </EmptyState>
              )
            : (
                <>
                  <div className="divide-y">
                    {visibleFavorites.map(item => (
                      <div className="group flex min-w-0 items-center gap-2 py-3 transition-colors hover:bg-tone-subtle" key={`${item.path}:${item.tool}`}>
                        <Link className="flex min-w-0 flex-1 items-start gap-3 rounded focus-visible:ring-2 focus-visible:ring-ring" state={{ from: '/' }} to={toolHref(item.path, item.tool)}>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{item.tool}</span>
                            <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{item.path || '/'}</span>
                          </span>
                        </Link>
                        <FavoriteToolButton path={item.path} tool={item.tool} />
                      </div>
                    ))}
                  </div>
                  {favorites.length > 6 && <Button className="mt-3" onClick={() => setShowAll(value => !value)} size="sm" variant="ghost">{showAll ? '收起收藏' : `查看全部 ${favorites.length} 个收藏`}</Button>}
                </>
              )}
        </section>
        <section aria-labelledby="devices-title" className="min-w-0">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold" id="devices-title">设备</h2>
            <Link className="text-xs text-muted-foreground hover:text-foreground" to="/manage/devices">查看全部 →</Link>
          </div>
          {devices.isPending
            ? <Skeleton aria-label="正在加载设备" className="h-32" />
            : devices.isError
              ? <EmptyState action={<Button onClick={() => void devices.refetch()} size="sm" variant="outline">重试</Button>} icon={Cpu} title="暂时无法读取设备" tone="danger">请检查网关连接或设备管理权限，其他工具仍可正常打开。</EmptyState>
              : deviceItems.length === 0
                ? <EmptyState action={<Button asChild size="sm" variant="outline"><Link to="/manage/devices?connect=1">连接设备</Link></Button>} icon={Cpu} title={devices.hasNextPage ? '当前页没有设备' : '连接你的第一台设备'}>{devices.hasNextPage ? '进入设备页继续加载，或连接新设备。' : '让电脑上的工具出现在同一个工作区。'}</EmptyState>
                : (
                    <div className="divide-y">
                      {deviceItems.map(node => (
                        <Link className="flex min-w-0 items-center gap-3 py-3 hover:bg-tone-subtle" key={node.path} to={`/tools?path=${encodeURIComponent(node.path)}`}>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{node.path.split('/').at(-1)}</p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">{node.description || node.path}</p>
                          </div>
                          <PresenceBadge state={derivePresence({ now: new Date().toISOString(), online: node.online, ...(node.lastSeenAt ? { lastSeenAt: node.lastSeenAt } : {}) }).state} />
                        </Link>
                      ))}
                      {devices.hasNextPage && <p className="text-xs text-muted-foreground">仅展示已加载设备，可在设备页继续加载。</p>}
                    </div>
                  )}
        </section>
      </div>
      <section aria-labelledby="recent-title" className="mt-9 min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold" id="recent-title">最近使用</h2>
        </div>
        {recent.length === 0
          ? <EmptyState icon={Clock3} title="还没有调用记录">使用工具后会在这里显示入口，不记录参数或结果。</EmptyState>
          : (
              <div className="divide-y border-y">
                {recent.map(record => (
                  <Link className="flex min-w-0 items-center gap-3 py-2.5 transition-colors hover:bg-secondary/30 focus-visible:ring-2 focus-visible:ring-ring" key={`${record.path}:${record.tool}`} state={{ from: '/' }} to={toolHref(record.path, record.tool)}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm font-medium">{record.tool}</p>
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{record.path || '/'}</p>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <p className={cn(record.ok ? 'text-muted-foreground' : 'text-destructive')}>{record.ok ? '已收到响应' : '调用失败'}</p>
                      <p className="mt-1 text-muted-foreground">
                        {record.ms}
                        {' '}
                        ms ·
                        {' '}
                        {recordTime(record.at)}
                      </p>
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            )}
      </section>
    </div>
  )
}
