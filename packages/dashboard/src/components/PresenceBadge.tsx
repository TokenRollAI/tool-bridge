import type { PresenceState } from '@/lib/types'
import { PRESENCE_HINT } from '@/lib/presence'
import { cn } from '@/lib/utils'
import { OnlineDot } from './KindBadge'

/**
 * device presence 徽标。取 `state` 而非布尔:`~tree` 已给投影好的 presence,
 * `system/registry` 是存储态需先过 `derivePresence` —— 两个数据源在调用点收敛成 state。
 */
export function PresenceBadge({
  state,
  className,
}: {
  className?: string
  state: PresenceState
}) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground', className)} title={PRESENCE_HINT[state]}>
      <OnlineDot state={state} />
      {{ online: '在线', stale: '疑似失联', offline: '离线' }[state]}
    </span>
  )
}
