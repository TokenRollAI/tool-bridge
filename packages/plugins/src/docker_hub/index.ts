/**
 * Docker Hub —— 从 open-connector 迁移的 provider(14 个 Hub API action)。
 *
 * 没有 credentialProbe:所有 effect 为 read 的 action 都要一个业务 id(namespace 或
 * orgName),平台空参调用会被 Zod 拦成 invalid_argument —— 那个错误看起来像凭证问题,
 * 实际是探针选错了。选不出满足条件的就不写。
 *
 * 凭证是**单值**但有格式约定:`identifier:secret`(Docker 用户名 + PAT,或组织名 + OAT),
 * 由 api.ts 拆开后换取 bearer token。
 */

import {
  addOrgMember,
  createRepository,
  deleteTeam,
  getImage,
  getRepository,
  getTag,
  getTeam,
  listOrgAccessTokens,
  listOrgMembers,
  listRepositories,
  listTeamMembers,
  listTeams,
  removeOrgMember,
  removeTeamMember,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { dockerHubActions } from './schema'

export type { ProviderEnv as Env }

export function createDockerHubPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Docker Hub',
    actions: dockerHubActions,
    handlers: {
      list_repositories: listRepositories,
      get_repository: getRepository,
      create_repository: createRepository,
      get_tag: getTag,
      get_image: getImage,
      list_org_members: listOrgMembers,
      add_org_member: addOrgMember,
      remove_org_member: removeOrgMember,
      list_org_access_tokens: listOrgAccessTokens,
      list_teams: listTeams,
      get_team: getTeam,
      delete_team: deleteTeam,
      list_team_members: listTeamMembers,
      remove_team_member: removeTeamMember,
    },
  })
}

export default createDockerHubPlugin()
