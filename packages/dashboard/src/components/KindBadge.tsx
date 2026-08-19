import type { NodeKind, PresenceState } from '@/lib/types'
import { PRESENCE_LABEL } from '@/lib/presence'
import { cn } from '@/lib/utils'

/** kind → 视觉编码(单一色相点缀,等宽小写,工业标签风)。 */
const KIND_STYLE: Record<NodeKind, string> = {
  directory: 'text-muted-foreground border-border',
  builtin: 'text-sky-400/90 border-sky-400/30',
  mcp: 'text-violet-400/90 border-violet-400/30',
  http: 'text-teal-400/90 border-teal-400/30',
  remote: 'text-fuchsia-400/90 border-fuchsia-400/30',
  context: 'text-emerald-400/90 border-emerald-400/30',
  skillhub: 'text-indigo-400/90 border-indigo-400/30',
  device: 'text-amber-400/90 border-amber-400/30',
  tool: 'text-rose-400/90 border-rose-400/30',
}

export function KindBadge({ kind, className }: { className?: string, kind: NodeKind }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0 font-mono text-[10px] leading-4 tracking-wide',
        KIND_STYLE[kind] ?? KIND_STYLE.directory,
        className,
      )}
    >
      {kind}
    </span>
  )
}

/** presence 三态 → 点的视觉编码。stale 用 warn 色相,区别于"确认离线"的灰。 */
const PRESENCE_DOT: Record<PresenceState, string> = {
  offline: 'bg-muted-foreground/40',
  online: 'bg-ok shadow-[0_0_6px_var(--ok)]',
  stale: 'bg-warn shadow-[0_0_6px_var(--warn)]',
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
      className={cn('inline-block size-1.5 shrink-0 rounded-full', PRESENCE_DOT[state])}
      title={PRESENCE_LABEL[state]}
    />
  )
}
