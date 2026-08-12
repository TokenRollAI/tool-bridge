/**
 * Figma `update_dev_resources` 的手写 schema。
 *
 * 为什么不走生成:上游在**数组元素**上挂了 `anyOf: [{required:['name']},{required:['url']}]`
 * (见 open-connector `providers/figma/actions.ts` 的 `devResourceUpdateSchema`),表达
 * "每条 dev resource 至少改 name 或 url 之一",与元素的 `type`/`properties`/`required` 同级共存。
 * Zod 侧只能写成 `.refine()`,而 refine **无法反推进 JSON Schema** —— 自动生成的话等价闸门
 * 判不了它,契约会悄悄变宽。codegen 在这种形状上硬失败,把它交到这里(见 handwritten.json)。
 *
 * 约束落在**元素**上而不是整个数组:一次调用可以更新多条,每条各自都得至少带一个可改字段。
 * 只带 `id` 的那条会让上游白跑一趟(PATCH 语义下什么都不改),故本地就拦。
 *
 * 代价同 resend:`~help` 里露出的 JSON Schema 不含这条二选一约束(JSON Schema 能表达,
 * Zod 的反推不能)。故在 description 里写清楚让 agent 读得到;运行期由 refine 真正拦住。
 */

import { z } from 'zod/v4'

/** 上游 `rawObjectSchema`:透传的 Figma JSON 对象。 */
const rawObject = z.record(z.string(), z.unknown().describe('A raw Figma API value.'))
  .describe('The raw JSON object returned by the Figma API.')

/** 上游 `rawArraySchema`:透传的 Figma JSON 数组。 */
const rawArray = z.array(rawObject).describe('The raw JSON array returned by the Figma API.')

export const updateDevResourcesInput = z.strictObject({
  devResources: z.array(
    z.strictObject({
      id: z.string().min(1).describe('The unique Figma dev resource ID.'),
      name: z.string().min(1).describe('The new display name for the dev resource.').optional(),
      url: z.url().describe('The new URL for the dev resource.').optional(),
    }).refine(
      resource => resource.name !== undefined || resource.url !== undefined,
      { message: 'at least one of name or url is required', path: ['name'] },
    ).describe('A Figma dev resource update. Include at least one of name or url.'),
  ).min(1).describe('The dev resources to update.'),
}).describe('Input parameters for updating Figma dev resources.')

export const updateDevResourcesOutput = z.strictObject({
  linksCreated: rawArray,
  linksUpdated: rawArray,
  errors: rawArray,
  raw: rawObject,
}).describe('The result of creating or updating Figma dev resources.')
