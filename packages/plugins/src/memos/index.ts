/**
 * Memos —— 从 open-connector 迁移的 provider(api_key,14 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * `update_memo` 走**手写豁免**:它的 inputSchema 带 Zod 无法反推的组合约束(六个可改字段
 * 至少给一个),schema 由人写在 `schema.handwritten.ts`(见 `handwritten.json`)。
 *
 * 实例地址走 `providerConfig.baseUrl`(**必配**,非 secret,见 `api.ts` 顶部注释);
 * personal access token 走 authRef → `ctx.upstreamAuth`。
 *
 * credentialProbe 选 `get_current_user`:它正是上游 credentialValidators 打的那个端点
 * (`/auth/me`),effect 为 read、无必填入参,一次验到 token 有效与 baseUrl 指得对两件事。
 */

import {
  createMemo,
  deleteAttachment,
  deleteMemo,
  getAttachment,
  getCurrentUser,
  getMemo,
  getUser,
  listAttachments,
  listMemoAttachments,
  listMemos,
  listUsers,
  setMemoAttachments,
  updateMemo,
  uploadAttachment,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { memosActions } from './schema'

export type { ProviderEnv as Env }

export function createMemosPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Memos',
    actions: memosActions,
    credentialProbe: 'get_current_user',
    handlers: {
      create_memo: createMemo,
      list_memos: listMemos,
      get_memo: getMemo,
      update_memo: updateMemo,
      delete_memo: deleteMemo,
      upload_attachment: uploadAttachment,
      list_attachments: listAttachments,
      get_attachment: getAttachment,
      delete_attachment: deleteAttachment,
      list_memo_attachments: listMemoAttachments,
      set_memo_attachments: setMemoAttachments,
      get_current_user: getCurrentUser,
      list_users: listUsers,
      get_user: getUser,
    },
  })
}

export default createMemosPlugin()
