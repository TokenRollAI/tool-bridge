import type { NodeKind, PresenceState } from '@/lib/types'
import { PRESENCE_LABEL, PRESENCE_TONE } from '@/lib/presence'
import { cn } from '@/lib/utils'

export function KindBadge({ kind, className }: { className?: string, kind: NodeKind }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-sm bg-secondary px-1.5 text-muted-foreground py-0 font-mono text-[10px] leading-4 tracking-wide',
        className,
      )}
    >
      {kind}
    </span>
  )
}

/**
 * device presence 状态点。三态:online 绿、stale 琥珀(连接位仍在但久无心跳)、offline 灰。
 * 取 `state` 而非布尔,因为两个数据源形状不同(`~tree` 给 presence 对象,registry 给
 * online+lastSeenAt 需先 derivePresence);统一在调用点收敛成 state 再传进来。
 */
export function OnlineDot({ state }: { state: PresenceState | undefined }) {
  if (state === undefined) return null
  return (
    <span
      className={cn('inline-block size-1.5 shrink-0 rounded-full', PRESENCE_TONE[state])}
      title={PRESENCE_LABEL[state]}
    />
  )
}
