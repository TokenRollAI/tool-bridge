/**
 * Statamic 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listSitesInput = z.strictObject({}).describe('The input payload for listing Statamic sites.')

export const listSitesOutput = z.strictObject({
  sites: z.array(z.strictObject({
    name: z.string().describe('The site name returned by Statamic.').optional(),
    key: z.string().describe('The site key returned by Statamic.').optional(),
    domains: z.array(z.string().describe('One licensed domain.')).describe('The licensed domains returned by Statamic.').optional(),
    createdAt: z.string().describe('The site creation timestamp returned by Statamic.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw site object returned by Statamic.').optional(),
  }).describe('A normalized Statamic site.')).describe('The Statamic sites returned by the API.').optional(),
}).describe('The response returned when listing Statamic sites.')

export const createSiteInput = z.strictObject({
  name: z.string().min(1).describe('The display name of the Statamic site.'),
  domain: z.string().min(1).describe('A domain to license for the Statamic site.').optional(),
  domains: z.array(z.string().min(1).describe('A domain to license for the Statamic site.')).min(1).describe('The domains to license for the Statamic site. The first domain is treated as production.').optional(),
}).describe('The input payload for creating a Statamic site. Provide either domain or domains, not both.')

export const createSiteOutput = z.strictObject({
  site: z.strictObject({
    name: z.string().describe('The site name returned by Statamic.').optional(),
    key: z.string().describe('The site key returned by Statamic.').optional(),
    domains: z.array(z.string().describe('One licensed domain.')).describe('The licensed domains returned by Statamic.').optional(),
    createdAt: z.string().describe('The site creation timestamp returned by Statamic.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw site object returned by Statamic.').optional(),
  }).describe('A normalized Statamic site.').optional(),
}).describe('The response returned with a Statamic site.')

export const updateSiteInput = z.strictObject({
  key: z.string().min(1).describe('The Statamic site key.'),
  name: z.string().min(1).describe('The display name of the Statamic site.').optional(),
  domain: z.string().min(1).describe('A domain to license for the Statamic site.').optional(),
  domains: z.array(z.string().min(1).describe('A domain to license for the Statamic site.')).min(1).describe('The domains to license for the Statamic site. The first domain is treated as production.').optional(),
}).describe('The input payload for updating a Statamic site. Provide at least one of name, domain, or domains; provide either domain or domains, not both.')

export const updateSiteOutput = z.strictObject({
  site: z.strictObject({
    name: z.string().describe('The site name returned by Statamic.').optional(),
    key: z.string().describe('The site key returned by Statamic.').optional(),
    domains: z.array(z.string().describe('One licensed domain.')).describe('The licensed domains returned by Statamic.').optional(),
    createdAt: z.string().describe('The site creation timestamp returned by Statamic.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw site object returned by Statamic.').optional(),
  }).describe('A normalized Statamic site.').optional(),
}).describe('The response returned with a Statamic site.')

export const deleteSiteInput = z.strictObject({
  key: z.string().min(1).describe('The Statamic site key.').optional(),
}).describe('The input payload for deleting a Statamic site.')

export const deleteSiteOutput = z.strictObject({
  message: z.string().describe('The deletion message returned by Statamic.').optional(),
}).describe('The response returned when deleting a Statamic site.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const statamicActions = {
  list_sites: {
    description: 'List Statamic sites available in the authenticated statamic.com account.',
    effect: 'read',
    inputSchema: listSitesInput,
    outputSchema: z.toJSONSchema(listSitesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_site: {
    description: 'Create a Statamic site license with an optional domain or domains.',
    effect: 'write',
    inputSchema: createSiteInput,
    outputSchema: z.toJSONSchema(createSiteOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_site: {
    description: 'Update a Statamic site name or replace its licensed domain list.',
    effect: 'write',
    inputSchema: updateSiteInput,
    outputSchema: z.toJSONSchema(updateSiteOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_site: {
    description: 'Delete a Statamic site by site key.',
    effect: 'destructive',
    inputSchema: deleteSiteInput,
    outputSchema: z.toJSONSchema(deleteSiteOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
