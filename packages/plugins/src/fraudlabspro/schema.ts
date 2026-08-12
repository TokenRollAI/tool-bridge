/**
 * FraudLabs Pro 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const screenOrderInput = z.strictObject({
  ip: z.string().min(1).describe('The customer IP address for the transaction.'),
  userOrderId: z.string().min(1).describe('The merchant order id for the transaction.').optional(),
  email: z.string().min(1).describe('The customer email address.').optional(),
  amount: z.number().describe('The transaction amount.').optional(),
  currency: z.string().min(1).describe('The ISO 4217 currency code for the transaction.').optional(),
  paymentMode: z.string().min(1).describe('The payment method or mode used by the customer.').optional(),
  firstName: z.string().min(1).describe('The customer first name.').optional(),
  lastName: z.string().min(1).describe('The customer last name.').optional(),
  userPhone: z.string().min(1).describe('The customer phone number.').optional(),
  emailHash: z.string().min(1).describe('The hashed customer email value accepted by FraudLabs Pro.').optional(),
  emailDomain: z.string().min(1).describe('The customer email domain.').optional(),
  binNo: z.string().min(1).describe('The payment card BIN or IIN value.').optional(),
  quantity: z.int().min(1).describe('The number of items in the order.').optional(),
  couponCode: z.string().min(1).describe('The coupon code used for the order.').optional(),
  flpChecksum: z.string().min(1).describe('The FraudLabs Pro checksum value for the transaction.').optional(),
}).describe('Input parameters for screening an order transaction with FraudLabs Pro.')

export const screenOrderOutput = z.looseObject({
  fraudlabspro_id: z.string().describe('The FraudLabs Pro transaction id generated for the screened order.').nullable(),
  fraudlabspro_score: z.number().describe('The fraud score returned by FraudLabs Pro.').nullable(),
  fraudlabspro_status: z.enum(['APPROVE', 'REJECT', 'REVIEW']).describe('The final action returned by FraudLabs Pro.').nullable(),
  user_order_id: z.string().describe('The merchant order id returned by FraudLabs Pro.').nullable(),
}).describe('FraudLabs Pro order screening response.')

export const getOrderResultInput = z.strictObject({
  id: z.string().min(1).describe('The FraudLabs Pro transaction id returned by the Screen Order API.'),
}).describe('Input parameters for retrieving a FraudLabs Pro order result.')

export const getOrderResultOutput = z.looseObject({
  fraudlabspro_id: z.string().describe('The FraudLabs Pro transaction id.').nullable(),
  fraudlabspro_score: z.number().describe('The fraud score returned by FraudLabs Pro.').nullable(),
  fraudlabspro_status: z.enum(['APPROVE', 'REJECT', 'REVIEW']).describe('The final action returned by FraudLabs Pro.').nullable(),
  fraudlabspro_rules: z.array(z.looseObject({}).describe('A triggered FraudLabs Pro rule.')).describe('The FraudLabs Pro rules triggered by the system.').nullable(),
}).describe('FraudLabs Pro order result response.')

export const feedbackOrderInput = z.strictObject({
  id: z.string().min(1).describe('The FraudLabs Pro transaction id returned by the Screen Order API.'),
  action: z.enum(['APPROVE', 'REJECT', 'REJECT_BLACKLIST']).describe('The feedback action to apply to the transaction.'),
  note: z.string().min(1).describe('Optional merchant note explaining the feedback decision.').optional(),
}).describe('Input parameters for sending merchant feedback to FraudLabs Pro.')

export const feedbackOrderOutput = z.looseObject({
  status: z.string().describe('The feedback status returned by FraudLabs Pro.').optional(),
  message: z.string().describe('The feedback message returned by FraudLabs Pro.').optional(),
  error: z.string().describe('The error message returned by FraudLabs Pro when present.').optional(),
}).describe('FraudLabs Pro feedback response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const fraudlabsproActions = {
  screen_order: {
    description: 'Screen an order transaction for fraud risk with FraudLabs Pro.',
    effect: 'write',
    inputSchema: screenOrderInput,
    outputSchema: z.toJSONSchema(screenOrderOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_order_result: {
    description: 'Retrieve a FraudLabs Pro order screening result by transaction id.',
    effect: 'read',
    inputSchema: getOrderResultInput,
    outputSchema: z.toJSONSchema(getOrderResultOutput, { io: 'output', unrepresentable: 'any' }),
  },
  feedback_order: {
    description: 'Send approve or reject feedback for a FraudLabs Pro order transaction.',
    effect: 'write',
    inputSchema: feedbackOrderInput,
    outputSchema: z.toJSONSchema(feedbackOrderOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
