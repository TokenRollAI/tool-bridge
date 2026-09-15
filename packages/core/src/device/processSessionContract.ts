import { z } from 'zod/v4'
/** Portable result contract for device-owned process sessions. */
export type ProcessSessionState = 'running' | 'stopping' | 'stopped' | 'exited' | 'timed_out'

export interface ProcessSessionSummary {
  completedAt?: string
  exitCode?: number
  requestId: string
  runtimeId: string
  sessionId: string
  signal?: string
  startedAt: string
  state: ProcessSessionState
}

export interface ProcessSessionList {
  cursor?: string
  items: ProcessSessionSummary[]
  now: string
  runtimeId: string
}

export interface ProcessSessionChunk {
  seq: number
  stream: 'stdout' | 'stderr'
  text: string
}

export interface ProcessSessionObservation extends ProcessSessionSummary {
  chunks: ProcessSessionChunk[]
  droppedBytes: number
  gap: boolean
  nextCursor: number
}

/** Public schemas shared by device metadata, consumer parsers, and contract tests. */
export const processSessionSummarySchema = z.strictObject({
  sessionId: z.string(), runtimeId: z.string(), requestId: z.string(),
  state: z.enum(['running', 'stopping', 'stopped', 'exited', 'timed_out']),
  startedAt: z.iso.datetime(), completedAt: z.iso.datetime().optional(),
  exitCode: z.number().int().optional(), signal: z.string().optional(),
})
export const processSessionListSchema = z.strictObject({
  runtimeId: z.string(), now: z.iso.datetime(), items: z.array(processSessionSummarySchema), cursor: z.string().optional(),
})
export const processSessionObservationSchema = processSessionSummarySchema.extend({
  chunks: z.array(z.strictObject({ seq: z.number().int().nonnegative(), stream: z.enum(['stdout', 'stderr']), text: z.string() })),
  nextCursor: z.number().int().nonnegative(), gap: z.boolean(), droppedBytes: z.number().int().nonnegative(),
})
