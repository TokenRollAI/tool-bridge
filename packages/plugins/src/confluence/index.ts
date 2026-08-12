/**
 * Confluence —— 从 open-connector 迁移的 provider(5 个内容/空间 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 凭证是**三个字段**:apiKey(Atlassian API token)、email、siteUrl。字段名与上游
 * `definition.ts` 的 auth[0](api_key + extraFields)逐字一致 —— 名字对不上就取不到值,
 * 而 `requireCredential` 会把它报成 internal(provider 自身的 bug)。
 *
 * credentialProbe 选 `list_spaces`:上游 credentialValidators 打的正是 `/spaces?limit=1`,
 * 且它 effect 为 read、无必填入参 —— 三个条件都满足。
 */

import { createPage, getPage, listSpaces, searchContent, updatePage } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { confluenceActions } from './schema'

export type { ProviderEnv as Env }

export function createConfluencePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Confluence',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Token',
        required: true,
        secret: true,
        description: 'Atlassian API token,当 Basic 认证的密码;在 https://id.atlassian.com/manage-profile/security/api-tokens 创建',
      },
      {
        key: 'email',
        label: 'Atlassian Email',
        required: true,
        secret: false,
        description: 'Atlassian 账号邮箱,当 Basic 认证的用户名',
      },
      {
        key: 'siteUrl',
        label: 'Confluence Site URL',
        required: true,
        secret: false,
        description: 'Confluence Cloud 站点地址(https://<site>.atlassian.net);只接受 https 的 atlassian.net 站点',
      },
    ],
    credentialProbe: 'list_spaces',
    actions: confluenceActions,
    handlers: {
      search_content: searchContent,
      list_spaces: listSpaces,
      get_page: getPage,
      create_page: createPage,
      update_page: updatePage,
    },
  })
}

export default createConfluencePlugin()
