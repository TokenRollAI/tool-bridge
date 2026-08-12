/**
 * Cohere —— 从 open-connector 迁移的 provider(api_key,3 个 action:chat / embed / rerank)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 不配 credentialProbe:三个 action 全是模型推理调用(effect 都是 write,且各自有必填
 * 入参),没有一个能当"空转"的只读探针 —— 上游校验凭证用的 `/v1/models` 没有对应 action。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { chat, embedTexts, rerankDocuments } from './api'
import { cohereActions } from './schema'

export type { ProviderEnv as Env }

export function createCoherePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Cohere',
    actions: cohereActions,
    handlers: {
      chat,
      embed_texts: embedTexts,
      rerank_documents: rerankDocuments,
    },
  })
}

export default createCoherePlugin()
