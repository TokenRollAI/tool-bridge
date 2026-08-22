/**
 * 「添加工具」向导的来源分类 —— 把原本散在三页(集成目录 / 节点注册 / Plugin)的入口
 * 收敛成一组"我想加什么"的选择。纯数据 + 纯函数,向导组件消费。
 *
 * 不重复造挂载逻辑:内置集成仍走 buildIntegrationCalls,自定义 kind 仍走
 * buildRegistryMountCalls —— 这里只决定"进哪条既有路径",不碰 wire payload。
 */

import { Blocks, Boxes, Database, Globe, type LucideIcon, Plug, Waypoints } from 'lucide-react'
import type { MountKind } from '@/pages/system/forms/registryConfig'

export type AddSourceKind
  = | 'catalog'
    | 'mcp'
    | 'http'
    | 'context'
    | 'skillhub'
    | 'remote'
    | 'plugin'

export interface AddSource {
  /** 一句话:这条路径适合加什么。 */
  blurb: string
  icon: LucideIcon
  kind: AddSourceKind
  /** 走通用挂载器时对应的 MountKind(catalog/plugin 例外,单独处理)。 */
  mountKind?: MountKind
  /** 需要 register 之外的前置能力时提示(如自定义 plugin 要先注册)。 */
  note?: string
  title: string
}

/** 向导第一步的来源卡片。顺序 = 推荐优先级:内置集成最省事,排最前。 */
export const ADD_SOURCES: readonly AddSource[] = [
  {
    kind: 'catalog',
    title: '内置集成',
    blurb: '这个部署自带、开箱即用的集成。选一个填好凭证即可挂载。',
    icon: Blocks,
  },
  {
    kind: 'mcp',
    title: 'MCP Server',
    blurb: '接入一个 MCP server(SSE / streamable HTTP),支持托管 OAuth 或 authRef。',
    icon: Plug,
    mountKind: 'mcp',
  },
  {
    kind: 'http',
    title: 'HTTP 端点',
    blurb: '把任意 HTTP API 按工具表映射成可调用工具。',
    icon: Globe,
    mountKind: 'http',
  },
  {
    kind: 'context',
    title: 'Context 存储',
    blurb: '挂一个存储 namespace(R2 / S3 / provider),用于读写上下文条目。',
    icon: Database,
    mountKind: 'context',
  },
  {
    kind: 'skillhub',
    title: 'Skill 目录',
    blurb: '挂一个 Agent 技能目录(R2 / S3)。',
    icon: Boxes,
    mountKind: 'skillhub',
  },
  {
    kind: 'remote',
    title: '远端 HTBP',
    blurb: '联邦另一个 HTBP 网关的子树(需在联邦白名单内)。',
    icon: Waypoints,
    mountKind: 'remote',
  },
  {
    kind: 'plugin',
    title: '自定义 Plugin',
    blurb: '注册实现 tool/context provider 契约的自建服务,再挂成节点。',
    icon: Plug,
    note: '会先带你到 Plugin 注册,通过契约校验后再回来挂载。',
  },
] as const

/**
 * 集成预设:在 catalog 之上给常用 provider 一键预填。只预填路径与非凭证配置骨架,
 * 凭证永远由用户自己填(不预置任何密钥)。预设 provider id 必须真实存在于 catalog
 * 才会显示 —— 拿不到目录项时静默跳过,不误导。
 */
export interface IntegrationPreset {
  /** 一句话用途。 */
  blurb: string
  /** 预填的非凭证配置骨架(如 baseUrl 占位),用户补全。 */
  config?: Record<string, string>
  /** 展示名(比裸 id 友好)。 */
  label: string
  /** 预填挂载路径(用户可改);留空则用 defaultMountPath。 */
  path?: string
  /** catalog 里的 provider id。 */
  provider: string
}

export const INTEGRATION_PRESETS: readonly IntegrationPreset[] = [
  { provider: 'tavily', label: 'Tavily 搜索', blurb: 'Web 搜索与内容抓取', path: 'tools/tavily' },
  { provider: 'jira', label: 'Jira', blurb: 'Issue 与项目管理', path: 'tools/jira' },
  { provider: 'memos', label: 'Memos', blurb: '自建备忘;需要实例地址', path: 'tools/memos' },
  { provider: 'sentry', label: 'Sentry', blurb: '错误监控(OAuth 授权)', path: 'tools/sentry' },
  { provider: 'github', label: 'GitHub', blurb: '仓库、Issue 与 PR', path: 'tools/github' },
  { provider: 'slack', label: 'Slack', blurb: '消息与频道', path: 'tools/slack' },
] as const

/** 只保留 catalog 里确实存在的预设(避免展示这个部署没装的集成)。 */
export function availablePresets(catalogIds: ReadonlySet<string>): IntegrationPreset[] {
  return INTEGRATION_PRESETS.filter(preset => catalogIds.has(preset.provider))
}
