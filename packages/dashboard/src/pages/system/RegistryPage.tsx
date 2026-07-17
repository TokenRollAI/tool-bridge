import {
  Boxes,
  Database,
  ExternalLink,
  FileJson2,
  Globe2,
  KeyRound,
  Layers3,
  Loader2,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import type { RegistryNode } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useInvoke, useOAuthAuthorize, usePluginList, useRegistryList } from '@/lib/queries'
import { PaginationFooter } from '@/components/PaginationFooter'
import { ConfirmAction } from '@/components/ConfirmAction'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { KindBadge } from '@/components/KindBadge'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

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

function configSummary(node: RegistryNode): { detail: string, target: string } {
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
        detail: value('authRef') ? `authRef · ${value('authRef')}` : '平台 Provider',
      }
    default:
      return { target: node.kind, detail: 'registry node' }
  }
}

/**
 * 节点注册管理(对等 `tb tool mount|rm` / `tb server add|ls|rm` / `tb ctx mount|unmount`;
 * E2E-6 ④ 的 Dashboard 写路径)。底层同一接口:POST /system/registry {tool: list|write|delete}。
 */
export function RegistryPage() {
  const list = useRegistryList()
  const invoke = useInvoke()
  const oauth = useOAuthAuthorize()
  const qc = useQueryClient()
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [search, setSearch] = useState('')
  const [inspecting, setInspecting] = useState<RegistryNode | null>(null)

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
          <MountDialog
            existingPaths={mounted.map(node => node.path)}
            hasUnloadedPaths={Boolean(list.hasNextPage)}
          />
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
                        const summary = configSummary(node)
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
                            <TableCell>
                              <Badge
                                className={cn(
                                  'font-mono text-[10px]',
                                  node.online === true && 'border-ok/35 bg-ok/[0.045] text-ok',
                                  node.online === false && 'text-muted-foreground',
                                )}
                                variant="outline"
                              >
                                <span
                                  className={cn(
                                    'size-1.5 rounded-full bg-muted-foreground',
                                    node.online === true && 'bg-ok',
                                  )}
                                />
                                {node.online === undefined
                                  ? 'registered'
                                  : node.online
                                    ? 'online'
                                    : 'offline'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-1">
                                {node.kind === 'mcp' && node.config?.auth === 'oauth' && (
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
                                  <Link to={`/nodes/${node.path}`}>
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
              注册配置只展示 authRef / skRef 等引用，不包含凭证明文。
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
                    Raw registry record
                  </p>
                  <CopyButton label="复制配置" value={JSON.stringify(inspecting, null, 2)} />
                </div>
                <pre className="max-h-[55vh] overflow-auto rounded-lg border bg-card px-4 py-3 font-mono text-xs leading-relaxed">
                  {JSON.stringify(inspecting, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
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

type MountKind = 'mcp' | 'http' | 'context' | 'skillhub' | 'remote' | 'tool'

/**
 * 挂载表单(按 kind 分支出 NodeConfig;tool 与 context 可引用已注册 plugin 为 provider)。
 * 可复用:`defaultPath` 预填 path(打开时);`trigger` 自定义触发按钮(缺省回退默认)。
 */
export function MountDialog({
  existingPaths,
  hasUnloadedPaths = false,
  defaultPath,
  trigger,
}: {
  defaultPath?: string
  existingPaths: string[]
  hasUnloadedPaths?: boolean
  trigger?: ReactNode
}) {
  const invoke = useInvoke()
  const oauth = useOAuthAuthorize()
  const qc = useQueryClient()
  const plugins = usePluginList()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<MountKind>('mcp')
  const [path, setPath] = useState(defaultPath ?? '')
  const [description, setDescription] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const normalizedPath = path.trim()
  const isReplacement = normalizedPath !== '' && existingPaths.includes(normalizedPath)
  const mayReplaceUnloaded = normalizedPath !== '' && !isReplacement && hasUnloadedPaths
  // mcp(auth:none = 无凭证;authRef = 静态 Bearer;oauth = 网关托管 OAuth,挂载后即发起授权)
  const [mcpUrl, setMcpUrl] = useState('')
  const [mcpAuthMode, setMcpAuthMode] = useState<'none' | 'authRef' | 'oauth'>('none')
  const [mcpAuthRef, setMcpAuthRef] = useState('')
  const [mcpAuthHeader, setMcpAuthHeader] = useState('')
  // 凭证前缀三态:bearer = 缺省(Bearer)、raw = 空串原样注入、custom = 自定义前缀
  const [mcpSchemeMode, setMcpSchemeMode] = useState<'bearer' | 'raw' | 'custom'>('bearer')
  const [mcpAuthScheme, setMcpAuthScheme] = useState('')
  const [mcpHeadersSpec, setMcpHeadersSpec] = useState('')
  // 虚拟化(mcp/http/tool 共用;对等 CLI --prefix/--rename/--hide/--describe)
  const [prefix, setPrefix] = useState('')
  const [renameSpec, setRenameSpec] = useState('')
  const [hideSpec, setHideSpec] = useState('')
  const [describeSpec, setDescribeSpec] = useState('')
  // http
  const [endpoint, setEndpoint] = useState('')
  const [toolsJson, setToolsJson] = useState(
    '[\n  {\n    "name": "echo",\n    "description": "…",\n    "method": "POST",\n    "pathTemplate": "/post"\n  }\n]',
  )
  const [httpAuthRef, setHttpAuthRef] = useState('')
  const [authHeader, setAuthHeader] = useState('')
  const [httpSchemeMode, setHttpSchemeMode] = useState<'bearer' | 'raw' | 'custom'>('bearer')
  const [authScheme, setAuthScheme] = useState('')
  // context(provider = r2 | s3 | 已注册 context-provider plugin id)
  const [provider, setProvider] = useState('r2')
  const [ctxPrefix, setCtxPrefix] = useState('')
  const [s3Endpoint, setS3Endpoint] = useState('')
  const [s3Bucket, setS3Bucket] = useState('')
  const [s3Region, setS3Region] = useState('')
  const [ctxAuthRef, setCtxAuthRef] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [ttl, setTtl] = useState('')
  // skillhub(provider = r2 | s3;与 context 同形,复用 ctxPrefix/s3*/ctxAuthRef/readOnly/ttl)
  const [skillProvider, setSkillProvider] = useState('r2')
  // remote
  const [baseUrl, setBaseUrl] = useState('')
  const [skRef, setSkRef] = useState('')
  // tool(plugin 工具源)
  const [toolProvider, setToolProvider] = useState('')
  const [toolAuthRef, setToolAuthRef] = useState('')

  const pluginItems = plugins.data?.items ?? []
  const toolPlugins = pluginItems.filter(p => p.kind === 'tool-provider')
  const ctxPlugins = pluginItems.filter(p => p.kind === 'context-provider')

  /** "from=to" 行 → Record(与 CLI buildVirtualize 同规则;非法行即抛)。 */
  const parsePairs = (spec: string, flag: string): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const line of spec.split('\n')) {
      const s = line.trim()
      if (!s) continue
      const idx = s.indexOf('=')
      const from = idx < 0 ? '' : s.slice(0, idx).trim()
      const to = idx < 0 ? '' : s.slice(idx + 1).trim()
      if (!from || !to) throw new Error(`${flag} 每行须为 "from=to" 形式:"${s}"`)
      out[from] = to
    }
    return out
  }

  const buildVirt = (): Record<string, unknown> | undefined => {
    if (kind !== 'mcp' && kind !== 'http' && kind !== 'tool') return undefined
    const v: Record<string, unknown> = {}
    if (prefix.trim()) v.prefix = prefix.trim()
    const rename = parsePairs(renameSpec, 'rename')
    if (Object.keys(rename).length) v.rename = rename
    const hide = hideSpec
      .split(/[,\n]/)
      .map(s => s.trim())
      .filter(Boolean)
    if (hide.length) v.hide = hide
    const describe = parsePairs(describeSpec, 'describe')
    if (Object.keys(describe).length) v.describe = describe
    return Object.keys(v).length ? v : undefined
  }

  const parseTtl = (): number | undefined => {
    if (!ttl.trim()) return undefined
    const n = Number(ttl.trim())
    if (!Number.isInteger(n) || n <= 0) throw new Error('ttl 须为正整数秒')
    return n
  }

  const buildConfig = (): Record<string, unknown> => {
    switch (kind) {
      case 'mcp': {
        if (!mcpUrl.trim()) throw new Error('url 必填')
        if (mcpAuthMode === 'authRef' && !mcpAuthRef.trim()) {
          throw new Error('authRef 必填(先在「凭证保管」set)')
        }
        const headers = parsePairs(mcpHeadersSpec, 'headers')
        return {
          kind: 'mcp',
          url: mcpUrl.trim(),
          ...(mcpAuthMode === 'authRef' ? { authRef: mcpAuthRef.trim() } : {}),
          ...(mcpAuthMode === 'oauth' ? { auth: 'oauth' } : {}),
          ...(mcpAuthMode === 'authRef' && mcpAuthHeader.trim()
            ? { authHeader: mcpAuthHeader.trim() }
            : {}),
          ...(mcpAuthMode === 'authRef'
            ? mcpSchemeMode === 'raw'
              ? { authScheme: '' }
              : mcpSchemeMode === 'custom' && mcpAuthScheme.trim()
                ? { authScheme: mcpAuthScheme.trim() }
                : {}
            : {}),
          ...(Object.keys(headers).length ? { headers } : {}),
        }
      }
      case 'http': {
        if (!endpoint.trim()) throw new Error('endpoint 必填')
        let tools: unknown
        try {
          tools = JSON.parse(toolsJson)
        } catch {
          throw new Error('tools 不是合法 JSON')
        }
        if (!Array.isArray(tools) || tools.length === 0) throw new Error('tools 需为非空数组')
        return {
          kind: 'http',
          endpoint: endpoint.trim(),
          tools,
          ...(httpAuthRef.trim() ? { authRef: httpAuthRef.trim() } : {}),
          ...(authHeader.trim() ? { authHeader: authHeader.trim() } : {}),
          ...(httpSchemeMode === 'raw'
            ? { authScheme: '' }
            : httpSchemeMode === 'custom' && authScheme.trim()
              ? { authScheme: authScheme.trim() }
              : {}),
        }
      }
      case 'context': {
        const ttlSeconds = parseTtl()
        if (provider === 's3') {
          if (!s3Endpoint.trim() || !s3Bucket.trim()) throw new Error('s3 需要 endpoint 与 bucket')
          if (!ctxAuthRef.trim()) throw new Error('s3 需要 authRef(先在「凭证保管」set)')
          return {
            kind: 'context',
            provider: 's3',
            providerConfig: {
              endpoint: s3Endpoint.trim(),
              bucket: s3Bucket.trim(),
              ...(s3Region.trim() ? { region: s3Region.trim() } : {}),
              ...(ctxPrefix.trim() ? { prefix: ctxPrefix.trim() } : {}),
            },
            authRef: ctxAuthRef.trim(),
            ...(readOnly ? { readOnly: true } : {}),
            ...(ttlSeconds !== undefined ? { ttl: ttlSeconds } : {}),
          }
        }
        if (provider === 'r2') {
          return {
            kind: 'context',
            provider: 'r2',
            ...(ctxPrefix.trim() ? { providerConfig: { prefix: ctxPrefix.trim() } } : {}),
            ...(readOnly ? { readOnly: true } : {}),
            ...(ttlSeconds !== undefined ? { ttl: ttlSeconds } : {}),
          }
        }
        // context-provider plugin:provider = plugin id(存储细节在 plugin 侧)
        return {
          kind: 'context',
          provider,
          ...(ctxAuthRef.trim() ? { authRef: ctxAuthRef.trim() } : {}),
          ...(readOnly ? { readOnly: true } : {}),
          ...(ttlSeconds !== undefined ? { ttl: ttlSeconds } : {}),
        }
      }
      case 'skillhub': {
        // skillhub 与 context 配置形状一致(provider r2|s3),复用同一组表单状态。
        const ttlSeconds = parseTtl()
        if (skillProvider === 's3') {
          if (!s3Endpoint.trim() || !s3Bucket.trim()) throw new Error('s3 需要 endpoint 与 bucket')
          if (!ctxAuthRef.trim()) throw new Error('s3 需要 authRef(先在「凭证保管」set)')
          return {
            kind: 'skillhub',
            provider: 's3',
            providerConfig: {
              endpoint: s3Endpoint.trim(),
              bucket: s3Bucket.trim(),
              ...(s3Region.trim() ? { region: s3Region.trim() } : {}),
              ...(ctxPrefix.trim() ? { prefix: ctxPrefix.trim() } : {}),
            },
            authRef: ctxAuthRef.trim(),
            ...(readOnly ? { readOnly: true } : {}),
            ...(ttlSeconds !== undefined ? { ttl: ttlSeconds } : {}),
          }
        }
        return {
          kind: 'skillhub',
          provider: 'r2',
          ...(ctxPrefix.trim() ? { providerConfig: { prefix: ctxPrefix.trim() } } : {}),
          ...(readOnly ? { readOnly: true } : {}),
          ...(ttlSeconds !== undefined ? { ttl: ttlSeconds } : {}),
        }
      }
      case 'remote':
        if (!baseUrl.trim()) throw new Error('baseUrl 必填')
        return {
          kind: 'remote',
          baseUrl: baseUrl.trim(),
          ...(skRef.trim() ? { skRef: skRef.trim() } : {}),
        }
      case 'tool':
        if (!toolProvider)
          throw new Error('先选择一个 tool-provider plugin(没有则去「Plugin」注册)')
        return {
          kind: 'tool',
          provider: toolProvider,
          ...(toolAuthRef.trim() ? { authRef: toolAuthRef.trim() } : {}),
        }
    }
  }

  const submit = () => {
    if (!path.trim() || !description.trim()) {
      setErr('path 与描述必填')
      return
    }
    let config: Record<string, unknown>
    let virtualize: Record<string, unknown> | undefined
    try {
      config = buildConfig()
      virtualize = buildVirt()
    } catch (e) {
      setErr((e as Error).message)
      return
    }
    invoke.mutate(
      {
        path: 'system/registry',
        tool: 'write',
        args: {
          path: path.trim(),
          kind,
          description: description.trim(),
          config,
          ...(virtualize ? { virtualize } : {}),
        },
      },
      {
        onSuccess: () => {
          const mounted = path.trim()
          toast.success(
            isReplacement
              ? `已替换挂载 ${mounted}`
              : mayReplaceUnloaded
                ? `已写入挂载 ${mounted}`
                : `已挂载 ${mounted}`,
          )
          setOpen(false)
          setErr(null)
          setPath('')
          setDescription('')
          qc.invalidateQueries({ queryKey: ['tb'] })
          // oauth 挂载:挂载完立即发起授权(redirect → 新标签打开 AS 授权页)。
          if (kind === 'mcp' && mcpAuthMode === 'oauth') {
            oauth.mutate(mounted, {
              onSuccess: (r) => {
                if (r.status === 'authorized') {
                  toast.success(`${mounted} 已授权(凭证有效)`)
                } else if (r.authorizationUrl) {
                  window.open(r.authorizationUrl, '_blank', 'noopener')
                  toast.info('已打开授权页,完成授权后即可调用')
                }
              },
              onError: e =>
                toast.error(
                  /redirect/i.test(e.message)
                    ? `该上游只允许 localhost 回调,请用 CLI 完成授权:tb tool auth ${mounted} --local`
                    : `发起授权失败:${e.message}(可稍后在列表点钥匙重试)`,
                ),
            })
          }
        },
        onError: e => setErr(e.message),
      },
    )
  }

  const changeOpen = (next: boolean) => {
    if (invoke.isPending) return
    setOpen(next)
    if (next) {
      setErr(null)
      // 每次打开都回到调用方给定的前缀(如节点页「挂载子节点」预填 `skills/`)。
      if (defaultPath !== undefined) setPath(defaultPath)
    }
  }

  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus />
            挂载节点
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="top-0 right-0 bottom-0 left-auto flex h-dvh max-h-none w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-3xl"
        showCloseButton={!invoke.isPending}
      >
        <DialogHeader className="border-b px-5 py-5 sm:px-7">
          <DialogTitle className="pr-8 text-lg">
            {isReplacement ? '替换现有节点' : '挂载节点'}
          </DialogTitle>
          <DialogDescription>
            <code className="font-mono text-xs">system/registry write</code>
            {' '}
            是 upsert：同 path
            会替换原记录。切换 kind 不会清空各分支草稿；凭证只通过 authRef 引用。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          <div className="grid gap-5">
            <FormSection
              description="确定节点在能力树中的位置、类型与面向使用者的说明。"
              index="01"
              title="基础身份"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label className="text-xs">kind</Label>
                  <Select onValueChange={v => setKind(v as MountKind)} value={kind}>
                    <SelectTrigger className="font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem className="font-mono text-xs" value="mcp">
                        mcp — MCP server
                      </SelectItem>
                      <SelectItem className="font-mono text-xs" value="http">
                        http — HTTP endpoint
                      </SelectItem>
                      <SelectItem className="font-mono text-xs" value="context">
                        context — 存储 namespace
                      </SelectItem>
                      <SelectItem className="font-mono text-xs" value="skillhub">
                        skillhub — Agent 技能目录
                      </SelectItem>
                      <SelectItem className="font-mono text-xs" value="remote">
                        remote — 联邦 HTBP 服务
                      </SelectItem>
                      <SelectItem className="font-mono text-xs" value="tool">
                        tool — plugin 工具源
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs" htmlFor="mount-path">
                    path *
                  </Label>
                  <Input
                    className="font-mono text-sm"
                    id="mount-path"
                    onChange={e => setPath(e.target.value)}
                    placeholder="docs/context7"
                    value={path}
                  />
                </div>
              </div>

              {(isReplacement || mayReplaceUnloaded) && (
                <div className="flex items-start gap-2.5 rounded-lg border border-warn/30 bg-warn/[0.045] px-3 py-2.5 text-xs">
                  <TriangleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 text-warn"
                  />
                  <p>
                    <span className="font-medium text-warn">
                      {isReplacement
                        ? '这个 path 已存在。'
                        : '列表还有未加载页，该 path 可能已经存在。'}
                    </span>
                    {' '}
                    继续写入会整体替换同 path 的 kind、描述、连接配置与虚拟化设置。
                  </p>
                </div>
              )}

              <div className="grid gap-1.5">
                <Label className="text-xs" htmlFor="mount-desc">
                  描述 *
                </Label>
                <Input
                  className="text-sm"
                  id="mount-desc"
                  onChange={e => setDescription(e.target.value)}
                  value={description}
                />
              </div>
            </FormSection>

            <FormSection
              description="配置 Provider、端点与凭证引用；认证材料本体始终留在凭证保管中。"
              index="02"
              title="连接与认证"
            >
              {kind === 'mcp' && (
                <>
                  <div className="grid gap-1.5">
                    <Label className="text-xs" htmlFor="mcp-url">
                      url *(Streamable HTTP)
                    </Label>
                    <Input
                      className="font-mono text-xs"
                      id="mcp-url"
                      onChange={e => setMcpUrl(e.target.value)}
                      placeholder="https://mcp.example.com/mcp"
                      value={mcpUrl}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label className="text-xs">上游认证</Label>
                      <Select
                        onValueChange={v => setMcpAuthMode(v as typeof mcpAuthMode)}
                        value={mcpAuthMode}
                      >
                        <SelectTrigger className="font-mono text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem className="font-mono text-xs" value="none">
                            无(公开上游)
                          </SelectItem>
                          <SelectItem className="font-mono text-xs" value="authRef">
                            authRef — 静态凭证
                          </SelectItem>
                          <SelectItem className="font-mono text-xs" value="oauth">
                            oauth — 网关托管 OAuth
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {mcpAuthMode === 'authRef' && (
                      <div className="grid gap-1.5">
                        <Label className="text-xs" htmlFor="mcp-auth">
                          authRef *(凭证保管里的名字)
                        </Label>
                        <Input
                          className="font-mono text-xs"
                          id="mcp-auth"
                          onChange={e => setMcpAuthRef(e.target.value)}
                          value={mcpAuthRef}
                        />
                      </div>
                    )}
                  </div>
                  {mcpAuthMode === 'authRef' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label className="text-xs" htmlFor="mcp-auth-header">
                          authHeader(可空)
                        </Label>
                        <Input
                          className="font-mono text-xs"
                          id="mcp-auth-header"
                          onChange={e => setMcpAuthHeader(e.target.value)}
                          placeholder="Authorization"
                          value={mcpAuthHeader}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-xs">authScheme</Label>
                        <Select
                          onValueChange={v => setMcpSchemeMode(v as 'bearer' | 'raw' | 'custom')}
                          value={mcpSchemeMode}
                        >
                          <SelectTrigger className="font-mono text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem className="font-mono text-xs" value="bearer">
                              Bearer(默认)
                            </SelectItem>
                            <SelectItem className="font-mono text-xs" value="raw">
                              无前缀(原样注入)
                            </SelectItem>
                            <SelectItem className="font-mono text-xs" value="custom">
                              自定义前缀
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                  {mcpAuthMode === 'authRef' && mcpSchemeMode === 'custom' && (
                    <div className="grid gap-1.5">
                      <Label className="text-xs" htmlFor="mcp-auth-scheme">
                        自定义 scheme 前缀
                      </Label>
                      <Input
                        className="font-mono text-xs"
                        id="mcp-auth-scheme"
                        onChange={e => setMcpAuthScheme(e.target.value)}
                        placeholder="Token"
                        value={mcpAuthScheme}
                      />
                    </div>
                  )}
                  <div className="grid gap-1.5">
                    <Label className="text-xs" htmlFor="mcp-headers">
                      静态 headers(可空;每行 Name=value,明文非机密)
                    </Label>
                    <Textarea
                      className="font-mono text-xs"
                      id="mcp-headers"
                      onChange={e => setMcpHeadersSpec(e.target.value)}
                      placeholder="X-Lark-MCP-Allowed-Tools=search-doc,fetch-doc"
                      rows={3}
                      spellCheck={false}
                      value={mcpHeadersSpec}
                    />
                  </div>
                  {mcpAuthMode === 'oauth' && (
                    <p className="text-[11px] text-muted-foreground">
                      挂载后自动打开上游授权页(OAuth 授权码 + PKCE,token 由网关保管、自动续期);
                      之后可在列表行的钥匙按钮重新授权。
                    </p>
                  )}
                </>
              )}

              {kind === 'http' && (
                <>
                  <div className="grid gap-1.5">
                    <Label className="text-xs" htmlFor="http-endpoint">
                      endpoint *
                    </Label>
                    <Input
                      className="font-mono text-xs"
                      id="http-endpoint"
                      onChange={e => setEndpoint(e.target.value)}
                      placeholder="https://postman-echo.com"
                      value={endpoint}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs" htmlFor="http-tools">
                      tools *(HttpToolDef[] JSON)
                    </Label>
                    <Textarea
                      className="font-mono text-xs"
                      id="http-tools"
                      onChange={e => setToolsJson(e.target.value)}
                      rows={7}
                      spellCheck={false}
                      value={toolsJson}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="grid gap-1.5">
                      <Label className="text-xs" htmlFor="http-auth">
                        authRef(可空)
                      </Label>
                      <Input
                        className="font-mono text-xs"
                        id="http-auth"
                        onChange={e => setHttpAuthRef(e.target.value)}
                        value={httpAuthRef}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs" htmlFor="http-auth-header">
                        authHeader(可空)
                      </Label>
                      <Input
                        className="font-mono text-xs"
                        id="http-auth-header"
                        onChange={e => setAuthHeader(e.target.value)}
                        placeholder="Authorization"
                        value={authHeader}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">authScheme</Label>
                      <Select
                        onValueChange={v => setHttpSchemeMode(v as 'bearer' | 'raw' | 'custom')}
                        value={httpSchemeMode}
                      >
                        <SelectTrigger className="font-mono text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem className="font-mono text-xs" value="bearer">
                            Bearer(默认)
                          </SelectItem>
                          <SelectItem className="font-mono text-xs" value="raw">
                            无前缀(原样注入)
                          </SelectItem>
                          <SelectItem className="font-mono text-xs" value="custom">
                            自定义前缀
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {httpSchemeMode === 'custom' && (
                    <div className="grid gap-1.5">
                      <Label className="text-xs" htmlFor="http-auth-scheme">
                        自定义 scheme 前缀
                      </Label>
                      <Input
                        className="font-mono text-xs"
                        id="http-auth-scheme"
                        onChange={e => setAuthScheme(e.target.value)}
                        placeholder="Token"
                        value={authScheme}
                      />
                    </div>
                  )}
                </>
              )}

              {kind === 'context' && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label className="text-xs">provider</Label>
                      <Select onValueChange={setProvider} value={provider}>
                        <SelectTrigger className="font-mono text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem className="font-mono text-xs" value="r2">
                            r2(实例自带桶)
                          </SelectItem>
                          <SelectItem className="font-mono text-xs" value="s3">
                            s3(外部 S3 兼容端点)
                          </SelectItem>
                          {ctxPlugins.map(p => (
                            <SelectItem className="font-mono text-xs" key={p.id} value={p.id}>
                              {p.id}
                              (plugin)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {(provider === 'r2' || provider === 's3') && (
                      <div className="grid gap-1.5">
                        <Label className="text-xs" htmlFor="ctx-prefix">
                          key 前缀(可空)
                        </Label>
                        <Input
                          className="font-mono text-xs"
                          id="ctx-prefix"
                          onChange={e => setCtxPrefix(e.target.value)}
                          value={ctxPrefix}
                        />
                      </div>
                    )}
                  </div>
                  {plugins.hasNextPage && (
                    <Button
                      className="justify-self-start"
                      disabled={plugins.isFetchingNextPage}
                      onClick={() => void plugins.fetchNextPage()}
                      size="xs"
                      type="button"
                      variant="ghost"
                    >
                      {plugins.isFetchingNextPage && <Loader2 className="animate-spin" />}
                      继续加载 Plugin（已加载
                      {' '}
                      {pluginItems.length}
                      ）
                    </Button>
                  )}
                  {provider !== 'r2' && provider !== 's3' && (
                    <div className="grid gap-1.5">
                      <Label className="text-xs" htmlFor="ctx-plugin-auth">
                        authRef(可空;上游凭证由平台代解析后注入 Plugin)
                      </Label>
                      <Input
                        className="font-mono text-xs"
                        id="ctx-plugin-auth"
                        onChange={e => setCtxAuthRef(e.target.value)}
                        value={ctxAuthRef}
                      />
                    </div>
                  )}
                  {provider === 's3' && (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <Label className="text-xs" htmlFor="s3-endpoint">
                            endpoint *
                          </Label>
                          <Input
                            className="font-mono text-xs"
                            id="s3-endpoint"
                            onChange={e => setS3Endpoint(e.target.value)}
                            placeholder="https://….r2.cloudflarestorage.com"
                            value={s3Endpoint}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs" htmlFor="s3-bucket">
                            bucket *
                          </Label>
                          <Input
                            className="font-mono text-xs"
                            id="s3-bucket"
                            onChange={e => setS3Bucket(e.target.value)}
                            value={s3Bucket}
                          />
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <Label className="text-xs" htmlFor="s3-region">
                            region(可空,缺省 auto)
                          </Label>
                          <Input
                            className="font-mono text-xs"
                            id="s3-region"
                            onChange={e => setS3Region(e.target.value)}
                            value={s3Region}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs" htmlFor="ctx-auth">
                            authRef *(凭证保管里的名字)
                          </Label>
                          <Input
                            className="font-mono text-xs"
                            id="ctx-auth"
                            onChange={e => setCtxAuthRef(e.target.value)}
                            placeholder="s3-main"
                            value={ctxAuthRef}
                          />
                        </div>
                      </div>
                    </>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
                    <div className="grid gap-1.5">
                      <Label className="text-xs" htmlFor="ctx-ttl">
                        ttl 秒(可空;到期整节点回收)
                      </Label>
                      <Input
                        className="font-mono text-xs"
                        id="ctx-ttl"
                        onChange={e => setTtl(e.target.value)}
                        placeholder="86400"
                        value={ttl}
                      />
                    </div>
                    {/* biome-ignore lint/a11y/noLabelWithoutControl: Radix Checkbox 是 label 内可交互控件,规则只识别原生 input */}
                    <label className="flex items-center gap-2 pb-2 text-xs">
                      <Checkbox
                        checked={readOnly}
                        onCheckedChange={v => setReadOnly(v === true)}
                      />
                      readOnly(拒绝 Write/Update/Delete)
                    </label>
                  </div>
                </>
              )}

              {kind === 'skillhub' && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label className="text-xs">provider</Label>
                      <Select onValueChange={setSkillProvider} value={skillProvider}>
                        <SelectTrigger className="font-mono text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem className="font-mono text-xs" value="r2">
                            r2(实例自带桶)
                          </SelectItem>
                          <SelectItem className="font-mono text-xs" value="s3">
                            s3(外部 S3 兼容端点)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs" htmlFor="skill-prefix">
                        key 前缀(可空)
                      </Label>
                      <Input
                        className="font-mono text-xs"
                        id="skill-prefix"
                        onChange={e => setCtxPrefix(e.target.value)}
                        value={ctxPrefix}
                      />
                    </div>
                  </div>
                  {skillProvider === 's3' && (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <Label className="text-xs" htmlFor="skill-s3-endpoint">
                            endpoint *
                          </Label>
                          <Input
                            className="font-mono text-xs"
                            id="skill-s3-endpoint"
                            onChange={e => setS3Endpoint(e.target.value)}
                            placeholder="https://….r2.cloudflarestorage.com"
                            value={s3Endpoint}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs" htmlFor="skill-s3-bucket">
                            bucket *
                          </Label>
                          <Input
                            className="font-mono text-xs"
                            id="skill-s3-bucket"
                            onChange={e => setS3Bucket(e.target.value)}
                            value={s3Bucket}
                          />
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <Label className="text-xs" htmlFor="skill-s3-region">
                            region(可空,缺省 auto)
                          </Label>
                          <Input
                            className="font-mono text-xs"
                            id="skill-s3-region"
                            onChange={e => setS3Region(e.target.value)}
                            value={s3Region}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs" htmlFor="skill-auth">
                            authRef *(凭证保管里的名字)
                          </Label>
                          <Input
                            className="font-mono text-xs"
                            id="skill-auth"
                            onChange={e => setCtxAuthRef(e.target.value)}
                            placeholder="s3-main"
                            value={ctxAuthRef}
                          />
                        </div>
                      </div>
                    </>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
                    <div className="grid gap-1.5">
                      <Label className="text-xs" htmlFor="skill-ttl">
                        ttl 秒(可空;到期整节点回收)
                      </Label>
                      <Input
                        className="font-mono text-xs"
                        id="skill-ttl"
                        onChange={e => setTtl(e.target.value)}
                        placeholder="86400"
                        value={ttl}
                      />
                    </div>
                    {/* biome-ignore lint/a11y/noLabelWithoutControl: Radix Checkbox 是 label 内可交互控件,规则只识别原生 input */}
                    <label className="flex items-center gap-2 pb-2 text-xs">
                      <Checkbox
                        checked={readOnly}
                        onCheckedChange={v => setReadOnly(v === true)}
                      />
                      readOnly(隐藏 Publish/Remove)
                    </label>
                  </div>
                </>
              )}

              {kind === 'remote' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label className="text-xs" htmlFor="remote-url">
                      baseUrl *(须在白名单内)
                    </Label>
                    <Input
                      className="font-mono text-xs"
                      id="remote-url"
                      onChange={e => setBaseUrl(e.target.value)}
                      placeholder="https://tb.example.com"
                      value={baseUrl}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs" htmlFor="remote-skref">
                      skRef(远端 SK 的 authRef,可空)
                    </Label>
                    <Input
                      className="font-mono text-xs"
                      id="remote-skref"
                      onChange={e => setSkRef(e.target.value)}
                      value={skRef}
                    />
                  </div>
                </div>
              )}

              {kind === 'tool' && (
                <>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">provider *(tool-provider plugin)</Label>
                    <Select onValueChange={setToolProvider} value={toolProvider}>
                      <SelectTrigger className="font-mono text-xs">
                        <SelectValue
                          placeholder={
                            toolPlugins.length === 0 ? '无已注册 plugin' : '选择 plugin…'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {toolPlugins.map(p => (
                          <SelectItem className="font-mono text-xs" key={p.id} value={p.id}>
                            {p.id}
                            {p.enabled ? '' : '(disabled)'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {toolPlugins.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        先在
                        <Link className="mx-0.5 underline underline-offset-2" to="/manage/plugins">
                          Plugin
                        </Link>
                        注册 tool-provider,再回来挂载。
                      </p>
                    )}
                    {plugins.hasNextPage && (
                      <Button
                        className="justify-self-start"
                        disabled={plugins.isFetchingNextPage}
                        onClick={() => void plugins.fetchNextPage()}
                        size="xs"
                        type="button"
                        variant="ghost"
                      >
                        {plugins.isFetchingNextPage && <Loader2 className="animate-spin" />}
                        继续加载 Plugin（已加载
                        {' '}
                        {pluginItems.length}
                        ）
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs" htmlFor="tool-auth">
                      authRef(可空;上游凭证引用,调用时平台代解析经 X-TB-Upstream-Auth 注入)
                    </Label>
                    <Input
                      className="font-mono text-xs"
                      id="tool-auth"
                      onChange={e => setToolAuthRef(e.target.value)}
                      value={toolAuthRef}
                    />
                  </div>
                </>
              )}
            </FormSection>

            {(kind === 'mcp' || kind === 'http' || kind === 'tool') && (
              <FormSection
                description="可选：按 hide → rename → prefix → describe 顺序重塑工具暴露面。"
                index="03"
                title="高级虚拟化"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label className="text-xs" htmlFor="virt-prefix">
                      工具名前缀(纯拼接,惯例 ns__)
                    </Label>
                    <Input
                      className="font-mono text-xs"
                      id="virt-prefix"
                      onChange={e => setPrefix(e.target.value)}
                      placeholder="gh__"
                      value={prefix}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs" htmlFor="virt-hide">
                      hide(原名,逗号分隔)
                    </Label>
                    <Input
                      className="font-mono text-xs"
                      id="virt-hide"
                      onChange={e => setHideSpec(e.target.value)}
                      placeholder="dangerous_tool"
                      value={hideSpec}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label className="text-xs" htmlFor="virt-rename">
                      rename(每行 from=to)
                    </Label>
                    <Textarea
                      className="font-mono text-xs"
                      id="virt-rename"
                      onChange={e => setRenameSpec(e.target.value)}
                      rows={2}
                      spellCheck={false}
                      value={renameSpec}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs" htmlFor="virt-describe">
                      describe(每行 from=描述)
                    </Label>
                    <Textarea
                      className="font-mono text-xs"
                      id="virt-describe"
                      onChange={e => setDescribeSpec(e.target.value)}
                      rows={2}
                      spellCheck={false}
                      value={describeSpec}
                    />
                  </div>
                </div>
              </FormSection>
            )}

            {err && (
              <p
                className="rounded-md border border-destructive/30 bg-destructive/[0.045] px-3 py-2.5 text-xs text-destructive"
                role="alert"
              >
                {err}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="border-t bg-background px-5 py-4 sm:px-7">
          <Button disabled={invoke.isPending} onClick={submit}>
            {invoke.isPending && <Loader2 className="animate-spin" />}
            {invoke.isPending
              ? '正在写入'
              : isReplacement || mayReplaceUnloaded
                ? `确认写入 ${path.trim() || kind}`
                : `挂载 ${path.trim() || kind}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FormSection({
  index,
  title,
  description,
  children,
}: {
  children: ReactNode
  description: string
  index: string
  title: string
}) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card/45">
      <div className="flex gap-3 border-b bg-muted/10 px-4 py-3.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-md border bg-background font-mono text-[10px] text-primary">
          {index}
        </span>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="grid gap-4 p-4 sm:p-5">{children}</div>
    </section>
  )
}
