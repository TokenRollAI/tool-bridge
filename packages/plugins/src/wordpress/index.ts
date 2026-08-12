/**
 * WordPress(REST API v2)—— 从 open-connector 迁移的 provider(18 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 凭证是**三个字段**:`apiKey`(应用密码)、`siteUrl`(站点根地址)、`username`。字段名与上游
 * `definition.ts` 的 auth[0](api_key + extraFields)逐字一致 —— 名字对不上就取不到值,
 * 而 `requireCredential` 会把它报成 internal(provider 自身的 bug)。
 * siteUrl 不是密钥,但它决定出站主机,故与应用密码一起走 authRef 而不是 providerConfig。
 *
 * 认证是 **HTTP Basic**(`username:应用密码`),不是 Bearer —— WordPress 的应用密码就是
 * Basic 的密码位。凭证只进请求头,不进 URL。
 *
 * credentialProbe 选 `get_current_user`:上游 credentialValidators 打的正是
 * `/users/me?context=edit`,且它 effect 为 read、零入参 —— 三个条件都满足,同时验到了
 * 应用密码有效与 siteUrl 指得对。
 */

import {
  createCategory,
  createPage,
  createPost,
  createTag,
  deleteComment,
  deletePage,
  deletePost,
  getCurrentUser,
  getPage,
  getPost,
  listCategories,
  listComments,
  listPages,
  listPosts,
  listTags,
  updateComment,
  updatePage,
  updatePost,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { wordpressActions } from './schema'

export type { ProviderEnv as Env }

export function createWordpressPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'WordPress (REST API v2)',
    actions: wordpressActions,
    credentialFields: [
      {
        key: 'apiKey',
        label: 'Application Password',
        required: true,
        secret: true,
        description: 'WordPress 应用密码,作为 HTTP Basic 认证的密码发送;在 WordPress 后台的 Users > Profile > Application Passwords 里创建',
      },
      {
        key: 'siteUrl',
        label: 'Site URL',
        required: true,
        secret: false,
        description: 'WordPress 站点的根地址(https://example.com,子目录安装写到子目录);带 /wp-json 或 /wp-json/wp/v2 后缀也认。必须是 https 的公网地址,私有网段会被出站策略拦下',
      },
      {
        key: 'username',
        label: 'Username',
        required: true,
        secret: false,
        description: '与应用密码配对的 WordPress 用户名,作为 HTTP Basic 认证的用户名发送',
      },
    ],
    credentialProbe: 'get_current_user',
    handlers: {
      get_current_user: getCurrentUser,
      list_posts: listPosts,
      get_post: getPost,
      create_post: createPost,
      update_post: updatePost,
      delete_post: deletePost,
      list_pages: listPages,
      get_page: getPage,
      create_page: createPage,
      update_page: updatePage,
      delete_page: deletePage,
      list_categories: listCategories,
      create_category: createCategory,
      list_tags: listTags,
      create_tag: createTag,
      list_comments: listComments,
      update_comment: updateComment,
      delete_comment: deleteComment,
    },
  })
}

export default createWordpressPlugin()
