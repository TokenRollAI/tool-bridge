import type { ReactNode } from 'react'

/** 页面定位与动作的统一入口：分区标签、无衬线标题、说明和右侧动作。 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  actions?: ReactNode
  description?: ReactNode
  /** 可选的页面分区标签；只用于说明所属工作区，不重复页面标题。 */
  eyebrow?: ReactNode
  title: ReactNode
}) {
  return (
    <header className="flex flex-col items-stretch gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-6">
      <div className="min-w-0 flex-1">
        <div className={`mb-2 flex items-center gap-2.5 ${eyebrow ? 'min-h-3' : 'h-px'}`}>
          <span className="h-px w-8 shrink-0 bg-primary" />
          {eyebrow && (
            <span className="text-[10px] font-semibold tracking-[0.18em] text-primary uppercase">
              {eyebrow}
            </span>
          )}
        </div>
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-balance">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-3xl text-sm leading-6 break-words text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:shrink-0 sm:justify-end sm:pb-0.5">
          {actions}
        </div>
      )}
    </header>
  )
}
