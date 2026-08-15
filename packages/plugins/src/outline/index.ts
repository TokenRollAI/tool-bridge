/**
 * Outline —— 从 open-connector 迁移的 provider(api_key,6 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * `get_document` 走**手写豁免**:它的 inputSchema 带 Zod 无法反推的组合约束(id 与 shareId
 * 至少给一个),schema 由人写在 `schema.handwritten.ts`。
 *
 * 自建实例的 API base 走 `providerConfig.baseUrl`(非 secret,见 `api.ts` 顶部注释),
 * 不配则打 Outline 云端。
 */

import {
  getCollection,
  getDocument,
  listCollectionDocuments,
  listCollections,
  listDocuments,
  searchDocuments,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { outlineActions } from './schema'

export type { ProviderEnv as Env }

export function createOutlinePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Outline',
    actions: outlineActions,
    // 上游 credentialValidators 打的 `/auth.info` 没有对应 action;`list_collections` 同样
    // 只读、无必填入参,且同样要求凭证有效,拿它当挂载时的凭证探针。
    credentialProbe: 'list_collections',
    // baseUrl 非必配:缺省走 Outline 云端(app.getoutline.com),自建实例才配。
    mountConfigFields: [{
      key: 'baseUrl',
      label: '实例地址',
      description: '自建 Outline 的根地址;留空用云端 app.getoutline.com',
    }],
    handlers: {
      list_collections: listCollections,
      get_collection: getCollection,
      list_collection_documents: listCollectionDocuments,
      list_documents: listDocuments,
      search_documents: searchDocuments,
      get_document: getDocument,
    },
  })
}

export default createOutlinePlugin()
