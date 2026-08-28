import {
  AlertTriangle,
  Ban,
  Eye,
  Inbox,
  Loader2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
  DeviceOperationDetail,
  DeviceOperationState,
  DeviceOperationSummary,
} from '@/lib/types'
import type { DeviceMailboxTarget } from '@/lib/deviceMailbox'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useCancelDeviceOperation,
  useDeviceOperationDetail,
  useDeviceOperations,
} from '@/lib/queries'
import { PaginationFooter } from '@/components/PaginationFooter'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const STATE_LABEL: Record<DeviceOperationState, string> = {
  cancelled: '已取消',
  claimed: '执行中',
  expired: '已过期',
  failed: '失败',
  queued: '等待设备',
  rejected: '设备拒绝',
  result_unknown: '结果未知',
  succeeded: '成功',
}

const STATE_TONE: Record<DeviceOperationState, string> = {
  cancelled: 'border-muted-foreground/25 text-muted-foreground',
  claimed: 'border-primary/30 bg-primary/5 text-primary',
  expired: 'border-warn/30 bg-warn/5 text-warn',
  failed: 'border-destructive/30 bg-destructive/5 text-destructive',
  queued: 'border-info/30 bg-info/5 text-info',
  rejected: 'border-destructive/30 bg-destructive/5 text-destructive',
  result_unknown: 'border-warn/30 bg-warn/5 text-warn',
  succeeded: 'border-ok/30 bg-ok/5 text-ok',
}

function formatTime(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value
}

function OperationStateBadge({ state }: { state: DeviceOperationState }) {
  return (
    <Badge className={cn('font-normal', STATE_TONE[state])} variant="outline">
      {STATE_LABEL[state]}
    </Badge>
  )
}

function AmbiguityNotice({ operation }: { operation: DeviceOperationDetail }) {
  if (operation.state === 'result_unknown') {
    return (
      <div className="rounded-md border border-warn/30 bg-warn/5 p-3 text-xs leading-5 text-warn">
        设备已确认命令开始执行，但无法恢复结果；不要在没有业务幂等保障时直接重试。
      </div>
    )
  }
  if (operation.state === 'expired' && operation.executionMayHaveOccurred) {
    return (
      <div className="rounded-md border border-warn/30 bg-warn/5 p-3 text-xs leading-5 text-warn">
        租约期间设备失联且操作过期：服务端无法证明它是否执行过，业务副作用可能已经发生。
      </div>
    )
  }
  return null
}

function OperationDetailDialog({
  deviceId,
  onClose,
  operationId,
}: {
  deviceId: string
  onClose: () => void
  operationId: string | null
}) {
  const detail = useDeviceOperationDetail(deviceId, operationId)
  const cancel = useCancelDeviceOperation(deviceId)
  const operation = detail.data
  const cancellable = operation?.state === 'queued' || operation?.state === 'claimed'

  const requestCancel = () => {
    if (operationId === null) return
    cancel.mutate(operationId, {
      onSuccess: result => toast.success(
        result.state === 'cancelled' ? '操作已取消' : '取消请求已记录，等待设备观察',
      ),
      onError: cause => toast.error(cause.message),
    })
  }

  return (
    <Dialog onOpenChange={value => !value && onClose()} open={operationId !== null}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="break-all font-mono text-base">
            {operationId ?? '设备操作'}
          </DialogTitle>
          <DialogDescription>持久化操作详情与执行歧义边界。</DialogDescription>
        </DialogHeader>
        {detail.isPending
          ? <Skeleton className="h-56 w-full" />
          : detail.isError
            ? <p className="text-sm text-destructive">{detail.error.message}</p>
            : operation && (
              <div className="grid gap-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <OperationStateBadge state={operation.state} />
                  <span className="text-xs text-muted-foreground">
                    第
                    {operation.attempt}
                    {' '}
                    次 claim
                  </span>
                  {operation.cancelRequestedAt && (
                    <Badge variant="outline">已请求取消</Badge>
                  )}
                </div>
                <AmbiguityNotice operation={operation} />
                <dl className="grid gap-x-5 gap-y-3 rounded-md border bg-muted/10 p-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">目标命令</dt>
                  <dd className="break-all font-mono text-xs">{operation.targetPath}</dd>
                  <dt className="text-muted-foreground">设备</dt>
                  <dd className="break-all font-mono text-xs">{operation.deviceId}</dd>
                  <dt className="text-muted-foreground">调用方快照</dt>
                  <dd className="break-all font-mono text-xs">
                    {operation.caller.owner}
                    {' '}
                    ·
                    {' '}
                    {operation.caller.keyId}
                  </dd>
                  <dt className="text-muted-foreground">traceId</dt>
                  <dd className="break-all font-mono text-xs">{operation.traceId}</dd>
                  <dt className="text-muted-foreground">创建时间</dt>
                  <dd>{formatTime(operation.createdAt)}</dd>
                  <dt className="text-muted-foreground">过期时间</dt>
                  <dd>{formatTime(operation.expiresAt)}</dd>
                  {operation.terminalAt && (
                    <>
                      <dt className="text-muted-foreground">终结时间</dt>
                      <dd>{formatTime(operation.terminalAt)}</dd>
                    </>
                  )}
                </dl>
                {operation.result !== undefined && (
                  <div>
                    <p className="mb-2 text-xs font-medium">结果</p>
                    <pre className="max-h-72 overflow-auto rounded-md border bg-muted/20 p-3 font-mono text-xs whitespace-pre-wrap break-words">
                      {JSON.stringify(operation.result, null, 2)}
                    </pre>
                  </div>
                )}
                {operation.error && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-destructive">错误</p>
                    <pre className="max-h-72 overflow-auto rounded-md border border-destructive/20 bg-destructive/5 p-3 font-mono text-xs whitespace-pre-wrap break-words">
                      {JSON.stringify(operation.error, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
        <DialogFooter>
          {cancellable && (
            <Button disabled={cancel.isPending} onClick={requestCancel} variant="destructive">
              {cancel.isPending ? <Loader2 className="animate-spin" /> : <Ban />}
              {operation?.state === 'claimed' ? '请求取消' : '取消操作'}
            </Button>
          )}
          <Button onClick={onClose} variant="outline">关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MailboxTable({
  deviceId,
  onSelect,
}: {
  deviceId: string
  onSelect: (operationId: string) => void
}) {
  const list = useDeviceOperations(deviceId)
  const operations = list.data?.pages.flatMap(page => page.items) ?? []

  if (list.isPending) {
    return (
      <div className="grid gap-2 p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-5/6" />
      </div>
    )
  }
  if (list.isError) {
    return (
      <EmptyState className="m-4" icon={AlertTriangle} title="Mailbox 读取失败" tone="danger">
        <p>{list.error.message}</p>
      </EmptyState>
    )
  }
  if (operations.length === 0) {
    return (
      <EmptyState className="m-4" icon={Inbox} title="这个设备还没有持久化操作">
        <p>入队后，操作会等待设备主动 claim；设备当前无需在线。</p>
      </EmptyState>
    )
  }
  return (
    <>
      <Table className="min-w-[880px]">
        <TableHeader>
          <TableRow>
            <TableHead>操作</TableHead>
            <TableHead className="w-28">状态</TableHead>
            <TableHead>目标</TableHead>
            <TableHead className="w-20">尝试</TableHead>
            <TableHead className="w-44">更新时间</TableHead>
            <TableHead className="w-16"><span className="sr-only">详情</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {operations.map((operation: DeviceOperationSummary) => (
            <TableRow key={operation.operationId}>
              <TableCell>
                <button
                  className="max-w-52 truncate font-mono text-xs hover:text-primary hover:underline"
                  onClick={() => onSelect(operation.operationId)}
                  type="button"
                >
                  {operation.operationId}
                </button>
                {operation.executionMayHaveOccurred && (
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-warn">
                    <AlertTriangle className="size-3" />
                    可能已执行
                  </p>
                )}
              </TableCell>
              <TableCell><OperationStateBadge state={operation.state} /></TableCell>
              <TableCell className="max-w-80">
                <p className="truncate font-mono text-xs">{operation.targetPath}</p>
              </TableCell>
              <TableCell className="font-mono text-xs">{operation.attempt}</TableCell>
              <TableCell className="text-xs">{formatTime(operation.updatedAt)}</TableCell>
              <TableCell>
                <Button
                  aria-label={`查看操作 ${operation.operationId}`}
                  onClick={() => onSelect(operation.operationId)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Eye />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <PaginationFooter
        count={operations.length}
        hasNextPage={Boolean(list.hasNextPage)}
        isFetchingNextPage={list.isFetchingNextPage}
        onLoadMore={() => void list.fetchNextPage()}
        unit="条操作"
      />
    </>
  )
}

/** Dashboard 的 durable mailbox 管理面；设备消费仍由 SDK pull processor 完成。 */
export function DeviceMailboxPanel({ targets }: { targets: DeviceMailboxTarget[] }) {
  const [deviceId, setDeviceId] = useState(targets[0]?.deviceId ?? '')
  const [selectedOperation, setSelectedOperation] = useState<{
    deviceId: string
    operationId: string
  } | null>(null)

  useEffect(() => {
    if (!targets.some(candidate => candidate.deviceId === deviceId)) {
      setDeviceId(targets[0]?.deviceId ?? '')
    }
  }, [deviceId, targets])

  return (
    <section className="mt-4 overflow-hidden rounded-lg border bg-card/45">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Durable Mailbox</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            操作由命令调用面的 delivery 策略创建；这里负责查询和取消。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {targets.length > 0 && (
            <Select onValueChange={setDeviceId} value={deviceId}>
              <SelectTrigger className="max-w-72 font-mono text-xs" size="sm">
                <SelectValue placeholder="选择设备" />
              </SelectTrigger>
              <SelectContent>
                {targets.map(candidate => (
                  <SelectItem
                    className="font-mono text-xs"
                    key={`${candidate.deviceId}:${candidate.mountPath}`}
                    value={candidate.deviceId}
                  >
                    {candidate.deviceId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      {deviceId === ''
        ? (
            <EmptyState className="m-4" icon={Inbox} title="先接入设备">
              <p>Mailbox 操作按 deviceId 隔离；在设备命令调用面选择 mailbox 或 fallback。</p>
            </EmptyState>
          )
        : (
            <MailboxTable
              deviceId={deviceId}
              onSelect={operationId => setSelectedOperation({ deviceId, operationId })}
            />
          )}
      {deviceId !== '' && (
        <OperationDetailDialog
          deviceId={selectedOperation?.deviceId ?? deviceId}
          onClose={() => setSelectedOperation(null)}
          operationId={selectedOperation?.operationId ?? null}
        />
      )}
    </section>
  )
}
