import { z } from 'zod'
import { TB_ERROR_CODES, type TBErrorBody, type TBErrorCode } from '../errors'

/** TBError 的最小 wire 契约；供固定控制面与 device 帧共同复用。 */
export const tbErrorCodeSchema: z.ZodType<TBErrorCode> = z.enum(TB_ERROR_CODES)
export type WireTBErrorCode = TBErrorCode

export const tbErrorBodySchema: z.ZodType<TBErrorBody> = z.object({
  code: tbErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
})
export type WireTBErrorBody = TBErrorBody
