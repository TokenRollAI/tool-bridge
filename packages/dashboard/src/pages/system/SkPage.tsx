import { useQueryClient } from '@tanstack/react-query'
import { Ban, Check, Copy, KeyRound, KeySquare, Loader2, Plus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmAction } from '@/components/ConfirmAction'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useInvoke, useSkList } from '@/lib/queries'
import { ACTIONS, type Action, type Scope, type SecretKeyInfo } from '@/lib/types'

/**
 * Secret Key 管理(对等 `tb sk list|create|rm`:签发/吊销)。
 * 底层与 CLI 同一接口:POST /system/sk {tool: list|write|update|delete}。
 * 签发返回的 secret 明文只显示一次(服务端只存 sha256)。
 */
export function SkPage() {
  const list = useSkList()
  const invoke = useInvoke()
  const qc = useQueryClient()
  const [issued, setIssued] = useState<{ id: string; secret: string } | null>(null)
  const [filter, setFilter] = useState('')

  const refresh = () => qc.invalidateQueries({ queryKey: ['tb'] })

  const setDisabled = (sk: SecretKeyInfo, disabled: boolean) => {
    invoke.mutate(
      { path: 'system/sk', tool: 'update', args: { id: sk.id, patch: { disabled } } },
      {
        onSuccess: () => {
          toast.success(`${sk.id} 已${disabled ? '禁用' : '启用'}`)
          refresh()
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  const remove = (sk: SecretKeyInfo) => {
    invoke.mutate(
      { path: 'system/sk', tool: 'delete', args: { id: sk.id } },
      {
        onSuccess: () => {
          toast.success(`${sk.id} 已吊销并删除`)
          refresh()
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  const all = list.data?.items ?? []
  const needle = filter.trim().toLowerCase()
  const items =
    needle === ''
      ? all
      : all.filter((sk) =>
          [sk.id, sk.owner, sk.description ?? ''].some((s) => s.toLowerCase().includes(needle)),
        )

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <PageHeader
        title="Secret Key"
        description={
          <>
            签发、限定 scope、吊销——对等 <code className="font-mono text-xs">tb sk</code>
          </>
        }
        actions={
          <>
            {all.length > 3 && (
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="过滤 id / owner…"
                  aria-label="过滤"
                  className="h-8 w-44 pl-7 font-mono text-xs"
                />
              </div>
            )}
            <CreateSkDialog onIssued={(v) => setIssued(v)} />
          </>
        }
      />

      <div className="mt-6 overflow-hidden rounded-md border">
        {list.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
          </div>
        ) : list.isError ? (
          <p className="p-4 text-sm text-destructive">{list.error.message}</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={KeySquare}
            title={needle ? '无匹配 SK' : '还没有签发任何 SK'}
            className="border-0"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>id</TableHead>
                <TableHead>owner</TableHead>
                <TableHead>scopes</TableHead>
                <TableHead className="w-36">时间</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((sk) => {
                const expired = sk.expiresAt !== undefined && Date.parse(sk.expiresAt) <= Date.now()
                return (
                  <TableRow key={sk.id}>
                    <TableCell className="font-mono text-xs">
                      <span className="group/id inline-flex items-center gap-1">
                        {sk.id}
                        <CopyButton
                          value={sk.id}
                          label="复制 id"
                          className="opacity-0 group-hover/id:opacity-100"
                        />
                      </span>
                      {sk.description && (
                        <p className="mt-0.5 max-w-48 truncate font-sans text-muted-foreground">
                          {sk.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{sk.owner}</TableCell>
                    <TableCell>
                      <div className="flex max-w-64 flex-wrap gap-1">
                        {sk.scopes.map((s) => (
                          <Badge
                            key={`${s.effect ?? 'allow'}:${s.pattern}:${s.actions.join()}`}
                            variant="outline"
                            className={`font-mono text-[10px] ${s.effect === 'deny' ? 'border-destructive/40 text-destructive' : ''}`}
                          >
                            {s.effect === 'deny' ? '!' : ''}
                            {s.pattern}:{s.actions.join(',')}
                          </Badge>
                        ))}
                        {sk.registerPaths?.map((p) => (
                          <Badge
                            key={`rp:${p}`}
                            variant="outline"
                            className="font-mono text-[10px] border-violet-400/30 text-violet-400/90"
                          >
                            reg:{p}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-[10px] leading-4 text-muted-foreground">
                      {sk.createdAt && (
                        <p title={`创建 ${sk.createdAt}`}>
                          {new Date(sk.createdAt).toLocaleDateString()}
                        </p>
                      )}
                      {sk.expiresAt && (
                        <p className={expired ? 'text-warn' : ''} title={`过期 ${sk.expiresAt}`}>
                          → {new Date(sk.expiresAt).toLocaleDateString()}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {sk.disabled ? (
                        <Badge
                          variant="outline"
                          className="border-destructive/40 text-destructive text-[10px]"
                        >
                          disabled
                        </Badge>
                      ) : expired ? (
                        <Badge variant="outline" className="border-warn/40 text-warn text-[10px]">
                          expired
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-ok/40 text-ok text-[10px]">
                          active
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={sk.disabled ? '启用' : '禁用'}
                          title={sk.disabled ? '启用' : '禁用'}
                          onClick={() => setDisabled(sk, !sk.disabled)}
                        >
                          {sk.disabled ? <Check /> : <Ban />}
                        </Button>
                        <ConfirmAction
                          title={`吊销并删除 ${sk.id}?`}
                          description={
                            <p>删除后该 SK 立即失效(吊销传播上限 60s)。此操作不可撤销。</p>
                          }
                          actionLabel="吊销并删除"
                          onConfirm={() => remove(sk)}
                          trigger={
                            <Button variant="ghost" size="icon-xs" aria-label="删除" title="删除">
                              <Trash2 className="text-destructive" />
                            </Button>
                          }
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* 签发结果:secret 明文仅此一次 */}
      <Dialog open={issued !== null} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4 text-primary" />
              SK 已签发 — 明文仅显示这一次
            </DialogTitle>
            <DialogDescription>
              服务端只存 sha256 哈希;关闭本窗口后明文不可再取回,请立即复制保存。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <p className="font-mono text-xs text-muted-foreground">{issued?.id}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 rounded-sm border bg-background px-3 py-2 font-mono text-xs break-all">
                {issued?.secret}
              </code>
              <Button
                size="icon-sm"
                variant="outline"
                aria-label="复制"
                onClick={async () => {
                  if (issued) {
                    await navigator.clipboard.writeText(issued.secret)
                    toast.success('已复制到剪贴板')
                  }
                }}
              >
                <Copy />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setIssued(null)}>我已保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface ScopeRow {
  pattern: string
  actions: Action[]
  effect: 'allow' | 'deny'
}

function CreateSkDialog({ onIssued }: { onIssued: (v: { id: string; secret: string }) => void }) {
  const invoke = useInvoke()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [owner, setOwner] = useState('')
  const [description, setDescription] = useState('')
  const [scopes, setScopes] = useState<ScopeRow[]>([
    { pattern: '**', actions: ['read', 'call'], effect: 'allow' },
  ])
  const [registerPaths, setRegisterPaths] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const submit = () => {
    const cleaned: Scope[] = scopes
      .filter((s) => s.pattern.trim() !== '' && s.actions.length > 0)
      .map((s) => ({
        pattern: s.pattern.trim(),
        actions: s.actions,
        ...(s.effect === 'deny' ? { effect: 'deny' as const } : {}),
      }))
    if (owner.trim() === '') {
      setErr('owner 必填')
      return
    }
    const rp = registerPaths
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    invoke.mutate(
      {
        path: 'system/sk',
        tool: 'write',
        args: {
          owner: owner.trim(),
          scopes: cleaned,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(rp.length > 0 ? { registerPaths: rp } : {}),
          ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        },
      },
      {
        onSuccess: (r) => {
          const data = r.json as { key: { id: string }; secret: string }
          setOpen(false)
          setErr(null)
          onIssued({ id: data.key.id, secret: data.secret })
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
          签发 SK
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">签发 Secret Key</DialogTitle>
          <DialogDescription>
            scope 判定:deny 优先,glob 支持 <code className="font-mono">*</code>/
            <code className="font-mono">**</code>,无匹配默认拒。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="sk-owner" className="text-xs">
                owner *
              </Label>
              <Input
                id="sk-owner"
                className="font-mono text-sm"
                placeholder="agent:alice"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sk-desc" className="text-xs">
                描述
              </Label>
              <Input
                id="sk-desc"
                className="text-sm"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-xs">scopes</Label>
            {scopes.map((row, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 行内可编辑列表,无稳定业务键
              <div key={i} className="grid gap-2 rounded-sm border px-3 py-2">
                <div className="flex items-center gap-2">
                  <Input
                    className="h-8 flex-1 font-mono text-xs"
                    placeholder="pattern,如 docs/** 或 **"
                    aria-label="pattern"
                    value={row.pattern}
                    onChange={(e) =>
                      setScopes((s) =>
                        s.map((r, j) => (j === i ? { ...r, pattern: e.target.value } : r)),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="移除该行"
                    onClick={() => setScopes((s) => s.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {ACTIONS.map((a) => (
                    // biome-ignore lint/a11y/noLabelWithoutControl: Radix Checkbox 是 label 内可交互控件,规则只识别原生 input
                    <label key={a} className="flex items-center gap-1.5 font-mono text-xs">
                      <Checkbox
                        checked={row.actions.includes(a)}
                        onCheckedChange={(v) =>
                          setScopes((s) =>
                            s.map((r, j) =>
                              j === i
                                ? {
                                    ...r,
                                    actions: v
                                      ? [...r.actions, a]
                                      : r.actions.filter((x) => x !== a),
                                  }
                                : r,
                            ),
                          )
                        }
                      />
                      {a}
                    </label>
                  ))}
                  {/* biome-ignore lint/a11y/noLabelWithoutControl: Radix Checkbox 是 label 内可交互控件,规则只识别原生 input */}
                  <label className="ml-auto flex items-center gap-1.5 font-mono text-xs text-destructive">
                    <Checkbox
                      checked={row.effect === 'deny'}
                      onCheckedChange={(v) =>
                        setScopes((s) =>
                          s.map((r, j) => (j === i ? { ...r, effect: v ? 'deny' : 'allow' } : r)),
                        )
                      }
                    />
                    deny
                  </label>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() =>
                setScopes((s) => [...s, { pattern: '', actions: ['read'], effect: 'allow' }])
              }
            >
              <Plus />
              加一条 scope
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="sk-rp" className="text-xs">
                registerPaths(逗号分隔,可空)
              </Label>
              <Input
                id="sk-rp"
                className="font-mono text-xs"
                placeholder="device/build-01/**"
                value={registerPaths}
                onChange={(e) => setRegisterPaths(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sk-exp" className="text-xs">
                过期时间(可空)
              </Label>
              <Input
                id="sk-exp"
                type="datetime-local"
                className="text-xs"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>

          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button disabled={invoke.isPending} onClick={submit}>
            {invoke.isPending && <Loader2 className="animate-spin" />}
            签发
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
