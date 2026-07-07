/**
 * 注册时契约校验(Proto §8.1 注册流程 / Plugin.md §3)。
 *
 * 输入 = manifest + 平台抓取的 `~describe` JSON 与 `~help` 响应;纯逻辑,抓取本身在宿主。
 * `~help` 优先按 HelpJson(cmds[].name)取方法集合;非 JSON 响应退化为 Help DSL 的
 * `cmd <name>` 行级解析(复用 htbp/helpDsl 的最小 parser)。
 * 校验三件事,任一不符 → TBError invalid_argument(message 指明缺口):
 * 1. 方法集合 ⊇ 该 interfaceVersion 的必需集合;
 * 2. `~describe` 的 kind/interfaceVersion 与 manifest 一致;
 * 3. `~describe.capabilities` 声明的可选能力必须有对应 cmd(未声明的平台永不调用)。
 */

import { z } from 'zod'
import { TBError } from '../errors'
import { parseHelpDsl } from '../htbp/helpDsl'
import type { PluginKind, PluginManifest } from './manifest'

/** 各 kind 的必需方法集合(Proto §4.1 / §5.1;v1)。 */
export const REQUIRED_METHODS: Record<PluginKind, readonly string[]> = {
  'tool-provider': ['List', 'Get', 'Call'],
  'context-provider': ['List', 'Get', 'Update', 'Write'],
}

/**
 * capability 基名 → 可选方法名(context-provider/v1;Proto §5.1)。
 * 限定词(如 `search:semantic`)按 ':' 前的基名判定;未知基名忽略(向前兼容)。
 */
const OPTIONAL_METHOD_BY_CAPABILITY: Record<string, string> = {
  search: 'Search',
  watch: 'Watch',
  delete: 'Delete',
}

/**
 * capabilities → 已声明的可选方法名集合(去重;未知基名忽略)。
 * 挂载后 `~help` 只列"四动词 + 已声明可选方法"(Proto §8.2 注记)的过滤依据。
 */
export function optionalMethodsForCapabilities(capabilities: readonly string[]): Set<string> {
  const methods = new Set<string>()
  for (const capability of capabilities) {
    const base = capability.split(':', 1)[0] ?? capability
    const method = OPTIONAL_METHOD_BY_CAPABILITY[base]
    if (method !== undefined) methods.add(method)
  }
  return methods
}

const describeSchema = z.object({
  kind: z.string().min(1),
  interfaceVersion: z.string().min(1),
  capabilities: z.array(z.string()).optional(),
})

/** `~describe` 响应形状(Proto §8.2)。 */
export interface PluginDescribe {
  kind: string
  interfaceVersion: string
  capabilities?: string[]
}

const helpJsonSchema = z.object({
  cmds: z.array(z.object({ name: z.string().min(1) }).passthrough()),
})

/**
 * 从 `~help` 响应提取 cmd 名集合:对象按 HelpJson(cmds[].name);字符串先尝试 JSON
 * (Accept 协商可能仍返回 JSON 文本),失败则退化 Help DSL 的 `cmd <name>` 行解析。
 */
export function helpMethodNames(help: unknown): Set<string> {
  let value = help
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return new Set(parseHelpDsl(value as string).cmds.map((c) => c.name))
    }
  }
  const parsed = helpJsonSchema.safeParse(value)
  if (!parsed.success) {
    throw new TBError('invalid_argument', '~help 响应既非 HelpJson(cmds[])也非 Help DSL 文本')
  }
  return new Set(parsed.data.cmds.map((c) => c.name))
}

export interface PluginContractInput {
  manifest: PluginManifest
  /** 抓取到的 `~describe` JSON(已 parse 的值)。 */
  describe: unknown
  /** 抓取到的 `~help` 响应:HelpJson 对象或 DSL/JSON 文本。 */
  help: unknown
}

/** 契约校验入口;通过返回解析后的 ~describe(capabilities 供挂载后 ~describe/~help 缓存)。 */
export function validatePluginContract(input: PluginContractInput): PluginDescribe {
  const { manifest } = input

  const parsedDescribe = describeSchema.safeParse(input.describe)
  if (!parsedDescribe.success) {
    throw new TBError(
      'invalid_argument',
      `plugin '${manifest.id}' 的 ~describe 形状非法(需 {kind, interfaceVersion, capabilities?})`,
    )
  }
  const describe = parsedDescribe.data
  if (describe.kind !== manifest.kind) {
    throw new TBError(
      'invalid_argument',
      `plugin '${manifest.id}' 的 ~describe.kind '${describe.kind}' 与 manifest.kind '${manifest.kind}' 不符`,
    )
  }
  if (describe.interfaceVersion !== manifest.interfaceVersion) {
    throw new TBError(
      'invalid_argument',
      `plugin '${manifest.id}' 的 ~describe.interfaceVersion '${describe.interfaceVersion}' 与 manifest '${manifest.interfaceVersion}' 不符`,
    )
  }

  const methods = helpMethodNames(input.help)
  const missing = REQUIRED_METHODS[manifest.kind].filter((m) => !methods.has(m))
  if (missing.length > 0) {
    throw new TBError(
      'invalid_argument',
      `plugin '${manifest.id}' 的 ~help 缺必需方法:${missing.join(', ')}(${manifest.interfaceVersion} 要求)`,
    )
  }

  for (const capability of describe.capabilities ?? []) {
    const base = capability.split(':', 1)[0] ?? capability
    const method = OPTIONAL_METHOD_BY_CAPABILITY[base]
    if (method !== undefined && !methods.has(method)) {
      throw new TBError(
        'invalid_argument',
        `plugin '${manifest.id}' 声明 capability '${capability}' 但 ~help 缺对应方法 '${method}'`,
      )
    }
  }

  return describe
}
