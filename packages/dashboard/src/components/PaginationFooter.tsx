import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** 管理列表统一分页脚注：明确当前已加载数量，并按 cursor 继续取下一页。 */
export function PaginationFooter({
  count,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  unit = '项',
  className,
}: {
  count: number
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  unit?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-10 flex-wrap items-center justify-between gap-2 border-t bg-card/30 px-3 py-2',
        className,
      )}
    >
      <p className="text-xs text-muted-foreground" aria-live="polite">
        已加载 <span className="font-mono tabular-nums text-foreground">{count}</span> {unit}
      </p>
      {hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={isFetchingNextPage}
          onClick={onLoadMore}
        >
          {isFetchingNextPage && <Loader2 className="animate-spin" aria-hidden="true" />}
          {isFetchingNextPage ? '加载中…' : '继续加载'}
        </Button>
      ) : (
        count > 0 && <span className="text-[11px] text-muted-foreground">已全部加载</span>
      )}
    </div>
  )
}
