import { z } from 'zod/v4'
import type { CallContext } from './types'
import {
  type EventPublishInput, eventPublishSchema, type EventReadInput, type EventReadResult,
  eventReadResultSchema, eventReadSchema, type EventReceipt, eventReceiptSchema,
} from './protocol/eventWire'
import { HtbpCommandRegistry } from './operation/htbpCommandRegistry'

export * from './protocol/eventWire'

export interface EventTopicBinding {
  authRef: string
  export: string
  generation: string
  provider: string
}

export interface EventRepository {
  acquireWait(keyId: string): Promise<() => Promise<void>>
  /** One snapshot of the authenticated ingress binding. Null for absent or user topics. */
  binding(path: string): Promise<EventTopicBinding | null>
  publish(path: string, actor: Pick<CallContext, 'keyId' | 'owner'>, input: EventPublishInput, expectedBinding?: EventTopicBinding): Promise<EventReceipt>
  read(path: string, input: EventReadInput): Promise<EventReadResult>
  /** A wake is only a hint. Each reader independently queries its durable position. */
  watch(path: string, wake: () => void): () => void
}

interface EventCommandContext {
  publish(input: EventPublishInput): Promise<EventReceipt>
  read(input: EventReadInput): Promise<EventReadResult>
}
export const eventCommands = new HtbpCommandRegistry<EventCommandContext>()
  .register('publish', {
    h: 'Append an event. Idempotency keys retain their first receipt for 24 hours.',
    inputSchema: eventPublishSchema, outputSchema: z.toJSONSchema(eventReceiptSchema),
    returns: 'EventReceipt', scope: 'write', effect: 'write',
  }, (input, ctx) => ctx.publish(input))
  .register('read', {
    h: 'Read after a cursor, or from the current tail when omitted. Stop on a retention or generation gap.',
    inputSchema: eventReadSchema, outputSchema: z.toJSONSchema(eventReadResultSchema),
    returns: 'EventReadResult', scope: 'read', effect: 'read',
  }, (input, ctx) => ctx.read(input))
