import {
  CheckCircle2,
  Globe,
  Layers3,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  ServerCog,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import type { FederationHost } from '@/lib/types'
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
import { useFederationList, useInvoke } from '@/lib/queries'
import { ConfirmAction } from '@/components/ConfirmAction'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface HostPreview {
  error?: string
  normalized: string
}

/** 与 core normalizeAllowHost 对齐的即时反馈；服务端仍是最终校验入口。 */
function previewHost(raw: string): HostPreview {
  const normalized = raw.trim().toLowerCase()
  if (normalized === '') return { normalized: '' }
  if (/[\s/?#@]/.test(normalized) || normalized.includes('://')) {
    return { normalized, error: '只填写裸主机名，不含 scheme、端口、路径或空白。' }
  }
  const isIpv6 = normalized.startsWith('[') && normalized.endsWith(']') && normalized.length > 2
  const isHostname = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(normalized)
  if (!isIpv6 && !isHostname) return { normalized, error: '主机名格式无效。' }
  return { normalized }
}

/**
 * 联邦白名单(system/federation,对等 `tb federation ls|add|rm`)。
 * remote 节点只能挂到白名单内的 host 后缀,空 = 拒一切 remote。
 * env 基线(TB_REMOTE_ALLOWLIST)只读不可删;运行时条目在此增删。
 */
export function FederationPage() {
  const list = useFederationList()
  const invoke = useInvoke()
  const qc = useQueryClient()
  const items = list.data?.items ?? []
  const envItems = items.filter(item => item.source === 'env')
  const runtimeItems = items.filter(item => item.source === 'store')

  const remove = async (host: string) => {
    try {
      await invoke.mutateAsync({ path: 'system/federation', tool: 'remove', args: { host } })
      toast.success(`已移除 ${host}`)
      await qc.invalidateQueries({ queryKey: ['tb'] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移除联邦白名单失败')
      throw error
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <PageHeader
        actions={<AddHostDialog />}
        description="控制 kind=remote 节点可以连接的 HTBP 主机；空白名单意味着拒绝全部联邦出站。"
        eyebrow="NETWORK / FEDERATION"
        title="联邦出站边界"
      />

      <section className="mt-6 overflow-hidden rounded-xl border border-primary/20 bg-card/65">
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-center lg:p-6">
          <div className="flex min-w-0 gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/8 text-primary">
              <ShieldAlert className="size-4.5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
                SSRF guardrail
              </p>
              <h2 className="mt-1.5 text-lg font-semibold tracking-tight">
                白名单是 remote 请求的网络闸门
              </h2>
              <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
                网关只允许 HTTPS
                remote，并按主机名段边界执行后缀匹配。允许范围越宽，可访问的子域越多；仅添加你信任并负责的域。
              </p>
            </div>
          </div>
          <div className="grid gap-2 rounded-lg border bg-background/60 p-3 font-mono text-[11px]">
            <MatchExample ok value="example.com → api.example.com" />
            <MatchExample ok value="example.com → example.com" />
            <MatchExample value="example.com ↛ example.com.evil.test" />
          </div>
        </div>
      </section>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MetricCard icon={Globe} label="当前生效" suffix="hosts" value={items.length} />
        <MetricCard icon={Lock} label="部署基线" suffix="env" value={envItems.length} />
        <MetricCard
          icon={ServerCog}
          label="运行时叠加"
          suffix="runtime"
          value={runtimeItems.length}
        />
      </div>

      {list.isPending
        ? (
            <div className="mt-4 grid gap-3 rounded-lg border bg-card/45 p-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-5/6" />
            </div>
          )
        : list.isError
          ? (
              <EmptyState
                action={(
                  <Button onClick={() => void list.refetch()} size="sm" variant="outline">
                    <RefreshCw />
                    重试
                  </Button>
                )}
                className="mt-4"
                icon={Globe}
                title="白名单读取失败"
                tone="danger"
              >
                <p>{list.error.message}</p>
              </EmptyState>
            )
          : (
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <HostLayer
                  badge="ENV"
                  description="来自 TB_REMOTE_ALLOWLIST。作为只读安全基线，修改后需重新部署。"
                  empty="当前部署没有配置 env 基线。"
                  icon={Lock}
                  items={envItems}
                  title="部署基线"
                />
                <HostLayer
                  badge="RUNTIME"
                  description="由管理员即时增删并持久化；与部署基线取并集后生效。"
                  empty="还没有运行时 host；可以按需添加最小后缀。"
                  icon={ServerCog}
                  items={runtimeItems}
                  onRemove={remove}
                  title="运行时叠加"
                />
              </div>
            )}
    </div>
  )
}

function MatchExample({ ok = false, value }: { ok?: boolean, value: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      {ok
        ? (
            <CheckCircle2 className="size-3.5 shrink-0 text-ok" />
          )
        : (
            <span className="grid size-3.5 shrink-0 place-items-center rounded-full border text-[8px]">
              ×
            </span>
          )}
      <span>{value}</span>
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  suffix,
}: {
  icon: typeof Globe
  label: string
  suffix: string
  value: number
}) {
  return (
    <div className="rounded-lg border bg-card/55 p-4">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{label}</span>
        <Icon className="size-4" />
      </div>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-2xl font-semibold tabular-nums">{value}</span>
        <span className="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
          {suffix}
        </span>
      </p>
    </div>
  )
}

function HostLayer({
  icon: Icon,
  title,
  badge,
  description,
  items,
  empty,
  onRemove,
}: {
  badge: string
  description: string
  empty: string
  icon: typeof Globe
  items: FederationHost[]
  onRemove?: (host: string) => Promise<void>
  title: string
}) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card/45">
      <div className="flex min-h-20 items-start gap-3 border-b px-4 py-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-background/65 text-muted-foreground">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            <Badge className="font-mono text-[9px] tracking-[0.12em]" variant="outline">
              {badge}
            </Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{items.length}</span>
      </div>

      {items.length === 0
        ? (
            <div className="flex min-h-32 items-center justify-center px-6 py-8 text-center text-xs text-muted-foreground">
              {empty}
            </div>
          )
        : (
            <Table className="min-w-[520px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Host suffix</TableHead>
                  <TableHead className="w-40">更新时间</TableHead>
                  {onRemove && (
                    <TableHead className="w-16">
                      <span className="sr-only">操作</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(item => (
                  <TableRow key={item.host}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                        <code className="font-mono text-xs">{item.host}</code>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">
                      {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '随部署生效'}
                    </TableCell>
                    {onRemove && (
                      <TableCell>
                        <ConfirmAction
                          actionLabel="移除"
                          description={<p>指向该 host 的 remote 节点将在下次调用或挂载时被拒绝。</p>}
                          onConfirm={() => onRemove(item.host)}
                          title={`从白名单移除 ${item.host}?`}
                          trigger={(
                            <Button aria-label={`移除 ${item.host}`} size="icon-sm" variant="ghost">
                              <Trash2 className="text-destructive" />
                            </Button>
                          )}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
    </section>
  )
}

function AddHostDialog() {
  const invoke = useInvoke()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [host, setHost] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const preview = previewHost(host)

  const changeOpen = (next: boolean) => {
    if (invoke.isPending) return
    setOpen(next)
    if (!next) {
      setHost('')
      setErr(null)
      invoke.reset()
    }
  }

  const submit = async () => {
    if (!preview.normalized) {
      setErr('host 必填')
      return
    }
    if (preview.error) {
      setErr(preview.error)
      return
    }
    setErr(null)
    await invoke
      .mutateAsync(
        {
          path: 'system/federation',
          tool: 'add',
          args: { host: preview.normalized },
        },
        {
          onSuccess: () => {
            toast.success(`已允许 ${preview.normalized}`)
            setOpen(false)
            setHost('')
            setErr(null)
            qc.invalidateQueries({ queryKey: ['tb'] })
          },
          onError: e => setErr(e.message),
        },
      )
      .catch(() => undefined)
  }

  const canSubmit = preview.normalized !== '' && preview.error === undefined
  const isIpv6 = preview.normalized.startsWith('[')

  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus />
          添加 host
        </Button>
      </DialogTrigger>
      <DialogContent className="p-4 sm:max-w-xl sm:p-6" showCloseButton={!invoke.isPending}>
        <DialogHeader>
          <DialogTitle className="text-base">添加运行时白名单</DialogTitle>
          <DialogDescription>
            只填写裸主机名后缀。保存后立即进入运行时叠加层，不需要重新部署。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label className="text-xs" htmlFor="fed-host">
            Host suffix
          </Label>
          <Input
            aria-invalid={Boolean(err || preview.error)}
            autoComplete="off"
            className="font-mono text-sm"
            id="fed-host"
            onChange={(event) => {
              setHost(event.target.value)
              setErr(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit && !invoke.isPending) void submit()
            }}
            placeholder="example.com"
            value={host}
          />
          {(err || preview.error) && (
            <p className="text-xs text-destructive" role="alert">
              {err ?? preview.error}
            </p>
          )}
        </div>

        <div className="rounded-lg border bg-muted/15 p-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            <Layers3 className="size-3.5" />
            规范化与命中预览
          </div>
          {preview.normalized && !preview.error
            ? (
                <div className="mt-3 grid gap-2 font-mono text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted-foreground">保存为</span>
                    <code className="rounded border bg-background px-2 py-1 text-foreground">
                      {preview.normalized}
                    </code>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted-foreground">将允许</span>
                    <code className="text-ok">
                      {isIpv6
                        ? preview.normalized
                        : `${preview.normalized} · api.${preview.normalized}`}
                    </code>
                  </div>
                  {!isIpv6 && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-muted-foreground">不会允许</span>
                      <code className="text-muted-foreground">
                        {preview.normalized}
                        .evil.test
                      </code>
                    </div>
                  )}
                </div>
              )
            : (
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  输入后会转换为小写并去除首尾空白；服务端仍会执行最终校验。
                </p>
              )}
        </div>

        <DialogFooter className="border-t pt-4">
          <Button disabled={!canSubmit || invoke.isPending} onClick={() => void submit()}>
            {invoke.isPending && <Loader2 className="animate-spin" />}
            {invoke.isPending ? '正在添加' : '添加到运行时层'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
