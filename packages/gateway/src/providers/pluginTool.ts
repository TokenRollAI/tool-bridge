/**
 * plugin-backed 工具源 Provider(Proto §8.1;kind='tool',provider=<plugin-id>)。
 *
 * `UpstreamProvider` 形状(对齐 providers/http.ts):进 app.ts handleInvoke 的既有
 * mcp/http 分支模式(虚拟化 / 两级披露 / toolcache 均复用)。envelope 的 `tool` 是
 * **方法名**(List/Call,Proto §8.3);工具名派发经 arguments(name)。
 */

import { TBError, type ToolResult, type ToolSpec } from '@tool-bridge/core'
import { callPlugin, type PluginCallOptions } from './pluginClient'
import type { UpstreamProvider } from './types'

export function createPluginToolProvider(opts: PluginCallOptions): UpstreamProvider {
  return {
    list: async (): Promise<ToolSpec[]> => {
      const value = await callPlugin(opts, 'List', {})
      if (!Array.isArray(value)) {
        throw new TBError(
          'unavailable',
          `plugin '${opts.manifest.id}' 的 List 未返回工具数组(Proto §4.1)`,
          { retryable: false },
        )
      }
      return value as ToolSpec[]
    },
    call: async (name, args): Promise<ToolResult> => {
      const value = await callPlugin(opts, 'Call', { name, args })
      if (value !== null && typeof value === 'object' && 'content' in value) {
        return value as ToolResult
      }
      // plugin 直接返回裸值时包一层(容错;规范形状是 ToolResult)。
      return { content: value }
    },
  }
}
