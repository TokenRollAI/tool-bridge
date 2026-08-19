import type { ReactNode } from 'react'
import { Wifi, WifiLow, WifiOff } from 'lucide-react'
import type { PresenceState } from '@/lib/types'
import { PRESENCE_HINT, PRESENCE_LABEL, PRESENCE_TONE } from '@/lib/presence'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const PRESENCE_ICON: Record<PresenceState, ReactNode> = {
  offline: <WifiOff />,
  online: <Wifi />,
  stale: <WifiLow />,
}

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
    <Badge
      className={cn('font-mono text-[10px]', PRESENCE_TONE[state], className)}
      title={PRESENCE_HINT[state]}
      variant="outline"
    >
      {PRESENCE_ICON[state]}
      {PRESENCE_LABEL[state]}
    </Badge>
  )
}
