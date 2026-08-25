import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, Rocket } from 'lucide-react'
import { Link } from 'react-router'
import { useState } from 'react'
import type { CatalogListItem } from '@/lib/types'
import {
  buildIntegrationCalls,
  defaultMountPath,
  INITIAL_INTEGRATION_FORM,
  type IntegrationFormState,
  integrationPlan,
} from '@/pages/system/forms/integrationPlan'
import { CatalogIntegrationFields } from '@/pages/system/forms/CatalogIntegrationFields'
import { Button } from '@/components/ui/button'
import { useSecretList } from '@/lib/queries'
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

  const entry = catalog.find(item => item.id === form.provider)

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
          <CatalogIntegrationFields
            catalog={catalog}
            collapseSelection
            form={form}
            idPrefix="wizard"
            onChange={setForm}
            secretNames={(secrets.data?.items ?? []).map(item => item.name)}
          />

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
