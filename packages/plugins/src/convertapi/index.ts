/**
 * ConvertAPI —— 从 open-connector 迁移的 provider(1 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 没有 credentialProbe:上游的 credentialValidator 也只是检查 key 非空、不打网络,
 * 而唯一的 action 会真的消耗转换额度,不能拿来当挂载探针。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { convertapiActions } from './schema'
import { convertPdfToDocx } from './api'

export type { ProviderEnv as Env }

export function createConvertapiPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'ConvertAPI',
    actions: convertapiActions,
    handlers: {
      convert_pdf_to_docx: convertPdfToDocx,
    },
  })
}

export default createConvertapiPlugin()
