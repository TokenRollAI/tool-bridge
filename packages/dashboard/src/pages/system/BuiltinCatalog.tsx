import { Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useIntegrationCatalog } from '@/lib/queries'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { IntegrationDialog } from './forms/IntegrationDialog'

function exportAuthLabel(item: NonNullable<ReturnType<typeof useIntegrationCatalog>['data']>[number], exportId: string): string {
  const auth = item.exportDetails[exportId]?.auth
  if (auth?.kind === 'none') return '无需凭证'
  if (auth?.kind === 'oauth') return 'OAuth 授权'
  if (auth?.kind === 'fields') return auth.fields.map(field => field.key).join(', ')
  if (auth?.kind === 'single') return auth.required ? '单值凭证 *' : '单值凭证（可选）'
  return '契约缺失'
}

function exportConfigLabel(item: NonNullable<ReturnType<typeof useIntegrationCatalog>['data']>[number], exportId: string): string {
  const fields = item.exportDetails[exportId]?.mountConfigFields
  return fields?.map(field => (field.required === true ? `${field.key}*` : field.key)).join(', ') ?? '—'
}

/**
 * 内置集成目录(对等 `tb integration catalog`)。
 *
 * 内置插件的 descriptor 是编译期常量(catalog),不落库,所以没有注册状态；直接挂载即可用。
 * 数据来自 `system/catalog`(read),包含逐 export 的 kind、凭证和挂载配置契约。
 */
export function BuiltinCatalog() {
  const catalog = useIntegrationCatalog()
  const [search, setSearch] = useState('')

  // 包进 useMemo:裸 `?? []` 每次渲染都是新引用,下面的过滤 memo 会失效。
  const all = useMemo(() => catalog.data ?? [], [catalog.data])
  const items = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (needle === '') return all
    return all.filter(
      i =>
        i.id.toLowerCase().includes(needle)
        || (i.description ?? '').toLowerCase().includes(needle),
    )
  }, [all, search])

  if (catalog.isLoading) return <Skeleton className="h-40 w-full" />

  if (catalog.isError) {
    return (
      <p className="rounded-lg border bg-card/55 p-4 text-sm text-muted-foreground">
        读取内置目录失败:
        {catalog.error.message}
      </p>
    )
  }

  if (all.length === 0) {
    return (
      <div className="rounded-lg border bg-card/55 p-4 text-sm text-muted-foreground">
        <p>这个宿主没有装配内置集成。</p>
        <p className="mt-1 text-xs">
          装配发生在**构建期**:宿主同时传
          {' '}
          <code className="font-mono">builtinPluginBindings</code>
          (代码)与
          {' '}
          <code className="font-mono">BUILTIN_CATALOG</code>
          (声明)。见
          {' '}
          <code className="font-mono">packages/gateway/src/deployEntry.ts</code>
          {' '}
          与
          {' '}
          <code className="font-mono">packages/server/src/main.ts</code>
          。
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          这个部署自带
          {' '}
          <span className="font-mono text-foreground">{all.length}</span>
          {' '}
          个集成 · 直接挂载即可用(无需注册)
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              onChange={e => setSearch(e.target.value)}
              placeholder="过滤集成"
              value={search}
            />
          </div>
          <IntegrationDialog />
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>集成</TableHead>
              <TableHead>可挂 kind</TableHead>
              <TableHead>Export</TableHead>
              <TableHead>凭证</TableHead>
              <TableHead>配置</TableHead>
              <TableHead className="w-24">
                <span className="sr-only">操作</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(item => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="font-mono text-xs">{item.id}</div>
                  {item.description !== undefined && (
                    <div className="text-xs text-muted-foreground">{item.description}</div>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {item.nodeKinds.join(' · ')}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {item.exports.join(', ')}
                </TableCell>
                <TableCell>
                  <div className="grid gap-1">
                    {item.exports.map(exportId => (
                      <div className="text-xs text-muted-foreground" key={exportId}>
                        {item.exports.length > 1 && (
                          <span className="font-mono text-foreground">
                            {exportId}
                            {': '}
                          </span>
                        )}
                        {exportAuthLabel(item, exportId) === 'OAuth 授权'
                          ? <Badge variant="outline">OAuth 授权</Badge>
                          : exportAuthLabel(item, exportId)}
                      </div>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="grid gap-1 font-mono text-xs text-muted-foreground">
                    {item.exports.map(exportId => (
                      <div key={exportId}>
                        {item.exports.length > 1 && (
                          <span className="text-foreground">
                            {exportId}
                            {': '}
                          </span>
                        )}
                        {exportConfigLabel(item, exportId)}
                      </div>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  {/* 目录行内直接挂载:预选该 provider、派生默认路径,不必去顶部再搜一次。 */}
                  <IntegrationDialog
                    defaultProvider={item.id}
                    trigger={(
                      <Button size="sm" variant="outline">
                        <Plus />
                        添加
                      </Button>
                    )}
                  />
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell className="text-sm text-muted-foreground" colSpan={6}>
                  没有匹配「
                  {search}
                  」的集成。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
