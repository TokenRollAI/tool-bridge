/**
 * screenshot.fyi 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const takeScreenshotInput = z.strictObject({
  url: z.url().describe('The complete website URL to capture, including the protocol.'),
  width: z.int().min(1).describe('The viewport width in pixels.').optional(),
  height: z.int().min(1).describe('The viewport height in pixels.').optional(),
  fullPage: z.boolean().describe('Whether to capture the full scrollable page instead of only the viewport.').optional(),
  darkMode: z.boolean().describe('Whether to render the target page with dark mode enabled.').optional(),
  disableCookieBanners: z.boolean().describe('Whether screenshot.fyi should hide cookie banners before capture.').optional(),
}).describe('The input payload for capturing a website screenshot with screenshot.fyi.')

export const takeScreenshotOutput = z.strictObject({
  url: z.url().describe('The generated screenshot URL returned by screenshot.fyi.').optional(),
}).describe('The output payload for a screenshot.fyi screenshot capture.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const screenshotFyiActions = {
  take_screenshot: {
    description: 'Capture a website screenshot with screenshot.fyi and return the generated URL.',
    effect: 'write',
    inputSchema: takeScreenshotInput,
    outputSchema: z.toJSONSchema(takeScreenshotOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
