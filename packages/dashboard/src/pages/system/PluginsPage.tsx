import { useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Ban,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Pencil,
  Plug2,
  Plus,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { ConfirmAction } from '@/components/ConfirmAction'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { PaginationFooter } from '@/components/PaginationFooter'
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
import { useInvoke, usePluginList } from '@/lib/queries'
import type { PluginHealth, PluginKind, PluginManifest, PluginRegistration } from '@/lib/types'

/**
 * Plugin 管理(对等 `tb plugin register|list|get|update|health|rm`)。
 * 底层同一接口:POST /system/plugin {tool: list|write|update|delete|health}(全 cmd 需 admin)。
 * 注册/auth 切换返回的 pluginToken 仅显示一次(与 SK 签发同款处理)。
 */
export function PluginsPage() {
  const list = usePluginList()
  const invoke = useInvoke()
  const qc = useQueryClient()
  const [token, setToken] = useState<{ id: string; token: string } | null>(null)
  const [editing, setEditing] = useState<PluginManifest | null>(null)
  const [health, setHealth] = useState<Record<string, PluginHealth | 'probing'>>({})

  const refresh = () => qc.invalidateQueries({ queryKey: ['tb'] })

  const setEnabled = (p: PluginManifest, enabled: boolean) => {
    invoke.mutate(
      { path: 'system/plugin', tool: 'update', args: { id: p.id, patch: { enabled } } },
      {
        onSuccess: () => {
          toast.success(`${p.id} 已${enabled ? '启用' : '禁用'}`)
          refresh()
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  const remove = async (p: PluginManifest) => {
    await invoke.mutateAsync(
      { path: 'system/plugin', tool: 'delete', args: { id: p.id } },
      {
        onSuccess: () => {
          toast.success(`已注销 plugin ${p.id}`)
          refresh()
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  const probe = (p: PluginManifest) => {
    setHealth((h) => ({ ...h, [p.id]: 'probing' }))
    invoke.mutate(
      { path: 'system/plugin', tool: 'health', args: { id: p.id } },
      {
        onSuccess: (r) => {
          const result = r.json as PluginHealth
          setHealth((h) => ({ ...h, [p.id]: result }))
        },
        onError: (e) => {
          setHealth((h) => {
            const { [p.id]: _dropped, ...rest } = h
            return rest
          })
          toast.error(e.message)
        },
      },
    )
  }

  const items = list.data?.items ?? []

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <PageHeader
        title="Plugin"
        description={
          <>
            注册自定义 Provider(探活 + 契约校验)——对等{' '}
            <code className="font-mono text-xs">tb plugin</code>;注册后在
            <Link to="/manage/registry" className="mx-0.5 underline underline-offset-2">
              节点注册
            </Link>
            以 provider 名义挂上树
          </>
        }
        actions={<RegisterPluginDialog onToken={(v) => setToken(v)} />}
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
          <EmptyState icon={Plug2} title="还没有注册任何 plugin" className="border-0">
            <p>实现 tool-provider / context-provider 契约的服务,注册后可作为节点的 provider。</p>
          </EmptyState>
        ) : (
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>id</TableHead>
                <TableHead>kind</TableHead>
                <TableHead>endpoint</TableHead>
                <TableHead>auth</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-40">探活</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => {
                const h = health[p.id]
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">
                      <span className="group/id inline-flex items-center gap-1">
                        {p.id}
                        <CopyButton
                          value={p.id}
                          label="复制 id"
                          className="opacity-0 group-hover/id:opacity-100"
                        />
                      </span>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        {p.interfaceVersion}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {p.kind === 'tool-provider' ? 'tool' : 'context'}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-52 truncate font-mono text-xs" title={p.endpoint}>
                      {p.endpoint}
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">
                      {p.auth.kind}
                      {p.auth.kind === 'bearer' && (
                        <p className="truncate" title={p.auth.secretRef}>
                          ↪ {p.auth.secretRef}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.enabled ? (
                        <Badge variant="outline" className="border-ok/40 text-ok text-[10px]">
                          enabled
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-destructive/40 text-destructive text-[10px]"
                        >
                          disabled
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="探活"
                          title={`GET ${p.healthPath}`}
                          disabled={h === 'probing'}
                          onClick={() => probe(p)}
                        >
                          {h === 'probing' ? <Loader2 className="animate-spin" /> : <Activity />}
                        </Button>
                        {h !== undefined && h !== 'probing' && (
                          <span
                            className={`font-mono text-[10px] ${h.healthy ? 'text-ok' : 'text-destructive'}`}
                            title={`checked ${h.checkedAt}`}
                          >
                            {h.healthy ? 'healthy' : 'unhealthy'}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="编辑"
                          title="编辑"
                          onClick={() => setEditing(p)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={p.enabled ? '禁用' : '启用'}
                          title={p.enabled ? '禁用' : '启用'}
                          onClick={() => setEnabled(p, !p.enabled)}
                        >
                          {p.enabled ? <Ban /> : <Check />}
                        </Button>
                        <ConfirmAction
                          title={`注销 plugin ${p.id}?`}
                          description={
                            <p>
                              引用它的挂载节点将在下次调用时失败;platform-token
                              将被吊销。此操作不可撤销。
                            </p>
                          }
                          actionLabel="注销"
                          onConfirm={() => remove(p)}
                          trigger={
                            <Button variant="ghost" size="icon-xs" aria-label="注销" title="注销">
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
        {!list.isPending && !list.isError && (
          <PaginationFooter
            count={items.length}
            unit="个 Plugin"
            hasNextPage={Boolean(list.hasNextPage)}
            isFetchingNextPage={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
          />
        )}
      </div>

      {editing && (
        <EditPluginDialog
          plugin={editing}
          onClose={() => setEditing(null)}
          onToken={(v) => setToken(v)}
        />
      )}

      {/* pluginToken 仅注册/auth 切换响应出现一次 */}
      <Dialog open={token !== null}>
        <DialogContent className="p-4 sm:p-6" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4 text-primary" />
              Plugin Token — 仅显示这一次
            </DialogTitle>
            <DialogDescription>
              把它配置到 plugin 服务侧用于回验平台调用;关闭本窗口后不可再取回(重注册可换发)。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <p className="font-mono text-xs text-muted-foreground">{token?.id}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 rounded-sm border bg-background px-3 py-2 font-mono text-xs break-all">
                {token?.token}
              </code>
              <Button
                size="icon-sm"
                variant="outline"
                aria-label="复制"
                onClick={async () => {
                  if (token) {
                    await navigator.clipboard.writeText(token.token)
                    toast.success('已复制到剪贴板')
                  }
                }}
              >
                <Copy />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setToken(null)}>我已保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface ManifestFormState {
  kind: PluginKind
  versionMajor: string
  endpoint: string
  healthPath: string
  authKind: 'platform-token' | 'bearer'
  secretRef: string
  enabled: boolean
}

/** 表单态 → manifest 字段(id 由调用方补;interfaceVersion 前缀强制与 kind 一致)。 */
function buildManifestFields(s: ManifestFormState) {
  return {
    kind: s.kind,
    interfaceVersion: `${s.kind}/${s.versionMajor.trim() || 'v1'}`,
    endpoint: s.endpoint.trim(),
    auth:
      s.authKind === 'bearer'
        ? { kind: 'bearer' as const, secretRef: s.secretRef.trim() }
        : { kind: 'platform-token' as const },
    healthPath: s.healthPath.trim() || '/healthz',
    enabled: s.enabled,
  }
}

function ManifestFields({
  state,
  onChange,
}: {
  state: ManifestFormState
  onChange: (next: ManifestFormState) => void
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label className="text-xs">kind</Label>
          <Select
            value={state.kind}
            onValueChange={(v) => onChange({ ...state, kind: v as PluginKind })}
          >
            <SelectTrigger className="font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tool-provider" className="font-mono text-xs">
                tool-provider — 工具源
              </SelectItem>
              <SelectItem value="context-provider" className="font-mono text-xs">
                context-provider — 存储源
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="plugin-version" className="text-xs">
            接口主版本
          </Label>
          <Input
            id="plugin-version"
            className="font-mono text-xs"
            placeholder="v1"
            value={state.versionMajor}
            onChange={(e) => onChange({ ...state, versionMajor: e.target.value })}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="plugin-endpoint" className="text-xs">
          endpoint *(https:// 或 binding:&lt;name&gt;)
        </Label>
        <Input
          id="plugin-endpoint"
          className="font-mono text-xs"
          placeholder="https://plugin.example.com"
          value={state.endpoint}
          onChange={(e) => onChange({ ...state, endpoint: e.target.value })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="plugin-health" className="text-xs">
            healthPath
          </Label>
          <Input
            id="plugin-health"
            className="font-mono text-xs"
            placeholder="/healthz"
            value={state.healthPath}
            onChange={(e) => onChange({ ...state, healthPath: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">auth</Label>
          <Select
            value={state.authKind}
            onValueChange={(v) =>
              onChange({ ...state, authKind: v as 'platform-token' | 'bearer' })
            }
          >
            <SelectTrigger className="font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="platform-token" className="font-mono text-xs">
                platform-token — 平台签发
              </SelectItem>
              <SelectItem value="bearer" className="font-mono text-xs">
                bearer — 引用已存凭证
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {state.authKind === 'bearer' && (
        <div className="grid gap-1.5">
          <Label htmlFor="plugin-secret" className="text-xs">
            secretRef *(凭证保管里的名字)
          </Label>
          <Input
            id="plugin-secret"
            className="font-mono text-xs"
            placeholder="my-plugin-token"
            value={state.secretRef}
            onChange={(e) => onChange({ ...state, secretRef: e.target.value })}
          />
        </div>
      )}

      {/* biome-ignore lint/a11y/noLabelWithoutControl: Radix Checkbox 是 label 内可交互控件,规则只识别原生 input */}
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={state.enabled}
          onCheckedChange={(v) => onChange({ ...state, enabled: v === true })}
        />
        enabled(禁用后挂载节点调用返回 unavailable)
      </label>
    </>
  )
}

const INITIAL_FORM: ManifestFormState = {
  kind: 'tool-provider',
  versionMajor: 'v1',
  endpoint: '',
  healthPath: '/healthz',
  authKind: 'platform-token',
  secretRef: '',
  enabled: true,
}

function RegisterPluginDialog({
  onToken,
}: {
  onToken: (v: { id: string; token: string }) => void
}) {
  const invoke = useInvoke()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [id, setId] = useState('')
  const [form, setForm] = useState<ManifestFormState>(INITIAL_FORM)
  const [err, setErr] = useState<string | null>(null)

  const submit = () => {
    if (id.trim() === '' || form.endpoint.trim() === '') {
      setErr('id 与 endpoint 必填')
      return
    }
    if (form.authKind === 'bearer' && form.secretRef.trim() === '') {
      setErr('bearer 认证需要 secretRef(先在「凭证保管」set)')
      return
    }
    invoke.mutate(
      {
        path: 'system/plugin',
        tool: 'write',
        args: { id: id.trim(), ...buildManifestFields(form) },
      },
      {
        onSuccess: (r) => {
          const reg = r.json as PluginRegistration
          toast.success(`plugin ${reg.id} 已注册(探活 + 契约校验通过)`)
          setOpen(false)
          setErr(null)
          setId('')
          setForm(INITIAL_FORM)
          if (reg.pluginToken) onToken({ id: reg.id, token: reg.pluginToken })
          qc.invalidateQueries({ queryKey: ['tb'] })
          if (reg.pluginToken) setTimeout(() => invoke.reset(), 0)
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
          注册 plugin
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto p-4 sm:max-w-lg sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-base">注册 plugin(write)</DialogTitle>
          <DialogDescription>
            注册即探活 + 契约校验,失败则拒;同 id 重注册会换发 platform-token 并吊销上一代。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="plugin-id" className="text-xs">
              id *([A-Za-z0-9._-],不以标点开头)
            </Label>
            <Input
              id="plugin-id"
              className="font-mono text-sm"
              placeholder="my-provider"
              value={id}
              onChange={(e) => setId(e.target.value)}
            />
          </div>
          <ManifestFields state={form} onChange={setForm} />
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button disabled={invoke.isPending} onClick={submit}>
            {invoke.isPending && <Loader2 className="animate-spin" />}
            注册
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 编辑 = update {id, patch}(对等 `tb plugin update`);auth 切到 platform-token 时响应含一次性 token。 */
function EditPluginDialog({
  plugin,
  onClose,
  onToken,
}: {
  plugin: PluginManifest
  onClose: () => void
  onToken: (v: { id: string; token: string }) => void
}) {
  const invoke = useInvoke()
  const qc = useQueryClient()
  const [form, setForm] = useState<ManifestFormState>(() => ({
    kind: plugin.kind,
    versionMajor: plugin.interfaceVersion.split('/')[1] ?? 'v1',
    endpoint: plugin.endpoint,
    healthPath: plugin.healthPath,
    authKind: plugin.auth.kind,
    secretRef: plugin.auth.kind === 'bearer' ? plugin.auth.secretRef : '',
    enabled: plugin.enabled,
  }))
  const [err, setErr] = useState<string | null>(null)

  const submit = () => {
    if (form.endpoint.trim() === '') {
      setErr('endpoint 必填')
      return
    }
    if (form.authKind === 'bearer' && form.secretRef.trim() === '') {
      setErr('bearer 认证需要 secretRef')
      return
    }
    invoke.mutate(
      {
        path: 'system/plugin',
        tool: 'update',
        args: { id: plugin.id, patch: buildManifestFields(form) },
      },
      {
        onSuccess: (r) => {
          const reg = r.json as PluginRegistration
          toast.success(`plugin ${plugin.id} 已更新`)
          onClose()
          if (reg.pluginToken) onToken({ id: plugin.id, token: reg.pluginToken })
          qc.invalidateQueries({ queryKey: ['tb'] })
          if (reg.pluginToken) setTimeout(() => invoke.reset(), 0)
        },
        onError: (e) => setErr(e.message),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto p-4 sm:max-w-lg sm:p-6">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">编辑 {plugin.id}</DialogTitle>
          <DialogDescription>
            契约相关字段(endpoint / healthPath / kind / 接口版本)变更会重探活 +
            重契约校验,失败则拒不落库。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <ManifestFields state={form} onChange={setForm} />
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
