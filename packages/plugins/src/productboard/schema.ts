/**
 * Productboard 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listEntityConfigurationsInput = z.strictObject({
  types: z.array(z.enum(['product', 'component', 'feature', 'subfeature', 'initiative', 'objective', 'keyResult', 'release', 'releaseGroup', 'user', 'company'])).min(1).describe('Optional entity types to include.').optional(),
})

export const listEntityConfigurationsOutput = z.strictObject({
  configurations: z.array(z.looseObject({}).describe('Productboard JSON object payload.')).describe('Productboard entity configurations.').optional(),
  nextPageCursor: z.string().describe('Opaque Productboard cursor for requesting the next page.').nullable().optional(),
  nextPageUrl: z.url().describe('Productboard next page URL returned in links.next.').nullable().optional(),
  links: z.looseObject({}).describe('Productboard links object returned with the response.').optional(),
})

export const getEntityConfigurationInput = z.strictObject({
  type: z.enum(['product', 'component', 'feature', 'subfeature', 'initiative', 'objective', 'keyResult', 'release', 'releaseGroup', 'user', 'company']).describe('Productboard entity type to retrieve.').optional(),
})

export const getEntityConfigurationOutput = z.strictObject({
  configuration: z.looseObject({}).describe('Productboard JSON object payload.').optional(),
})

export const listEntitiesInput = z.strictObject({
  pageCursor: z.string().min(1).describe('Opaque cursor returned by a previous Productboard list response.').optional(),
  types: z.array(z.enum(['product', 'component', 'feature', 'subfeature', 'initiative', 'objective', 'keyResult', 'release', 'releaseGroup', 'user', 'company'])).min(1).describe('Entity types to include.').optional(),
  fields: z.array(z.string().min(1).describe('Productboard field identifier.')).min(1).describe('Productboard fields to return. Use all or field IDs from the configuration endpoints.').optional(),
  name: z.string().min(1).describe('Filter entities by name.').optional(),
  ownerId: z.string().min(1).describe('Filter entities by Productboard owner ID.').optional(),
  ownerEmail: z.email().describe('Filter entities by Productboard owner email.').optional(),
  statusId: z.string().min(1).describe('Filter entities by Productboard status ID.').optional(),
  statusName: z.string().min(1).describe('Filter entities by Productboard status name.').optional(),
  archived: z.boolean().describe('Filter entities by archived status.').optional(),
  parentId: z.string().min(1).describe('Filter entities by parent entity ID.').optional(),
  metadataSourceSystem: z.string().min(1).describe('Filter entities by metadata source system name.').optional(),
  metadataSourceRecordId: z.string().min(1).describe('Filter entities by metadata source record ID.').optional(),
})

export const listEntitiesOutput = z.strictObject({
  entities: z.array(z.looseObject({}).describe('Productboard JSON object payload.')).describe('Productboard entities returned by the API.').optional(),
  nextPageCursor: z.string().describe('Opaque Productboard cursor for requesting the next page.').nullable().optional(),
  nextPageUrl: z.url().describe('Productboard next page URL returned in links.next.').nullable().optional(),
  links: z.looseObject({}).describe('Productboard links object returned with the response.').optional(),
})

export const getEntityInput = z.strictObject({
  id: z.string().min(1).describe('Productboard entity identifier.'),
  fields: z.array(z.string().min(1).describe('Productboard field identifier.')).min(1).describe('Productboard fields to return. Use all or field IDs from the configuration endpoints.').optional(),
})

export const getEntityOutput = z.strictObject({
  entity: z.looseObject({}).describe('Productboard JSON object payload.').optional(),
})

export const listNoteConfigurationsInput = z.strictObject({
  types: z.array(z.enum(['textNote', 'conversationNote', 'opportunityNote', 'simple', 'conversation', 'opportunity'])).min(1).describe('Optional note types to include.').optional(),
})

export const listNoteConfigurationsOutput = z.strictObject({
  configurations: z.array(z.looseObject({}).describe('Productboard JSON object payload.')).describe('Productboard note configurations.').optional(),
  nextPageCursor: z.string().describe('Opaque Productboard cursor for requesting the next page.').nullable().optional(),
  nextPageUrl: z.url().describe('Productboard next page URL returned in links.next.').nullable().optional(),
  links: z.looseObject({}).describe('Productboard links object returned with the response.').optional(),
})

export const getNoteConfigurationInput = z.strictObject({
  type: z.enum(['textNote', 'conversationNote', 'opportunityNote', 'simple', 'conversation', 'opportunity']).describe('Productboard note type to retrieve.').optional(),
})

export const getNoteConfigurationOutput = z.strictObject({
  configuration: z.looseObject({}).describe('Productboard JSON object payload.').optional(),
})

export const listNotesInput = z.strictObject({
  pageCursor: z.string().min(1).describe('Opaque cursor returned by a previous Productboard list response.').optional(),
  archived: z.boolean().describe('Filter notes by archived status.').optional(),
  processed: z.boolean().describe('Filter notes by processed status.').optional(),
  types: z.array(z.enum(['textNote', 'conversationNote', 'opportunityNote', 'simple', 'conversation', 'opportunity'])).min(1).describe('Note types to include.').optional(),
  ownerId: z.string().min(1).describe('Filter notes by Productboard owner ID.').optional(),
  ownerEmail: z.email().describe('Filter notes by Productboard owner email.').optional(),
  creatorId: z.string().min(1).describe('Filter notes by Productboard creator ID.').optional(),
  creatorEmail: z.email().describe('Filter notes by Productboard creator email.').optional(),
  metadataSourceSystem: z.string().min(1).describe('Filter notes by metadata source system name.').optional(),
  metadataSourceRecordId: z.string().min(1).describe('Filter notes by metadata source record ID.').optional(),
  createdFrom: z.iso.datetime({ offset: true }).describe('Filter notes created on or after this ISO-8601 timestamp.').optional(),
  createdTo: z.iso.datetime({ offset: true }).describe('Filter notes created on or before this ISO-8601 timestamp.').optional(),
  updatedFrom: z.iso.datetime({ offset: true }).describe('Filter notes updated on or after this ISO-8601 timestamp.').optional(),
  updatedTo: z.iso.datetime({ offset: true }).describe('Filter notes updated on or before this ISO-8601 timestamp.').optional(),
  fields: z.array(z.string().min(1).describe('Productboard field identifier.')).min(1).describe('Productboard fields to return. Use all or field IDs from the configuration endpoints.').optional(),
})

export const listNotesOutput = z.strictObject({
  notes: z.array(z.looseObject({}).describe('Productboard JSON object payload.')).describe('Productboard notes returned by the API.').optional(),
  nextPageCursor: z.string().describe('Opaque Productboard cursor for requesting the next page.').nullable().optional(),
  nextPageUrl: z.url().describe('Productboard next page URL returned in links.next.').nullable().optional(),
  links: z.looseObject({}).describe('Productboard links object returned with the response.').optional(),
})

export const getNoteInput = z.strictObject({
  id: z.string().min(1).describe('Productboard note identifier.'),
  fields: z.array(z.string().min(1).describe('Productboard field identifier.')).min(1).describe('Productboard fields to return. Use all or field IDs from the configuration endpoints.').optional(),
})

export const getNoteOutput = z.strictObject({
  note: z.looseObject({}).describe('Productboard JSON object payload.').optional(),
})

export const listMembersInput = z.strictObject({
  pageCursor: z.string().min(1).describe('Opaque cursor returned by a previous Productboard list response.').optional(),
  query: z.string().min(1).describe('Case-insensitive partial match query for member name or email.').optional(),
  roles: z.array(z.enum(['admin', 'maker', 'viewer', 'contributor'])).min(1).describe('Member roles to include.').optional(),
  includeDisabled: z.boolean().describe('Whether to include disabled members.').optional(),
  includeInvitationPending: z.boolean().describe('Whether to include members with pending invitations.').optional(),
})

export const listMembersOutput = z.strictObject({
  members: z.array(z.looseObject({}).describe('Productboard JSON object payload.')).describe('Productboard members returned by the API.').optional(),
  nextPageCursor: z.string().describe('Opaque Productboard cursor for requesting the next page.').nullable().optional(),
  nextPageUrl: z.url().describe('Productboard next page URL returned in links.next.').nullable().optional(),
  links: z.looseObject({}).describe('Productboard links object returned with the response.').optional(),
})

export const getMemberInput = z.strictObject({
  id: z.string().min(1).describe('Productboard member identifier.').optional(),
})

export const getMemberOutput = z.strictObject({
  member: z.looseObject({}).describe('Productboard JSON object payload.').optional(),
})

export const listTeamsInput = z.strictObject({
  pageCursor: z.string().min(1).describe('Opaque cursor returned by a previous Productboard list response.').optional(),
  name: z.string().min(1).describe('Filter teams by exact name, case-insensitive.').optional(),
  handle: z.string().min(1).describe('Filter teams by exact handle, case-insensitive.').optional(),
  query: z.string().min(1).describe('Case-insensitive partial match query for team name or handle.').optional(),
})

export const listTeamsOutput = z.strictObject({
  teams: z.array(z.looseObject({}).describe('Productboard JSON object payload.')).describe('Productboard teams returned by the API.').optional(),
  nextPageCursor: z.string().describe('Opaque Productboard cursor for requesting the next page.').nullable().optional(),
  nextPageUrl: z.url().describe('Productboard next page URL returned in links.next.').nullable().optional(),
  links: z.looseObject({}).describe('Productboard links object returned with the response.').optional(),
})

export const getTeamInput = z.strictObject({
  id: z.string().min(1).describe('Productboard team identifier.').optional(),
})

export const getTeamOutput = z.strictObject({
  team: z.looseObject({}).describe('Productboard JSON object payload.').optional(),
})

export const listTeamMembersInput = z.strictObject({
  teamId: z.string().min(1).describe('Productboard team identifier.'),
  pageCursor: z.string().min(1).describe('Opaque cursor returned by a previous Productboard list response.').optional(),
})

export const listTeamMembersOutput = z.strictObject({
  members: z.array(z.looseObject({}).describe('Productboard JSON object payload.')).describe('Productboard team members returned by the API.').optional(),
  nextPageCursor: z.string().describe('Opaque Productboard cursor for requesting the next page.').nullable().optional(),
  nextPageUrl: z.url().describe('Productboard next page URL returned in links.next.').nullable().optional(),
  links: z.looseObject({}).describe('Productboard links object returned with the response.').optional(),
})

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const productboardActions = {
  list_entity_configurations: {
    description: 'List Productboard entity configurations available in the workspace.',
    effect: 'read',
    inputSchema: listEntityConfigurationsInput,
    outputSchema: z.toJSONSchema(listEntityConfigurationsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_entity_configuration: {
    description: 'Get the Productboard configuration for one entity type.',
    effect: 'read',
    inputSchema: getEntityConfigurationInput,
    outputSchema: z.toJSONSchema(getEntityConfigurationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_entities: {
    description: 'List Productboard product-management entities with supported filters.',
    effect: 'read',
    inputSchema: listEntitiesInput,
    outputSchema: z.toJSONSchema(listEntitiesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_entity: {
    description: 'Get a Productboard product-management entity by ID.',
    effect: 'read',
    inputSchema: getEntityInput,
    outputSchema: z.toJSONSchema(getEntityOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_note_configurations: {
    description: 'List Productboard note configurations available in the workspace.',
    effect: 'read',
    inputSchema: listNoteConfigurationsInput,
    outputSchema: z.toJSONSchema(listNoteConfigurationsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_note_configuration: {
    description: 'Get the Productboard configuration for one note type.',
    effect: 'read',
    inputSchema: getNoteConfigurationInput,
    outputSchema: z.toJSONSchema(getNoteConfigurationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_notes: {
    description: 'List Productboard notes with supported filters.',
    effect: 'read',
    inputSchema: listNotesInput,
    outputSchema: z.toJSONSchema(listNotesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_note: {
    description: 'Get a Productboard note by ID.',
    effect: 'read',
    inputSchema: getNoteInput,
    outputSchema: z.toJSONSchema(getNoteOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_members: {
    description: 'List Productboard workspace members.',
    effect: 'read',
    inputSchema: listMembersInput,
    outputSchema: z.toJSONSchema(listMembersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_member: {
    description: 'Get a Productboard workspace member by ID.',
    effect: 'read',
    inputSchema: getMemberInput,
    outputSchema: z.toJSONSchema(getMemberOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_teams: {
    description: 'List Productboard teams.',
    effect: 'read',
    inputSchema: listTeamsInput,
    outputSchema: z.toJSONSchema(listTeamsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_team: {
    description: 'Get a Productboard team by ID.',
    effect: 'read',
    inputSchema: getTeamInput,
    outputSchema: z.toJSONSchema(getTeamOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_team_members: {
    description: 'List members belonging to a Productboard team.',
    effect: 'read',
    inputSchema: listTeamMembersInput,
    outputSchema: z.toJSONSchema(listTeamMembersOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
