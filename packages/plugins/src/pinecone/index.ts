/**
 * Pinecone —— 从 open-connector 迁移的 provider(api_key,12 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  configureIndex,
  createIndex,
  deleteIndex,
  deleteVectors,
  describeIndex,
  fetchVectors,
  getIndexStats,
  listIndexes,
  listVectorIds,
  queryVectors,
  updateVector,
  upsertVectors,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { pineconeActions } from './schema'

export type { ProviderEnv as Env }

export function createPineconePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Pinecone',
    actions: pineconeActions,
    // 上游 validatePineconeCredential 也打 /indexes —— 只读、无入参,正好当挂载时的凭证探针。
    credentialProbe: 'list_indexes',
    handlers: {
      list_indexes: listIndexes,
      describe_index: describeIndex,
      create_index: createIndex,
      configure_index: configureIndex,
      delete_index: deleteIndex,
      get_index_stats: getIndexStats,
      upsert_vectors: upsertVectors,
      query_vectors: queryVectors,
      fetch_vectors: fetchVectors,
      list_vector_ids: listVectorIds,
      delete_vectors: deleteVectors,
      update_vector: updateVector,
    },
  })
}

export default createPineconePlugin()
