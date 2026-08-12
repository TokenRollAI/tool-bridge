/**
 * 飞书自定义机器人 `send_post_message` 的手写 schema。
 *
 * 为什么不走生成:上游在 `post` 上用 `anyOf: [{required:['zh_cn']},{required:['en_us']}]`
 * 表达"中英文语言块至少给一个",这个组合约束与 `type`/`properties` 同级共存。Zod 侧只能写
 * `.refine()`,而 refine **无法反推进 JSON Schema** —— 自动生成的话等价闸门判不了它,契约会
 * 悄悄变宽。codegen 在这种形状上硬失败,把它交到这里(见 handwritten.json)。
 *
 * 代价是 `~help` 里露出的 JSON Schema 不含这条二选一约束(JSON Schema 能表达、Zod 的反推
 * 不能)。故在 description 里写清楚,让 agent 读得到;运行期由 refine 真正拦住。
 */

import { z } from 'zod/v4'

/** 富文本标签对象:飞书的 tag 种类很多(text/a/at/img/media…),不在此穷举。 */
const richTextTag = z.looseObject({}).describe('One Feishu rich-text tag object.')

const languageBlock = z.looseObject({
  title: z.string().describe('The rich-text title.').optional(),
  content: z.array(
    z.array(richTextTag).min(1).describe('One paragraph of Feishu rich-text tag objects.'),
  ).min(1).describe('The rich-text paragraphs grouped by line.'),
}).describe('One language block inside the Feishu post payload.')

export const sendPostMessageInput = z.strictObject({
  post: z.looseObject({
    zh_cn: languageBlock.optional(),
    en_us: languageBlock.optional(),
  })
    .refine(
      value => value.zh_cn !== undefined || value.en_us !== undefined,
      { message: 'post 需要 zh_cn 与 en_us 至少一个语言块', path: ['zh_cn'] },
    )
    .describe('The Feishu post payload. Provide at least one of zh_cn or en_us.'),
}).describe('Send a Feishu rich-text (post) message through a custom bot webhook.')

export const sendPostMessageOutput = z.looseObject({
  code: z.int().describe('The Feishu response code. 0 means success.').optional(),
  msg: z.string().describe('The Feishu response message.').optional(),
  data: z.looseObject({}).describe('A raw Feishu object payload.').optional(),
}).describe('The Feishu custom bot webhook response.')
