import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 空态统一形制:安静的面板 + 图标 + 引导文案(可带操作)。 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  tone = 'neutral',
  className,
}: {
  action?: ReactNode
  children?: ReactNode
  className?: string
  icon: LucideIcon
  title: string
  /** 错误态使用 danger，避免与“当前没有数据”混淆。 */
  tone?: 'neutral' | 'danger'
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-start py-5 text-left',
        tone === 'danger' && 'border-l-2 border-destructive pl-4',
        className,
      )}
      role={tone === 'danger' ? 'alert' : undefined}
    >
      <div
        className={cn(
          'text-muted-foreground',
          tone === 'danger' && 'text-destructive',
        )}
      >
        <Icon className="size-4.5" strokeWidth={1.5} />
      </div>
      <p className="mt-3 text-sm font-medium">{title}</p>
      {children && (
        <div className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{children}</div>
      )}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}
