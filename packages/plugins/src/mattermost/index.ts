/**
 * Mattermost —— 从 open-connector 迁移的 provider(7 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 凭证是**两个字段**:`apiKey`(Personal Access Token)与 `instanceUrl`(实例根地址)。
 * 字段名与上游 `definition.ts` 里 api_key 那份 auth 的自身值 + `extraFields` 逐字一致 ——
 * 名字对不上就取不到值,而 `requireCredential` 会把它报成 internal(provider 自身的 bug)。
 *
 * credentialProbe 选 `get_current_user`:它 effect 为 read、无必填入参,且打的正是上游
 * `credentialValidators` 用的 `/users/me`。它一次验到三件事 —— token 有效、instanceUrl 指得对、
 * 这个实例真的是 Mattermost。自建实例最常见的配错(把浏览器地址栏里带路径的 URL 贴进来、
 * 或填了内网地址)在挂载时就会被拒,不用等第一次业务调用。
 */

import {
  createPost,
  getChannel,
  getCurrentUser,
  getTeam,
  listChannelPosts,
  listTeamChannels,
  listUserTeams,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { mattermostActions } from './schema'

export type { ProviderEnv as Env }

export function createMattermostPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Mattermost',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'Personal access token',
        required: true,
        secret: true,
        description: 'Mattermost 个人访问令牌,以 Bearer 发送;在账号设置的 Security → Personal Access Tokens 里创建',
      },
      {
        key: 'instanceUrl',
        label: 'Instance URL',
        required: true,
        secret: false,
        description: 'Mattermost 实例的根地址(https://mattermost.example.com,带 /api/v4 后缀也能识别);必须是 https 的公网可达地址,私有网段会被出站策略拦下',
      },
    ],
    credentialProbe: 'get_current_user',
    actions: mattermostActions,
    handlers: {
      get_current_user: getCurrentUser,
      list_user_teams: listUserTeams,
      get_team: getTeam,
      list_team_channels: listTeamChannels,
      get_channel: getChannel,
      list_channel_posts: listChannelPosts,
      create_post: createPost,
    },
  })
}

export default createMattermostPlugin()
