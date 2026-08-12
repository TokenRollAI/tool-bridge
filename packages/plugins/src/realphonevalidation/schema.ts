/**
 * RealPhoneValidation 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const validatePhoneStandardInput = z.strictObject({
  phone: z.string().regex(new RegExp('^\\d{10}$')).describe('The 10-digit US phone number to validate, using numeric digits only.').optional(),
}).describe('The input payload for the Turbo Standard phone validation request.')

export const validatePhoneStandardOutput = z.strictObject({
  status: z.string().describe('The line status returned by RealPhoneValidation, such as connected, disconnected, busy, or pending.').optional(),
  error_text: z.string().describe('The upstream error text returned by RealPhoneValidation when the request was not a normal validation success.').nullable().optional(),
  phone_type: z.string().describe('The detected phone type returned by RealPhoneValidation, such as Mobile, Landline, or VoIP.').nullable().optional(),
}).describe('The normalized Turbo Standard validation result returned by RealPhoneValidation.')

export const validatePhoneV3Input = z.strictObject({
  phone: z.string().regex(new RegExp('^\\d{10}$')).describe('The 10-digit US phone number to validate, using numeric digits only.').optional(),
}).describe('The input payload for the Turbo v3 phone validation request.')

export const validatePhoneV3Output = z.strictObject({
  status: z.string().describe('The line status returned by RealPhoneValidation, such as connected, disconnected, busy, or pending.').optional(),
  error_text: z.string().describe('The upstream error text returned by RealPhoneValidation when the request was not a normal validation success.').nullable().optional(),
  phone_type: z.string().describe('The detected phone type returned by RealPhoneValidation, such as Mobile, Landline, or VoIP.').nullable().optional(),
  caller_name: z.string().describe('The subscriber name returned by RealPhoneValidation when available.').nullable().optional(),
  carrier: z.string().describe('The carrier or service provider returned by RealPhoneValidation when available.').nullable().optional(),
  caller_type: z.string().describe('The caller type returned by RealPhoneValidation, such as Consumer or Business.').nullable().optional(),
}).describe('The normalized Turbo v3 validation result returned by RealPhoneValidation.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const realphonevalidationActions = {
  validate_phone_standard: {
    description: 'Validate one 10-digit phone number with the RealPhoneValidation Turbo Standard endpoint.',
    effect: 'write',
    inputSchema: validatePhoneStandardInput,
    outputSchema: z.toJSONSchema(validatePhoneStandardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  validate_phone_v3: {
    description: 'Validate one 10-digit phone number with the RealPhoneValidation Turbo v3 endpoint and return caller enrichment fields when available.',
    effect: 'write',
    inputSchema: validatePhoneV3Input,
    outputSchema: z.toJSONSchema(validatePhoneV3Output, { io: 'output', unrepresentable: 'any' }),
  },
} as const
