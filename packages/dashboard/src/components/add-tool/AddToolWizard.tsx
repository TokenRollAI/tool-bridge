import { ArrowRight, ChevronRight, Plus, Sparkles } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { MountDialog } from '@/pages/system/forms/MountDialog'
import { useIntegrationCatalog } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ADD_SOURCES, type AddSource, availablePresets } from './addToolSources'
import { CatalogConfigStep } from './CatalogConfigStep'

type WizardStep = 'source' | 'catalog-config'

function WizardBody({
  step,
  setStep,
  defaultPath,
  onClose,
}: {
  defaultPath?: string
  onClose: () => void
  setStep: (step: WizardStep) => void
  step: WizardStep
}) {
  const navigate = useNavigate()
  const catalog = useIntegrationCatalog()
  const [selectedProvider, setSelectedProvider] = useState<string>('')

  const catalogIds = useMemo(
    () => new Set((catalog.data ?? []).map(item => item.id)),
    [catalog.data],
  )
  const presets = useMemo(() => availablePresets(catalogIds), [catalogIds])

  const pickSource = (source: AddSource) => {
    if (source.kind === 'catalog') {
      setSelectedProvider('')
      setStep('catalog-config')
      return
    }
    if (source.kind === 'plugin') {
      onClose()
      navigate('/manage/plugins')
    }
    // 其余自定义 kind 由卡片内嵌的 MountDialog trigger 直接打开(见下方渲染)。
  }

  const openPreset = (provider: string) => {
    setSelectedProvider(provider)
    setStep('catalog-config')
  }

  if (step === 'catalog-config') {
    return (
      <CatalogConfigStep
        catalog={catalog.data ?? []}
        defaultPath={defaultPath}
        initialProvider={selectedProvider}
        onBack={() => setStep('source')}
        onDone={onClose}
      />
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
      {presets.length > 0 && (
        <section className="mb-6">
          <div className="mb-2.5 flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h3 className="text-sm font-medium">常用集成</h3>
            <span className="text-[11px] text-muted-foreground">一键预填,填好凭证即可</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {presets.map(preset => (
              <button
                className="flex items-center gap-3 rounded-xl border bg-card/50 px-3.5 py-3 text-left transition-colors hover:border-primary/45 hover:bg-secondary/40"
                key={preset.provider}
                onClick={() => openPreset(preset.provider)}
                type="button"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{preset.label}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {preset.blurb}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2.5 text-sm font-medium">选择来源</h3>
        <div className="grid gap-2">
          {ADD_SOURCES.map((source) => {
            const Icon = source.icon
            const card = (
              <span className="group flex w-full items-center gap-3 rounded-xl border bg-card/40 px-4 py-3 text-left transition-colors hover:border-primary/45 hover:bg-secondary/40">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-background/70 text-muted-foreground group-hover:text-primary">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium">{source.title}</span>
                    {source.kind === 'catalog' && (
                      <Badge className="text-[10px]" variant="secondary">推荐</Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                    {source.blurb}
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </span>
            )
            // 自定义 kind 直接用 MountDialog 的 trigger(预选 kind);catalog/plugin 走 pickSource。
            if (source.mountKind) {
              return (
                <MountDialog
                  defaultKind={source.mountKind}
                  {...(defaultPath !== undefined ? { defaultPath } : {})}
                  existingPaths={[]}
                  key={source.kind}
                  trigger={<button type="button">{card}</button>}
                />
              )
            }
            return (
              <button key={source.kind} onClick={() => pickSource(source)} type="button">
                {card}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

/**
 * 统一「添加工具」向导 —— 把原本散在集成目录 / 节点注册 / Plugin 三页的入口收敛成一处:
 * 选来源 → 配置 → 挂载并预检(可见分步 + 失败诊断 + 可见回滚)。
 *
 * - 内置集成(catalog):向导内一站式完成,复用 buildIntegrationCalls + 可见步骤 runner。
 * - 自定义 kind(mcp/http/context/skillhub/remote):交给既有 MountDialog(逻辑已测)。
 * - 自定义 plugin:引导到 Plugin 注册页(契约校验后再回来挂)。
 */
export function AddToolWizard({
  trigger,
  defaultPath,
}: {
  defaultPath?: string
  trigger?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<WizardStep>('source')

  const close = () => {
    setOpen(false)
    // 关闭动画后复位,避免看到步骤闪回。
    setTimeout(() => setStep('source'), 200)
  }

  return (
    <Dialog onOpenChange={next => (next ? setOpen(true) : close())} open={open}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus />
            添加工具
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="top-0 right-0 bottom-0 left-auto flex h-dvh max-h-none w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-2xl"
        showCloseButton
      >
        <DialogHeader className="border-b px-5 py-4 sm:px-6">
          <DialogTitle className="text-lg">添加工具</DialogTitle>
          <DialogDescription>
            从来源开始:内置集成一站式挂载,自定义类型走通用挂载器。
          </DialogDescription>
        </DialogHeader>

        <WizardBody defaultPath={defaultPath} onClose={close} setStep={setStep} step={step} />
      </DialogContent>
    </Dialog>
  )
}
