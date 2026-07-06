import type { NodeKind } from '@/lib/types'
import { cn } from '@/lib/utils'

/** kind → 视觉编码(单一色相点缀,等宽小写,工业标签风)。 */
const KIND_STYLE: Record<NodeKind, string> = {
  directory: 'text-muted-foreground border-border',
  builtin: 'text-sky-400/90 border-sky-400/30',
  mcp: 'text-violet-400/90 border-violet-400/30',
  http: 'text-teal-400/90 border-teal-400/30',
  remote: 'text-fuchsia-400/90 border-fuchsia-400/30',
  context: 'text-emerald-400/90 border-emerald-400/30',
  device: 'text-amber-400/90 border-amber-400/30',
}

export function KindBadge({ kind, className }: { kind: NodeKind; className?: string }) {
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

/** device 在线状态点。 */
export function OnlineDot({ online }: { online: boolean | undefined }) {
  if (online === undefined) return null
  return (
    <span
      title={online ? 'online' : 'offline'}
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        online ? 'bg-ok shadow-[0_0_6px_var(--ok)]' : 'bg-muted-foreground/40',
      )}
    />
  )
}
