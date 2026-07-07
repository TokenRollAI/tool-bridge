import {
  Blocks,
  Cpu,
  Database,
  Folder,
  Globe,
  type LucideIcon,
  Plug,
  Waypoints,
  Wrench,
} from 'lucide-react'
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
  tool: 'text-rose-400/90 border-rose-400/30',
}

/** kind → 图标 + 色相(与 KIND_STYLE 同一套色相编码;树导航与命令面板共用)。 */
export const KIND_ICON: Record<NodeKind, { icon: LucideIcon; className: string }> = {
  directory: { icon: Folder, className: 'text-muted-foreground/70' },
  builtin: { icon: Blocks, className: 'text-sky-400/80' },
  mcp: { icon: Plug, className: 'text-violet-400/80' },
  http: { icon: Globe, className: 'text-teal-400/80' },
  remote: { icon: Waypoints, className: 'text-fuchsia-400/80' },
  context: { icon: Database, className: 'text-emerald-400/80' },
  device: { icon: Cpu, className: 'text-amber-400/80' },
  tool: { icon: Wrench, className: 'text-rose-400/80' },
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
