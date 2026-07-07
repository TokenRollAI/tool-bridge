import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 空态统一形制:虚线框 + 图标 + 引导文案(可带操作)。 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon: LucideIcon
  title: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-md border border-dashed px-6 py-10 text-center',
        className,
      )}
    >
      <div className="grid size-10 place-items-center rounded-md border bg-card text-muted-foreground">
        <Icon className="size-4.5" strokeWidth={1.5} />
      </div>
      <p className="mt-1 text-sm">{title}</p>
      {children && <div className="max-w-md text-xs text-muted-foreground">{children}</div>}
    </div>
  )
}
