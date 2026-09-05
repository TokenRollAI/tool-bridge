import type { ReactNode } from 'react'

/** 页面定位与动作的统一入口：分区标签、无衬线标题、说明和右侧动作。 */
export function PageHeader({
  title,
  description,
  actions,
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
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px] text-balance">{title}</h1>
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
