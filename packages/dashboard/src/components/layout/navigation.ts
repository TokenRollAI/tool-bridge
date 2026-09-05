import { Blocks, Boxes, Cpu, Database, GitBranch, Globe, HardDrive, KeySquare, LayoutDashboard, type LucideIcon, Plug2, Settings, ShieldEllipsis } from 'lucide-react'

export interface ManageLink {
  icon: LucideIcon
  label: string
  shortLabel: string
  to: string
}

export const WORKSPACE_LINKS: readonly ManageLink[] = [
  { to: '/', label: '工作台', shortLabel: '工作台', icon: LayoutDashboard },
  { to: '/tools', label: '工具', shortLabel: '工具', icon: Blocks },
  { to: '/manage/devices', label: '设备', shortLabel: '设备', icon: Cpu },
  { to: '/canvas', label: '能力树', shortLabel: '能力树', icon: GitBranch },
]

export const RESOURCE_LINKS: readonly ManageLink[] = [
  { to: '/manage/registry', label: '工具连接', shortLabel: '连接', icon: Boxes },
  { to: '/manage/secrets', label: '服务凭证', shortLabel: '凭证', icon: ShieldEllipsis },
  { to: '/manage/sk', label: '访问密钥', shortLabel: '密钥', icon: KeySquare },
  { to: '/manage/store', label: '文件存储', shortLabel: '文件', icon: HardDrive },
  { to: '/manage/plugins', label: '插件', shortLabel: '插件', icon: Plug2 },
  { to: '/manage/federation', label: '联邦连接', shortLabel: '联邦', icon: Globe },
]

export const SETTINGS_LINKS: readonly ManageLink[] = [
  { to: '/manage/settings/config', label: '实例设置', shortLabel: '设置', icon: Settings },
  { to: '/manage/deployment', label: '应用部署', shortLabel: '部署', icon: Settings },
  { to: '/manage/maintenance', label: '数据库维护', shortLabel: '维护', icon: Database },
  { to: '/manage/keys', label: '实例密钥', shortLabel: '根密钥', icon: KeySquare },
  { to: '/manage/storage', label: '存储后端', shortLabel: '后端', icon: Database },
]

/** 所有管理入口仍可通过统一面板与深链接访问。 */
export const MANAGE_LINKS: readonly ManageLink[] = [
  ...RESOURCE_LINKS,
  WORKSPACE_LINKS[2]!,
  ...SETTINGS_LINKS,
]
