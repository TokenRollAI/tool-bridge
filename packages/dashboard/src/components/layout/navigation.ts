import { Boxes, Cpu, Database, Globe, HardDrive, KeySquare, type LucideIcon, Plug2, Settings, ShieldEllipsis } from 'lucide-react'

export interface ManageLink {
  icon: LucideIcon
  label: string
  shortLabel: string
  to: string
}

/** 固定在 ActivityRail / 移动管理面板的控制面入口，不再随长树一起滚动。 */
export const MANAGE_LINKS: readonly ManageLink[] = [
  { to: '/manage/settings/config', label: '实例设置', shortLabel: '设置', icon: Settings },
  { to: '/manage/deployment', label: '应用部署', shortLabel: '部署', icon: Settings },
  { to: '/manage/maintenance', label: '数据库维护', shortLabel: '维护', icon: Database },
  { to: '/manage/keys', label: '实例密钥', shortLabel: '根密钥', icon: KeySquare },
  { to: '/manage/storage', label: '存储后端', shortLabel: '后端', icon: Database },
  { to: '/manage/store', label: '对象存储', shortLabel: 'Store', icon: HardDrive },
  { to: '/manage/registry', label: '节点注册', shortLabel: '节点', icon: Boxes },
  { to: '/manage/sk', label: 'Secret Key', shortLabel: '密钥', icon: KeySquare },
  { to: '/manage/secrets', label: '凭证保管', shortLabel: '凭证', icon: ShieldEllipsis },
  { to: '/manage/devices', label: '设备', shortLabel: '设备', icon: Cpu },
  { to: '/manage/plugins', label: 'Plugin', shortLabel: '插件', icon: Plug2 },
  { to: '/manage/federation', label: '联邦白名单', shortLabel: '联邦', icon: Globe },
] as const
