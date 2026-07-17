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
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { toast } from 'sonner'
import type { PluginHealth, PluginKind, PluginManifest, PluginRegistration } from '@/lib/types'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PaginationFooter } from '@/components/PaginationFooter'
import { ConfirmAction } from '@/components/ConfirmAction'
import { useInvoke, usePluginList } from '@/lib/queries'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const REQUIRED_METHODS: Record<PluginKind, readonly string[]> = {
  'tool-provider': ['List', 'Get', 'Call'],
  'context-provider': ['List', 'Get', 'Update', 'Write'],
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
  const methods = REQUIRED_METHODS[plugin.kind]
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
              {plugin.kind}
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
            <ManifestFact label="Interface">
              <span className="font-mono">{plugin.interfaceVersion}</span>
            </ManifestFact>
            <ManifestFact label="Kind">
              <span className="font-mono">{plugin.kind}</span>
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
                  的 kind 与 interfaceVersion 必须和
                  manifest 一致。
                </span>
              </span>
            </li>
            <li className="flex gap-3 px-4 py-3">
              <span className="font-mono text-[10px] text-primary">03</span>
              <span className="min-w-0">
                <span className="font-medium">Required methods</span>
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {methods.map(method => (
                    <Badge className="font-mono text-[10px]" key={method} variant="outline">
                      {method}
                    </Badge>
                  ))}
                </span>
                <span className="mt-1.5 block text-[10px] leading-5 text-muted-foreground">
                  <span className="font-mono">~help</span>
                  {' '}
                  必须包含全部必需方法；声明的可选
                  capability 也必须有对应命令。
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

interface ManifestFormState {
  authKind: 'platform-token' | 'bearer'
  enabled: boolean
  endpoint: string
  healthPath: string
  kind: PluginKind
  secretRef: string
  versionMajor: string
}

/** 表单态 → manifest 字段（id 由调用方补；interfaceVersion 前缀强制与 kind 一致）。 */
function buildManifestFields(state: ManifestFormState) {
  return {
    kind: state.kind,
    interfaceVersion: `${state.kind}/${state.versionMajor.trim() || 'v1'}`,
    endpoint: state.endpoint.trim(),
    auth:
      state.authKind === 'bearer'
        ? { kind: 'bearer' as const, secretRef: state.secretRef.trim() }
        : { kind: 'platform-token' as const },
    healthPath: state.healthPath.trim() || '/healthz',
    enabled: state.enabled,
  }
}

function FormSection({
  number,
  title,
  description,
  children,
}: {
  children: ReactNode
  description: string
  number: string
  title: string
}) {
  return (
    <section className="rounded-lg border bg-card/30">
      <div className="flex items-start gap-3 border-b px-4 py-3">
        <span className="mt-0.5 font-mono text-[10px] text-primary">{number}</span>
        <div>
          <h3 className="text-xs font-medium">{title}</h3>
          <p className="mt-0.5 text-[10px] leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="grid gap-3 p-4">{children}</div>
    </section>
  )
}

function ManifestFields({
  state,
  onChange,
  idPrefix,
  disabled = false,
}: {
  disabled?: boolean
  idPrefix: string
  onChange: (next: ManifestFormState) => void
  state: ManifestFormState
}) {
  const endpointId = `${idPrefix}-endpoint`
  const healthId = `${idPrefix}-health`
  const kindId = `${idPrefix}-kind`
  const versionId = `${idPrefix}-version`
  const authId = `${idPrefix}-auth`
  const secretId = `${idPrefix}-secret`
  const enabledId = `${idPrefix}-enabled`

  return (
    <div className="grid gap-3">
      <FormSection
        description="平台访问 Plugin 与健康端点的位置；生产环境使用 HTTPS，或填写平台 service binding。"
        number="01"
        title="Endpoint"
      >
        <div className="grid gap-1.5">
          <Label className="text-xs" htmlFor={endpointId}>
            Plugin endpoint *
          </Label>
          <Input
            className="font-mono text-xs"
            disabled={disabled}
            id={endpointId}
            onChange={event => onChange({ ...state, endpoint: event.target.value })}
            placeholder="https://plugin.example.com 或 binding:MY_PLUGIN"
            value={state.endpoint}
          />
        </div>
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label className="text-xs" htmlFor={healthId}>
            Health path *
          </Label>
          <Input
            className="font-mono text-xs"
            disabled={disabled}
            id={healthId}
            onChange={event => onChange({ ...state, healthPath: event.target.value })}
            placeholder="/healthz"
            value={state.healthPath}
          />
          <p className="text-[10px] leading-5 text-muted-foreground">
            必须以 / 开头；注册时和手动检查都会请求它。
          </p>
        </div>
      </FormSection>

      <FormSection
        description="声明 Provider 类型与契约主版本；平台会读取 ~describe 和 ~help 逐项核对。"
        number="02"
        title="Interface"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-xs" htmlFor={kindId}>
              Provider kind *
            </Label>
            <Select
              disabled={disabled}
              onValueChange={value => onChange({ ...state, kind: value as PluginKind })}
              value={state.kind}
            >
              <SelectTrigger className="font-mono text-xs" id={kindId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem className="font-mono text-xs" value="tool-provider">
                  tool-provider — 工具源
                </SelectItem>
                <SelectItem className="font-mono text-xs" value="context-provider">
                  context-provider — 存储源
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs" htmlFor={versionId}>
              接口主版本 *
            </Label>
            <Input
              className="font-mono text-xs"
              disabled={disabled}
              id={versionId}
              onChange={event => onChange({ ...state, versionMajor: event.target.value })}
              placeholder="v1"
              value={state.versionMajor}
            />
          </div>
        </div>
        <div className="rounded-md border bg-background/55 px-3 py-2.5">
          <p className="font-mono text-[10px] text-muted-foreground">
            {state.kind}
            /
            {state.versionMajor.trim() || 'v1'}
            {' '}
            requires
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REQUIRED_METHODS[state.kind].map(method => (
              <Badge className="font-mono text-[10px]" key={method} variant="outline">
                {method}
              </Badge>
            ))}
          </div>
        </div>
      </FormSection>

      <FormSection
        description="选择平台签发的一次性 Token，或引用凭证保管中的 bearer secret。"
        number="03"
        title="Authentication"
      >
        <div className="grid gap-1.5 sm:max-w-sm">
          <Label className="text-xs" htmlFor={authId}>
            Auth mode *
          </Label>
          <Select
            disabled={disabled}
            onValueChange={value =>
              onChange({ ...state, authKind: value as 'platform-token' | 'bearer' })}
            value={state.authKind}
          >
            <SelectTrigger className="font-mono text-xs" id={authId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem className="font-mono text-xs" value="platform-token">
                platform-token — 平台签发
              </SelectItem>
              <SelectItem className="font-mono text-xs" value="bearer">
                bearer — 引用已存凭证
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {state.authKind === 'bearer'
          ? (
              <div className="grid gap-1.5">
                <Label className="text-xs" htmlFor={secretId}>
                  Secret reference *
                </Label>
                <Input
                  className="font-mono text-xs"
                  disabled={disabled}
                  id={secretId}
                  onChange={event => onChange({ ...state, secretRef: event.target.value })}
                  placeholder="my-plugin-token"
                  value={state.secretRef}
                />
                <p className="text-[10px] leading-5 text-muted-foreground">
                  这里只填写
                  <Link
                    className="mx-1 text-foreground underline underline-offset-2"
                    to="/manage/secrets"
                  >
                    凭证保管
                  </Link>
                  中的名字，明文不会进入 manifest。
                </p>
              </div>
            )
          : (
              <div className="flex items-start gap-2.5 rounded-md border border-primary/20 bg-primary/[0.045] px-3 py-2.5">
                <KeyRound className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <p className="text-[10px] leading-5 text-muted-foreground">
                  注册成功，或从 bearer 切换到 platform-token 后，Token
                  只在该次响应显示。页面会阻止关闭，直到你明确确认已保存。
                </p>
              </div>
            )}
      </FormSection>

      <FormSection
        description="决定注册完成后是否立即允许挂载节点调用；它不代表远端当前健康。"
        number="04"
        title="Lifecycle"
      >
        <div className="flex items-start gap-3 rounded-md border bg-background/55 px-3 py-3">
          <Checkbox
            checked={state.enabled}
            disabled={disabled}
            id={enabledId}
            onCheckedChange={value => onChange({ ...state, enabled: value === true })}
          />
          <Label className="grid cursor-pointer gap-1 text-xs leading-5" htmlFor={enabledId}>
            <span>注册后启用调用</span>
            <span className="font-normal text-[10px] text-muted-foreground">
              关闭后 manifest 仍保留，但挂载节点调用会返回 unavailable，可随时重新启用。
            </span>
          </Label>
        </div>
      </FormSection>
    </div>
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
  onRegistered,
}: {
  onRegistered: (id: string) => void
  onToken: (value: { id: string, token: string }) => void
}) {
  const invoke = useInvoke()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [id, setId] = useState('')
  const [form, setForm] = useState<ManifestFormState>(INITIAL_FORM)
  const [error, setError] = useState<string | null>(null)

  const changeOpen = (next: boolean) => {
    if (invoke.isPending) return
    setOpen(next)
    if (!next) {
      setError(null)
      invoke.reset()
    }
  }

  const submit = () => {
    if (id.trim() === '' || form.endpoint.trim() === '') {
      setError('Plugin id 与 endpoint 必填。')
      return
    }
    if (form.authKind === 'bearer' && form.secretRef.trim() === '') {
      setError('Bearer 认证需要 secretRef；请先把值写入凭证保管。')
      return
    }
    invoke.mutate(
      {
        path: 'system/plugin',
        tool: 'write',
        args: { id: id.trim(), ...buildManifestFields(form) },
      },
      {
        onSuccess: (response) => {
          const registration = response.json as PluginRegistration
          toast.success(`Plugin ${registration.id} 已通过探活与契约校验`)
          setOpen(false)
          setError(null)
          setId('')
          setForm(INITIAL_FORM)
          onRegistered(registration.id)
          if (registration.pluginToken) {
            onToken({ id: registration.id, token: registration.pluginToken })
            setTimeout(() => invoke.reset(), 0)
          }
          qc.invalidateQueries({ queryKey: ['tb'] })
        },
        onError: submitError => setError(submitError.message),
      },
    )
  }

  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus />
          注册 Plugin
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[90svh] overflow-y-auto p-4 sm:max-w-2xl sm:p-6"
        onEscapeKeyDown={event => invoke.isPending && event.preventDefault()}
        onPointerDownOutside={event => invoke.isPending && event.preventDefault()}
        showCloseButton={!invoke.isPending}
      >
        <DialogHeader>
          <DialogTitle className="text-base">注册 Plugin</DialogTitle>
          <DialogDescription>
            Write 会先探活，再验证 ~describe / ~help；任一步失败都不会写入注册表。同 id
            重注册会换发并吊销上一代 platform-token。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <section className="rounded-lg border bg-card/30">
            <div className="flex items-start gap-3 border-b px-4 py-3">
              <span className="mt-0.5 font-mono text-[10px] text-primary">00</span>
              <div>
                <h3 className="text-xs font-medium">Identity</h3>
                <p className="mt-0.5 text-[10px] leading-5 text-muted-foreground">
                  稳定的注册表主键，也会被节点配置以 plugin:&lt;id&gt; 引用。
                </p>
              </div>
            </div>
            <div className="grid gap-1.5 p-4">
              <Label className="text-xs" htmlFor="register-plugin-id">
                Plugin id *
              </Label>
              <Input
                aria-describedby={error ? 'register-plugin-error' : undefined}
                className="font-mono text-sm"
                disabled={invoke.isPending}
                id="register-plugin-id"
                onChange={(event) => {
                  setId(event.target.value)
                  setError(null)
                }}
                placeholder="my-provider"
                value={id}
              />
              <p className="text-[10px] text-muted-foreground">
                允许 A–Z、a–z、0–9、点、下划线和短横线，且不能以标点开头。
              </p>
            </div>
          </section>

          <ManifestFields
            disabled={invoke.isPending}
            idPrefix="register-plugin"
            onChange={(next) => {
              setForm(next)
              setError(null)
            }}
            state={form}
          />

          {error && (
            <p
              className="rounded-md border border-destructive/35 bg-destructive/[0.05] px-3 py-2.5 text-xs leading-5 text-destructive"
              id="register-plugin-error"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="border-t pt-4">
          <Button disabled={invoke.isPending} onClick={() => changeOpen(false)} variant="outline">
            取消
          </Button>
          <Button disabled={invoke.isPending} onClick={submit}>
            {invoke.isPending ? <Loader2 className="animate-spin" /> : <FileCheck2 />}
            {invoke.isPending ? '正在探活并校验…' : '验证并注册'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** update 会整体重校验；认证切到 platform-token 时，响应含一次性 token。 */
function EditPluginDialog({
  plugin,
  onClose,
  onToken,
  onUpdated,
}: {
  onClose: () => void
  onToken: (value: { id: string, token: string }) => void
  onUpdated: (id: string) => void
  plugin: PluginManifest
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
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (invoke.isPending) return
    invoke.reset()
    onClose()
  }

  const submit = () => {
    if (form.endpoint.trim() === '') {
      setError('Endpoint 必填。')
      return
    }
    if (form.authKind === 'bearer' && form.secretRef.trim() === '') {
      setError('Bearer 认证需要 secretRef。')
      return
    }
    invoke.mutate(
      {
        path: 'system/plugin',
        tool: 'update',
        args: { id: plugin.id, patch: buildManifestFields(form) },
      },
      {
        onSuccess: (response) => {
          const registration = response.json as PluginRegistration
          toast.success(`Plugin ${plugin.id} 已更新`)
          onUpdated(plugin.id)
          onClose()
          if (registration.pluginToken) {
            onToken({ id: plugin.id, token: registration.pluginToken })
            setTimeout(() => invoke.reset(), 0)
          }
          qc.invalidateQueries({ queryKey: ['tb'] })
        },
        onError: submitError => setError(submitError.message),
      },
    )
  }

  return (
    <Dialog onOpenChange={open => !open && close()} open>
      <DialogContent
        className="max-h-[90svh] overflow-y-auto p-4 sm:max-w-2xl sm:p-6"
        onEscapeKeyDown={event => invoke.isPending && event.preventDefault()}
        onPointerDownOutside={event => invoke.isPending && event.preventDefault()}
        showCloseButton={!invoke.isPending}
      >
        <DialogHeader>
          <DialogTitle className="font-mono text-base">
            编辑
            {plugin.id}
          </DialogTitle>
          <DialogDescription>
            Endpoint、healthPath、kind 或接口版本变化时会重新探活并校验契约；失败不会覆盖当前
            manifest。
          </DialogDescription>
        </DialogHeader>

        <ManifestFields
          disabled={invoke.isPending}
          idPrefix={`edit-plugin-${plugin.id}`}
          onChange={(next) => {
            setForm(next)
            setError(null)
          }}
          state={form}
        />

        {error && (
          <p
            className="rounded-md border border-destructive/35 bg-destructive/[0.05] px-3 py-2.5 text-xs leading-5 text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}

        <DialogFooter className="border-t pt-4">
          <Button disabled={invoke.isPending} onClick={close} variant="outline">
            取消
          </Button>
          <Button disabled={invoke.isPending} onClick={submit}>
            {invoke.isPending ? <Loader2 className="animate-spin" /> : <Check />}
            {invoke.isPending ? '正在验证变更…' : '保存 Manifest'}
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
  const qc = useQueryClient()
  const inspectingId = useRef<string | null>(null)
  const [token, setToken] = useState<{ id: string, token: string } | null>(null)
  const [editing, setEditing] = useState<PluginManifest | null>(null)
  const [inspecting, setInspecting] = useState<PluginManifest | null>(null)
  const [changingEnabled, setChangingEnabled] = useState<string | null>(null)
  const [health, setHealth] = useState<Record<string, HealthView>>({})

  const refresh = () => qc.invalidateQueries({ queryKey: ['tb'] })
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
            六个命令保持对等。
          </>
        )}
        eyebrow="CONTROL PLANE / PROVIDERS"
        title="Plugin"
      />

      <section className="mt-6 flex flex-col gap-3 rounded-lg border bg-card/45 px-4 py-3.5 sm:flex-row sm:items-center">
        <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-background/70 text-primary">
          <FileCheck2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">生命周期与健康状态彼此独立</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Enabled 只决定平台是否允许调用；注册或契约字段更新时会自动探活并校验
            {' '}
            <span className="font-mono">~describe / ~help</span>
            。列表健康状态只在点击检查后刷新，不做后台轮询。
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
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <Badge className="font-mono text-[10px]" variant="outline">
                                {plugin.kind === 'tool-provider' ? 'tool' : 'context'}
                              </Badge>
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {plugin.interfaceVersion}
                              </span>
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
                            <Button
                              className="mt-1.5 -ml-2 text-muted-foreground"
                              disabled={changingEnabled !== null}
                              onClick={() => void setEnabled(plugin, !plugin.enabled)}
                              size="xs"
                              type="button"
                              variant="ghost"
                            >
                              {changingEnabled === plugin.id
                                ? (
                                    <Loader2 className="animate-spin" />
                                  )
                                : plugin.enabled
                                  ? (
                                      <Ban />
                                    )
                                  : (
                                      <Check />
                                    )}
                              {changingEnabled === plugin.id
                                ? '正在更新'
                                : plugin.enabled
                                  ? '禁用调用'
                                  : '重新启用'}
                            </Button>
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
