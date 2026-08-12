/**
 * Feishu Custom Bot 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

// 手写豁免(见 handwritten.json):send_post_message

export const sendTextMessageInput = z.strictObject({
  text: z.string().min(1).describe('The text message content. You can include Feishu <at ...> tags inline.'),
}).describe('Input for sending a Feishu text message.')

export const sendTextMessageOutput = z.strictObject({
  code: z.int().describe('The Feishu response code. 0 means success.'),
  msg: z.string().describe('The Feishu response message.'),
  data: z.looseObject({}).describe('A raw Feishu object payload.'),
  statusCode: z.int().describe('The legacy response code returned for backward compatibility.').optional(),
  statusMessage: z.string().describe('The legacy response message returned for backward compatibility.').optional(),
}).describe('The normalized Feishu custom bot send result.')

export const sendImageMessageInput = z.strictObject({
  imageKey: z.string().min(1).describe('The Feishu image_key obtained from the image upload API.'),
}).describe('Input for sending a Feishu image message.')

export const sendImageMessageOutput = z.strictObject({
  code: z.int().describe('The Feishu response code. 0 means success.'),
  msg: z.string().describe('The Feishu response message.'),
  data: z.looseObject({}).describe('A raw Feishu object payload.'),
  statusCode: z.int().describe('The legacy response code returned for backward compatibility.').optional(),
  statusMessage: z.string().describe('The legacy response message returned for backward compatibility.').optional(),
}).describe('The normalized Feishu custom bot send result.')

export const sendShareChatMessageInput = z.strictObject({
  shareChatId: z.string().min(1).describe('The Feishu chat ID used in the share_chat message payload.'),
}).describe('Input for sending a Feishu shared-chat message.')

export const sendShareChatMessageOutput = z.strictObject({
  code: z.int().describe('The Feishu response code. 0 means success.'),
  msg: z.string().describe('The Feishu response message.'),
  data: z.looseObject({}).describe('A raw Feishu object payload.'),
  statusCode: z.int().describe('The legacy response code returned for backward compatibility.').optional(),
  statusMessage: z.string().describe('The legacy response message returned for backward compatibility.').optional(),
}).describe('The normalized Feishu custom bot send result.')

export const sendInteractiveMessageInput = z.strictObject({
  card: z.looseObject({}).describe('The Feishu interactive card payload sent as the top-level card object.'),
}).describe('Input for sending a Feishu interactive card message.')

export const sendInteractiveMessageOutput = z.strictObject({
  code: z.int().describe('The Feishu response code. 0 means success.'),
  msg: z.string().describe('The Feishu response message.'),
  data: z.looseObject({}).describe('A raw Feishu object payload.'),
  statusCode: z.int().describe('The legacy response code returned for backward compatibility.').optional(),
  statusMessage: z.string().describe('The legacy response message returned for backward compatibility.').optional(),
}).describe('The normalized Feishu custom bot send result.')

import { sendPostMessageInput, sendPostMessageOutput } from './schema.handwritten'

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const feishuCustomBotActions = {
  send_text_message: {
    description: 'Send a text message through the Feishu/Lark custom bot webhook.',
    effect: 'write',
    inputSchema: sendTextMessageInput,
    outputSchema: z.toJSONSchema(sendTextMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_post_message: {
    description: 'Send a post rich-text message through the Feishu/Lark custom bot webhook.',
    effect: 'write',
    inputSchema: sendPostMessageInput,
    outputSchema: z.toJSONSchema(sendPostMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_image_message: {
    description: 'Send an image message through the Feishu/Lark custom bot webhook.',
    effect: 'write',
    inputSchema: sendImageMessageInput,
    outputSchema: z.toJSONSchema(sendImageMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_share_chat_message: {
    description: 'Send a shared-chat card through the Feishu/Lark custom bot webhook.',
    effect: 'write',
    inputSchema: sendShareChatMessageInput,
    outputSchema: z.toJSONSchema(sendShareChatMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_interactive_message: {
    description: 'Send an interactive card message through the Feishu/Lark custom bot webhook.',
    effect: 'write',
    inputSchema: sendInteractiveMessageInput,
    outputSchema: z.toJSONSchema(sendInteractiveMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
