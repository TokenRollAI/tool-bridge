/**
 * IP2Proxy 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const lookupIpInput = z.strictObject({
  ip: z.union([z.ipv4().describe('The IPv4 address to look up.'), z.ipv6().describe('The IPv6 address to look up.')]).describe('The IPv4 or IPv6 address to look up.').optional(),
  package: z.enum(['PX1', 'PX2', 'PX3', 'PX4', 'PX5', 'PX6', 'PX7', 'PX8', 'PX9', 'PX10', 'PX11']).default('PX1').describe('The IP2Proxy package code to query. The official API defaults to PX1 when omitted.').optional(),
}).describe('The input payload for one proxy detection lookup.')

export const lookupIpOutput = z.looseObject({
  response: z.string().min(1).describe('The response status string returned by IP2Proxy.'),
  countryCode: z.string().describe('The two-character ISO 3166 country code.').optional(),
  countryName: z.string().describe('The country name.').optional(),
  regionName: z.string().describe('The region or state name.').optional(),
  cityName: z.string().describe('The city name.').optional(),
  isp: z.string().describe('The ISP or company name.').optional(),
  domain: z.string().describe('The internet domain associated with the IP range.').optional(),
  usageType: z.string().describe('The usage type classification returned by IP2Proxy.').optional(),
  asn: z.string().describe('The autonomous system number.').optional(),
  as: z.string().describe('The autonomous system name.').optional(),
  lastSeen: z.int().describe('How many days ago the proxy was last seen.').optional(),
  proxyType: z.string().describe('The proxy type returned by IP2Proxy.').optional(),
  isProxy: z.string().describe('Whether the IP address is identified as a proxy.').optional(),
  threat: z.string().describe('The security threat classification returned by IP2Proxy.').optional(),
  provider: z.string().describe('The VPN provider name when IP2Proxy has one.').optional(),
  creditsConsumed: z.int().describe('The credit count consumed by the query.').optional(),
}).describe('The proxy detection payload returned by IP2Proxy.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const ip2proxyActions = {
  lookup_ip: {
    description: 'Detect whether one IPv4 or IPv6 address is a proxy and return the official IP2Proxy lookup payload.',
    effect: 'write',
    inputSchema: lookupIpInput,
    outputSchema: z.toJSONSchema(lookupIpOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
