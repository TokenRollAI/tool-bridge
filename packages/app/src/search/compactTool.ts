/**
 * 搜索 compact 投影的单一实现:去 schema + 按 UTF-8 字节预算截断 description。
 * 本地执行器(localSearch)与 federated coordinator(federatedSearch)共用,
 * 防两处的字节预算与截断语义漂移。
 */
import { TOOL_SEARCH_DESCRIPTION_BYTES_MAX } from '@tool-bridge/core'

export function compactSearchTool<
  T extends { description?: string, inputSchema?: unknown, outputSchema?: unknown },
>(tool: T): T {
  const compact = { ...tool }
  delete compact.inputSchema
  delete compact.outputSchema
  if (compact.description !== undefined) {
    const encoder = new TextEncoder()
    if (encoder.encode(compact.description).length > TOOL_SEARCH_DESCRIPTION_BYTES_MAX) {
      // 逐码位累加字节数,保证截断点不落在多字节字符中间。
      let description = ''
      let bytes = 0
      for (const char of compact.description) {
        const size = encoder.encode(char).length
        if (bytes + size > TOOL_SEARCH_DESCRIPTION_BYTES_MAX) break
        description += char
        bytes += size
      }
      compact.description = description
    }
  }
  return compact
}
