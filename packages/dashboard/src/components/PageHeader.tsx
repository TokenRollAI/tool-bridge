import type { ReactNode } from 'react'

/**
 * 页头统一形制:琥珀刻度线 + 等宽标题 + 说明,右侧动作区。
 * 所有页面共用,保证"工业面板"的版式一致性。
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end gap-3">
      <div className="min-w-0">
        <div className="mb-1.5 h-px w-10 bg-primary" />
        <h1 className="font-mono text-xl tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="ml-auto flex shrink-0 items-center gap-2 pb-0.5">{actions}</div>}
    </header>
  )
}
