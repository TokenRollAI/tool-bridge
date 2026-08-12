/**
 * Brandfetch 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getBrandInput = z.strictObject({
  identifier: z.string().min(1).describe('The identifier to look up, such as a domain, Brand ID, ISIN, or stock ticker.').optional(),
}).describe('The input payload for fetching a Brandfetch brand profile.')

export const getBrandOutput = z.strictObject({
  id: z.string().describe('The Brandfetch brand identifier.').optional(),
  urn: z.string().describe('The Brandfetch URN for the brand profile.').optional(),
  name: z.string().describe('The canonical brand name.').nullable().optional(),
  domain: z.string().describe('The primary brand domain.').optional(),
  claimed: z.boolean().describe('Whether the brand profile is claimed on Brandfetch.').optional(),
  description: z.string().describe('The short brand description.').nullable().optional(),
  longDescription: z.string().describe('The long-form brand description.').nullable().optional(),
  qualityScore: z.number().describe('The Brandfetch quality score for the brand.').optional(),
  isNsfw: z.boolean().describe('Whether the brand profile is flagged as NSFW.').optional(),
  logos: z.array(z.strictObject({
    type: z.string().describe('The logo type, such as `icon` or `logo`.'),
    theme: z.string().describe('The logo theme, such as `dark` or `light`.').optional(),
    formats: z.array(z.strictObject({
      src: z.string().describe('The source URL for the asset format.'),
      format: z.string().describe('The asset file format, such as `svg` or `png`.'),
      width: z.number().describe('The asset width in pixels.').optional(),
      height: z.number().describe('The asset height in pixels.').optional(),
      size: z.number().describe('The asset size in bytes.').optional(),
      background: z.string().describe('The background hint returned for the asset.').optional(),
    }).describe('One asset format returned by Brandfetch.')).describe('The available logo formats.'),
  }).describe('One logo variant returned by Brandfetch.')).describe('The logos returned by Brandfetch.').optional(),
  colors: z.array(z.strictObject({
    hex: z.string().describe('The HEX color value.'),
    type: z.string().describe('The color role returned by Brandfetch.'),
    brightness: z.number().describe('The brightness score returned by Brandfetch.').optional(),
  }).describe('One brand color returned by Brandfetch.')).describe('The brand colors.').optional(),
  fonts: z.array(z.strictObject({
    name: z.string().describe('The font name.').optional(),
    type: z.string().describe('The font usage type, such as `title` or `body`.'),
    origin: z.string().describe('The font origin system.').optional(),
    originId: z.string().describe('The font origin identifier.').optional(),
  }).describe('One font descriptor returned by Brandfetch.')).describe('The brand fonts.').optional(),
  images: z.array(z.strictObject({
    type: z.string().describe('The image type returned by Brandfetch.').optional(),
    formats: z.array(z.strictObject({
      src: z.string().describe('The source URL for the asset format.'),
      format: z.string().describe('The asset file format, such as `svg` or `png`.'),
      width: z.number().describe('The asset width in pixels.').optional(),
      height: z.number().describe('The asset height in pixels.').optional(),
      size: z.number().describe('The asset size in bytes.').optional(),
      background: z.string().describe('The background hint returned for the asset.').optional(),
    }).describe('One asset format returned by Brandfetch.')).describe('The available image formats.').optional(),
  }).describe('One brand image variant returned by Brandfetch.')).describe('The brand images.').optional(),
  links: z.array(z.strictObject({
    name: z.string().describe('The social or link target name.').optional(),
    url: z.string().describe('The linked URL.').optional(),
  }).describe('One external link returned by Brandfetch.')).describe('The external links for the brand.').optional(),
  company: z.record(z.string(), z.unknown().describe('Any company metadata value returned by Brandfetch.')).describe('The company metadata block returned by Brandfetch.').optional(),
}).describe('The normalized Brandfetch brand profile.')

export const getTransactionInfoInput = z.strictObject({
  transactionLabel: z.string().min(1).describe('The raw merchant label from a payment or card statement.').optional(),
  countryCode: z.string().min(2).max(2).describe('The ISO 3166-1 alpha-2 country code for the transaction.').optional(),
}).describe('The input payload for resolving Brandfetch transaction information.')

export const getTransactionInfoOutput = z.strictObject({
  id: z.string().describe('The Brandfetch brand identifier.').optional(),
  urn: z.string().describe('The Brandfetch URN for the brand profile.').optional(),
  name: z.string().describe('The canonical brand name.').nullable().optional(),
  domain: z.string().describe('The primary brand domain.').optional(),
  claimed: z.boolean().describe('Whether the brand profile is claimed on Brandfetch.').optional(),
  description: z.string().describe('The short brand description.').nullable().optional(),
  longDescription: z.string().describe('The long-form brand description.').nullable().optional(),
  qualityScore: z.number().describe('The Brandfetch quality score for the brand.').optional(),
  isNsfw: z.boolean().describe('Whether the brand profile is flagged as NSFW.').optional(),
  logos: z.array(z.strictObject({
    type: z.string().describe('The logo type, such as `icon` or `logo`.'),
    theme: z.string().describe('The logo theme, such as `dark` or `light`.').optional(),
    formats: z.array(z.strictObject({
      src: z.string().describe('The source URL for the asset format.'),
      format: z.string().describe('The asset file format, such as `svg` or `png`.'),
      width: z.number().describe('The asset width in pixels.').optional(),
      height: z.number().describe('The asset height in pixels.').optional(),
      size: z.number().describe('The asset size in bytes.').optional(),
      background: z.string().describe('The background hint returned for the asset.').optional(),
    }).describe('One asset format returned by Brandfetch.')).describe('The available logo formats.'),
  }).describe('One logo variant returned by Brandfetch.')).describe('The logos returned by Brandfetch.').optional(),
  colors: z.array(z.strictObject({
    hex: z.string().describe('The HEX color value.'),
    type: z.string().describe('The color role returned by Brandfetch.'),
    brightness: z.number().describe('The brightness score returned by Brandfetch.').optional(),
  }).describe('One brand color returned by Brandfetch.')).describe('The brand colors.').optional(),
  fonts: z.array(z.strictObject({
    name: z.string().describe('The font name.').optional(),
    type: z.string().describe('The font usage type, such as `title` or `body`.'),
    origin: z.string().describe('The font origin system.').optional(),
    originId: z.string().describe('The font origin identifier.').optional(),
  }).describe('One font descriptor returned by Brandfetch.')).describe('The brand fonts.').optional(),
  images: z.array(z.strictObject({
    type: z.string().describe('The image type returned by Brandfetch.').optional(),
    formats: z.array(z.strictObject({
      src: z.string().describe('The source URL for the asset format.'),
      format: z.string().describe('The asset file format, such as `svg` or `png`.'),
      width: z.number().describe('The asset width in pixels.').optional(),
      height: z.number().describe('The asset height in pixels.').optional(),
      size: z.number().describe('The asset size in bytes.').optional(),
      background: z.string().describe('The background hint returned for the asset.').optional(),
    }).describe('One asset format returned by Brandfetch.')).describe('The available image formats.').optional(),
  }).describe('One brand image variant returned by Brandfetch.')).describe('The brand images.').optional(),
  links: z.array(z.strictObject({
    name: z.string().describe('The social or link target name.').optional(),
    url: z.string().describe('The linked URL.').optional(),
  }).describe('One external link returned by Brandfetch.')).describe('The external links for the brand.').optional(),
  company: z.record(z.string(), z.unknown().describe('Any company metadata value returned by Brandfetch.')).describe('The company metadata block returned by Brandfetch.').optional(),
}).describe('The normalized Brandfetch brand profile.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const brandfetchActions = {
  get_brand: {
    description: 'Fetch a Brandfetch brand profile from a domain, Brand ID, ISIN, or stock ticker identifier.',
    effect: 'read',
    inputSchema: getBrandInput,
    outputSchema: z.toJSONSchema(getBrandOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_transaction_info: {
    description: 'Resolve a raw transaction label into the corresponding Brandfetch merchant brand profile.',
    effect: 'read',
    inputSchema: getTransactionInfoInput,
    outputSchema: z.toJSONSchema(getTransactionInfoOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
