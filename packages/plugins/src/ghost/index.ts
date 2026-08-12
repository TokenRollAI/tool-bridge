/**
 * Ghost(Content API)—— 从 open-connector 迁移的 provider(9 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 凭证是**两个字段**:`apiKey`(Content API key)与 `siteUrl`(站点公开地址)。字段名与上游
 * `definition.ts` 的 auth[0](api_key + extraFields)逐字一致 —— 名字对不上就取不到值,
 * 而 `requireCredential` 会把它报成 internal(provider 自身的 bug)。
 * siteUrl 不是密钥,但它决定出站主机,故与 key 一起走 authRef 而不是 providerConfig。
 *
 * key 走 **URL query**(`?key=...`),Ghost Content API 不接受请求头 —— 见 api.ts 顶部的
 * 日志脱敏提示。
 *
 * credentialProbe 选 `read_settings`:上游 credentialValidators 打的正是
 * `/ghost/api/content/v5.0/settings/`,且它 effect 为 read、零入参 —— 三个条件都满足,
 * 同时验到了 key 有效与 siteUrl 指得对。
 */

import {
  getAuthor,
  getPage,
  getPost,
  getTag,
  listAuthors,
  listPages,
  listPosts,
  listTags,
  readSettings,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { ghostActions } from './schema'

export type { ProviderEnv as Env }

export function createGhostPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Ghost (Content API)',
    actions: ghostActions,
    credentialFields: [
      {
        key: 'apiKey',
        label: 'Content API Key',
        required: true,
        secret: true,
        description: 'Ghost Content API key,作为 key query 参数发送;在 Ghost Admin 的 Settings > Advanced > Integrations 里创建或查看',
      },
      {
        key: 'siteUrl',
        label: 'Site URL',
        required: true,
        secret: false,
        description: 'Ghost 站点的公开地址(https://example.ghost.io),不要带 API 路径;必须是公网可达地址,私有网段会被出站策略拦下',
      },
    ],
    credentialProbe: 'read_settings',
    handlers: {
      list_posts: listPosts,
      get_post: getPost,
      list_pages: listPages,
      get_page: getPage,
      list_tags: listTags,
      get_tag: getTag,
      list_authors: listAuthors,
      get_author: getAuthor,
      read_settings: readSettings,
    },
  })
}

export default createGhostPlugin()
