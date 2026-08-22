import {
  Ban,
  Check,
  Clock3,
  Copy,
  KeyRound,
  KeySquare,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserRound,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
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
import { useInvalidate, useInvoke, useSkList } from '@/lib/queries'
import { PaginationFooter } from '@/components/PaginationFooter'
import { type Scope, type SecretKeyInfo } from '@/lib/types'
import { ConfirmAction } from '@/components/ConfirmAction'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  buildSkWriteArgs,
  INITIAL_SK_FORM,
  type SkFormState,
} from './forms/skConfig'
import { SkFormFields } from './forms/SkFormFields'

type SkStatus = 'active' | 'disabled' | 'expired'
type StatusFilter = 'all' | SkStatus

const STATUS_FILTERS: Array<{ label: string, value: StatusFilter }> = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '有效' },
  { value: 'disabled', label: '已禁用' },
  { value: 'expired', label: '已过期' },
]

function getSkStatus(sk: SecretKeyInfo, now: number): SkStatus {
  if (sk.disabled) return 'disabled'
  if (sk.expiresAt && Date.parse(sk.expiresAt) <= now) return 'expired'
  return 'active'
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function StatusMetric({
  icon: Icon,
  label,
  value,
  description,
  tone,
}: {
  description: string
  icon: typeof ShieldCheck
  label: string
  tone: 'ok' | 'warn' | 'danger'
  value: number
}) {
  const toneClass = {
    ok: 'border-ok/25 bg-ok/[0.045] text-ok',
    warn: 'border-warn/25 bg-warn/[0.045] text-warn',
    danger: 'border-destructive/25 bg-destructive/[0.04] text-destructive',
  }[tone]
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card/70 px-4 py-3.5">
      <div className={`grid size-9 shrink-0 place-items-center rounded-lg border ${toneClass}`}>
        <Icon aria-hidden="true" className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="font-mono text-xl font-medium tabular-nums">{value}</p>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function ScopeGroup({
  label,
  scopes,
  danger = false,
}: {
  danger?: boolean
  label: string
  scopes: Scope[]
}) {
  const occurrences = new Map<string, number>()
  return (
    <div className="flex items-start gap-2">
      <span
        className={`mt-0.5 w-12 shrink-0 font-mono text-[9px] tracking-[0.12em] ${danger ? 'text-destructive' : 'text-ok'}`}
      >
        {label}
      </span>
      {scopes.length === 0
        ? (
            <span className="text-[11px] text-muted-foreground">无规则</span>
          )
        : (
            <div className="flex flex-wrap gap-1.5">
              {scopes.map((scope) => {
                const baseKey = `${scope.pattern}:${scope.actions.join(',')}`
                const occurrence = (occurrences.get(baseKey) ?? 0) + 1
                occurrences.set(baseKey, occurrence)
                return (
                  <span
                    className={`inline-flex items-center overflow-hidden rounded-md border text-[10px] ${
                      danger
                        ? 'border-destructive/25 bg-destructive/[0.04]'
                        : 'border-ok/20 bg-ok/[0.035]'
                    }`}
                    key={`${baseKey}:${occurrence}`}
                  >
                    <code className="border-r px-1.5 py-1 font-mono font-medium">{scope.pattern}</code>
                    <span className="px-1.5 py-1 font-mono text-muted-foreground">
                      {scope.actions.join(' · ')}
                    </span>
                  </span>
                )
              })}
            </div>
          )}
    </div>
  )
}

function ScopeSummary({ scopes, registerPaths }: { registerPaths?: string[], scopes: Scope[] }) {
  const allow = scopes.filter(scope => scope.effect !== 'deny')
  const deny = scopes.filter(scope => scope.effect === 'deny')
  return (
    <div className="grid min-w-[360px] gap-2.5">
      <ScopeGroup label="ALLOW" scopes={allow} />
      {deny.length > 0 && <ScopeGroup danger label="DENY" scopes={deny} />}
      {registerPaths && registerPaths.length > 0 && (
        <div className="flex items-start gap-2">
          <span className="mt-0.5 w-12 shrink-0 font-mono text-[9px] tracking-[0.12em] text-primary">
            REGISTER
          </span>
          <div className="flex flex-wrap gap-1">
            {registerPaths.map(path => (
              <code
                className="rounded border border-primary/25 bg-primary/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-primary"
                key={path}
              >
                {path}
              </code>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Lifecycle({ sk, status }: { sk: SecretKeyInfo, status: SkStatus }) {
  return (
    <div className="grid gap-1.5 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">签发</span>
        <time className="font-mono" dateTime={sk.createdAt}>
          {sk.createdAt ? formatDate(sk.createdAt) : '未知'}
        </time>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">到期</span>
        {sk.expiresAt
          ? (
              <time
                className={`font-mono ${status === 'expired' ? 'text-warn' : ''}`}
                dateTime={sk.expiresAt}
                title={new Date(sk.expiresAt).toLocaleString()}
              >
                {formatDate(sk.expiresAt)}
              </time>
            )
          : (
              <span className="text-muted-foreground">永久</span>
            )}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: SkStatus }) {
  if (status === 'disabled') {
    return (
      <Badge
        className="border-destructive/35 bg-destructive/[0.04] text-destructive"
        variant="outline"
      >
        <span className="size-1.5 rounded-full bg-current" />
        disabled
      </Badge>
    )
  }
  if (status === 'expired') {
    return (
      <Badge className="border-warn/35 bg-warn/[0.04] text-warn" variant="outline">
        <span className="size-1.5 rounded-full bg-current" />
        expired
      </Badge>
    )
  }
  return (
    <Badge className="border-ok/35 bg-ok/[0.04] text-ok" variant="outline">
      <span className="size-1.5 rounded-full bg-current" />
      active
    </Badge>
  )
}

function CreateSkDialog({
  onIssued,
}: {
  onIssued: (value: { id: string, secret: string }) => void
}) {
  const invoke = useInvoke()
  const invalidate = useInvalidate()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<SkFormState>(INITIAL_SK_FORM)
  const [err, setErr] = useState<string | null>(null)

  const resetDraft = () => {
    setForm(INITIAL_SK_FORM)
    setErr(null)
  }

  const submit = () => {
    let args: ReturnType<typeof buildSkWriteArgs>
    try {
      args = buildSkWriteArgs(form)
    } catch (buildError) {
      setErr((buildError as Error).message)
      return
    }

    invoke.mutate(
      {
        path: 'system/sk',
        tool: 'write',
        args,
      },
      {
        onSuccess: (response) => {
          const data = response.json as { key: { id: string }, secret: string }
          setOpen(false)
          onIssued({ id: data.key.id, secret: data.secret })
          resetDraft()
          invalidate('sk-list')
          // 明文已转移到不可意外关闭的一次性结果弹窗，立即清除 mutation data 副本。
          setTimeout(() => invoke.reset(), 0)
        },
        onError: error => setErr(error.message),
      },
    )
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        if (invoke.isPending) return
        setOpen(next)
        if (!next) {
          resetDraft()
          invoke.reset()
        }
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus />
          签发 SK
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[92vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-3xl"
        onEscapeKeyDown={event => invoke.isPending && event.preventDefault()}
        onPointerDownOutside={event => invoke.isPending && event.preventDefault()}
        showCloseButton={!invoke.isPending}
      >
        <DialogHeader className="border-b px-5 py-5 sm:px-6">
          <DialogTitle>签发 Secret Key</DialogTitle>
          <DialogDescription>
            从身份开始，再定义权限与生命周期。deny 始终优先，无匹配默认拒绝。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          <SkFormFields disabled={invoke.isPending} onChange={setForm} state={form} />
          {err && (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/[0.04] px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {err}
            </p>
          )}
        </div>

        <DialogFooter className="border-t bg-background px-5 py-4 sm:px-6">
          <Button
            disabled={invoke.isPending}
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            取消
          </Button>
          <Button disabled={invoke.isPending} onClick={submit}>
            {invoke.isPending && <Loader2 className="animate-spin" />}
            {invoke.isPending ? '正在签发…' : '签发并显示一次明文'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Secret Key 管理：签发、scope 约束、禁用与吊销。 */
export function SkPage() {
  const list = useSkList()
  const invoke = useInvoke()
  const invalidate = useInvalidate()
  const [issued, setIssued] = useState<{ id: string, secret: string } | null>(null)
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const refresh = () => invalidate('sk-list')

  // 不吞 rejection:onError 已 toast,拒绝向上传递让 ConfirmAction 的禁用弹窗保留、允许重试;
  // 启用路径的调用方自行 .catch 掉。
  const setDisabled = (sk: SecretKeyInfo, disabled: boolean) =>
    invoke.mutateAsync(
      { path: 'system/sk', tool: 'update', args: { id: sk.id, patch: { disabled } } },
      {
        onSuccess: () => {
          toast.success(`${sk.owner} 的 SK 已${disabled ? '禁用' : '启用'}`)
          refresh()
        },
        onError: error => toast.error(error.message),
      },
    )

  const remove = async (sk: SecretKeyInfo) => {
    try {
      await invoke.mutateAsync({ path: 'system/sk', tool: 'delete', args: { id: sk.id } })
      toast.success(`${sk.id} 已吊销并删除`)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '吊销 Secret Key 失败')
      throw error
    }
  }

  const all = list.data?.items ?? []
  const now = Date.now()
  const statusCounts = all.reduce<Record<SkStatus, number>>(
    (counts, sk) => {
      counts[getSkStatus(sk, now)] += 1
      return counts
    },
    { active: 0, disabled: 0, expired: 0 },
  )
  const needle = filter.trim().toLowerCase()
  const items = all.filter((sk) => {
    const matchesText
      = needle === ''
        || [sk.id, sk.owner, sk.description ?? ''].some(value => value.toLowerCase().includes(needle))
    const matchesStatus = statusFilter === 'all' || getSkStatus(sk, now) === statusFilter
    return matchesText && matchesStatus
  })
  const hasFilters = needle !== '' || statusFilter !== 'all'

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <PageHeader
        actions={<CreateSkDialog onIssued={setIssued} />}
        description={(
          <>
            以身份、路径与动作组合最小权限；签发和吊销能力对等
            {' '}
            <code className="font-mono text-xs">tb sk</code>
            。
          </>
        )}
        eyebrow="AUTH / ACCESS CONTROL"
        title="Secret Key"
      />

      <section aria-label="Secret Key 状态概览" className="mt-6 grid gap-3 sm:grid-cols-3">
        <StatusMetric
          description="可通过 scope 授权"
          icon={ShieldCheck}
          label="有效"
          tone="ok"
          value={statusCounts.active}
        />
        <StatusMetric
          description="保留记录但拒绝访问"
          icon={ShieldOff}
          label="已禁用"
          tone="danger"
          value={statusCounts.disabled}
        />
        <StatusMetric
          description="生命周期已经结束"
          icon={Clock3}
          label="已过期"
          tone="warn"
          value={statusCounts.expired}
        />
      </section>

      <section aria-label="SK 列表" className="mt-6 overflow-hidden rounded-xl border bg-card/70">
        <div className="flex flex-col gap-3 border-b bg-muted/10 px-4 py-3.5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-8 shrink-0 place-items-center rounded-md border bg-background text-primary">
              <KeySquare aria-hidden="true" className="size-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-medium">访问身份</h2>
              <p className="text-xs text-muted-foreground">
                已加载
                {' '}
                {all.length}
                {' '}
                把，当前显示
                {' '}
                {items.length}
                {' '}
                把
              </p>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="搜索 Secret Key"
                className="h-9 w-full pl-9 text-sm"
                onChange={event => setFilter(event.target.value)}
                placeholder="搜索 owner、用途或 id"
                value={filter}
              />
            </div>
            <fieldset className="flex min-w-0 overflow-x-auto rounded-md border bg-background p-0.5">
              <legend className="sr-only">按状态过滤</legend>
              {STATUS_FILTERS.map((option) => {
                const count = option.value === 'all' ? all.length : statusCounts[option.value]
                return (
                  <Button
                    aria-pressed={statusFilter === option.value}
                    className="gap-1.5"
                    key={option.value}
                    onClick={() => setStatusFilter(option.value)}
                    size="xs"
                    type="button"
                    variant={statusFilter === option.value ? 'secondary' : 'ghost'}
                  >
                    {option.label}
                    <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
                  </Button>
                )
              })}
            </fieldset>
          </div>
        </div>

        {list.isPending
          ? (
              <div className="grid gap-3 p-5">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-4/5" />
              </div>
            )
          : list.isError
            ? (
                <EmptyState
                  action={(
                    <Button onClick={() => void list.refetch()} size="sm" variant="outline">
                      重新加载
                    </Button>
                  )}
                  className="m-4"
                  icon={ShieldOff}
                  title="无法加载 Secret Key"
                  tone="danger"
                >
                  <p>{list.error.message}</p>
                </EmptyState>
              )
            : items.length === 0
              ? (
                  <EmptyState
                    action={
                      hasFilters
                        ? (
                            <Button
                              onClick={() => {
                                setFilter('')
                                setStatusFilter('all')
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
                    icon={KeySquare}
                    title={hasFilters ? '没有符合当前条件的 SK' : '还没有签发任何 SK'}
                  >
                    <p>{hasFilters ? '调整搜索词或状态过滤。' : '从右上角签发一把最小权限 SK。'}</p>
                  </EmptyState>
                )
              : (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[1040px]">
                      <TableHeader>
                        <TableRow className="bg-muted/15">
                          <TableHead className="w-[270px]">身份与用途</TableHead>
                          <TableHead>权限边界</TableHead>
                          <TableHead className="w-[170px]">生命周期</TableHead>
                          <TableHead className="w-[100px]">状态</TableHead>
                          <TableHead className="w-[92px]">
                            <span className="sr-only">操作</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((sk) => {
                          const status = getSkStatus(sk, now)
                          return (
                            <TableRow className="group align-top" key={sk.id}>
                              <TableCell className="py-4">
                                <div className="flex items-start gap-3">
                                  <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border bg-muted/20 text-muted-foreground">
                                    <UserRound aria-hidden="true" className="size-3.5" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="truncate font-mono text-sm font-medium">{sk.owner}</p>
                                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                                      {sk.description || '未填写用途说明'}
                                    </p>
                                    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                      <span className="uppercase tracking-[0.12em]">id</span>
                                      <code className="max-w-40 truncate font-mono">{sk.id}</code>
                                      <CopyButton label="复制 id" value={sk.id} />
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="py-4">
                                <ScopeSummary registerPaths={sk.registerPaths} scopes={sk.scopes} />
                              </TableCell>
                              <TableCell className="py-4">
                                <Lifecycle sk={sk} status={status} />
                              </TableCell>
                              <TableCell className="py-4">
                                <StatusBadge status={status} />
                              </TableCell>
                              <TableCell className="py-4">
                                <div className="flex justify-end gap-1">
                                  {sk.disabled
                                    ? (
                                        // 启用是恢复访问，非破坏性，直接点击。
                                        <Button
                                          aria-label="启用"
                                          disabled={invoke.isPending}
                                          onClick={() => { void setDisabled(sk, false).catch(() => {}) }}
                                          size="icon-sm"
                                          title="启用"
                                          variant="ghost"
                                        >
                                          <Check />
                                        </Button>
                                      )
                                    : (
                                        // 禁用会立即拒绝该 SK 的所有请求，与吊销的确认标准对齐。
                                        <ConfirmAction
                                          actionLabel="禁用"
                                          description={<p>禁用后该 SK 的所有请求会立即被拒绝（引用它的 Agent/设备随即断开）。可随时重新启用。</p>}
                                          onConfirm={async () => { await setDisabled(sk, true) }}
                                          title={`禁用 ${sk.id}?`}
                                          trigger={(
                                            <Button
                                              aria-label="禁用"
                                              disabled={invoke.isPending}
                                              size="icon-sm"
                                              title="禁用"
                                              variant="ghost"
                                            >
                                              <Ban />
                                            </Button>
                                          )}
                                        />
                                      )}
                                  <ConfirmAction
                                    actionLabel="吊销并删除"
                                    description={
                                      <p>删除后当前区域通常很快拒绝该 SK；CF KV 向其它边缘传播常需约 60 秒，且可能更久。此操作不可撤销。</p>
                                    }
                                    onConfirm={() => remove(sk)}
                                    title={`吊销并删除 ${sk.id}?`}
                                    trigger={(
                                      <Button
                                        aria-label="吊销并删除"
                                        size="icon-sm"
                                        title="吊销并删除"
                                        variant="ghost"
                                      >
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
                  </div>
                )}
        {!list.isPending && !list.isError && (
          <PaginationFooter
            count={all.length}
            hasNextPage={Boolean(list.hasNextPage)}
            isFetchingNextPage={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
            unit="把 SK"
          />
        )}
      </section>

      <Dialog open={issued !== null}>
        <DialogContent className="p-4 sm:p-6" showCloseButton={false}>
          <DialogHeader>
            <div className="mb-1 grid size-10 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
              <KeyRound aria-hidden="true" className="size-5" />
            </div>
            <DialogTitle className="text-base">SK 已签发，明文仅显示这一次</DialogTitle>
            <DialogDescription>
              服务端只存 sha256 哈希。关闭后无法找回，请立即复制到安全的凭证管理器。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 rounded-lg border bg-muted/15 p-3">
            <p className="font-mono text-[11px] text-muted-foreground">{issued?.id}</p>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2.5 font-mono text-xs leading-5 break-all">
                {issued?.secret}
              </code>
              <Button
                aria-label="复制 SK 明文"
                onClick={async () => {
                  if (!issued) return
                  try {
                    await navigator.clipboard.writeText(issued.secret)
                    toast.success('已复制到剪贴板')
                  } catch {
                    toast.error('复制失败，请手动选择明文')
                  }
                }}
                size="icon-sm"
                variant="outline"
              >
                <Copy />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setIssued(null)}>我已安全保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
