/**
 * Resend 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'
// 手写豁免(见 handwritten.json):send_email
import { sendEmailInput, sendEmailOutput } from './schema.handwritten'

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const resendActions = {
  send_email: {
    description: 'Send an email with Resend.',
    effect: 'write',
    inputSchema: sendEmailInput,
    outputSchema: z.toJSONSchema(sendEmailOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
