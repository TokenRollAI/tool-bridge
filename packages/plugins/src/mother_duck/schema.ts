/**
 * MotherDuck 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listActiveAccountsInput = z.strictObject({}).describe('No input is required to list active MotherDuck accounts.')

export const listActiveAccountsOutput = z.strictObject({
  accounts: z.array(z.strictObject({
    username: z.string().min(1).max(255).describe('The MotherDuck username within the organization.').optional(),
    ducklings: z.array(z.strictObject({
      id: z.string().describe('The Duckling identifier, such as rw or rs.N.').optional(),
      type: z.enum(['read_write', 'read_scaling']).describe('The MotherDuck Duckling type.').optional(),
      status: z.string().min(1).describe('The MotherDuck Duckling status, such as active or cooldown.').optional(),
    }).describe('A MotherDuck Duckling attached to an active account.')).describe('The active Ducklings for the account.').optional(),
  }).describe('A MotherDuck active account.')).describe('The active accounts in the organization.'),
}).describe('The active MotherDuck accounts returned by the Admin API.')

export const createUserInput = z.strictObject({
  username: z.string().min(1).max(255).describe('The MotherDuck username within the organization.'),
}).describe('Input for creating a MotherDuck user.')

export const createUserOutput = z.strictObject({
  username: z.string().min(1).max(255).describe('The MotherDuck username within the organization.'),
}).describe('The created MotherDuck user.')

export const deleteUserInput = z.strictObject({
  username: z.string().min(1).max(255).describe('The MotherDuck username within the organization.'),
}).describe('Input for deleting a MotherDuck user.')

export const deleteUserOutput = z.strictObject({
  username: z.string().min(1).max(255).describe('The MotherDuck username within the organization.'),
}).describe('The deleted MotherDuck user.')

export const listTokensInput = z.strictObject({
  username: z.string().min(1).max(255).describe('The MotherDuck username within the organization.'),
}).describe('Input for listing MotherDuck user tokens.')

export const listTokensOutput = z.strictObject({
  tokens: z.array(z.strictObject({
    id: z.string().describe('The token UUID.').optional(),
    name: z.string().describe('The token display name.').optional(),
    token: z.string().describe('The newly-created token secret when MotherDuck returns it.').optional(),
    expire_at: z.string().describe('The timestamp when the token expires.').optional(),
    created_ts: z.string().describe('The timestamp when the token was created.').optional(),
    read_only: z.boolean().describe('Whether the token is read-only.').optional(),
    token_type: z.enum(['read_write', 'read_scaling']).describe('The MotherDuck token type.').optional(),
    raw: z.looseObject({}).describe('The raw token object returned by MotherDuck.'),
  }).describe('A MotherDuck access token.')).describe('The user\'s MotherDuck access tokens.'),
}).describe('The MotherDuck access tokens for the user.')

export const createTokenInput = z.strictObject({
  username: z.string().min(1).max(255).describe('The MotherDuck username within the organization.'),
  name: z.string().min(1).max(255).describe('The token display name.'),
  ttl: z.number().min(300).max(31536000).describe('Token expiration in seconds.').optional(),
  token_type: z.enum(['read_write', 'read_scaling']).describe('The MotherDuck token type.').optional(),
}).describe('Input for creating a MotherDuck user token.')

export const createTokenOutput = z.strictObject({
  token: z.strictObject({
    id: z.string().describe('The token UUID.').optional(),
    name: z.string().describe('The token display name.').optional(),
    token: z.string().describe('The newly-created token secret when MotherDuck returns it.').optional(),
    expire_at: z.string().describe('The timestamp when the token expires.').optional(),
    created_ts: z.string().describe('The timestamp when the token was created.').optional(),
    read_only: z.boolean().describe('Whether the token is read-only.').optional(),
    token_type: z.enum(['read_write', 'read_scaling']).describe('The MotherDuck token type.').optional(),
    raw: z.looseObject({}).describe('The raw token object returned by MotherDuck.'),
  }).describe('A MotherDuck access token.'),
}).describe('The newly-created MotherDuck token.')

export const deleteTokenInput = z.strictObject({
  username: z.string().min(1).max(255).describe('The MotherDuck username within the organization.'),
  token_id: z.string().min(1).describe('The MotherDuck access token identifier.'),
}).describe('Input for deleting a MotherDuck user token.')

export const deleteTokenOutput = z.strictObject({
  success: z.boolean().describe('Whether MotherDuck accepted the token deletion request.'),
}).describe('The normalized MotherDuck token deletion result.')

export const getUserDucklingConfigInput = z.strictObject({
  username: z.string().min(1).max(255).describe('The MotherDuck username within the organization.'),
}).describe('Input for retrieving a MotherDuck user\'s Duckling configuration.')

export const getUserDucklingConfigOutput = z.strictObject({
  config: z.strictObject({
    read_write: z.strictObject({
      instance_size: z.enum(['pulse', 'standard', 'jumbo', 'mega', 'giga']).describe('The MotherDuck instance size.'),
      cooldown_seconds: z.int().min(60).max(86400).describe('Cooldown duration in seconds.').optional(),
    }).describe('MotherDuck read-write Duckling configuration.').optional(),
    read_scaling: z.strictObject({
      instance_size: z.enum(['pulse', 'standard', 'jumbo', 'mega', 'giga']).describe('The MotherDuck instance size.'),
      flock_size: z.number().min(0).max(64).describe('The number of read-scaling Ducklings.'),
      cooldown_seconds: z.int().min(60).max(86400).describe('Cooldown duration in seconds.').optional(),
    }).describe('MotherDuck read-scaling Duckling configuration.').optional(),
  }).describe('MotherDuck Duckling configuration for a user.'),
}).describe('The MotherDuck Duckling configuration for the user.')

export const setUserDucklingConfigInput = z.strictObject({
  username: z.string().min(1).max(255).describe('The MotherDuck username within the organization.'),
  config: z.strictObject({
    read_write: z.strictObject({
      instance_size: z.enum(['pulse', 'standard', 'jumbo', 'mega', 'giga']).describe('The MotherDuck instance size.'),
      cooldown_seconds: z.int().min(60).max(86400).describe('Cooldown duration in seconds.').optional(),
    }).describe('MotherDuck read-write Duckling configuration.').optional(),
    read_scaling: z.strictObject({
      instance_size: z.enum(['pulse', 'standard', 'jumbo', 'mega', 'giga']).describe('The MotherDuck instance size.'),
      flock_size: z.number().min(0).max(64).describe('The number of read-scaling Ducklings.'),
      cooldown_seconds: z.int().min(60).max(86400).describe('Cooldown duration in seconds.').optional(),
    }).describe('MotherDuck read-scaling Duckling configuration.').optional(),
  }).describe('MotherDuck Duckling configuration for a user.'),
}).describe('Input for setting a MotherDuck user\'s Duckling configuration.')

export const setUserDucklingConfigOutput = z.strictObject({
  config: z.strictObject({
    read_write: z.strictObject({
      instance_size: z.enum(['pulse', 'standard', 'jumbo', 'mega', 'giga']).describe('The MotherDuck instance size.'),
      cooldown_seconds: z.int().min(60).max(86400).describe('Cooldown duration in seconds.').optional(),
    }).describe('MotherDuck read-write Duckling configuration.').optional(),
    read_scaling: z.strictObject({
      instance_size: z.enum(['pulse', 'standard', 'jumbo', 'mega', 'giga']).describe('The MotherDuck instance size.'),
      flock_size: z.number().min(0).max(64).describe('The number of read-scaling Ducklings.'),
      cooldown_seconds: z.int().min(60).max(86400).describe('Cooldown duration in seconds.').optional(),
    }).describe('MotherDuck read-scaling Duckling configuration.').optional(),
  }).describe('MotherDuck Duckling configuration for a user.'),
}).describe('The updated MotherDuck Duckling configuration for the user.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const motherDuckActions = {
  list_active_accounts: {
    description: 'List active MotherDuck accounts and their active Ducklings in the organization.',
    effect: 'read',
    inputSchema: listActiveAccountsInput,
    outputSchema: z.toJSONSchema(listActiveAccountsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_user: {
    description: 'Create a MotherDuck member user in the organization.',
    effect: 'write',
    inputSchema: createUserInput,
    outputSchema: z.toJSONSchema(createUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_user: {
    description: 'Permanently delete a MotherDuck user and all of their data.',
    effect: 'destructive',
    inputSchema: deleteUserInput,
    outputSchema: z.toJSONSchema(deleteUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_tokens: {
    description: 'List MotherDuck access tokens for a user.',
    effect: 'read',
    inputSchema: listTokensInput,
    outputSchema: z.toJSONSchema(listTokensOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_token: {
    description: 'Create a MotherDuck access token for a user.',
    effect: 'write',
    inputSchema: createTokenInput,
    outputSchema: z.toJSONSchema(createTokenOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_token: {
    description: 'Invalidate a MotherDuck access token for a user.',
    effect: 'destructive',
    inputSchema: deleteTokenInput,
    outputSchema: z.toJSONSchema(deleteTokenOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_user_duckling_config: {
    description: 'Retrieve MotherDuck Duckling configuration for a user.',
    effect: 'read',
    inputSchema: getUserDucklingConfigInput,
    outputSchema: z.toJSONSchema(getUserDucklingConfigOutput, { io: 'output', unrepresentable: 'any' }),
  },
  set_user_duckling_config: {
    description: 'Set MotherDuck Duckling configuration for a user.',
    effect: 'write',
    inputSchema: setUserDucklingConfigInput,
    outputSchema: z.toJSONSchema(setUserDucklingConfigOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
