import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** 数据工作台的分页脚注：保持已加载内容可见，并显式追加下一页。 */
export function PaginationFooter({
  count,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  unit = '项',
  className,
}: {
  className?: string
  count: number
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  unit?: string
}) {
  return (
    <div
      aria-busy={isFetchingNextPage}
      className={cn(
        'flex min-h-11 flex-wrap items-center justify-between gap-3 border-t bg-muted/15 px-3 py-2.5 sm:px-4',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
        <p aria-live="polite">
          当前已加载
          {' '}
          <span className="font-mono tabular-nums text-foreground">{count}</span>
          {' '}
          {unit}
        </p>
      </div>
      {hasNextPage
        ? (
            <Button
              disabled={isFetchingNextPage}
              onClick={onLoadMore}
              size="xs"
              type="button"
              variant="outline"
            >
              {isFetchingNextPage && <Loader2 aria-hidden="true" className="animate-spin" />}
              {isFetchingNextPage ? '正在追加…' : '加载下一页'}
            </Button>
          )
        : (
            count > 0 && <span className="text-[11px] text-muted-foreground">已经到底</span>
          )}
    </div>
  )
}
