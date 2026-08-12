/**
 * Alt Text Generator AI 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const generateAltTextInput = z.strictObject({
  imageUrl: z.url().describe('The publicly reachable HTTP or HTTPS URL of the image to describe.').optional(),
}).describe('Input for generating alt text from a public image URL.')

export const generateAltTextOutput = z.strictObject({
  altText: z.string().min(1).describe('The alt text generated for the image.').optional(),
}).describe('Generated alt text for the image.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const altTextGeneratorAiActions = {
  generate_alt_text: {
    description: 'Generate concise, accessibility-friendly alt text for a publicly reachable image URL.',
    effect: 'read',
    inputSchema: generateAltTextInput,
    outputSchema: z.toJSONSchema(generateAltTextOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
