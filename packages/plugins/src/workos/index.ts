/**
 * WorkOS —— 从 open-connector 迁移的 provider(api_key,14 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createOrganization,
  createOrganizationMembership,
  createUser,
  deactivateOrganizationMembership,
  getOrganization,
  getOrganizationMembership,
  getUser,
  listOrganizationMemberships,
  listOrganizations,
  listUsers,
  reactivateOrganizationMembership,
  updateOrganization,
  updateOrganizationMembership,
  updateUser,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { workosActions } from './schema'

export type { ProviderEnv as Env }

export function createWorkosPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'WorkOS',
    actions: workosActions,
    // 上游的 credentialValidators 打的是 /organizations?limit=1;list_organizations 无必填入参,
    // 是它的同一个调用。
    credentialProbe: 'list_organizations',
    handlers: {
      list_users: listUsers,
      get_user: getUser,
      create_user: createUser,
      update_user: updateUser,
      list_organizations: listOrganizations,
      get_organization: getOrganization,
      create_organization: createOrganization,
      update_organization: updateOrganization,
      list_organization_memberships: listOrganizationMemberships,
      get_organization_membership: getOrganizationMembership,
      create_organization_membership: createOrganizationMembership,
      update_organization_membership: updateOrganizationMembership,
      deactivate_organization_membership: deactivateOrganizationMembership,
      reactivate_organization_membership: reactivateOrganizationMembership,
    },
  })
}

export default createWorkosPlugin()
