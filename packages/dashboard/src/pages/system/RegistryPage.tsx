import { useQueryClient } from '@tanstack/react-query'
import { Boxes, ExternalLink, FileJson2, Loader2, Plus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { ConfirmAction } from '@/components/ConfirmAction'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { KindBadge, OnlineDot } from '@/components/KindBadge'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useInvoke, usePluginList, useRegistryList } from '@/lib/queries'
import type { RegistryNode } from '@/lib/types'
import { cn } from '@/lib/utils'

const KIND_FILTERS = ['all', 'mcp', 'http', 'context', 'remote', 'device', 'tool'] as const
type KindFilter = (typeof KIND_FILTERS)[number]

/**
 * 节点注册管理(对等 `tb tool mount|rm` / `tb server add|ls|rm` / `tb ctx mount|unmount`;
 * E2E-6 ④ 的 Dashboard 写路径)。底层同一接口:POST /system/registry {tool: list|write|delete}。
 */
export function RegistryPage() {
  const list = useRegistryList()
  const invoke = useInvoke()
  const qc = useQueryClient()
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [search, setSearch] = useState('')
  const [inspecting, setInspecting] = useState<RegistryNode | null>(null)

  const unmount = (path: string) => {
    invoke.mutate(
      { path: 'system/registry', tool: 'delete', args: { path } },
      {
        onSuccess: () => {
          toast.success(`已卸载 ${path}`)
          qc.invalidateQueries({ queryKey: ['tb'] })
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  const mounted = (list.data?.items ?? []).filter((n) => !n.path.startsWith('system'))
  const needle = search.trim().toLowerCase()
  const items = mounted.filter(
    (n) =>
      (kindFilter === 'all' || n.kind === kindFilter) &&
      (needle === '' ||
        n.path.toLowerCase().includes(needle) ||
        n.description.toLowerCase().includes(needle)),
  )
  const countByKind = (k: KindFilter) =>
    k === 'all' ? mounted.length : mounted.filter((n) => n.kind === k).length

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <PageHeader
        title="节点注册"
        description="挂载工具(mcp/http/plugin)、context namespace、联邦 HTBP 服务(remote)"
        actions={<MountDialog />}
      />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border">
          {KIND_FILTERS.map((k) => {
            const count = countByKind(k)
            if (k !== 'all' && count === 0) return null
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKindFilter(k)}
                className={cn(
                  'border-r px-2.5 py-1 font-mono text-[11px] last:border-r-0',
                  kindFilter === k
                    ? 'bg-secondary text-primary'
                    : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
                )}
              >
                {k === 'all' ? '全部' : k}
                <span className="ml-1 opacity-60 tabular-nums">{count}</span>
              </button>
            )
          })}
        </div>
        {mounted.length > 3 && (
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="过滤 path / 描述…"
              aria-label="过滤"
              className="h-8 w-48 pl-7 font-mono text-xs"
            />
          </div>
        )}
      </div>

      <div className="mt-3 overflow-hidden rounded-md border">
        {list.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
          </div>
        ) : list.isError ? (
          <p className="p-4 text-sm text-destructive">{list.error.message}</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={mounted.length === 0 ? '还没有挂载任何节点' : '无匹配节点'}
            className="border-0"
          >
            {mounted.length === 0 && (
              <p>点右上「挂载节点」开始,或用 CLI:tb tool mount / tb ctx mount</p>
            )}
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>path</TableHead>
                <TableHead>kind</TableHead>
                <TableHead>描述</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((n) => (
                <TableRow key={n.path}>
                  <TableCell className="font-mono text-xs">
                    <span className="flex items-center gap-1.5">
                      {n.path}
                      <OnlineDot online={n.online} />
                    </span>
                  </TableCell>
                  <TableCell>
                    <KindBadge kind={n.kind} />
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                    {n.description}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="查看配置"
                        title="查看配置"
                        onClick={() => setInspecting(n)}
                      >
                        <FileJson2 />
                      </Button>
                      <Button variant="ghost" size="icon-xs" asChild aria-label="查看节点">
                        <Link to={`/nodes/${n.path}`}>
                          <ExternalLink />
                        </Link>
                      </Button>
                      <ConfirmAction
                        title={`卸载 ${n.path}?`}
                        description={<p>卸载后该子树不可见;空的中间目录将被回收。</p>}
                        actionLabel="卸载"
                        onConfirm={() => unmount(n.path)}
                        trigger={
                          <Button variant="ghost" size="icon-xs" aria-label="卸载" title="卸载">
                            <Trash2 className="text-destructive" />
                          </Button>
                        }
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* 节点配置查看(registry get 的展示面;凭证只以 authRef 名义出现) */}
      <Dialog open={inspecting !== null} onOpenChange={(o) => !o && setInspecting(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono text-sm">
              {inspecting?.path}
              {inspecting && <KindBadge kind={inspecting.kind} />}
            </DialogTitle>
            <DialogDescription>节点注册配置(凭证经 authRef 引用,无明文)</DialogDescription>
          </DialogHeader>
          {inspecting && (
            <div className="relative">
              <pre className="max-h-96 overflow-auto rounded-sm border bg-card px-3 py-2 font-mono text-xs leading-relaxed">
                {JSON.stringify(
                  {
                    path: inspecting.path,
                    kind: inspecting.kind,
                    description: inspecting.description,
                    ...(inspecting.config ? { config: inspecting.config } : {}),
                    ...(inspecting.virtualize ? { virtualize: inspecting.virtualize } : {}),
                    ...(inspecting.owner ? { owner: inspecting.owner } : {}),
                    ...(inspecting.createdAt ? { createdAt: inspecting.createdAt } : {}),
                    ...(inspecting.updatedAt ? { updatedAt: inspecting.updatedAt } : {}),
                  },
                  null,
                  2,
                )}
              </pre>
              <CopyButton
                value={JSON.stringify(inspecting, null, 2)}
                label="复制配置"
                className="absolute top-1.5 right-1.5"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

type MountKind = 'mcp' | 'http' | 'context' | 'remote' | 'tool'

/** 挂载表单(按 kind 分支出 NodeConfig;tool 与 context 可引用已注册 plugin 为 provider)。 */
function MountDialog() {
  const invoke = useInvoke()
  const qc = useQueryClient()
  const plugins = usePluginList()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<MountKind>('mcp')
  const [path, setPath] = useState('')
  const [description, setDescription] = useState('')
  const [err, setErr] = useState<string | null>(null)
  // mcp
  const [mcpUrl, setMcpUrl] = useState('')
  const [mcpAuthRef, setMcpAuthRef] = useState('')
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
  // remote
  const [baseUrl, setBaseUrl] = useState('')
  const [skRef, setSkRef] = useState('')
  // tool(plugin 工具源)
  const [toolProvider, setToolProvider] = useState('')

  const pluginItems = plugins.data?.items ?? []
  const toolPlugins = pluginItems.filter((p) => p.kind === 'tool-provider')
  const ctxPlugins = pluginItems.filter((p) => p.kind === 'context-provider')

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
      .map((s) => s.trim())
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
      case 'mcp':
        if (!mcpUrl.trim()) throw new Error('url 必填')
        return {
          kind: 'mcp',
          url: mcpUrl.trim(),
          ...(mcpAuthRef.trim() ? { authRef: mcpAuthRef.trim() } : {}),
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
          ...(authScheme.trim() !== '' ? { authScheme: authScheme.trim() } : {}),
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
        return { kind: 'tool', provider: toolProvider }
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
          toast.success(`已挂载 ${path.trim()}`)
          setOpen(false)
          setErr(null)
          setPath('')
          setDescription('')
          qc.invalidateQueries({ queryKey: ['tb'] })
        },
        onError: (e) => setErr(e.message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus />
          挂载节点
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">挂载节点</DialogTitle>
          <DialogDescription>
            等价 <code className="font-mono text-xs">system/registry write</code>;凭证一律经 authRef
            引用,不入节点配置明文。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as MountKind)}>
                <SelectTrigger className="font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mcp" className="font-mono text-xs">
                    mcp — MCP server
                  </SelectItem>
                  <SelectItem value="http" className="font-mono text-xs">
                    http — HTTP endpoint
                  </SelectItem>
                  <SelectItem value="context" className="font-mono text-xs">
                    context — 存储 namespace
                  </SelectItem>
                  <SelectItem value="remote" className="font-mono text-xs">
                    remote — 联邦 HTBP 服务
                  </SelectItem>
                  <SelectItem value="tool" className="font-mono text-xs">
                    tool — plugin 工具源
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mount-path" className="text-xs">
                path *
              </Label>
              <Input
                id="mount-path"
                className="font-mono text-sm"
                placeholder="docs/context7"
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="mount-desc" className="text-xs">
              描述 *
            </Label>
            <Input
              id="mount-desc"
              className="text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {kind === 'mcp' && (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="mcp-url" className="text-xs">
                  url *(Streamable HTTP)
                </Label>
                <Input
                  id="mcp-url"
                  className="font-mono text-xs"
                  placeholder="https://mcp.example.com/mcp"
                  value={mcpUrl}
                  onChange={(e) => setMcpUrl(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="mcp-auth" className="text-xs">
                  authRef(可空)
                </Label>
                <Input
                  id="mcp-auth"
                  className="font-mono text-xs"
                  value={mcpAuthRef}
                  onChange={(e) => setMcpAuthRef(e.target.value)}
                />
              </div>
            </>
          )}

          {kind === 'http' && (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="http-endpoint" className="text-xs">
                  endpoint *
                </Label>
                <Input
                  id="http-endpoint"
                  className="font-mono text-xs"
                  placeholder="https://postman-echo.com"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="http-tools" className="text-xs">
                  tools *(HttpToolDef[] JSON)
                </Label>
                <Textarea
                  id="http-tools"
                  className="font-mono text-xs"
                  rows={7}
                  spellCheck={false}
                  value={toolsJson}
                  onChange={(e) => setToolsJson(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="http-auth" className="text-xs">
                    authRef(可空)
                  </Label>
                  <Input
                    id="http-auth"
                    className="font-mono text-xs"
                    value={httpAuthRef}
                    onChange={(e) => setHttpAuthRef(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="http-auth-header" className="text-xs">
                    authHeader(可空)
                  </Label>
                  <Input
                    id="http-auth-header"
                    className="font-mono text-xs"
                    placeholder="Authorization"
                    value={authHeader}
                    onChange={(e) => setAuthHeader(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="http-auth-scheme" className="text-xs">
                    authScheme(可空)
                  </Label>
                  <Input
                    id="http-auth-scheme"
                    className="font-mono text-xs"
                    placeholder="Bearer"
                    value={authScheme}
                    onChange={(e) => setAuthScheme(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          {kind === 'context' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">provider</Label>
                  <Select value={provider} onValueChange={setProvider}>
                    <SelectTrigger className="font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="r2" className="font-mono text-xs">
                        r2(实例自带桶)
                      </SelectItem>
                      <SelectItem value="s3" className="font-mono text-xs">
                        s3(外部 S3 兼容端点)
                      </SelectItem>
                      {ctxPlugins.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="font-mono text-xs">
                          {p.id}(plugin)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {(provider === 'r2' || provider === 's3') && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="ctx-prefix" className="text-xs">
                      key 前缀(可空)
                    </Label>
                    <Input
                      id="ctx-prefix"
                      className="font-mono text-xs"
                      value={ctxPrefix}
                      onChange={(e) => setCtxPrefix(e.target.value)}
                    />
                  </div>
                )}
              </div>
              {provider === 's3' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="s3-endpoint" className="text-xs">
                        endpoint *
                      </Label>
                      <Input
                        id="s3-endpoint"
                        className="font-mono text-xs"
                        placeholder="https://….r2.cloudflarestorage.com"
                        value={s3Endpoint}
                        onChange={(e) => setS3Endpoint(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="s3-bucket" className="text-xs">
                        bucket *
                      </Label>
                      <Input
                        id="s3-bucket"
                        className="font-mono text-xs"
                        value={s3Bucket}
                        onChange={(e) => setS3Bucket(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="s3-region" className="text-xs">
                        region(可空,缺省 auto)
                      </Label>
                      <Input
                        id="s3-region"
                        className="font-mono text-xs"
                        value={s3Region}
                        onChange={(e) => setS3Region(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="ctx-auth" className="text-xs">
                        authRef *(凭证保管里的名字)
                      </Label>
                      <Input
                        id="ctx-auth"
                        className="font-mono text-xs"
                        placeholder="s3-main"
                        value={ctxAuthRef}
                        onChange={(e) => setCtxAuthRef(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}
              <div className="grid grid-cols-2 items-end gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="ctx-ttl" className="text-xs">
                    ttl 秒(可空;到期整节点回收)
                  </Label>
                  <Input
                    id="ctx-ttl"
                    className="font-mono text-xs"
                    placeholder="86400"
                    value={ttl}
                    onChange={(e) => setTtl(e.target.value)}
                  />
                </div>
                {/* biome-ignore lint/a11y/noLabelWithoutControl: Radix Checkbox 是 label 内可交互控件,规则只识别原生 input */}
                <label className="flex items-center gap-2 pb-2 text-xs">
                  <Checkbox checked={readOnly} onCheckedChange={(v) => setReadOnly(v === true)} />
                  readOnly(拒绝 Write/Update/Delete)
                </label>
              </div>
            </>
          )}

          {kind === 'remote' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="remote-url" className="text-xs">
                  baseUrl *(须在白名单内)
                </Label>
                <Input
                  id="remote-url"
                  className="font-mono text-xs"
                  placeholder="https://tb.example.com"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="remote-skref" className="text-xs">
                  skRef(远端 SK 的 authRef,可空)
                </Label>
                <Input
                  id="remote-skref"
                  className="font-mono text-xs"
                  value={skRef}
                  onChange={(e) => setSkRef(e.target.value)}
                />
              </div>
            </div>
          )}

          {kind === 'tool' && (
            <div className="grid gap-1.5">
              <Label className="text-xs">provider *(tool-provider plugin)</Label>
              <Select value={toolProvider} onValueChange={setToolProvider}>
                <SelectTrigger className="font-mono text-xs">
                  <SelectValue
                    placeholder={toolPlugins.length === 0 ? '无已注册 plugin' : '选择 plugin…'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {toolPlugins.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="font-mono text-xs">
                      {p.id}
                      {p.enabled ? '' : '(disabled)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {toolPlugins.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  先在
                  <Link to="/manage/plugins" className="mx-0.5 underline underline-offset-2">
                    Plugin
                  </Link>
                  注册 tool-provider,再回来挂载。
                </p>
              )}
            </div>
          )}

          {(kind === 'mcp' || kind === 'http' || kind === 'tool') && (
            <div className="grid gap-3 rounded-sm border px-3 py-2.5">
              <p className="text-[11px] font-medium text-muted-foreground">
                虚拟化(可空;hide → rename → prefix → describe)
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="virt-prefix" className="text-xs">
                    工具名前缀(纯拼接,惯例 ns__)
                  </Label>
                  <Input
                    id="virt-prefix"
                    className="font-mono text-xs"
                    placeholder="gh__"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="virt-hide" className="text-xs">
                    hide(原名,逗号分隔)
                  </Label>
                  <Input
                    id="virt-hide"
                    className="font-mono text-xs"
                    placeholder="dangerous_tool"
                    value={hideSpec}
                    onChange={(e) => setHideSpec(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="virt-rename" className="text-xs">
                    rename(每行 from=to)
                  </Label>
                  <Textarea
                    id="virt-rename"
                    className="font-mono text-xs"
                    rows={2}
                    spellCheck={false}
                    value={renameSpec}
                    onChange={(e) => setRenameSpec(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="virt-describe" className="text-xs">
                    describe(每行 from=描述)
                  </Label>
                  <Textarea
                    id="virt-describe"
                    className="font-mono text-xs"
                    rows={2}
                    spellCheck={false}
                    value={describeSpec}
                    onChange={(e) => setDescribeSpec(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>

        <DialogFooter>
          <Button disabled={invoke.isPending} onClick={submit}>
            {invoke.isPending && <Loader2 className="animate-spin" />}
            挂载
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
