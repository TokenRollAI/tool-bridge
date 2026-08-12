/**
 * Lob 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const verifyUsAddressInput = z.strictObject({
  primary_line: z.string().min(1).describe('The primary street address line.'),
  secondary_line: z.string().min(1).describe('The secondary address line, such as an apartment, suite, or unit.').optional(),
  city: z.string().min(1).describe('The city name for the address.').optional(),
  state: z.string().min(1).describe('The US state or region for the address.').optional(),
  zip_code: z.string().min(1).describe('The US ZIP or ZIP+4 code for the address.').optional(),
  recipient: z.string().min(1).describe('The recipient name associated with the address.').optional(),
}).describe('Input for verifying one US address with Lob.')

export const verifyUsAddressOutput = z.strictObject({
  verification: z.looseObject({}).describe('A Lob address verification object.').optional(),
}).describe('The normalized Lob US address verification result.')

export const bulkVerifyUsAddressesInput = z.strictObject({
  addresses: z.array(z.strictObject({
    primary_line: z.string().min(1).describe('The primary street address line.'),
    secondary_line: z.string().min(1).describe('The secondary address line, such as an apartment, suite, or unit.').optional(),
    city: z.string().min(1).describe('The city name for the address.').optional(),
    state: z.string().min(1).describe('The US state or region for the address.').optional(),
    zip_code: z.string().min(1).describe('The US ZIP or ZIP+4 code for the address.').optional(),
    recipient: z.string().min(1).describe('The recipient name associated with the address.').optional(),
  }).describe('Input for verifying one US address with Lob.')).min(1).max(100).describe('The US addresses to verify.').optional(),
}).describe('Input for verifying multiple US addresses with Lob.')

export const bulkVerifyUsAddressesOutput = z.strictObject({
  verifications: z.array(z.looseObject({}).describe('A Lob address verification object.')).describe('The Lob US address verification objects.').optional(),
  raw: z.looseObject({}).describe('The raw Lob bulk verification response metadata.').optional(),
}).describe('The normalized Lob bulk US address verification result.')

export const autocompleteUsAddressesInput = z.strictObject({
  address_prefix: z.string().min(1).describe('The beginning of the US address to autocomplete.'),
  city: z.string().min(1).describe('The city name for the address.').optional(),
  state: z.string().min(1).describe('The US state or region for the address.').optional(),
  zip_code: z.string().min(1).describe('The US ZIP or ZIP+4 code for the address.').optional(),
  geo_ip_sort: z.boolean().describe('Whether Lob should sort suggestions based on the request origin\'s IP geolocation.').optional(),
}).describe('Input for retrieving Lob US address autocompletion suggestions.')

export const autocompleteUsAddressesOutput = z.strictObject({
  suggestions: z.array(z.looseObject({}).describe('A Lob US address autocomplete suggestion.')).describe('The Lob US address autocomplete suggestions.').optional(),
  raw: z.looseObject({}).describe('The raw Lob autocomplete response metadata.').optional(),
}).describe('The normalized Lob US address autocomplete result.')

export const verifyInternationalAddressInput = z.strictObject({
  primary_line: z.string().min(1).describe('The primary street address line.'),
  secondary_line: z.string().min(1).describe('The secondary address line, such as an apartment, suite, or unit.').optional(),
  city: z.string().min(1).describe('The city name for the address.').optional(),
  state: z.string().min(1).describe('The US state or region for the address.').optional(),
  postal_code: z.string().min(1).describe('The postal code for an international address.').optional(),
  country: z.string().min(1).describe('The destination country code or country name.'),
  recipient: z.string().min(1).describe('The recipient name associated with the address.').optional(),
}).describe('Input for verifying one international address with Lob.')

export const verifyInternationalAddressOutput = z.strictObject({
  verification: z.looseObject({}).describe('A Lob address verification object.').optional(),
}).describe('The normalized Lob international address verification result.')

export const bulkVerifyInternationalAddressesInput = z.strictObject({
  addresses: z.array(z.strictObject({
    primary_line: z.string().min(1).describe('The primary street address line.'),
    secondary_line: z.string().min(1).describe('The secondary address line, such as an apartment, suite, or unit.').optional(),
    city: z.string().min(1).describe('The city name for the address.').optional(),
    state: z.string().min(1).describe('The US state or region for the address.').optional(),
    postal_code: z.string().min(1).describe('The postal code for an international address.').optional(),
    country: z.string().min(1).describe('The destination country code or country name.'),
    recipient: z.string().min(1).describe('The recipient name associated with the address.').optional(),
  }).describe('Input for verifying one international address with Lob.')).min(1).max(100).describe('The international addresses to verify.').optional(),
}).describe('Input for verifying multiple international addresses with Lob.')

export const bulkVerifyInternationalAddressesOutput = z.strictObject({
  verifications: z.array(z.looseObject({}).describe('A Lob address verification object.')).describe('The Lob international address verification objects.').optional(),
  raw: z.looseObject({}).describe('The raw Lob bulk international verification response metadata.').optional(),
}).describe('The normalized Lob bulk international verification result.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const lobActions = {
  verify_us_address: {
    description: 'Verify and standardize one US address with Lob Address Verification.',
    effect: 'write',
    inputSchema: verifyUsAddressInput,
    outputSchema: z.toJSONSchema(verifyUsAddressOutput, { io: 'output', unrepresentable: 'any' }),
  },
  bulk_verify_us_addresses: {
    description: 'Verify and standardize multiple US addresses with Lob Address Verification.',
    effect: 'write',
    inputSchema: bulkVerifyUsAddressesInput,
    outputSchema: z.toJSONSchema(bulkVerifyUsAddressesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  autocomplete_us_addresses: {
    description: 'Return Lob US address autocomplete suggestions for a partial address.',
    effect: 'write',
    inputSchema: autocompleteUsAddressesInput,
    outputSchema: z.toJSONSchema(autocompleteUsAddressesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  verify_international_address: {
    description: 'Verify and standardize one international address with Lob Address Verification.',
    effect: 'write',
    inputSchema: verifyInternationalAddressInput,
    outputSchema: z.toJSONSchema(verifyInternationalAddressOutput, { io: 'output', unrepresentable: 'any' }),
  },
  bulk_verify_international_addresses: {
    description: 'Verify and standardize multiple international addresses with Lob Address Verification.',
    effect: 'write',
    inputSchema: bulkVerifyInternationalAddressesInput,
    outputSchema: z.toJSONSchema(bulkVerifyInternationalAddressesOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
