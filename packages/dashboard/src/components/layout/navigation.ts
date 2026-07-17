import { Boxes, Cpu, Globe, KeySquare, type LucideIcon, Plug2, ShieldEllipsis } from 'lucide-react'

export interface ManageLink {
  icon: LucideIcon
  label: string
  shortLabel: string
  to: string
}

/** 固定在 ActivityRail / 移动管理面板的控制面入口，不再随长树一起滚动。 */
export const MANAGE_LINKS: readonly ManageLink[] = [
  { to: '/manage/registry', label: '节点注册', shortLabel: '节点', icon: Boxes },
  { to: '/manage/sk', label: 'Secret Key', shortLabel: '密钥', icon: KeySquare },
  { to: '/manage/secrets', label: '凭证保管', shortLabel: '凭证', icon: ShieldEllipsis },
  { to: '/manage/devices', label: '设备', shortLabel: '设备', icon: Cpu },
  { to: '/manage/plugins', label: 'Plugin', shortLabel: '插件', icon: Plug2 },
  { to: '/manage/federation', label: '联邦白名单', shortLabel: '联邦', icon: Globe },
] as const
