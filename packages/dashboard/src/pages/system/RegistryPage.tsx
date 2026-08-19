import {
  Boxes,
  Database,
  ExternalLink,
  FileJson2,
  Globe2,
  KeyRound,
  Layers3,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import type { RegistryNode } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  useIntegrationCatalog,
  useInvoke,
  useOAuthAuthorize,
  useRegistryList,
} from '@/lib/queries'
import { PaginationFooter } from '@/components/PaginationFooter'
import { PresenceBadge } from '@/components/PresenceBadge'
import { ConfirmAction } from '@/components/ConfirmAction'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { KindBadge } from '@/components/KindBadge'
import { derivePresence } from '@/lib/presence'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { encodeTreePath } from '@/lib/path'
import { cn } from '@/lib/utils'
import { showsAuthorizeAction } from './forms/registryConfig'
import { IntegrationDialog } from './forms/IntegrationDialog'
import { MountDialog } from './forms/MountDialog'

const KIND_FILTERS = [
  'all',
  'mcp',
  'http',
  'context',
  'skillhub',
  'remote',
  'device',
  'tool',
] as const
type KindFilter = (typeof KIND_FILTERS)[number]

function isBuiltinPluginNode(node: RegistryNode, builtinProviders: Set<string>): boolean {
  const provider = node.config?.provider
  return (node.kind === 'tool' || node.kind === 'context')
    && typeof provider === 'string'
    && builtinProviders.has(provider)
}

function configSummary(
  node: RegistryNode,
  builtinProviders: Set<string>,
): { detail: string, target: string } {
  const config = node.config ?? {}
  const value = (key: string) => (typeof config[key] === 'string' ? config[key] : '')
  switch (node.kind) {
    case 'mcp':
      return {
        target: value('url') || 'MCP server',
        detail:
          config.auth === 'oauth'
            ? '托管 OAuth'
            : value('authRef')
              ? `authRef · ${value('authRef')}`
              : '公开连接',
      }
    case 'http':
      return {
        target: value('endpoint') || 'HTTP endpoint',
        detail: value('authRef') ? `authRef · ${value('authRef')}` : '无凭证引用',
      }
    case 'context':
      return {
        target: value('provider') || 'context provider',
        detail: config.readOnly ? '只读 namespace' : '可读写 namespace',
      }
    case 'skillhub':
      return {
        target: value('provider') || 'skill provider',
        detail: config.readOnly ? '只读技能目录' : '可发布技能目录',
      }
    case 'remote':
      return {
        target: value('baseUrl') || 'HTBP remote',
        detail: value('skRef') ? `skRef · ${value('skRef')}` : '无远端凭证引用',
      }
    case 'tool':
      return {
        target: value('provider') || 'tool-provider plugin',
        detail: isBuiltinPluginNode(node, builtinProviders)
          ? value('authRef') ? '凭证由平台保管' : '无需服务商凭证'
          : value('authRef') ? `authRef · ${value('authRef')}` : '平台 Provider',
      }
    default:
      return { target: node.kind, detail: 'registry node' }
  }
}

/** 内置集成的详情视图隐藏内部引用实现；外部/协议级节点仍保留原始配置。 */
function registryNodeForDisplay(
  node: RegistryNode,
  builtinProviders: Set<string>,
): RegistryNode & { credential?: string } {
  if (!isBuiltinPluginNode(node, builtinProviders) || typeof node.config?.authRef !== 'string') {
    return node
  }
  const config = { ...node.config }
  delete config.authRef
  return { ...node, config, credential: 'managed by platform' }
}

function RegistryMetric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  detail: string
  icon: typeof Boxes
  label: string
  value: number
}) {
  return (
    <div className="rounded-lg border bg-card/55 p-4">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{label}</span>
        <Icon className="size-4" />
      </div>
      <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  )
}

function ConfigFact({ label, value }: { label: string, value: string }) {
  return (
    <div className="rounded-md border bg-muted/10 p-3">
      <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1.5 truncate font-mono text-xs" title={value}>
        {value}
      </p>
    </div>
  )
}

/**
 * 节点注册管理(对等 `tb tool mount|rm` / `tb server add|ls|rm` / `tb ctx mount|unmount`;
 * E2E-6 ④ 的 Dashboard 写路径)。底层同一接口:POST /system/registry {tool: list|write|delete}。
 */
export function RegistryPage() {
  const list = useRegistryList()
  const catalog = useIntegrationCatalog()
  const invoke = useInvoke()
  const oauth = useOAuthAuthorize()
  const qc = useQueryClient()
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [search, setSearch] = useState('')
  const [inspecting, setInspecting] = useState<RegistryNode | null>(null)
  const builtinProviders = useMemo(
    () => new Set((catalog.data ?? []).map(item => item.id)),
    [catalog.data],
  )
  const displayedInspection = inspecting === null
    ? null
    : registryNodeForDisplay(inspecting, builtinProviders)

  const unmount = async (path: string) => {
    try {
      await invoke.mutateAsync({ path: 'system/registry', tool: 'delete', args: { path } })
      toast.success(`已卸载 ${path}`)
      await qc.invalidateQueries({ queryKey: ['tb'] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '卸载节点失败')
      throw error
    }
  }

  // auth:'oauth' 挂载的授权入口(对等 tb tool auth):redirect → 新标签打开 AS 授权页。
  // 严格上游(DCR 只放行 localhost 回调,如 Bytebase)→ 指引 CLI --local 通道。
  //
  // 两类节点走这个入口:auth:'oauth' 的 mcp 挂载,以及 export 声明了 oauth 的 plugin
  // tool 挂载(provider 型托管流程,两者是两套机制、共用 `~authorize`)。
  // **tool 节点无法在前端精确判定**:oauth 声明在 plugin 的 `~describe` 里,不在节点
  // 记录的 config 里,而列表页只有后者。故对所有 tool 节点都给按钮 —— 平台侧对
  // 非 oauth 的 export 会回 invalid_argument 并说清原因(register.ts 的分派同此判据:
  // 先按 kind 分派,再由 authorizeToolNode 查 export)。让按钮在少数情况下点了报错,
  // 好过让 oauth 型 tool 挂载**完全没有入口**(那是管理旁路)。
  const authorize = (path: string) => {
    oauth.mutate(path, {
      onSuccess: (r) => {
        if (r.status === 'authorized') {
          toast.success(`${path} 已授权(凭证有效)`)
          return
        }
        if (r.authorizationUrl) {
          window.open(r.authorizationUrl, '_blank', 'noopener')
          toast.info('已打开授权页,完成授权后即可调用')
        }
      },
      onError: e =>
        toast.error(
          /redirect/i.test(e.message)
            ? `该上游只允许 localhost 回调,请用 CLI 完成授权:tb tool auth ${path} --local`
            : e.message,
        ),
    })
  }

  const mounted = (list.data?.items ?? []).filter(
    n => n.path !== 'system' && !n.path.startsWith('system/'),
  )
  const needle = search.trim().toLowerCase()
  const items = mounted.filter(
    n =>
      (kindFilter === 'all' || n.kind === kindFilter)
      && (needle === ''
        || n.path.toLowerCase().includes(needle)
        || n.description.toLowerCase().includes(needle)),
  )
  const countByKind = (k: KindFilter) =>
    k === 'all' ? mounted.length : mounted.filter(n => n.kind === k).length

  const serviceCount = mounted.filter(node => ['mcp', 'http', 'tool'].includes(node.kind)).length
  const contextCount = mounted.filter(node => node.kind === 'context').length
  const skillhubCount = mounted.filter(node => node.kind === 'skillhub').length
  const remoteCount = mounted.filter(node => node.kind === 'remote').length

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <PageHeader
        actions={(
          <div className="flex flex-wrap gap-2">
            {/* 常见路径在前:挂一个现成集成。通用挂载器降为次要按钮。 */}
            <IntegrationDialog />
            <MountDialog
              existingNodes={mounted}
              existingPaths={mounted.map(node => node.path)}
              hasUnloadedPaths={Boolean(list.hasNextPage)}
              trigger={(
                <Button size="sm" variant="outline">
                  <Plus />
                  挂载节点
                </Button>
              )}
            />
          </div>
        )}
        description="把 MCP、HTTP、Plugin、Context 与远端 HTBP 服务挂入统一能力树，并集中查看连接与认证边界。"
        eyebrow="SYSTEM / REGISTRY"
        title="节点注册"
      />

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <RegistryMetric detail="全部资源" icon={Boxes} label="已加载挂载" value={mounted.length} />
        <RegistryMetric
          detail="MCP · HTTP · Plugin"
          icon={Layers3}
          label="工具服务"
          value={serviceCount}
        />
        <RegistryMetric
          detail={`Context ${contextCount} · Skillhub ${skillhubCount}`}
          icon={Database}
          label="内容节点"
          value={contextCount + skillhubCount}
        />
        <RegistryMetric detail="联邦 HTBP" icon={Globe2} label="Remote" value={remoteCount} />
      </div>

      <section className="mt-4 overflow-hidden rounded-lg border bg-card/45">
        <div className="flex flex-col gap-3 border-b p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="flex max-w-full overflow-x-auto rounded-md border bg-background/60">
            {KIND_FILTERS.map((kind) => {
              const count = countByKind(kind)
              return (
                <button
                  className={cn(
                    'min-h-8 border-r px-3 font-mono text-[10px] whitespace-nowrap last:border-r-0',
                    kindFilter === kind
                      ? 'bg-primary/10 text-primary shadow-[inset_0_-2px_var(--primary)]'
                      : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                  )}
                  key={kind}
                  onClick={() => setKindFilter(kind)}
                  type="button"
                >
                  {kind === 'all' ? '全部' : kind}
                  <span className="ml-1.5 tabular-nums opacity-60">{count}</span>
                </button>
              )
            })}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="搜索挂载节点"
              className="h-9 bg-background/70 pl-9 font-mono text-xs"
              onChange={event => setSearch(event.target.value)}
              placeholder="搜索 path 或描述"
              value={search}
            />
          </div>
        </div>

        {list.isPending
          ? (
              <div className="grid gap-2 p-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-5/6" />
              </div>
            )
          : list.isError
            ? (
                <EmptyState
                  action={(
                    <Button onClick={() => void list.refetch()} size="sm" variant="outline">
                      重试
                    </Button>
                  )}
                  className="m-4"
                  icon={Boxes}
                  title="注册表读取失败"
                  tone="danger"
                >
                  <p>{list.error.message}</p>
                </EmptyState>
              )
            : items.length === 0
              ? (
                  <EmptyState
                    action={
                      mounted.length > 0
                        ? (
                            <Button
                              onClick={() => {
                                setKindFilter('all')
                                setSearch('')
                              }}
                              size="sm"
                              variant="outline"
                            >
                              清除筛选
                            </Button>
                          )
                        : undefined
                    }
                    className="m-4"
                    icon={Boxes}
                    title={mounted.length === 0 ? '还没有挂载任何节点' : '没有符合筛选条件的节点'}
                  >
                    {mounted.length === 0 && <p>使用“挂载节点”，或通过 CLI 挂载工具与 Context。</p>}
                  </EmptyState>
                )
              : (
                  <Table className="min-w-[1040px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>资源身份</TableHead>
                        <TableHead className="w-28">Kind</TableHead>
                        <TableHead>连接 / Provider</TableHead>
                        <TableHead className="w-40">注册来源</TableHead>
                        <TableHead className="w-28">状态</TableHead>
                        <TableHead className="w-40">
                          <span className="sr-only">操作</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((node) => {
                        const summary = configSummary(node, builtinProviders)
                        return (
                          <TableRow key={node.path}>
                            <TableCell className="max-w-80 whitespace-normal">
                              <button
                                className="block max-w-full text-left outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={() => setInspecting(node)}
                                type="button"
                              >
                                <span className="block truncate font-mono text-xs text-foreground">
                                  {node.path}
                                </span>
                                <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">
                                  {node.description}
                                </span>
                              </button>
                            </TableCell>
                            <TableCell>
                              <KindBadge kind={node.kind} />
                            </TableCell>
                            <TableCell className="max-w-80 whitespace-normal">
                              <p className="truncate font-mono text-xs" title={summary.target}>
                                {summary.target}
                              </p>
                              <p className="mt-1 text-[11px] text-muted-foreground">{summary.detail}</p>
                            </TableCell>
                            <TableCell>
                              <p
                                className="truncate font-mono text-[11px] text-muted-foreground"
                                title={node.registeredBy}
                              >
                                {node.registeredBy || 'system'}
                              </p>
                              {node.updatedAt && (
                                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                                  {new Date(node.updatedAt).toLocaleDateString()}
                                </p>
                              )}
                            </TableCell>
                            {/*
                              数据源是 system/registry(存储态):device 节点带裸 online +
                              lastSeenAt,非 device 节点两者都缺 → 'registered'。三态在客户端
                              派生,避免把丢了拆除事件的 online 报成在线。
                            */}
                            <TableCell>
                              {node.online === undefined
                                ? (
                                    <Badge className="font-mono text-[10px]" variant="outline">
                                      <span className="size-1.5 rounded-full bg-muted-foreground" />
                                      registered
                                    </Badge>
                                  )
                                : (
                                    <PresenceBadge
                                      state={derivePresence({
                                        online: node.online,
                                        ...(node.lastSeenAt !== undefined
                                          ? { lastSeenAt: node.lastSeenAt }
                                          : {}),
                                      }).state}
                                    />
                                  )}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-1">
                                {showsAuthorizeAction(node) && (
                                  <Button
                                    aria-label={`授权 ${node.path}`}
                                    disabled={oauth.isPending}
                                    onClick={() => authorize(node.path)}
                                    size="icon-sm"
                                    title="OAuth 授权"
                                    variant="ghost"
                                  >
                                    <KeyRound />
                                  </Button>
                                )}
                                <Button
                                  aria-label={`查看 ${node.path} 配置`}
                                  onClick={() => setInspecting(node)}
                                  size="icon-sm"
                                  title="查看配置"
                                  variant="ghost"
                                >
                                  <FileJson2 />
                                </Button>
                                <Button
                                  aria-label={`打开 ${node.path}`}
                                  asChild
                                  size="icon-sm"
                                  variant="ghost"
                                >
                                  <Link to={`/nodes/${encodeTreePath(node.path)}`}>
                                    <ExternalLink />
                                  </Link>
                                </Button>
                                <ConfirmAction
                                  actionLabel="卸载"
                                  description={<p>卸载后该子树不可见；空的中间目录将被回收。</p>}
                                  onConfirm={() => unmount(node.path)}
                                  title={`卸载 ${node.path}?`}
                                  trigger={(
                                    <Button aria-label={`卸载 ${node.path}`} size="icon-sm" variant="ghost">
                                      <Trash2 className="text-destructive" />
                                    </Button>
                                  )}
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
        {!list.isPending && !list.isError && (
          <PaginationFooter
            count={mounted.length}
            hasNextPage={Boolean(list.hasNextPage)}
            isFetchingNextPage={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
            unit="个节点"
          />
        )}
      </section>

      {/* 节点配置查看(registry get 的展示面;凭证只以 authRef 名义出现) */}
      <Dialog onOpenChange={next => !next && setInspecting(null)} open={inspecting !== null}>
        <DialogContent className="top-0 right-0 bottom-0 left-auto flex h-dvh max-h-none w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-xl">
          <DialogHeader className="border-b px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-center gap-2 pr-8">
              <DialogTitle className="font-mono text-base">{inspecting?.path}</DialogTitle>
              {inspecting && <KindBadge kind={inspecting.kind} />}
            </div>
            <DialogDescription>
              内置集成的凭证由平台管理；这里不展示密钥或内部引用。
            </DialogDescription>
          </DialogHeader>
          {inspecting && (
            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <ConfigFact label="Kind" value={inspecting.kind} />
                <ConfigFact label="Registered by" value={inspecting.registeredBy || 'system'} />
                <ConfigFact
                  label="Created"
                  value={
                    inspecting.createdAt ? new Date(inspecting.createdAt).toLocaleString() : '—'
                  }
                />
                <ConfigFact
                  label="Updated"
                  value={
                    inspecting.updatedAt ? new Date(inspecting.updatedAt).toLocaleString() : '—'
                  }
                />
              </div>
              <p className="mt-5 text-sm leading-6 text-muted-foreground">
                {inspecting.description}
              </p>
              <div className="relative mt-5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    Registry configuration
                  </p>
                  <CopyButton label="复制配置" value={JSON.stringify(displayedInspection, null, 2)} />
                </div>
                <pre className="max-h-[55vh] overflow-auto rounded-lg border bg-card px-4 py-3 font-mono text-xs leading-relaxed">
                  {JSON.stringify(displayedInspection, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
