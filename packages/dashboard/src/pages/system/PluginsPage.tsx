import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Ban,
  Check,
  ChevronRight,
  Copy,
  FileCheck2,
  FileJson2,
  KeyRound,
  Loader2,
  Pencil,
  Plug2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import type { PluginExport, PluginHealth, PluginManifest } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { useInvalidate, useInvoke, usePluginList } from '@/lib/queries'
import { PaginationFooter } from '@/components/PaginationFooter'
import { ConfirmAction } from '@/components/ConfirmAction'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EditPluginDialog, RegisterPluginDialog } from './forms/PluginFormDialogs'
import { BuiltinCatalog } from './BuiltinCatalog'

/** profile → 挂载成哪种树节点（与 core NODE_KIND_BY_PROFILE 同一张表）。 */
const NODE_KIND_BY_PROFILE = { 'tools/v1': 'tool', 'context/v1': 'context' } as const

/** export 徽标：`<id> · <profile>`。 */
function ExportBadges({ exports }: { exports: PluginExport[] }) {
  return (
    <>
      {exports.map(e => (
        <Badge className="font-mono text-[10px]" key={e.id} variant="outline">
          {e.id}
          {' · '}
          {e.profile}
        </Badge>
      ))}
    </>
  )
}

type HealthView
  = | { state: 'probing' }
    | { data: PluginHealth, state: 'result' }
    | { message: string, state: 'error' }

function formatCheckedAt(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString()
}

function PluginHealthCell({ state, onProbe }: { onProbe: () => void, state?: HealthView }) {
  if (!state) {
    return (
      <div className="flex items-center gap-2">
        <Badge className="text-[10px] text-muted-foreground" variant="outline">
          未检查
        </Badge>
        <Button onClick={onProbe} size="xs" variant="outline">
          <Activity />
          立即检查
        </Button>
      </div>
    )
  }

  if (state.state === 'probing') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <Loader2 className="size-3.5 animate-spin text-primary" />
        正在请求 health endpoint…
      </div>
    )
  }

  if (state.state === 'error') {
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Badge className="border-destructive/40 text-[10px] text-destructive" variant="outline">
            检查失败
          </Badge>
          <Button className="text-destructive" onClick={onProbe} size="xs" variant="ghost">
            <RefreshCw />
            重试
          </Button>
        </div>
        <p className="mt-1 max-w-56 truncate text-[10px] text-destructive" title={state.message}>
          {state.message}
        </p>
      </div>
    )
  }

  const { data } = state
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <Badge
          className={
            data.healthy
              ? 'border-ok/40 text-[10px] text-ok'
              : 'border-destructive/40 text-[10px] text-destructive'
          }
          variant="outline"
        >
          {data.healthy ? 'healthy' : 'unhealthy'}
        </Badge>
        <Button
          className={data.healthy ? 'text-muted-foreground' : 'text-destructive'}
          onClick={onProbe}
          size="xs"
          variant="ghost"
        >
          <RefreshCw />
          {data.healthy ? '重新检查' : '重试'}
        </Button>
      </div>
      <time
        className="mt-1 block font-mono text-[10px] text-muted-foreground"
        dateTime={data.checkedAt}
        title={data.checkedAt}
      >
        checked
        {' '}
        {formatCheckedAt(data.checkedAt)}
      </time>
    </div>
  )
}

function ManifestFact({
  label,
  wide = false,
  children,
}: {
  children: ReactNode
  label: string
  wide?: boolean
}) {
  return (
    <div className={`min-w-0 bg-background px-4 py-3 ${wide ? 'sm:col-span-2' : ''}`}>
      <p className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </p>
      <div className="mt-1.5 text-xs leading-5">{children}</div>
    </div>
  )
}

function PluginDetailsDialog({
  plugin,
  loading,
  error,
  onClose,
  onEdit,
}: {
  error?: string
  loading: boolean
  onClose: () => void
  onEdit: () => void
  plugin: PluginManifest
}) {
  const exports = plugin.exports ?? []
  const healthUrl = `${plugin.endpoint.replace(/\/+$/, '')}${plugin.healthPath}`
  return (
    <Dialog onOpenChange={open => !open && onClose()} open>
      <DialogContent className="max-h-[90svh] overflow-y-auto p-4 sm:max-w-2xl sm:p-6">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <Badge
              className={
                plugin.enabled
                  ? 'border-ok/40 text-[10px] text-ok'
                  : 'text-[10px] text-muted-foreground'
              }
              variant="outline"
            >
              {plugin.enabled ? 'enabled' : 'disabled'}
            </Badge>
            <Badge className="font-mono text-[10px]" variant="secondary">
              {plugin.protocolVersion}
            </Badge>
            {loading && (
              <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                正在读取最新 manifest
              </span>
            )}
          </div>
          <DialogTitle className="font-mono text-base">{plugin.id}</DialogTitle>
          <DialogDescription>
            这里通过
            {' '}
            <code className="font-mono text-xs">get</code>
            {' '}
            读取当前
            manifest；契约摘要来自平台注册时实际执行的校验规则。
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div
            className="rounded-md border border-destructive/35 bg-destructive/[0.05] px-3 py-2 text-xs leading-5 text-destructive"
            role="alert"
          >
            无法刷新最新 manifest，当前显示列表快照：
            {error}
          </div>
        )}

        <section className="rounded-lg border">
          <div className="border-b px-4 py-3">
            <p className="text-sm font-medium">Manifest</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">身份、接口与远端连接声明</p>
          </div>
          <div className="grid gap-px bg-border sm:grid-cols-2">
            <ManifestFact label="Plugin ID">
              <span className="font-mono">{plugin.id}</span>
            </ManifestFact>
            <ManifestFact label="Protocol">
              <span className="font-mono">{plugin.protocolVersion}</span>
            </ManifestFact>
            <ManifestFact label="Exports">
              <span className="flex flex-wrap gap-1.5">
                <ExportBadges exports={plugin.exports} />
              </span>
            </ManifestFact>
            <ManifestFact label="Lifecycle">{plugin.enabled ? 'Enabled' : 'Disabled'}</ManifestFact>
            <ManifestFact label="Endpoint" wide>
              <span className="font-mono break-all">{plugin.endpoint}</span>
            </ManifestFact>
            <ManifestFact label="Health path">
              <span className="font-mono">{plugin.healthPath}</span>
            </ManifestFact>
            <ManifestFact label="Authentication">
              <span className="font-mono">
                {plugin.auth.kind === 'bearer'
                  ? `bearer · ${plugin.auth.secretRef}`
                  : 'platform-token · managed'}
              </span>
            </ManifestFact>
          </div>
        </section>

        <section className="rounded-lg border">
          <div className="flex items-start gap-3 border-b px-4 py-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/[0.07] text-primary">
              <ShieldCheck className="size-4" />
            </span>
            <div>
              <p className="text-sm font-medium">Contract gate</p>
              <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                注册和契约字段变更只有在以下三步全部通过后才会落库。
              </p>
            </div>
          </div>
          <ol className="grid gap-0 divide-y text-xs">
            <li className="flex gap-3 px-4 py-3">
              <span className="font-mono text-[10px] text-primary">01</span>
              <span>
                <span className="font-medium">Health probe</span>
                <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground break-all">
                  GET
                  {' '}
                  {healthUrl}
                </span>
              </span>
            </li>
            <li className="flex gap-3 px-4 py-3">
              <span className="font-mono text-[10px] text-primary">02</span>
              <span>
                <span className="font-medium">Describe match</span>
                <span className="mt-0.5 block text-[10px] leading-5 text-muted-foreground">
                  <span className="font-mono">~describe</span>
                  {' '}
                  的 protocolVersion 必须和 manifest 一致，且至少声明一个 export。
                </span>
              </span>
            </li>
            <li className="flex gap-3 px-4 py-3">
              <span className="font-mono text-[10px] text-primary">03</span>
              <span className="min-w-0">
                <span className="font-medium">Exports</span>
                <span className="mt-1.5 grid gap-1.5">
                  {exports.length === 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      无 ~describe 缓存（重新注册可刷新）。
                    </span>
                  )}
                  {exports.map(e => (
                    <span className="flex flex-wrap items-center gap-1.5" key={e.id}>
                      <Badge className="font-mono text-[10px]" variant="outline">
                        {e.id}
                        {' · '}
                        {e.profile}
                      </Badge>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        挂载为 kind:
                        {NODE_KIND_BY_PROFILE[e.profile]}
                      </span>
                      {(e.methods ?? []).map(m => (
                        <Badge className="font-mono text-[10px]" key={m} variant="secondary">
                          {m}
                        </Badge>
                      ))}
                    </span>
                  ))}
                </span>
                <span className="mt-1.5 block text-[10px] leading-5 text-muted-foreground">
                  export 自报的 methods 就是平台会调用的动词集合；声明的可选 capability
                  必须同时列进 methods。
                </span>
              </span>
            </li>
          </ol>
        </section>

        <details className="rounded-lg border px-4 py-3 text-xs">
          <summary className="cursor-pointer font-medium outline-none focus-visible:text-primary">
            查看原始 Manifest JSON
          </summary>
          <pre className="mt-3 max-h-56 overflow-auto rounded-md bg-muted/30 p-3 font-mono text-[10px] leading-5 whitespace-pre-wrap break-all text-muted-foreground">
            {JSON.stringify(plugin, null, 2)}
          </pre>
        </details>

        <DialogFooter className="gap-2">
          <Button asChild variant="outline">
            <Link onClick={onClose} to="/manage/registry">
              挂载为节点
              <ArrowUpRight />
            </Link>
          </Button>
          <Button onClick={onEdit}>
            <Pencil />
            编辑 Manifest
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
* Plugin 管理（对等 `tb plugin register|list|get|update|health|rm`）。
 * enabled 是本地生命周期开关；health 只在用户明确触发时向远端探测。
 */
export function PluginsPage() {
  const list = usePluginList()
  const invoke = useInvoke()
  const detailsInvoke = useInvoke()
  const invalidate = useInvalidate()
  const inspectingId = useRef<string | null>(null)
  const [token, setToken] = useState<{ id: string, token: string } | null>(null)
  const [editing, setEditing] = useState<PluginManifest | null>(null)
  const [inspecting, setInspecting] = useState<PluginManifest | null>(null)
  const [changingEnabled, setChangingEnabled] = useState<string | null>(null)
  const [health, setHealth] = useState<Record<string, HealthView>>({})

  // plugin 启用/禁用/注销会改变工具树的解析结果,故一并失效 tree/help;仍限当前 profile。
  const refresh = () => invalidate('plugin-list', 'tree', 'help', 'helpMarkdown')
  const clearHealth = (id: string) => {
    setHealth((current) => {
      if (!(id in current)) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  const setEnabled = async (plugin: PluginManifest, enabled: boolean) => {
    setChangingEnabled(plugin.id)
    try {
      await invoke.mutateAsync({
        path: 'system/plugin',
        tool: 'update',
        args: { id: plugin.id, patch: { enabled } },
      })
      toast.success(`${plugin.id} 已${enabled ? '启用' : '禁用'}`)
      void refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新 Plugin 生命周期失败')
      // 向上抛出让禁用确认弹窗保留、允许重试(启用路径的调用方自行吞掉)。
      throw error
    } finally {
      setChangingEnabled(current => (current === plugin.id ? null : current))
    }
  }

  const remove = async (plugin: PluginManifest) => {
    try {
      await invoke.mutateAsync({
        path: 'system/plugin',
        tool: 'delete',
        args: { id: plugin.id },
      })
      toast.success(`已注销 plugin ${plugin.id}`)
      clearHealth(plugin.id)
      void refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '注销 Plugin 失败')
      throw error
    }
  }

  const probe = async (plugin: PluginManifest) => {
    setHealth(current => ({ ...current, [plugin.id]: { state: 'probing' } }))
    try {
      const response = await invoke.mutateAsync({
        path: 'system/plugin',
        tool: 'health',
        args: { id: plugin.id },
      })
      setHealth(current => ({
        ...current,
        [plugin.id]: { state: 'result', data: response.json as PluginHealth },
      }))
    } catch (error) {
      setHealth(current => ({
        ...current,
        [plugin.id]: {
          state: 'error',
          message: error instanceof Error ? error.message : 'Plugin 健康检查失败',
        },
      }))
    }
  }

  const openDetails = (plugin: PluginManifest) => {
    inspectingId.current = plugin.id
    setInspecting(plugin)
    detailsInvoke.reset()
    detailsInvoke.mutate(
      { path: 'system/plugin', tool: 'get', args: { id: plugin.id } },
      {
        onSuccess: (response) => {
          if (inspectingId.current === plugin.id) {
            setInspecting(response.json as PluginManifest)
          }
        },
      },
    )
  }

  const closeDetails = () => {
    inspectingId.current = null
    setInspecting(null)
    detailsInvoke.reset()
  }

  const items = list.data?.items ?? []
  const enabledCount = items.filter(plugin => plugin.enabled).length

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <PageHeader
        actions={<RegisterPluginDialog onRegistered={id => clearHealth(id)} onToken={setToken} />}
        description={(
          <>
            注册自定义 Provider，验证远端契约，再到
            <Link
              className="mx-1 text-foreground underline underline-offset-3"
              to="/manage/registry"
            >
              节点注册
            </Link>
            将它挂上能力树。管理能力与
            {' '}
            <code className="font-mono text-xs">tb plugin</code>
            {' '}
            命令面保持对等。
          </>
        )}
        eyebrow="CONTROL PLANE / PROVIDERS"
        title="Plugin"
      />

      {/*
        内置目录放在已注册列表**之前**:这个部署带了什么是第一个要回答的问题。
        下面那张表只列 external plugin —— 内置集成不落库,故永远不会出现在里面。
      */}
      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold">内置集成目录</h2>
        <BuiltinCatalog />
      </section>

      <section className="mt-6 flex flex-col gap-3 rounded-lg border bg-card/45 px-4 py-3.5 sm:flex-row sm:items-center">
        <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-background/70 text-primary">
          <FileCheck2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">生命周期与健康状态彼此独立</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Enabled 只决定平台是否允许调用；注册或连接契约字段更新时会自动探活并校验
            {' '}
            <span className="font-mono">~describe</span>
            。列表健康状态只在点击检查后刷新，
            不做后台轮询。
          </p>
        </div>
        {!list.isPending && !list.isError && (
          <div className="flex shrink-0 flex-wrap gap-1.5 text-[10px]">
            <Badge className="border-ok/35 text-ok" variant="outline">
              {enabledCount}
              {' '}
              enabled
            </Badge>
            <Badge className="text-muted-foreground" variant="outline">
              {items.length - enabledCount}
              {' '}
              disabled
            </Badge>
            <Badge variant="secondary">
              当前已加载
              {items.length}
            </Badge>
          </div>
        )}
      </section>

      <div className="mt-4 overflow-hidden rounded-lg border bg-card/30">
        {list.isPending
          ? (
              <div className="grid gap-3 p-4">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            )
          : list.isError
            ? (
                <EmptyState
                  action={(
                    <Button onClick={() => void list.refetch()} size="sm" variant="outline">
                      <RefreshCw />
                      重新加载
                    </Button>
                  )}
                  className="border-0"
                  icon={Plug2}
                  title="无法读取 Plugin 注册表"
                  tone="danger"
                >
                  <p>{list.error.message}</p>
                </EmptyState>
              )
            : items.length === 0
              ? (
                  <EmptyState className="border-0" icon={Plug2} title="还没有注册任何 Plugin">
                    <p>先注册实现 tool-provider 或 context-provider 契约的服务，再把它挂载成节点。</p>
                  </EmptyState>
                )
              : (
                  <Table className="min-w-[1060px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-56">Plugin / Interface</TableHead>
                        <TableHead>Endpoint</TableHead>
                        <TableHead className="w-44">Auth</TableHead>
                        <TableHead className="w-40">Lifecycle</TableHead>
                        <TableHead className="w-64">Health · on demand</TableHead>
                        <TableHead className="w-28" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map(plugin => (
                        <TableRow key={plugin.id}>
                          <TableCell className="whitespace-normal">
                            <div className="flex min-w-0 items-center gap-1">
                              <button
                                className="group/details flex min-w-0 items-center gap-1 text-left font-mono text-xs font-medium text-foreground outline-none hover:text-primary focus-visible:text-primary focus-visible:underline"
                                onClick={() => openDetails(plugin)}
                                type="button"
                              >
                                <span className="truncate">{plugin.id}</span>
                                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover/details:translate-x-0.5 group-hover/details:text-primary" />
                              </button>
                              <CopyButton
                                className="opacity-60 hover:opacity-100"
                                label="复制 Plugin id"
                                value={plugin.id}
                              />
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <ExportBadges exports={plugin.exports} />
                            </div>
                          </TableCell>
                          <TableCell className="max-w-80 whitespace-normal">
                            <p className="truncate font-mono text-xs" title={plugin.endpoint}>
                              {plugin.endpoint}
                            </p>
                            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                              health
                              {' '}
                              {plugin.healthPath}
                            </p>
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            <Badge className="font-mono text-[10px]" variant="secondary">
                              {plugin.auth.kind}
                            </Badge>
                            {plugin.auth.kind === 'bearer'
                              ? (
                                  <p
                                    className="mt-1.5 max-w-36 truncate font-mono text-[10px] text-muted-foreground"
                                    title={plugin.auth.secretRef}
                                  >
                                    secretRef ·
                                    {' '}
                                    {plugin.auth.secretRef}
                                  </p>
                                )
                              : (
                                  <p className="mt-1.5 text-[10px] text-muted-foreground">平台托管 · 不回显</p>
                                )}
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            <Badge
                              className={
                                plugin.enabled
                                  ? 'border-ok/40 text-[10px] text-ok'
                                  : 'border-border text-[10px] text-muted-foreground'
                              }
                              variant="outline"
                            >
                              {plugin.enabled ? 'enabled' : 'disabled'}
                            </Badge>
                            {plugin.enabled
                              ? (
                                  // 禁用会让引用该 plugin 的挂载节点下次调用失败,与注销的确认标准对齐。
                                  <ConfirmAction
                                    actionLabel="禁用调用"
                                    description={<p>禁用后引用该 plugin 的挂载节点在下次调用时会失败。可随时重新启用。</p>}
                                    onConfirm={async () => { await setEnabled(plugin, false) }}
                                    title={`禁用 ${plugin.id}?`}
                                    trigger={(
                                      <Button
                                        className="mt-1.5 -ml-2 text-muted-foreground"
                                        disabled={changingEnabled !== null}
                                        size="xs"
                                        type="button"
                                        variant="ghost"
                                      >
                                        {changingEnabled === plugin.id ? <Loader2 className="animate-spin" /> : <Ban />}
                                        {changingEnabled === plugin.id ? '正在更新' : '禁用调用'}
                                      </Button>
                                    )}
                                  />
                                )
                              : (
                                  // 重新启用是恢复,非破坏性,直接点击。
                                  <Button
                                    className="mt-1.5 -ml-2 text-muted-foreground"
                                    disabled={changingEnabled !== null}
                                    onClick={() => { void setEnabled(plugin, true).catch(() => {}) }}
                                    size="xs"
                                    type="button"
                                    variant="ghost"
                                  >
                                    {changingEnabled === plugin.id ? <Loader2 className="animate-spin" /> : <Check />}
                                    {changingEnabled === plugin.id ? '正在更新' : '重新启用'}
                                  </Button>
                                )}
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            <PluginHealthCell
                              onProbe={() => void probe(plugin)}
                              state={health[plugin.id]}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                aria-label={`查看 ${plugin.id} manifest`}
                                onClick={() => openDetails(plugin)}
                                size="icon-xs"
                                title="查看 manifest 与契约"
                                variant="ghost"
                              >
                                <FileJson2 />
                              </Button>
                              <Button
                                aria-label={`编辑 ${plugin.id}`}
                                onClick={() => setEditing(plugin)}
                                size="icon-xs"
                                title="编辑 manifest"
                                variant="ghost"
                              >
                                <Pencil />
                              </Button>
                              <ConfirmAction
                                actionLabel="注销"
                                description={(
                                  <p>
                                    引用它的挂载节点将在下次调用时失败；platform-token
                                    将被吊销。此操作不可撤销。
                                  </p>
                                )}
                                onConfirm={() => remove(plugin)}
                                title={`注销 plugin ${plugin.id}?`}
                                trigger={(
                                  <Button
                                    aria-label={`注销 ${plugin.id}`}
                                    size="icon-xs"
                                    title="注销 Plugin"
                                    variant="ghost"
                                  >
                                    <Trash2 className="text-destructive" />
                                  </Button>
                                )}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
        {!list.isPending && !list.isError && (
          <PaginationFooter
            count={items.length}
            hasNextPage={Boolean(list.hasNextPage)}
            isFetchingNextPage={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
            unit="个 Plugin"
          />
        )}
      </div>

      {inspecting && (
        <PluginDetailsDialog
          error={detailsInvoke.error?.message}
          loading={detailsInvoke.isPending}
          onClose={closeDetails}
          onEdit={() => {
            const snapshot = inspecting
            closeDetails()
            setEditing(snapshot)
          }}
          plugin={inspecting}
        />
      )}

      {editing && (
        <EditPluginDialog
          onClose={() => setEditing(null)}
          onToken={setToken}
          onUpdated={id => clearHealth(id)}
          plugin={editing}
        />
      )}

      {/* pluginToken 仅存在于 write / auth 切换的响应；确认保存前禁止任何隐式关闭。 */}
      <Dialog open={token !== null}>
        <DialogContent
          className="p-4 sm:max-w-xl sm:p-6"
          onEscapeKeyDown={event => event.preventDefault()}
          onInteractOutside={event => event.preventDefault()}
          onPointerDownOutside={event => event.preventDefault()}
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4 text-primary" />
              Plugin Token — 仅显示这一次
            </DialogTitle>
            <DialogDescription>
              把它立即配置到 Plugin
              服务端用于验证平台调用。关闭后平台不会再次回显；需要新值只能重新注册或切换认证方式换发。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2.5 rounded-md border border-warn/35 bg-warn/[0.06] px-3 py-2.5 text-xs leading-5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
            <p>
              复制并存入目标服务的安全配置后，再使用下方确认按钮。Escape 与点击遮罩不会关闭此窗口。
            </p>
          </div>
          <div className="grid gap-2">
            <p className="font-mono text-xs text-muted-foreground">{token?.id}</p>
            <div className="flex items-stretch gap-2">
              <code className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 font-mono text-xs break-all">
                {token?.token}
              </code>
              <Button
                aria-label="复制 Plugin Token"
                onClick={async () => {
                  if (!token) return
                  try {
                    await navigator.clipboard.writeText(token.token)
                    toast.success('Plugin Token 已复制')
                  } catch {
                    toast.error('复制失败，请手动选择并复制')
                  }
                }}
                size="icon"
                variant="outline"
              >
                <Copy />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setToken(null)}>
              <Check />
              我已安全保存，关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
