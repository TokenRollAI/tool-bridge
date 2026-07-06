import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, ShieldEllipsis, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmAction } from '@/components/ConfirmAction'
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
import { Textarea } from '@/components/ui/textarea'
import { useInvoke, useSecretList } from '@/lib/queries'

/**
 * 凭证保管(SecretStore,对等 `tb secret set|ls|rm`;Proto §2.5 只写不读)。
 * 列表只见名字与时间戳,值永不回显——挂载 s3/mcp 时以 authRef 引用名字。
 */
export function SecretsPage() {
  const list = useSecretList()
  const invoke = useInvoke()
  const qc = useQueryClient()

  const remove = (name: string) => {
    invoke.mutate(
      { path: 'system/secret', tool: 'delete', args: { name } },
      {
        onSuccess: () => {
          toast.success(`凭证 ${name} 已删除`)
          qc.invalidateQueries({ queryKey: ['tb'] })
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="font-mono text-xl tracking-tight">凭证保管</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            SecretStore 只写不读:值加密落库,仅网关内部经 authRef 解析(Proto §2.5)
          </p>
        </div>
        <div className="ml-auto">
          <SetSecretDialog />
        </div>
      </header>

      <div className="mt-6 overflow-hidden rounded-md border">
        {list.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/6" />
          </div>
        ) : list.isError ? (
          <p className="p-4 text-sm text-destructive">{list.error.message}</p>
        ) : (list.data?.items ?? []).length === 0 ? (
          <div className="flex items-center gap-3 px-4 py-6 text-sm text-muted-foreground">
            <ShieldEllipsis className="size-4" />
            还没有保存任何凭证。挂载 s3 context 或带鉴权的上游前,先在这里 set。
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>name(authRef 引用名)</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list.data?.items ?? []).map((s) => (
                <TableRow key={s.name}>
                  <TableCell className="font-mono text-xs">{s.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {s.updatedAt}
                  </TableCell>
                  <TableCell>
                    <ConfirmAction
                      title={`删除凭证 ${s.name}?`}
                      description={<p>引用它的节点(authRef)将在下次调用时解析失败。</p>}
                      actionLabel="删除"
                      onConfirm={() => remove(s.name)}
                      trigger={
                        <Button variant="ghost" size="icon-xs" aria-label="删除" title="删除">
                          <Trash2 className="text-destructive" />
                        </Button>
                      }
                    />
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

function SetSecretDialog() {
  const invoke = useInvoke()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const submit = () => {
    if (name.trim() === '' || value === '') {
      setErr('name 与 value 均必填')
      return
    }
    invoke.mutate(
      { path: 'system/secret', tool: 'set', args: { name: name.trim(), value } },
      {
        onSuccess: () => {
          toast.success(`凭证 ${name.trim()} 已保存(值不回显)`)
          setOpen(false)
          setName('')
          setValue('')
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
          保存凭证
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-base">保存凭证(set)</DialogTitle>
          <DialogDescription>
            同名覆盖;保存后值不可读取。s3 凭证格式:
            <code className="ml-1 font-mono text-xs">
              {'{"accessKeyId":"…","secretAccessKey":"…"}'}
            </code>
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="secret-name" className="text-xs">
              name
            </Label>
            <Input
              id="secret-name"
              className="font-mono text-sm"
              placeholder="s3-main"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="secret-value" className="text-xs">
              value
            </Label>
            <Textarea
              id="secret-value"
              className="font-mono text-xs"
              rows={4}
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button disabled={invoke.isPending} onClick={submit}>
            {invoke.isPending && <Loader2 className="animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
