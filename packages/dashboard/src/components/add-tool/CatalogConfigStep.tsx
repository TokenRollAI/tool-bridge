import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, Rocket, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { CatalogListItem } from '@/lib/types'
import {
  buildIntegrationCalls,
  defaultMountPath,
  INITIAL_INTEGRATION_FORM,
  type IntegrationFormState,
  integrationPlan,
} from '@/pages/system/forms/integrationPlan'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ManagedCredentialFields } from '@/pages/system/forms/ManagedCredentialFields'
import { FormSection } from '@/components/FormSection'
import { Button } from '@/components/ui/button'
import { useSecretList } from '@/lib/queries'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { encodeTreePath } from '@/lib/path'
import { INTEGRATION_PRESETS } from './addToolSources'
import { MountStepsView } from './MountStepsView'
import { useMountRunner } from './useMountRunner'

/** 挂载编排的结果视图:步骤时间线 + 成功/失败收尾。 */
function MountRunView({
  runner,
  provider,
  onRetry,
  onDone,
}: {
  onDone: () => void
  onRetry: () => void
  provider: string
  runner: ReturnType<typeof useMountRunner>
}) {
  const { state } = runner
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        {state.succeeded
          ? (
              <div className="mb-5 flex items-start gap-3 rounded-xl border border-ok/30 bg-ok/[0.04] px-4 py-3.5">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {provider}
                    {' '}
                    挂载成功
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {state.mountedPath}
                  </p>
                </div>
              </div>
            )
          : state.running
            ? (
                <p className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  正在挂载并预检…
                </p>
              )
            : (
                <p className="mb-5 text-sm text-muted-foreground">挂载未完成 —— 见下方失败步骤。</p>
              )}

        <MountStepsView steps={state.steps} />

        {state.authorizationUrl && (
          <a
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2 text-xs text-primary hover:bg-primary/10"
            href={state.authorizationUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalLink className="size-3.5" />
            打开授权页完成授权
          </a>
        )}
      </div>

      <div className="flex gap-2 border-t bg-background px-5 py-4 sm:px-6">
        {state.succeeded
          ? (
              <>
                <Button asChild className="flex-1" variant="outline">
                  <Link onClick={onDone} to={`/nodes/${encodeTreePath(state.mountedPath ?? '')}`}>
                    打开节点
                  </Link>
                </Button>
                <Button className="flex-1" onClick={onDone}>完成</Button>
              </>
            )
          : !state.running
              ? (
                  <>
                    <Button className="flex-1" onClick={onRetry} variant="outline">
                      返回修改
                    </Button>
                    <Button className="flex-1" onClick={onDone} variant="ghost">关闭</Button>
                  </>
                )
              : null}
      </div>
    </>
  )
}

/**
 * 内置集成的配置步骤:选 provider(或从预设进来已预选)→ 填凭证/配置 → 挂载并预检。
 * 挂载走 useMountRunner:可见分步 + 失败诊断 + 可见回滚。复用 buildIntegrationCalls
 * (测试锁定的 wire payload)与 ManagedCredentialFields。
 */
export function CatalogConfigStep({
  catalog,
  initialProvider,
  defaultPath,
  onBack,
  onDone,
}: {
  catalog: CatalogListItem[]
  defaultPath?: string
  initialProvider: string
  onBack: () => void
  onDone: () => void
}) {
  const secrets = useSecretList()
  const runner = useMountRunner()
  const [query, setQuery] = useState('')
  const [buildErr, setBuildErr] = useState<string | null>(null)

  const preset = INTEGRATION_PRESETS.find(p => p.provider === initialProvider)
  const [form, setForm] = useState<IntegrationFormState>(() => {
    if (initialProvider === '') return { ...INITIAL_INTEGRATION_FORM, path: defaultPath ?? '' }
    const entry = catalog.find(i => i.id === initialProvider)
    const exportId = entry?.exports.length === 1 ? entry.exports[0]! : ''
    return {
      ...INITIAL_INTEGRATION_FORM,
      provider: initialProvider,
      path: preset?.path ?? defaultPath ?? defaultMountPath(entry),
      exportId,
      config: preset?.config ?? {},
      mode: integrationPlan(entry, exportId).kind === 'none' ? 'none' : 'inline',
    }
  })

  const entry = useMemo(() => catalog.find(i => i.id === form.provider), [catalog, form.provider])
  const plan = integrationPlan(entry, form.exportId)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q === ''
      ? catalog
      : catalog.filter(i =>
          i.id.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q))
    return base.slice(0, 50)
  }, [catalog, query])

  const selectProvider = (item: CatalogListItem) => {
    const exportId = item.exports.length === 1 ? item.exports[0]! : ''
    const nextPlan = integrationPlan(item, exportId)
    setForm(current => ({
      ...current,
      provider: item.id,
      path: current.path.trim() === '' ? defaultMountPath(item) : current.path,
      exportId,
      credentials: {},
      existingSecret: '',
      config: {},
      mode: nextPlan.kind === 'none' ? 'none' : 'inline',
    }))
  }

  const submit = () => {
    setBuildErr(null)
    let calls: ReturnType<typeof buildIntegrationCalls>
    try {
      calls = buildIntegrationCalls(form, entry)
    } catch (error) {
      setBuildErr((error as Error).message)
      return
    }
    void runner.run(calls)
  }

  // 挂载编排进行中或已出结果:展示可见步骤视图。
  if (runner.state.steps.length > 0) {
    return (
      <MountRunView onDone={onDone} onRetry={runner.reset} provider={form.provider} runner={runner} />
    )
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        <button
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft className="size-3.5" />
          返回来源
        </button>

        <div className="grid gap-5">
          <FormSection
            description="平台自带的集成目录:每一项都是这个部署里现成可用的代码。"
            index="01"
            title="选择集成"
          >
            {form.provider === '' && (
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
                <Input
                  className="pl-8 text-sm"
                  onChange={e => setQuery(e.target.value)}
                  placeholder="tavily / jira / memos…"
                  value={query}
                />
              </div>
            )}
            {form.provider === ''
              ? (
                  <div className="grid max-h-64 gap-1 overflow-y-auto rounded-md border p-1">
                    {filtered.map(item => (
                      <button
                        className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/60"
                        key={item.id}
                        onClick={() => selectProvider(item)}
                        type="button"
                      >
                        <code className="font-mono font-medium">{item.id}</code>
                        <span className="truncate text-muted-foreground">{item.description}</span>
                        {Object.values(item.exportDetails).some(d => d.auth.kind === 'oauth') && (
                          <Badge className="ml-auto px-1 py-0 text-[10px]" variant="outline">
                            OAuth
                          </Badge>
                        )}
                      </button>
                    ))}
                    {filtered.length === 0 && (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                        无匹配集成
                      </p>
                    )}
                  </div>
                )
              : (
                  <div className="flex items-center gap-2 rounded-lg border bg-card/50 px-3 py-2.5">
                    <code className="font-mono text-sm font-medium">{form.provider}</code>
                    <span className="truncate text-xs text-muted-foreground">
                      {entry?.description}
                    </span>
                    <Button
                      className="ml-auto"
                      onClick={() => setForm(c => ({ ...c, provider: '', exportId: '' }))}
                      size="xs"
                      variant="ghost"
                    >
                      更换
                    </Button>
                  </div>
                )}

            {form.provider !== '' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label className="text-xs" htmlFor="wiz-path">挂载路径 *</Label>
                  <Input
                    className="font-mono text-sm"
                    id="wiz-path"
                    onChange={e => setForm(c => ({ ...c, path: e.target.value }))}
                    placeholder="tools/tavily"
                    value={form.path}
                  />
                </div>
                {plan.needsExportChoice && (
                  <div className="grid gap-1.5">
                    <Label className="text-xs">export *</Label>
                    <Select
                      onValueChange={(value) => {
                        const nextPlan = integrationPlan(entry, value)
                        setForm(c => ({
                          ...c,
                          exportId: value,
                          credentials: {},
                          existingSecret: '',
                          config: {},
                          mode: nextPlan.kind === 'none' ? 'none' : 'inline',
                        }))
                      }}
                      value={form.exportId}
                    >
                      <SelectTrigger className="font-mono text-xs">
                        <SelectValue placeholder="选一个 export" />
                      </SelectTrigger>
                      <SelectContent>
                        {(entry?.exports ?? []).map(id => (
                          <SelectItem className="font-mono text-xs" key={id} value={id}>{id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
          </FormSection>

          {form.provider !== '' && (
            <FormSection
              description="平台自动加密保管,不写入节点配置,也不会回显。"
              index="02"
              title="凭证"
            >
              <ManagedCredentialFields
                idPrefix="wiz-credential"
                onChange={cred => setForm(c => ({
                  ...c,
                  credentials: cred.credentials,
                  existingSecret: cred.existingSecret,
                  mode: cred.mode,
                }))}
                plan={plan}
                secretNames={(secrets.data?.items ?? []).map(item => item.name)}
                state={{
                  credentials: form.credentials,
                  existingSecret: form.existingSecret,
                  mode: form.mode,
                }}
              />
            </FormSection>
          )}

          {form.provider !== '' && plan.mountConfigFields.length > 0 && (
            <FormSection
              description="非密钥配置(如自建实例地址),明文存进节点记录。"
              index="03"
              title={plan.mountConfigFields.some(f => f.required === true) ? '配置' : '配置(可选)'}
            >
              <div className="grid gap-2">
                {plan.mountConfigFields.map(field => (
                  <div className="grid gap-1.5" key={field.key}>
                    <Label className="text-xs" htmlFor={`wiz-mc-${field.key}`}>
                      {field.key}
                      {field.required === true && ' *'}
                      {field.label !== undefined && (
                        <span className="ml-1.5 font-normal text-muted-foreground">
                          {field.label}
                        </span>
                      )}
                    </Label>
                    <Input
                      className="font-mono text-sm"
                      id={`wiz-mc-${field.key}`}
                      onChange={e => setForm(c => ({
                        ...c,
                        config: { ...c.config, [field.key]: e.target.value },
                      }))}
                      value={form.config[field.key] ?? ''}
                    />
                    {field.description !== undefined && (
                      <p className="text-[11px] text-muted-foreground">{field.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </FormSection>
          )}

          {buildErr && (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/[0.045] px-3 py-2.5 text-xs text-destructive"
              role="alert"
            >
              {buildErr}
            </p>
          )}
        </div>
      </div>

      <div className="border-t bg-background px-5 py-4 sm:px-6">
        <Button className="w-full" disabled={form.provider === ''} onClick={submit}>
          <Rocket />
          挂载并预检
          {form.provider && ` ${form.provider}`}
        </Button>
      </div>
    </>
  )
}
