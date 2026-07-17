import {
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
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
import { PaginationFooter } from '@/components/PaginationFooter'
import { ConfirmAction } from '@/components/ConfirmAction'
import { useInvoke, useSecretList } from '@/lib/queries'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** SecretStore 管理：值只写不读，节点只持有 authRef 引用名。 */
export function SecretsPage() {
  const list = useSecretList()
  const invoke = useInvoke()
  const qc = useQueryClient()
  const [filter, setFilter] = useState('')
  const [editor, setEditor] = useState({ open: false, initialName: '' })

  const remove = async (name: string) => {
    try {
      await invoke.mutateAsync({ path: 'system/secret', tool: 'delete', args: { name } })
      toast.success(`凭证 ${name} 已删除`)
      await qc.invalidateQueries({ queryKey: ['tb'] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除凭证失败')
      throw error
    }
  }

  const all = list.data?.items ?? []
  const needle = filter.trim().toLowerCase()
  const items
    = needle === '' ? all : all.filter(secret => secret.name.toLowerCase().includes(needle))
  const openEditor = (initialName = '') => setEditor({ open: true, initialName })

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <PageHeader
        actions={(
          <Button onClick={() => openEditor()} size="sm">
            <Plus />
            保存新凭证
          </Button>
        )}
        description="把上游凭证留在网关信任边界内；业务节点只保存 authRef，不接触凭证明文。"
        eyebrow="AUTH / CREDENTIAL VAULT"
        title="凭证保管"
      />

      <section
        aria-label="SecretStore 信任边界"
        className="relative mt-6 overflow-hidden rounded-xl border border-ok/25 bg-ok/[0.035] p-4 sm:p-5"
      >
        <div className="pointer-events-none absolute top-0 right-0 size-40 translate-x-1/3 -translate-y-1/2 rounded-full bg-ok/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-ok/30 bg-background/70 text-ok">
              <ShieldCheck aria-hidden="true" className="size-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">只写不读的凭证边界</h2>
                <Badge
                  className="border-ok/30 bg-ok/[0.05] font-mono text-[10px] text-ok"
                  variant="outline"
                >
                  WRITE ONLY
                </Badge>
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                值以 AES-256-GCM 加密落库，保存后 Dashboard 和 API
                都不会回显；只有网关在调用上游时按 authRef 解析。
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-border rounded-lg border bg-background/60 text-center">
            <TrustFact label="保存" value="加密落库" />
            <TrustFact label="引用" value="仅 authRef" />
            <TrustFact label="读取" value="不可回显" />
          </div>
        </div>
      </section>

      <section
        aria-label="凭证引用列表"
        className="mt-6 overflow-hidden rounded-xl border bg-card/70"
      >
        <div className="flex flex-col gap-3 border-b bg-muted/10 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-8 shrink-0 place-items-center rounded-md border bg-background text-primary">
              <LockKeyhole aria-hidden="true" className="size-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-medium">引用目录</h2>
              <p className="text-xs text-muted-foreground">
                已加载
                {' '}
                {all.length}
                {' '}
                个引用名
                {needle && `，匹配 ${items.length} 个`}
              </p>
            </div>
          </div>
          <div className="relative min-w-0 sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="搜索凭证引用名"
              className="h-9 w-full pl-9 font-mono text-xs"
              onChange={event => setFilter(event.target.value)}
              placeholder="搜索 authRef 引用名"
              value={filter}
            />
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
                  icon={LockKeyhole}
                  title="无法加载凭证目录"
                  tone="danger"
                >
                  <p>{list.error.message}</p>
                </EmptyState>
              )
            : items.length === 0
              ? (
                  <EmptyState
                    action={
                      needle
                        ? (
                            <Button onClick={() => setFilter('')} size="sm" variant="outline">
                              清除搜索
                            </Button>
                          )
                        : (
                            <Button onClick={() => openEditor()} size="sm">
                              <Plus />
                              保存第一项凭证
                            </Button>
                          )
                    }
                    className="m-4"
                    icon={KeyRound}
                    title={needle ? '没有匹配的引用名' : '还没有保存任何凭证'}
                  >
                    <p>
                      {needle
                        ? '换一个名称继续搜索。'
                        : '挂载 S3、MCP 或 Plugin 上游前，先保存凭证，再在节点配置中引用它。'}
                    </p>
                  </EmptyState>
                )
              : (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[760px]">
                      <TableHeader>
                        <TableRow className="bg-muted/15">
                          <TableHead>引用身份</TableHead>
                          <TableHead className="w-[220px]">信任边界</TableHead>
                          <TableHead className="w-[210px]">最近更新</TableHead>
                          <TableHead className="w-[150px]">
                            <span className="sr-only">操作</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map(secret => (
                          <TableRow className="group" key={secret.name}>
                            <TableCell className="py-4">
                              <div className="flex items-start gap-3">
                                <div className="grid size-8 shrink-0 place-items-center rounded-md border bg-muted/20 text-muted-foreground">
                                  <KeyRound aria-hidden="true" className="size-3.5" />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <code className="truncate font-mono text-sm font-medium">
                                      {secret.name}
                                    </code>
                                    <CopyButton label="复制引用名" value={secret.name} />
                                  </div>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    节点配置使用
                                    {' '}
                                    <code className="font-mono text-[11px]">
                                      authRef: &quot;
                                      {secret.name}
                                      &quot;
                                    </code>
                                  </p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="py-4">
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <ShieldCheck aria-hidden="true" className="size-3.5 text-ok" />
                                值不可读取或回显
                              </div>
                            </TableCell>
                            <TableCell className="py-4">
                              <time
                                dateTime={secret.updatedAt}
                                title={new Date(secret.updatedAt).toLocaleString()}
                              >
                                <span className="block text-xs">
                                  {formatRelativeTime(secret.updatedAt)}
                                </span>
                                <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                                  {formatExactTime(secret.updatedAt)}
                                </span>
                              </time>
                            </TableCell>
                            <TableCell className="py-4">
                              <div className="flex justify-end gap-1.5">
                                <Button onClick={() => openEditor(secret.name)} size="xs" variant="outline">
                                  <RefreshCw />
                                  轮换
                                </Button>
                                <ConfirmAction
                                  actionLabel="删除"
                                  description={(
                                    <p>
                                      引用它的节点将在下次调用时解析失败。请先确认没有仍在使用的 authRef。
                                    </p>
                                  )}
                                  onConfirm={() => remove(secret.name)}
                                  title={`删除凭证 ${secret.name}?`}
                                  trigger={(
                                    <Button
                                      aria-label="删除凭证"
                                      size="icon-sm"
                                      title="删除凭证"
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
                  </div>
                )}

        {!list.isPending && !list.isError && (
          <PaginationFooter
            count={all.length}
            hasNextPage={Boolean(list.hasNextPage)}
            isFetchingNextPage={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
            unit="个凭证"
          />
        )}
      </section>

      <SetSecretDialog
        existingNames={all.map(secret => secret.name)}
        hasUnloadedNames={Boolean(list.hasNextPage)}
        initialName={editor.initialName}
        onOpenChange={open => setEditor(current => ({ ...current, open }))}
        open={editor.open}
      />
    </div>
  )
}

function TrustFact({ label, value }: { label: string, value: string }) {
  return (
    <div className="px-3 py-2.5 sm:px-4">
      <p className="font-mono text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-0.5 whitespace-nowrap text-[11px] font-medium">{value}</p>
    </div>
  )
}

function formatRelativeTime(value: string) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return '更新时间未知'
  const elapsed = Date.now() - timestamp
  const future = elapsed < 0
  const absolute = Math.abs(elapsed)
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
  ]
  for (const [duration, unit] of units) {
    if (absolute >= duration) {
      const amount = Math.max(1, Math.round(absolute / duration)) * (future ? 1 : -1)
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(amount, unit)
    }
  }
  return '刚刚更新'
}

function formatExactTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function SetSecretDialog({
  open,
  initialName,
  existingNames,
  hasUnloadedNames,
  onOpenChange,
}: {
  existingNames: string[]
  hasUnloadedNames: boolean
  initialName: string
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const invoke = useInvoke()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [showValue, setShowValue] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setValue('')
      setShowValue(false)
      setErr(null)
    }
  }, [initialName, open])

  const normalizedName = name.trim()
  const isRotation = normalizedName !== '' && existingNames.includes(normalizedName)
  const mayRotateUnloaded = normalizedName !== '' && !isRotation && hasUnloadedNames

  const reset = () => {
    setName('')
    setValue('')
    setShowValue(false)
    setErr(null)
    invoke.reset()
  }

  const requestOpenChange = (next: boolean) => {
    // 请求发出后不允许界面表现成“已取消”；等待 settled 后再清理明文。
    if (invoke.isPending) return
    onOpenChange(next)
    if (!next) reset()
  }

  const submit = () => {
    if (normalizedName === '' || value === '') {
      setErr('引用名与凭证明文均为必填项。')
      return
    }
    const action = isRotation ? '轮换' : mayRotateUnloaded ? '写入' : '保存'
    invoke.mutate(
      { path: 'system/secret', tool: 'set', args: { name: normalizedName, value } },
      {
        onSuccess: () => {
          toast.success(`凭证 ${normalizedName} 已${action}，值不会回显`)
          qc.invalidateQueries({ queryKey: ['tb'] })
          onOpenChange(false)
          setName('')
          setValue('')
          setShowValue(false)
          setErr(null)
          // mutation variables 含凭证明文；成功回调后立即丢弃 observer 状态。
          setTimeout(() => invoke.reset(), 0)
        },
        onError: error => setErr(error.message),
      },
    )
  }

  return (
    <Dialog onOpenChange={requestOpenChange} open={open}>
      <DialogContent
        className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-xl"
        onEscapeKeyDown={event => invoke.isPending && event.preventDefault()}
        onPointerDownOutside={event => invoke.isPending && event.preventDefault()}
        showCloseButton={!invoke.isPending}
      >
        <DialogHeader className="border-b px-5 py-5 sm:px-6">
          <div className="mb-1 grid size-10 place-items-center rounded-lg border border-primary/25 bg-primary/[0.07] text-primary">
            {isRotation ? <RefreshCw className="size-5" /> : <LockKeyhole className="size-5" />}
          </div>
          <DialogTitle>
            {isRotation
              ? `轮换 ${normalizedName}`
              : mayRotateUnloaded
                ? `写入 ${normalizedName}`
                : '保存新凭证'}
          </DialogTitle>
          <DialogDescription>
            {isRotation
              ? '同名写入会立即替换旧值；所有引用该 authRef 的节点会在下一次调用时使用新凭证。'
              : mayRotateUnloaded
                ? '凭证目录还有未加载页；该写入使用 upsert，后续页若已有同名引用将立即轮换旧值。'
                : '保存后仅保留引用名；明文不会出现在列表、详情或调用历史中。'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 px-5 py-5 sm:px-6">
          <div className="grid gap-1.5">
            <Label htmlFor="secret-name">authRef 引用名 *</Label>
            <Input
              autoComplete="off"
              className="font-mono text-sm"
              id="secret-name"
              onChange={event => setName(event.target.value)}
              placeholder="s3-production"
              value={name}
            />
            <p className="text-[11px] text-muted-foreground">
              节点配置只保存这个名字。已加载的同名项会明确切换为“轮换”；目录未加载完整时会按潜在轮换处理。
            </p>
          </div>

          {(isRotation || mayRotateUnloaded) && (
            <div className="flex items-start gap-2.5 rounded-lg border border-warn/30 bg-warn/[0.045] px-3 py-2.5 text-xs">
              <RefreshCw aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warn" />
              <p>
                <span className="font-medium text-warn">
                  {isRotation ? '这是凭证轮换。' : '该名称可能已存在于未加载页。'}
                </span>
                {' '}
                {isRotation
                  ? '旧值不会被读取或展示，将被新值直接替换。'
                  : '继续写入即确认：若存在同名引用，旧值会被新值直接替换。'}
              </p>
            </div>
          )}

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="secret-value">凭证明文 *</Label>
              <Button
                aria-controls="secret-value"
                aria-pressed={showValue}
                onClick={() => setShowValue(current => !current)}
                size="xs"
                type="button"
                variant="ghost"
              >
                {showValue ? <EyeOff /> : <Eye />}
                {showValue ? '隐藏明文' : '显示明文'}
              </Button>
            </div>
            <Textarea
              autoComplete="new-password"
              className={cn(
                'min-h-40 resize-y font-mono text-xs leading-5',
                !showValue && '[-webkit-text-security:disc] tracking-[0.16em]',
              )}
              id="secret-value"
              onChange={event => setValue(event.target.value)}
              placeholder={
                showValue ? '{"accessKeyId":"…","secretAccessKey":"…"}' : '输入或粘贴凭证明文'
              }
              spellCheck={false}
              value={value}
            />
            <div className="flex items-start gap-2 text-[11px] leading-5 text-muted-foreground">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-ok" />
              明文默认遮蔽；关闭窗口会清空本地表单，保存成功后也会清除 mutation 缓存。
            </div>
          </div>

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
            onClick={() => requestOpenChange(false)}
            type="button"
            variant="outline"
          >
            取消
          </Button>
          <Button disabled={invoke.isPending} onClick={submit}>
            {invoke.isPending
              ? (
                  <Loader2 className="animate-spin" />
                )
              : isRotation
                ? (
                    <RefreshCw />
                  )
                : (
                    <Plus />
                  )}
            {invoke.isPending
              ? '正在写入…'
              : isRotation
                ? '确认轮换凭证'
                : mayRotateUnloaded
                  ? '确认写入（同名将轮换）'
                  : '保存到凭证库'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
