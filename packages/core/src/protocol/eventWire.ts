import { z } from 'zod/v4'

export const EVENT_MAX_WAIT_MS = 30_000
export const EVENT_MAX_BYTES = 16_384
const type = z.string().min(1).max(128)
const cursor = z.string().min(1).max(2048)
const schemaVersion = z.number().int().min(1).max(2_147_483_647)
const subject = z.string().min(1).max(512).optional()
export const eventPublishSchema = z.strictObject({
  type, schemaVersion: schemaVersion.optional(), subject, data: z.json(),
  idempotencyKey: z.string().min(1).max(256).optional(),
})
export const eventReadSchema = z.strictObject({
  after: cursor.optional(), type: type.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  waitMs: z.number().int().min(0).max(EVENT_MAX_WAIT_MS).optional(),
})
export const eventReceiptSchema = z.object({ id: z.uuid(), cursor })
export const eventEnvelopeSchema = eventReceiptSchema.extend({
  type, schemaVersion, source: z.string(), recordedAt: z.iso.datetime(), subject, data: z.json(),
})
export const eventReadResultSchema = z.object({
  events: z.array(eventEnvelopeSchema), nextCursor: cursor, timedOut: z.boolean(),
  gap: z.object({ reason: z.enum(['retention', 'generation']), earliestCursor: cursor }).optional(),
})

/** Portable public types; SDK declaration consumers do not need the validator package. */
type EventData = string | number | boolean | null | EventData[] | { [key: string]: EventData }
export interface EventPublishInput {
  data: EventData
  idempotencyKey?: string
  schemaVersion?: number
  subject?: string
  type: string
}
export interface EventReadInput {
  after?: string
  limit?: number
  type?: string
  waitMs?: number
}
export interface EventReceipt {
  cursor: string
  id: string
}
export interface EventEnvelope extends EventReceipt {
  data: EventData
  recordedAt: string
  schemaVersion: number
  source: string
  subject?: string
  type: string
}
export interface EventReadResult {
  events: EventEnvelope[]
  gap?: { earliestCursor: string, reason: 'generation' | 'retention' }
  nextCursor: string
  timedOut: boolean
}
