/**
 * Cloudflare DNS 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

// 手写豁免(见 handwritten.json):create_dns_record, update_dns_record

export const listAccountsInput = z.strictObject({
  page: z.int().min(1).describe('The result page number.').optional(),
  perPage: z.int().min(1).describe('The page size.').optional(),
}).describe('The input payload for this action.')

export const listAccountsOutput = z.strictObject({
  accounts: z.array(z.strictObject({
    id: z.string().describe('The Cloudflare account ID.'),
    name: z.string().describe('The Cloudflare account name.').optional(),
    type: z.string().describe('The Cloudflare account type.').optional(),
  }).describe('The Cloudflare account summary.')).describe('The visible Cloudflare accounts.'),
  resultInfo: z.strictObject({
    page: z.int().describe('The current page number.').optional(),
    perPage: z.int().describe('The page size.').optional(),
    count: z.int().describe('The number of items in the current page.').optional(),
    totalCount: z.int().describe('The total number of matching items.').optional(),
    totalPages: z.int().describe('The total number of pages.').optional(),
  }).describe('Cloudflare pagination metadata.').optional(),
}).describe('The output payload for this action.')

export const listZonesInput = z.strictObject({
  page: z.int().min(1).describe('The result page number.').optional(),
  perPage: z.int().min(1).describe('The page size.').optional(),
  name: z.string().describe('Filter zones by exact zone name.').optional(),
  status: z.string().describe('Filter zones by zone status.').optional(),
  accountId: z.string().describe('Filter zones by Cloudflare account ID.').optional(),
  match: z.enum(['all', 'any']).describe('Whether all or any query filters must match.').optional(),
  order: z.string().describe('The field to order by.').optional(),
  direction: z.enum(['asc', 'desc']).describe('The sort direction.').optional(),
}).describe('The input payload for this action.')

export const listZonesOutput = z.strictObject({
  zones: z.array(z.strictObject({
    id: z.string().describe('The zone ID.'),
    name: z.string().describe('The zone name.'),
    status: z.string().describe('The zone status.').optional(),
    type: z.string().describe('The zone type.').optional(),
    paused: z.boolean().describe('Whether the zone is paused.').optional(),
    createdOn: z.string().describe('The zone creation timestamp.').optional(),
    modifiedOn: z.string().describe('The last zone update timestamp.').optional(),
    nameServers: z.array(z.string().min(1)).describe('The assigned name servers.').optional(),
    originalNameServers: z.array(z.string().min(1)).describe('The original name servers reported by Cloudflare.').optional(),
    account: z.strictObject({
      id: z.string().describe('The Cloudflare account ID.').optional(),
      name: z.string().describe('The Cloudflare account name.').optional(),
      type: z.string().describe('The Cloudflare account type.').optional(),
    }).describe('The Cloudflare account linked to a zone.').optional(),
    meta: z.looseObject({}).describe('A free-form object accepted by the Cloudflare API.').optional(),
  }).describe('A Cloudflare zone summary.')).describe('The list of matching zones.'),
  resultInfo: z.strictObject({
    page: z.int().describe('The current page number.').optional(),
    perPage: z.int().describe('The page size.').optional(),
    count: z.int().describe('The number of items in the current page.').optional(),
    totalCount: z.int().describe('The total number of matching items.').optional(),
    totalPages: z.int().describe('The total number of pages.').optional(),
  }).describe('Cloudflare pagination metadata.').optional(),
}).describe('The output payload for this action.')

export const getZoneInput = z.strictObject({
  zoneId: z.string().min(1).describe('The Cloudflare zone ID.'),
}).describe('The input payload for this action.')

export const getZoneOutput = z.strictObject({
  zone: z.strictObject({
    id: z.string().describe('The zone ID.'),
    name: z.string().describe('The zone name.'),
    status: z.string().describe('The zone status.').optional(),
    type: z.string().describe('The zone type.').optional(),
    paused: z.boolean().describe('Whether the zone is paused.').optional(),
    createdOn: z.string().describe('The zone creation timestamp.').optional(),
    modifiedOn: z.string().describe('The last zone update timestamp.').optional(),
    nameServers: z.array(z.string().min(1)).describe('The assigned name servers.').optional(),
    originalNameServers: z.array(z.string().min(1)).describe('The original name servers reported by Cloudflare.').optional(),
    account: z.strictObject({
      id: z.string().describe('The Cloudflare account ID.').optional(),
      name: z.string().describe('The Cloudflare account name.').optional(),
      type: z.string().describe('The Cloudflare account type.').optional(),
    }).describe('The Cloudflare account linked to a zone.').optional(),
    meta: z.looseObject({}).describe('A free-form object accepted by the Cloudflare API.').optional(),
  }).describe('A Cloudflare zone summary.').optional(),
}).describe('The output payload for this action.')

export const listDnsRecordsInput = z.strictObject({
  zoneId: z.string().min(1).describe('The Cloudflare zone ID.'),
  page: z.int().min(1).describe('The result page number.').optional(),
  perPage: z.int().min(1).describe('The page size.').optional(),
  type: z.enum(['A', 'AAAA', 'CAA', 'CERT', 'CNAME', 'DNSKEY', 'DS', 'HTTPS', 'LOC', 'MX', 'NAPTR', 'NS', 'OPENPGPKEY', 'PTR', 'SMIMEA', 'SRV', 'SSHFP', 'SVCB', 'TLSA', 'TXT', 'URI']).describe('The DNS record type.').optional(),
  name: z.string().describe('Filter by record name.').optional(),
  content: z.string().describe('Filter by record content.').optional(),
  proxied: z.boolean().describe('Filter by proxy status.').optional(),
  match: z.enum(['all', 'any']).describe('Whether all or any query filters must match.').optional(),
  order: z.string().describe('The field to order by.').optional(),
  direction: z.enum(['asc', 'desc']).describe('The sort direction.').optional(),
}).describe('The input payload for this action.')

export const listDnsRecordsOutput = z.strictObject({
  records: z.array(z.strictObject({
    id: z.string().describe('The DNS record ID.'),
    zoneId: z.string().describe('The parent zone ID.').optional(),
    zoneName: z.string().describe('The parent zone name.').optional(),
    type: z.string().describe('The DNS record type.'),
    name: z.string().describe('The record name.'),
    content: z.string().describe('The record content.').nullable().optional(),
    ttl: z.int().describe('The DNS TTL in seconds.').optional(),
    proxied: z.boolean().describe('Whether Cloudflare proxying is enabled.').optional(),
    proxiable: z.boolean().describe('Whether the record can be proxied.').optional(),
    priority: z.int().describe('The record priority.').optional(),
    comment: z.string().describe('The record comment.').nullable().optional(),
    tags: z.array(z.string().min(1)).describe('The record tags.').optional(),
    createdOn: z.string().describe('The record creation timestamp.').optional(),
    modifiedOn: z.string().describe('The last record update timestamp.').optional(),
    commentModifiedOn: z.string().describe('The comment update timestamp.').optional(),
    tagsModifiedOn: z.string().describe('The tag update timestamp.').optional(),
    data: z.looseObject({}).describe('A free-form object accepted by the Cloudflare API.').optional(),
    meta: z.looseObject({}).describe('A free-form object accepted by the Cloudflare API.').optional(),
    settings: z.looseObject({}).describe('A free-form object accepted by the Cloudflare API.').optional(),
  }).describe('A Cloudflare DNS record.')).describe('The list of DNS records.'),
  resultInfo: z.strictObject({
    page: z.int().describe('The current page number.').optional(),
    perPage: z.int().describe('The page size.').optional(),
    count: z.int().describe('The number of items in the current page.').optional(),
    totalCount: z.int().describe('The total number of matching items.').optional(),
    totalPages: z.int().describe('The total number of pages.').optional(),
  }).describe('Cloudflare pagination metadata.').optional(),
}).describe('The output payload for this action.')

export const getDnsRecordInput = z.strictObject({
  zoneId: z.string().min(1).describe('The Cloudflare zone ID.'),
  dnsRecordId: z.string().min(1).describe('The Cloudflare DNS record ID.'),
}).describe('The input payload for this action.')

export const getDnsRecordOutput = z.strictObject({
  record: z.strictObject({
    id: z.string().describe('The DNS record ID.'),
    zoneId: z.string().describe('The parent zone ID.').optional(),
    zoneName: z.string().describe('The parent zone name.').optional(),
    type: z.string().describe('The DNS record type.'),
    name: z.string().describe('The record name.'),
    content: z.string().describe('The record content.').nullable().optional(),
    ttl: z.int().describe('The DNS TTL in seconds.').optional(),
    proxied: z.boolean().describe('Whether Cloudflare proxying is enabled.').optional(),
    proxiable: z.boolean().describe('Whether the record can be proxied.').optional(),
    priority: z.int().describe('The record priority.').optional(),
    comment: z.string().describe('The record comment.').nullable().optional(),
    tags: z.array(z.string().min(1)).describe('The record tags.').optional(),
    createdOn: z.string().describe('The record creation timestamp.').optional(),
    modifiedOn: z.string().describe('The last record update timestamp.').optional(),
    commentModifiedOn: z.string().describe('The comment update timestamp.').optional(),
    tagsModifiedOn: z.string().describe('The tag update timestamp.').optional(),
    data: z.looseObject({}).describe('A free-form object accepted by the Cloudflare API.').optional(),
    meta: z.looseObject({}).describe('A free-form object accepted by the Cloudflare API.').optional(),
    settings: z.looseObject({}).describe('A free-form object accepted by the Cloudflare API.').optional(),
  }).describe('A Cloudflare DNS record.').optional(),
}).describe('The output payload for this action.')

export const deleteDnsRecordInput = z.strictObject({
  zoneId: z.string().min(1).describe('The Cloudflare zone ID.'),
  dnsRecordId: z.string().min(1).describe('The Cloudflare DNS record ID.'),
}).describe('The input payload for this action.')

export const deleteDnsRecordOutput = z.strictObject({
  id: z.string().describe('The deleted DNS record ID.').optional(),
  deleted: z.boolean().describe('Whether the delete request succeeded.').optional(),
}).describe('The output payload for this action.')

import { createDnsRecordInput, createDnsRecordOutput, updateDnsRecordInput, updateDnsRecordOutput } from './schema.handwritten'

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const cloudflareDnsActions = {
  list_accounts: {
    description: 'List Cloudflare accounts visible to the current credential.',
    effect: 'read',
    inputSchema: listAccountsInput,
    outputSchema: z.toJSONSchema(listAccountsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_zones: {
    description: 'List the Cloudflare zones visible to the current API token.',
    effect: 'read',
    inputSchema: listZonesInput,
    outputSchema: z.toJSONSchema(listZonesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_zone: {
    description: 'Get one Cloudflare zone by zone ID.',
    effect: 'read',
    inputSchema: getZoneInput,
    outputSchema: z.toJSONSchema(getZoneOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_dns_records: {
    description: 'List DNS records inside one Cloudflare zone.',
    effect: 'read',
    inputSchema: listDnsRecordsInput,
    outputSchema: z.toJSONSchema(listDnsRecordsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_dns_record: {
    description: 'Get one DNS record from a Cloudflare zone.',
    effect: 'read',
    inputSchema: getDnsRecordInput,
    outputSchema: z.toJSONSchema(getDnsRecordOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_dns_record: {
    description: 'Create a DNS record inside a Cloudflare zone.',
    effect: 'write',
    inputSchema: createDnsRecordInput,
    outputSchema: z.toJSONSchema(createDnsRecordOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_dns_record: {
    description: 'Patch one DNS record inside a Cloudflare zone.',
    effect: 'write',
    inputSchema: updateDnsRecordInput,
    outputSchema: z.toJSONSchema(updateDnsRecordOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_dns_record: {
    description: 'Delete one DNS record from a Cloudflare zone.',
    effect: 'destructive',
    inputSchema: deleteDnsRecordInput,
    outputSchema: z.toJSONSchema(deleteDnsRecordOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
