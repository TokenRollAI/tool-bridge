/**
 * Readwise —— 从 open-connector 迁移的 provider(api_key,6 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createHighlights,
  exportHighlights,
  listBooks,
  listDocuments,
  saveDocument,
  updateDocument,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { readwiseActions } from './schema'

export type { ProviderEnv as Env }

export function createReadwisePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Readwise',
    actions: readwiseActions,
    // 上游用 /v2/auth/ 验凭证,但那个端点没有对应的 action;list_books 是最接近的
    // 只读、无必填入参的调用(export 会拉全量 highlight,更贵)。
    credentialProbe: 'list_books',
    handlers: {
      create_highlights: createHighlights,
      export_highlights: exportHighlights,
      list_books: listBooks,
      list_documents: listDocuments,
      save_document: saveDocument,
      update_document: updateDocument,
    },
  })
}

export default createReadwisePlugin()
