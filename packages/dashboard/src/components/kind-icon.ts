import {
  Blocks,
  BookMarked,
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

/** kind → 图标 + 色相(与 KIND_STYLE 同一套色相编码;树导航与命令面板共用)。 */
export const KIND_ICON: Record<NodeKind, { className: string, icon: LucideIcon }> = {
  directory: { icon: Folder, className: 'text-muted-foreground/70' },
  builtin: { icon: Blocks, className: 'text-sky-400/80' },
  mcp: { icon: Plug, className: 'text-violet-400/80' },
  http: { icon: Globe, className: 'text-teal-400/80' },
  remote: { icon: Waypoints, className: 'text-fuchsia-400/80' },
  context: { icon: Database, className: 'text-emerald-400/80' },
  skillhub: { icon: BookMarked, className: 'text-indigo-400/80' },
  device: { icon: Cpu, className: 'text-amber-400/80' },
  tool: { icon: Wrench, className: 'text-rose-400/80' },
}
