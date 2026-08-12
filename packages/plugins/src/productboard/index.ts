/**
 * Productboard —— 从 open-connector 迁移的 provider(api_key,13 个 action,全部只读)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getEntity,
  getEntityConfiguration,
  getMember,
  getNote,
  getNoteConfiguration,
  getTeam,
  listEntities,
  listEntityConfigurations,
  listMembers,
  listNoteConfigurations,
  listNotes,
  listTeamMembers,
  listTeams,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { productboardActions } from './schema'

export type { ProviderEnv as Env }

export function createProductboardPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Productboard',
    actions: productboardActions,
    // 上游 validateProductboardCredential 打的就是 /entities/configurations;
    // list_entity_configurations 只读、无必填入参。
    credentialProbe: 'list_entity_configurations',
    handlers: {
      list_entity_configurations: listEntityConfigurations,
      get_entity_configuration: getEntityConfiguration,
      list_entities: listEntities,
      get_entity: getEntity,
      list_note_configurations: listNoteConfigurations,
      get_note_configuration: getNoteConfiguration,
      list_notes: listNotes,
      get_note: getNote,
      list_members: listMembers,
      get_member: getMember,
      list_teams: listTeams,
      get_team: getTeam,
      list_team_members: listTeamMembers,
    },
  })
}

export default createProductboardPlugin()
