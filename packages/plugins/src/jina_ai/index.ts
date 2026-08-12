/**
 * Jina AI —— 从 open-connector 迁移的 provider(api_key,2 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 不声明 `credentialProbe`:上游 `credentialValidators` 打 `/v1/rerank`,但那个 action 的
 * effect 是 `write` 且 model/query/documents 三个字段都必填 —— 探针要求"只读且无必填入参",
 * 两个 action 都不满足。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { createEmbeddings, rerankDocuments } from './api'
import { jinaAiActions } from './schema'

export type { ProviderEnv as Env }

export function createJinaAiPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Jina AI',
    actions: jinaAiActions,
    handlers: {
      create_embeddings: createEmbeddings,
      rerank_documents: rerankDocuments,
    },
  })
}

export default createJinaAiPlugin()
