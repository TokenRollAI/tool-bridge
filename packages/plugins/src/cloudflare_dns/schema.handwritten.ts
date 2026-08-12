/**
 * Cloudflare DNS `create_dns_record` / `update_dns_record` 的手写 schema。
 *
 * 为什么不走生成:上游这两个 action 在 `type`/`properties`/`required` 之外**另挂了一个
 * `anyOf`**(见 open-connector `providers/cloudflare_dns/actions.ts` 末尾对
 * `createDnsRecordInputSchema.anyOf` / `updateDnsRecordInputSchema.anyOf` 的赋值)。
 * Zod 侧只能写成 `.refine()`,而 refine **无法反推进 JSON Schema** —— 自动生成的话等价闸门
 * 判不了它,契约会悄悄变宽。codegen 在这种形状上硬失败,把它交到这里(见 handwritten.json)。
 *
 * 两条约束各自是什么:
 * - create:`anyOf: [{required:['content']},{required:['data']}]` —— 记录内容二选一。
 *   简单记录(A/CNAME/TXT…)用 `content` 给字符串,结构化记录(MX/SRV/CAA…)用 `data` 给对象。
 * - update:`anyOf` 是 10 个可变字段各自的 `{required:[field]}` —— 即"至少改一个字段"。
 *   PATCH 一个空 body 上游会照单全收却什么都不改,白花一次配额。
 *
 * **注意 `handwritten.json` 的 reason 与上游实际不符**:它写的是"用 `oneOf` 按记录类型
 * (A/AAAA/MX/SRV/CAA/…)区分 `data`/`content`/`priority` 的形状"。上游没有这样的按类型判别
 * —— 只有上面这两条与记录类型无关的 `anyOf`。这里按**上游源码**写:做成按 `type` 判别的
 * discriminated union 会把契约收得比上游窄(例如 TXT 记录用 `data` 给结构化内容,上游接受、
 * 判别式版本会拒),那是行为变更而不是迁移。
 *
 * 代价同 resend:`~help` 里露出的 JSON Schema 不含这两条组合约束(JSON Schema 能表达,
 * Zod 的反推不能)。故在 description 里写清楚让 agent 读得到;运行期由 refine 真正拦住。
 */

import { z } from 'zod/v4'

/** 上游 `dnsRecordTypes`,顺序照抄(枚举顺序会进 JSON Schema,换序就是契约 diff)。 */
const dnsRecordType = z.enum([
  'A',
  'AAAA',
  'CAA',
  'CERT',
  'CNAME',
  'DNSKEY',
  'DS',
  'HTTPS',
  'LOC',
  'MX',
  'NAPTR',
  'NS',
  'OPENPGPKEY',
  'PTR',
  'SMIMEA',
  'SRV',
  'SSHFP',
  'SVCB',
  'TLSA',
  'TXT',
  'URI',
]).describe('The DNS record type.')

/** 上游 `dnsRecordMutationFields`:create 与 update 共用的可变字段。 */
const mutationFields = {
  type: dnsRecordType,
  name: z.string().min(1).describe('The DNS record name.'),
  content: z.string().describe('The DNS record content.'),
  data: z.looseObject({}).describe('A free-form object accepted by the Cloudflare API.'),
  ttl: z.int().min(1).describe('The DNS TTL in seconds. Use 1 for automatic TTL.'),
  proxied: z.boolean().describe('Whether Cloudflare proxying should be enabled.'),
  priority: z.int().describe('The DNS record priority.'),
  comment: z.string().describe('The DNS record comment.'),
  tags: z.array(z.string().min(1)).describe('The DNS record tags.'),
  settings: z.looseObject({}).describe('A free-form object accepted by the Cloudflare API.'),
} as const

/** 上游 `dnsRecordSchema`:出参里那条记录。与生成的 `getDnsRecordOutput` 逐字段一致。 */
const dnsRecord = z.strictObject({
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
}).describe('A Cloudflare DNS record.')

export const createDnsRecordInput = z.strictObject({
  zoneId: z.string().min(1).describe('The Cloudflare zone ID.'),
  type: mutationFields.type,
  name: mutationFields.name,
  content: mutationFields.content
    .describe('The DNS record content, for simple record types such as A or CNAME.'
      + ' Provide at least one of content or data.')
    .optional(),
  data: mutationFields.data
    .describe('The structured record payload, for record types such as MX, SRV or CAA.'
      + ' Provide at least one of content or data.')
    .optional(),
  ttl: mutationFields.ttl.optional(),
  proxied: mutationFields.proxied.optional(),
  priority: mutationFields.priority.optional(),
  comment: mutationFields.comment.optional(),
  tags: mutationFields.tags.optional(),
  settings: mutationFields.settings.optional(),
}).refine(
  input => input.content !== undefined || input.data !== undefined,
  { message: 'at least one of content or data is required', path: ['content'] },
).describe('The input payload for this action.')

export const createDnsRecordOutput = z.strictObject({
  record: dnsRecord.optional(),
}).describe('The output payload for this action.')

/** 上游 update 的 `anyOf` 就是这 10 个键各自一条 `{required:[key]}`。 */
const UPDATABLE_FIELDS = Object.keys(mutationFields) as Array<keyof typeof mutationFields>

export const updateDnsRecordInput = z.strictObject({
  zoneId: z.string().min(1).describe('The Cloudflare zone ID.'),
  dnsRecordId: z.string().min(1).describe('The Cloudflare DNS record ID.'),
  type: mutationFields.type.optional(),
  name: mutationFields.name.optional(),
  content: mutationFields.content.optional(),
  data: mutationFields.data.optional(),
  ttl: mutationFields.ttl.optional(),
  proxied: mutationFields.proxied.optional(),
  priority: mutationFields.priority.optional(),
  comment: mutationFields.comment.optional(),
  tags: mutationFields.tags.optional(),
  settings: mutationFields.settings.optional(),
}).refine(
  input => UPDATABLE_FIELDS.some(field => input[field] !== undefined),
  { message: 'at least one DNS record field must be provided', path: ['content'] },
).describe('The input payload for this action. At least one record field must be provided.')

export const updateDnsRecordOutput = z.strictObject({
  record: dnsRecord.optional(),
}).describe('The output payload for this action.')
