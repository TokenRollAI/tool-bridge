import { z } from 'zod/v4'

export const eventBindingSchema = z.strictObject({
  kind: z.literal('topic'), provider: z.string().min(1).max(128),
  export: z.string().min(1).max(128), authRef: z.string().min(1).max(128),
})

/** Portable event source metadata shared by plugin and catalog views. */
export interface PluginEventSource {
  headers: string[]
  types: Array<{ dataSchema: Record<string, unknown>, type: string, version: number }>
}

export const eventSourceSchema = z.strictObject({
  headers: z.array(z.string().max(80).regex(/^x-(?!tb-|forwarded-)[a-z0-9-]+$/)).max(12),
  types: z.array(z.strictObject({
    type: z.string().min(1).max(128),
    version: z.number().int().positive(),
    dataSchema: z.record(z.string(), z.unknown()),
  })).min(1).max(64),
}) satisfies z.ZodType<PluginEventSource>
