import { AlertTriangle, Check, Loader2, RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MountStep, StepState } from './mountDiagnostics'

/** 步骤状态 → 图标。 */
function StepIcon({ state }: { state: StepState }) {
  switch (state) {
    case 'running':
      return <Loader2 className="size-4 animate-spin text-primary" />
    case 'done':
      return <Check className="size-4 text-ok" />
    case 'failed':
      return <X className="size-4 text-destructive" />
    case 'rolled-back':
      return <RotateCcw className="size-4 text-warn" />
    case 'skipped':
      return <span className="size-2 rounded-full bg-muted-foreground/40" />
    default:
      return <span className="size-2 rounded-full bg-muted-foreground/30" />
  }
}

const STATE_LABEL: Record<StepState, string> = {
  'pending': '待执行',
  'running': '进行中',
  'done': '完成',
  'failed': '失败',
  'skipped': '跳过',
  'rolled-back': '已回滚',
}

/**
 * 挂载编排的可见时间线:secret → mount → (rollback / authorize)。
 * 失败步骤展开诊断(是哪一类问题 + 下一步)。把原本藏在代码里的回滚过程摊开给用户看。
 */
export function MountStepsView({ steps }: { steps: MountStep[] }) {
  return (
    <ol className="grid gap-2">
      {steps.map((step, index) => (
        <li
          className={cn(
            'rounded-xl border px-4 py-3',
            step.state === 'failed'
              ? 'border-destructive/35 bg-destructive/[0.04]'
              : step.state === 'rolled-back'
                ? 'border-warn/35 bg-warn/[0.04]'
                : step.state === 'done'
                  ? 'border-ok/30 bg-ok/[0.03]'
                  : 'bg-card/40',
          )}
          key={step.key}
        >
          <div className="flex items-center gap-3">
            <span className="grid size-6 shrink-0 place-items-center">
              <StepIcon state={step.state} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="text-sm font-medium">{step.label}</span>
              </span>
            </span>
            <span
              className={cn(
                'shrink-0 text-[11px]',
                step.state === 'failed'
                  ? 'text-destructive'
                  : step.state === 'done'
                    ? 'text-ok'
                    : step.state === 'rolled-back'
                      ? 'text-warn'
                      : 'text-muted-foreground',
              )}
            >
              {STATE_LABEL[step.state]}
            </span>
          </div>

          {step.diagnosis && (
            <div className="mt-2.5 ml-9 rounded-lg border border-destructive/25 bg-background/50 px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                <AlertTriangle className="size-3.5" />
                {step.diagnosis.title}
              </p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {step.diagnosis.hint}
              </p>
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}
