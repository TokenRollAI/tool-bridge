/**
 * Resend `send_email` 的手写 schema。
 *
 * 为什么不走生成:上游用 `anyOf: [{required:['html']},{required:['text']}]` 表达"HTML 正文与
 * 纯文本正文至少给一个",这个组合约束与 `type`/`properties` 同级共存。Zod 侧只能写成
 * `.refine()`,而 refine **无法反推进 JSON Schema** —— 自动生成的话等价闸门判不了它,
 * 契约会悄悄变宽。codegen 在这种形状上硬失败,把它交到这里(见 handwritten.json)。
 *
 * 代价是 `~help` 里露出的 JSON Schema 不含这条二选一约束(JSON Schema 能表达,Zod 的
 * 反推不能)。故 description 里写清楚,让 agent 读得到;运行期由 refine 真正拦住。
 */

import { z } from 'zod/v4'

export const sendEmailInput = z.strictObject({
  from: z.string().min(1).describe('The sender email address.'),
  to: z.string().min(1).describe('The recipient email address.'),
  subject: z.string().min(1).describe('The email subject line.'),
  html: z.string().describe('The HTML body of the email. Provide at least one of html or text.').optional(),
  text: z.string().describe('The plain text body of the email. Provide at least one of html or text.').optional(),
}).refine(
  input => input.html !== undefined || input.text !== undefined,
  { message: 'at least one of html or text is required', path: ['html'] },
).describe('The input payload for sending a Resend email.')

export const sendEmailOutput = z.strictObject({
  emailId: z.string().describe('The unique identifier of the sent email.').optional(),
}).describe('The output payload for this action.')
