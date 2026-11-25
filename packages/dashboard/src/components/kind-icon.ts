import {
  Blocks,
  BookMarked,
  Cpu,
  Database,
  Folder,
  Globe,
  type LucideIcon,
  Plug,
  Radio,
  Waypoints,
  Wrench,
} from 'lucide-react'
import type { NodeKind } from '@/lib/types'

/** 节点类型由图标形状区分。 */
export const KIND_ICON: Record<NodeKind, LucideIcon> = {
  topic: Radio,
  directory: Folder,
  builtin: Blocks,
  mcp: Plug,
  http: Globe,
  remote: Waypoints,
  context: Database,
  skillhub: BookMarked,
  device: Cpu,
  tool: Wrench,
}
