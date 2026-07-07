/**
 * plugin-backed context Provider(挂载消费;kind='context',provider=<plugin-id>)。
 *
 * 实现 core `ContextProvider` 语义:四核心动词恒有;可选方法(Search/Delete)只在注册时
 * `~describe.capabilities` 声明过才挂上——未声明的平台永不调用,网关调度
 * (app.ts dispatchContextCmd)对缺失方法按 unknown cmd 拒。
 * 每个方法一次 envelope 调用;返回值(含 `$ref`)原样透传。
 */

import type {
  ContextEntry,
  ContextEntryInput,
  ContextEntryMeta,
  ContextPatch,
  ContextProvider,
  ListOptions,
  Page,
  SearchOptions,
} from '@tool-bridge/core'
import { optionalMethodsForCapabilities } from '@tool-bridge/core'
import { callPlugin, type PluginCallOptions } from './pluginClient'

export interface PluginContextOptions extends PluginCallOptions {
  /** 注册时抓取并缓存的 `~describe.capabilities`(pluginmeta:<id>)。 */
  capabilities: readonly string[]
}

export function createPluginContextProvider(opts: PluginContextOptions): ContextProvider {
  const call = (method: string, args: Record<string, unknown>): Promise<unknown> =>
    callPlugin(opts, method, args)

  const provider: ContextProvider = {
    List: (path: string, listOpts?: ListOptions) =>
      call('List', { path, ...(listOpts !== undefined ? { opts: listOpts } : {}) }) as Promise<
        Page<ContextEntryMeta>
      >,
    Get: (path: string) => call('Get', { path }) as Promise<ContextEntry>,
    Update: (path: string, patch: ContextPatch) =>
      call('Update', { path, patch }) as Promise<ContextEntryMeta>,
    Write: (path: string, entry: ContextEntryInput) =>
      call('Write', { path, entry }) as Promise<ContextEntryMeta>,
  }

  const declared = optionalMethodsForCapabilities(opts.capabilities)
  if (declared.has('Search')) {
    provider.Search = (query: string, searchOpts?: SearchOptions) =>
      call('Search', {
        query,
        ...(searchOpts !== undefined ? { opts: searchOpts } : {}),
      }) as Promise<Page<ContextEntryMeta>>
  }
  if (declared.has('Delete')) {
    provider.Delete = async (path: string): Promise<void> => {
      await call('Delete', { path })
    }
  }
  return provider
}
