import { useQueryClient } from '@tanstack/react-query'
import { Globe, Loader2, Lock, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmAction } from '@/components/ConfirmAction'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useFederationList, useInvoke } from '@/lib/queries'

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

  const remove = async (host: string) => {
    await invoke.mutateAsync(
      { path: 'system/federation', tool: 'remove', args: { host } },
      {
        onSuccess: () => {
          toast.success(`已移除 ${host}`)
          qc.invalidateQueries({ queryKey: ['tb'] })
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <PageHeader
        title="联邦白名单"
        description="remote 节点只能挂到白名单内的 host 后缀(空 = 拒一切 remote);env 基线只读,运行时条目可增删"
        actions={<AddHostDialog />}
      />

      <div className="mt-6 overflow-hidden rounded-md border">
        {list.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/6" />
          </div>
        ) : list.isError ? (
          <p className="p-4 text-sm text-destructive">{list.error.message}</p>
        ) : items.length === 0 ? (
          <EmptyState icon={Globe} title="白名单为空,当前拒绝一切 remote 联邦" className="border-0">
            <p>添加目标 HTBP 服务器的 host 后缀(如 example.com),才能挂载 kind=remote 节点。</p>
          </EmptyState>
        ) : (
          <Table className="min-w-[620px]">
            <TableHeader>
              <TableRow>
                <TableHead>host 后缀</TableHead>
                <TableHead className="w-28">来源</TableHead>
                <TableHead className="w-44">更新时间</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((h) => (
                <TableRow key={h.host}>
                  <TableCell className="font-mono text-xs">{h.host}</TableCell>
                  <TableCell>
                    {h.source === 'env' ? (
                      <Badge variant="secondary" className="gap-1">
                        <Lock className="size-3" />
                        env 基线
                      </Badge>
                    ) : (
                      <Badge variant="outline">运行时</Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {h.updatedAt ? new Date(h.updatedAt).toLocaleString() : '-'}
                  </TableCell>
                  <TableCell>
                    {h.removable ? (
                      <ConfirmAction
                        title={`从白名单移除 ${h.host}?`}
                        description={<p>指向该 host 的 remote 节点将在下次调用/挂载时被拒。</p>}
                        actionLabel="移除"
                        onConfirm={() => remove(h.host)}
                        trigger={
                          <Button variant="ghost" size="icon-xs" aria-label="移除" title="移除">
                            <Trash2 className="text-destructive" />
                          </Button>
                        }
                      />
                    ) : (
                      <span title="env 基线条目:改 TB_REMOTE_ALLOWLIST 并重新部署">
                        <Button variant="ghost" size="icon-xs" disabled aria-label="不可删除">
                          <Lock className="text-muted-foreground" />
                        </Button>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}

function AddHostDialog() {
  const invoke = useInvoke()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [host, setHost] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const submit = () => {
    if (host.trim() === '') {
      setErr('host 必填')
      return
    }
    invoke.mutate(
      { path: 'system/federation', tool: 'add', args: { host: host.trim() } },
      {
        onSuccess: () => {
          toast.success(`已允许 ${host.trim()}`)
          setOpen(false)
          setHost('')
          setErr(null)
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
          添加 host
        </Button>
      </DialogTrigger>
      <DialogContent className="p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-base">添加白名单 host</DialogTitle>
          <DialogDescription>
            裸主机名后缀,不含 scheme/端口/路径;按 host 段边界后缀匹配(
            <code className="font-mono text-xs">example.com</code> 命中{' '}
            <code className="font-mono text-xs">api.example.com</code>)。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="fed-host" className="text-xs">
            host
          </Label>
          <Input
            id="fed-host"
            className="font-mono text-sm"
            placeholder="example.com"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button disabled={invoke.isPending} onClick={submit}>
            {invoke.isPending && <Loader2 className="animate-spin" />}
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
