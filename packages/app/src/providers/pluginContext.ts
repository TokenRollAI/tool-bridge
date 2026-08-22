/**
 * plugin-backed context Provider(挂载消费;kind='context',provider=<plugin-id>)。
 *
 * 实现 core `ContextProvider` 语义:**动词集合 = export 在 `~describe` 里自报的 `methods`**
 * (plugin/v2 契约:声明多少就是多少,平台只调用声明过的动词);未声明 `methods` 的
 * export(v2 允许省略)退回旧默认:四核心动词 + `capabilities` 声明过的可选方法。
 * 网关调度(app.ts dispatchContextCmd)对缺失方法按 unknown cmd 拒,故未实现的动词
 * 永远打不到 plugin。
 * 每个方法一次 envelope 调用;返回值(含 `$ref`)原样透传。
 */

import { type ContextEntry,
  type ContextEntryInput,
  type ContextEntryMeta,
  type ContextPatch,
  type ContextProvider,
  type ListOptions,
  optionalMethodsForCapabilities,
  type Page,
  type SearchOptions } from '@tool-bridge/core'
import { callPlugin, type PluginCallOptions } from './pluginClient'

export interface PluginContextOptions extends PluginCallOptions {
  /** 注册时抓取并缓存的 `~describe.capabilities`(pluginmeta:<id>)。 */
  capabilities: readonly string[]
  /** 该 export 自报的动词集合;省略 → 四核心动词 + capabilities 声明的可选方法。 */
  methods?: readonly string[]
}

/** 四核心动词(export 未自报 methods 时的默认集合)。 */
const CORE_METHODS = ['list', 'get', 'write', 'update'] as const

export function createPluginContextProvider(opts: PluginContextOptions): ContextProvider {
  const call = (method: string, args: Record<string, unknown>): Promise<unknown> =>
    callPlugin(opts, method, args)

  const declared
    = opts.methods !== undefined
      ? new Set<string>(opts.methods)
      : new Set<string>([...CORE_METHODS, ...optionalMethodsForCapabilities(opts.capabilities)])

  const provider: ContextProvider = {}
  if (declared.has('list')) {
    provider.list = (path: string, listOpts?: ListOptions) =>
      call('list', { path, ...(listOpts !== undefined ? { opts: listOpts } : {}) }) as Promise<
        Page<ContextEntryMeta>
      >
  }
  if (declared.has('get')) {
    provider.get = (path: string) => call('get', { path }) as Promise<ContextEntry>
  }
  if (declared.has('update')) {
    provider.update = (path: string, patch: ContextPatch) =>
      call('update', { path, patch }) as Promise<ContextEntryMeta>
  }
  if (declared.has('write')) {
    provider.write = (path: string, entry: ContextEntryInput) =>
      call('write', { path, entry }) as Promise<ContextEntryMeta>
  }
  // 可选能力仍须在 capabilities 里声明过(调用方据 capabilities 先探测再用),
  // 且 methods 自报时二者必须一致(注册期契约校验已钉死,见 core validatePluginContract)。
  const optional = optionalMethodsForCapabilities(opts.capabilities)
  if (declared.has('search') && optional.has('search')) {
    provider.search = (query: string, searchOpts?: SearchOptions) =>
      call('search', {
        query,
        ...(searchOpts !== undefined ? { opts: searchOpts } : {}),
      }) as Promise<Page<ContextEntryMeta>>
  }
  if (declared.has('delete') && optional.has('delete')) {
    provider.delete = async (path: string): Promise<void> => {
      await call('delete', { path })
    }
  }
  return provider
}
