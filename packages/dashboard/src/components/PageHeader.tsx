import type { ReactNode } from 'react'

/**
 * 页头统一形制:琥珀刻度线 + 等宽标题 + 说明,右侧动作区。
 * 所有页面共用,保证"工业面板"的版式一致性。
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** 可选的页面分区标签；不传时保持原有单刻度线形制。 */
  eyebrow?: ReactNode
}) {
  return (
    <header className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="min-w-0">
        <div className={`mb-1.5 flex items-center gap-2 ${eyebrow ? 'min-h-2.5' : 'h-px'}`}>
          <span className="h-px w-10 shrink-0 bg-primary" />
          {eyebrow && (
            <span className="font-mono text-[10px] tracking-[0.16em] text-primary uppercase">
              {eyebrow}
            </span>
          )}
        </div>
        <h1 className="font-mono text-xl tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm break-words text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 pb-0.5 sm:ml-auto sm:w-auto sm:shrink-0 sm:justify-end">
          {actions}
        </div>
      )}
    </header>
  )
}
