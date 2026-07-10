import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 空态统一形制:虚线框 + 图标 + 引导文案(可带操作)。 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  tone = 'neutral',
  className,
}: {
  icon: LucideIcon
  title: string
  children?: ReactNode
  action?: ReactNode
  /** 错误态使用 danger，避免与“当前没有数据”混淆。 */
  tone?: 'neutral' | 'danger'
  className?: string
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className={cn(
        'flex flex-col items-center rounded-lg border border-dashed bg-muted/10 px-6 py-10 text-center',
        tone === 'danger' && 'border-destructive/35 bg-destructive/[0.035]',
        className,
      )}
    >
      <div
        className={cn(
          'grid size-10 place-items-center rounded-md border bg-background/70 text-muted-foreground',
          tone === 'danger' && 'border-destructive/30 text-destructive',
        )}
      >
        <Icon className="size-4.5" strokeWidth={1.5} />
      </div>
      <p className="mt-3 text-sm font-medium">{title}</p>
      {children && (
        <div className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{children}</div>
      )}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}
