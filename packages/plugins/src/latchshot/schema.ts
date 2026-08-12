/**
 * Latchshot 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const capturePageInput = z.strictObject({
  url: z.url().describe('The public HTTP or HTTPS page URL. Private, loopback, link-local, credential-bearing, and non-web-port targets are rejected.'),
  kind: z.enum(['screenshot', 'pdf']).default('screenshot').describe('The artifact family to render.').optional(),
  format: z.enum(['png', 'jpeg']).default('png').describe('The image format for screenshots. PDF renders always return PDF.').optional(),
  width: z.int().min(320).max(2560).default(1440).describe('The browser viewport width in CSS pixels.').optional(),
  height: z.int().min(240).max(1440).default(900).describe('The browser viewport height in CSS pixels.').optional(),
  scale: z.int().min(1).max(2).default(1).describe('The device scale factor for screenshot output.').optional(),
  fullPage: z.boolean().default(false).describe('Whether a screenshot should include the bounded full document height.').optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).default('domcontentloaded').describe('The browser lifecycle event awaited before the optional delay.').optional(),
  delay: z.int().min(0).max(3000).default(0).describe('Additional wait in milliseconds after the lifecycle event.').optional(),
  timeout: z.int().min(3000).max(30000).default(15000).describe('The browser navigation timeout in milliseconds.').optional(),
  darkMode: z.boolean().default(false).describe('Whether to emulate a dark color-scheme preference.').optional(),
  reducedMotion: z.boolean().default(true).describe('Whether to emulate reduced motion for a more stable capture.').optional(),
  paper: z.enum(['A4', 'Letter', 'Legal']).default('A4').describe('The paper size for PDF rendering.').optional(),
  landscape: z.boolean().default(false).describe('Whether PDF output should use landscape orientation.').optional(),
}).describe('Input parameters for one bounded public-page screenshot or PDF render.')

export const capturePageOutput = z.strictObject({
  file: z.strictObject({
    fileId: z.string().min(1).describe('The local transit file identifier.'),
    downloadUrl: z.url().describe('The local URL used to download the rendered artifact.'),
    sizeBytes: z.int().min(0).describe('The artifact size in bytes.'),
    name: z.string().min(1).describe('The artifact filename.'),
    mimeType: z.enum(['image/png', 'image/jpeg', 'application/pdf']).describe('The artifact MIME type.'),
  }).describe('The rendered artifact stored in local transit storage.'),
  diagnostics: z.strictObject({
    renderMs: z.int().min(0).describe('The server-side render duration in milliseconds.').optional(),
    navigation: z.enum(['complete', 'timed-out']).describe('Whether browser navigation completed before capture.').optional(),
    fonts: z.enum(['original', 'fallback']).describe('Whether the page used its original fonts or a fallback state.').optional(),
    scripts: z.enum(['active', 'paused']).describe('Whether page scripts stayed active or were paused by the fallback path.').optional(),
  }).describe('Bounded render diagnostics returned in Latchshot response headers.').optional(),
  quota: z.strictObject({
    limit: z.int().min(0).describe('The successful-render allowance for the current UTC calendar month.').optional(),
    remaining: z.int().min(0).describe('The successful renders remaining in the current month.').optional(),
    resetAt: z.iso.datetime({ offset: true }).describe('The start of the next UTC calendar month.').optional(),
  }).describe('The successful-render quota snapshot returned with the artifact.').optional(),
}).describe('A rendered artifact in local transit storage with render and quota diagnostics.')

export const getUsageInput = z.strictObject({}).describe('No input is required to read usage for the configured API key.')

export const getUsageOutput = z.strictObject({
  customer: z.strictObject({
    name: z.string().min(1).describe('The display name attached to the API key.'),
    plan: z.string().min(1).describe('The current Latchshot plan identifier. Known values are trial, launch, build, and scale; newer tiers are passed through unchanged.'),
  }).describe('The display identity attached to the API key.'),
  usage: z.strictObject({
    period: z.string().regex(new RegExp('^[0-9]{4}-[0-9]{2}$')).describe('The current UTC calendar month.'),
    plan: z.string().min(1).describe('The current Latchshot plan identifier. Known values are trial, launch, build, and scale; newer tiers are passed through unchanged.'),
    limit: z.int().min(0).describe('The successful-render allowance for the current month.'),
    remaining: z.int().min(0).describe('The successful renders remaining in the current month.'),
    resetAt: z.iso.datetime({ offset: true }).describe('The start of the next UTC calendar month.'),
    successful: z.int().min(0).describe('The successful renders completed in the current month.'),
    failed: z.int().min(0).describe('The failed reserved renders, which do not consume successful-render quota.'),
    reserved: z.int().min(0).describe('The render slots currently reserved for in-flight work.'),
    outputBytes: z.int().min(0).describe('The total successful output bytes in the current month.'),
    renderMs: z.int().min(0).describe('The aggregate successful render duration in the current month.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('The last usage update time, or null before the first render.').nullable(),
  }).describe('Current successful-render usage for the UTC calendar month.'),
  upgradeRequest: z.strictObject({
    id: z.int().min(1).describe('The request identifier.'),
    keyId: z.int().min(1).describe('The API key record identifier.'),
    requestedPlan: z.string().min(1).describe('The requested paid plan. Known values are launch, build, and scale; newer tiers are passed through unchanged.'),
    note: z.string().describe('The optional request note.').nullable(),
    status: z.string().min(1).describe('The request review status. Known values are new, contacted, fulfilled, and declined; newer statuses are passed through unchanged.'),
    createdAt: z.iso.datetime({ offset: true }).describe('When the request was created.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('When the request was last updated.'),
  }).describe('The latest paid-plan request attached to the key.').nullable(),
  links: z.strictObject({
    plans: z.url().describe('The public Latchshot plan comparison.'),
    requestPaidPlan: z.url().describe('The human paid-plan request form.'),
    requestPaidPlanDocs: z.url().describe('The authenticated paid-plan request API documentation.'),
  }).describe('Owner-managed paid-plan continuation links.'),
}).describe('The current Latchshot plan and quota snapshot.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const latchshotActions = {
  capture_page: {
    description: 'Render a public web page as a PNG, JPEG, or PDF and store the bounded artifact in local transit storage.',
    effect: 'write',
    inputSchema: capturePageInput,
    outputSchema: z.toJSONSchema(capturePageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_usage: {
    description: 'Read the current Latchshot plan, successful-render quota, reset time, upgrade-request status, and owner-managed paid-plan links. This action never initiates payment or an upgrade.',
    effect: 'read',
    inputSchema: getUsageInput,
    outputSchema: z.toJSONSchema(getUsageOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
