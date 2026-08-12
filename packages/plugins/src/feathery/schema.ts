/**
 * Feathery 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getAccountInfoInput = z.strictObject({}).describe('No input parameters are required for this action.')

export const getAccountInfoOutput = z.strictObject({
  account: z.looseObject({
    team: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery team name.').optional(),
    accounts: z.array(z.looseObject({
      id: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery account member ID.').optional(),
      email: z.email().describe('The account member email address.').optional(),
      role: z.string().min(1).regex(new RegExp('\\S')).describe('The account member role.').optional(),
    }).describe('One Feathery account member.')).describe('The accounts belonging to the Feathery team.').optional(),
  }).describe('The Feathery account information returned for the API key.'),
}).describe('The normalized Feathery account response.')

export const listFormsInput = z.strictObject({
  tags: z.array(z.string().min(1).regex(new RegExp('\\S')).describe('One Feathery form tag.')).describe('Only return forms that have all of these Feathery tags.').optional(),
}).describe('Optional filters for listing Feathery forms.')

export const listFormsOutput = z.strictObject({
  forms: z.array(z.looseObject({
    id: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery form ID.').optional(),
    name: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery form name.').optional(),
    active: z.boolean().describe('Whether the Feathery form is active.').optional(),
    tags: z.array(z.string().describe('One Feathery form tag.')).describe('The tags associated with the form.').optional(),
    created_at: z.string().min(1).regex(new RegExp('\\S')).describe('The timestamp when the form was created.').optional(),
    updated_at: z.string().min(1).regex(new RegExp('\\S')).describe('The timestamp when the form was last updated.').optional(),
    internal_id: z.string().describe('The Feathery internal form identifier when returned.').optional(),
  }).describe('One Feathery form returned by the Forms API.')).describe('The Feathery forms returned by the API.'),
}).describe('The normalized Feathery form-list response.')

export const getFormSchemaInput = z.strictObject({
  form_id: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery form ID.'),
}).describe('Input payload for one Feathery form.')

export const getFormSchemaOutput = z.strictObject({
  schema: z.looseObject({}).describe('The raw Feathery form schema payload.'),
}).describe('The normalized Feathery form-schema response.')

export const createOrUpdateFormSubmissionsInput = z.strictObject({
  form_id: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery form ID.'),
  submissions: z.array(z.looseObject({}).describe('One Feathery submission object.')).min(1).describe('The Feathery submission objects to create or update.'),
}).describe('Input payload for creating or updating Feathery form submissions.')

export const createOrUpdateFormSubmissionsOutput = z.strictObject({
  result: z.looseObject({}).describe('The raw Feathery submission write payload.'),
}).describe('The normalized Feathery submission write response.')

export const listHiddenFieldsInput = z.strictObject({}).describe('No input parameters are required for this action.')

export const listHiddenFieldsOutput = z.strictObject({
  hiddenFields: z.array(z.looseObject({
    id: z.string().min(1).regex(new RegExp('\\S')).describe('The hidden field ID.').optional(),
    field_id: z.string().min(1).regex(new RegExp('\\S')).describe('The hidden field ID returned by write endpoints.').optional(),
    type: z.string().min(1).regex(new RegExp('\\S')).describe('The hidden field value type.').optional(),
    internal_id: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery internal hidden field identifier.').optional(),
    created_at: z.string().min(1).regex(new RegExp('\\S')).describe('The timestamp when the hidden field was created.').optional(),
    updated_at: z.string().min(1).regex(new RegExp('\\S')).describe('The timestamp when the hidden field was last updated.').optional(),
  }).describe('One Feathery hidden field.')).describe('The hidden fields returned by Feathery.'),
}).describe('The normalized Feathery hidden-field list response.')

export const createHiddenFieldInput = z.strictObject({
  field_id: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery hidden field ID.'),
}).describe('Input payload for one Feathery hidden field.')

export const createHiddenFieldOutput = z.strictObject({
  hiddenField: z.looseObject({
    id: z.string().min(1).regex(new RegExp('\\S')).describe('The hidden field ID.').optional(),
    field_id: z.string().min(1).regex(new RegExp('\\S')).describe('The hidden field ID returned by write endpoints.').optional(),
    type: z.string().min(1).regex(new RegExp('\\S')).describe('The hidden field value type.').optional(),
    internal_id: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery internal hidden field identifier.').optional(),
    created_at: z.string().min(1).regex(new RegExp('\\S')).describe('The timestamp when the hidden field was created.').optional(),
    updated_at: z.string().min(1).regex(new RegExp('\\S')).describe('The timestamp when the hidden field was last updated.').optional(),
  }).describe('One Feathery hidden field.'),
}).describe('The normalized Feathery hidden-field create response.')

export const editHiddenFieldInput = z.strictObject({
  field_id: z.string().min(1).regex(new RegExp('\\S')).describe('The existing Feathery hidden field ID.'),
  new_field_id: z.string().min(1).regex(new RegExp('\\S')).describe('The replacement Feathery hidden field ID.'),
}).describe('Input payload for editing one Feathery hidden field.')

export const editHiddenFieldOutput = z.strictObject({
  hiddenField: z.looseObject({
    id: z.string().min(1).regex(new RegExp('\\S')).describe('The hidden field ID.').optional(),
    field_id: z.string().min(1).regex(new RegExp('\\S')).describe('The hidden field ID returned by write endpoints.').optional(),
    type: z.string().min(1).regex(new RegExp('\\S')).describe('The hidden field value type.').optional(),
    internal_id: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery internal hidden field identifier.').optional(),
    created_at: z.string().min(1).regex(new RegExp('\\S')).describe('The timestamp when the hidden field was created.').optional(),
    updated_at: z.string().min(1).regex(new RegExp('\\S')).describe('The timestamp when the hidden field was last updated.').optional(),
  }).describe('One Feathery hidden field.'),
}).describe('The normalized Feathery hidden-field edit response.')

export const deleteHiddenFieldInput = z.strictObject({
  field_id: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery hidden field ID.'),
}).describe('Input payload for one Feathery hidden field.')

export const deleteHiddenFieldOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the delete request completed successfully.'),
  field_id: z.string().min(1).regex(new RegExp('\\S')).describe('The deleted Feathery hidden field ID.'),
  raw: z.unknown().describe('The raw response returned by Feathery.'),
}).describe('The normalized Feathery hidden-field delete response.')

export const listUsersInput = z.strictObject({
  created_after: z.string().describe('Return users created on or after this ISO timestamp.').optional(),
  created_before: z.string().describe('Return users created on or before this ISO timestamp.').optional(),
  filter_field_id: z.string().describe('The form or hidden field ID used to filter users.').optional(),
  filter_field_value: z.string().describe('The value matched for filter_field_id.').optional(),
}).describe('Optional filters for listing Feathery users.')

export const listUsersOutput = z.strictObject({
  users: z.array(z.looseObject({
    id: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery user ID.').optional(),
    created_at: z.string().min(1).regex(new RegExp('\\S')).describe('The timestamp when the user was created.').optional(),
    sdk_key: z.string().min(1).regex(new RegExp('\\S')).describe('The SDK key returned for this Feathery user.').optional(),
  }).describe('One Feathery end user.')).describe('The Feathery users returned by the API.'),
}).describe('The normalized Feathery user-list response.')

export const getUserDataInput = z.strictObject({
  id: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery user ID whose field data should be returned.').optional(),
}).describe('Optional input payload for reading Feathery user field data.')

export const getUserDataOutput = z.strictObject({
  fields: z.array(z.looseObject({
    id: z.string().min(1).regex(new RegExp('\\S')).describe('The field ID.').optional(),
    type: z.string().min(1).regex(new RegExp('\\S')).describe('The field value type.').optional(),
    value: z.unknown().describe('The submitted field value returned by Feathery.').optional(),
    hidden: z.boolean().describe('Whether this entry is a hidden field.').optional(),
    internal_id: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery internal field identifier.').optional(),
    display_text: z.string().describe('The human-readable field label when returned.').optional(),
    created_at: z.string().min(1).regex(new RegExp('\\S')).describe('The timestamp when this field was created.').optional(),
    updated_at: z.string().min(1).regex(new RegExp('\\S')).describe('The timestamp when this field was last updated.').optional(),
  }).describe('One Feathery field data entry.')).describe('The Feathery field data entries returned by the API.'),
}).describe('The normalized Feathery user data response.')

export const getUserSessionInput = z.strictObject({
  user_id: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery user ID.'),
}).describe('Input payload for one Feathery user session.')

export const getUserSessionOutput = z.strictObject({
  session: z.looseObject({}).describe('The raw Feathery user session payload.'),
}).describe('The normalized Feathery user-session response.')

export const createOrFetchUserInput = z.strictObject({
  id: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery user ID.'),
}).describe('Input payload for one Feathery user.')

export const createOrFetchUserOutput = z.strictObject({
  user: z.looseObject({
    id: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery user ID.').optional(),
    created_at: z.string().min(1).regex(new RegExp('\\S')).describe('The timestamp when the user was created.').optional(),
    sdk_key: z.string().min(1).regex(new RegExp('\\S')).describe('The SDK key returned for this Feathery user.').optional(),
  }).describe('One Feathery end user.'),
}).describe('The normalized Feathery create-or-fetch-user response.')

export const deleteUserInput = z.strictObject({
  id: z.string().min(1).regex(new RegExp('\\S')).describe('The Feathery user ID.'),
}).describe('Input payload for one Feathery user.')

export const deleteUserOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the delete request completed successfully.'),
  id: z.string().min(1).regex(new RegExp('\\S')).describe('The deleted Feathery user ID.'),
  raw: z.unknown().describe('The raw response returned by Feathery.'),
}).describe('The normalized Feathery delete-user response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const featheryActions = {
  get_account_info: {
    description: 'Retrieve Feathery team and account information for the authenticated API key.',
    effect: 'read',
    inputSchema: getAccountInfoInput,
    outputSchema: z.toJSONSchema(getAccountInfoOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_forms: {
    description: 'List Feathery forms, optionally filtered by tags.',
    effect: 'read',
    inputSchema: listFormsInput,
    outputSchema: z.toJSONSchema(listFormsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_form_schema: {
    description: 'Retrieve the complete schema for one Feathery form.',
    effect: 'read',
    inputSchema: getFormSchemaInput,
    outputSchema: z.toJSONSchema(getFormSchemaOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_or_update_form_submissions: {
    description: 'Create or update Feathery form submissions for one form.',
    effect: 'write',
    inputSchema: createOrUpdateFormSubmissionsInput,
    outputSchema: z.toJSONSchema(createOrUpdateFormSubmissionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_hidden_fields: {
    description: 'List hidden fields configured in the Feathery account.',
    effect: 'read',
    inputSchema: listHiddenFieldsInput,
    outputSchema: z.toJSONSchema(listHiddenFieldsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_hidden_field: {
    description: 'Create a Feathery hidden field by field ID.',
    effect: 'write',
    inputSchema: createHiddenFieldInput,
    outputSchema: z.toJSONSchema(createHiddenFieldOutput, { io: 'output', unrepresentable: 'any' }),
  },
  edit_hidden_field: {
    description: 'Rename or edit a Feathery hidden field by field ID.',
    effect: 'write',
    inputSchema: editHiddenFieldInput,
    outputSchema: z.toJSONSchema(editHiddenFieldOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_hidden_field: {
    description: 'Delete one Feathery hidden field by field ID.',
    effect: 'destructive',
    inputSchema: deleteHiddenFieldInput,
    outputSchema: z.toJSONSchema(deleteHiddenFieldOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_users: {
    description: 'List Feathery users with optional creation-time and field-value filters.',
    effect: 'read',
    inputSchema: listUsersInput,
    outputSchema: z.toJSONSchema(listUsersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_user_data: {
    description: 'Retrieve all Feathery field data, optionally scoped to one user.',
    effect: 'read',
    inputSchema: getUserDataInput,
    outputSchema: z.toJSONSchema(getUserDataOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_user_session: {
    description: 'Retrieve Feathery form session and progress data for one user.',
    effect: 'read',
    inputSchema: getUserSessionInput,
    outputSchema: z.toJSONSchema(getUserSessionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_or_fetch_user: {
    description: 'Create a Feathery user or fetch the existing user by ID.',
    effect: 'write',
    inputSchema: createOrFetchUserInput,
    outputSchema: z.toJSONSchema(createOrFetchUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_user: {
    description: 'Delete one Feathery user by ID.',
    effect: 'destructive',
    inputSchema: deleteUserInput,
    outputSchema: z.toJSONSchema(deleteUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
