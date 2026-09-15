import {
  processSessionListSchema as listSchema,
  processSessionObservationSchema as observationSchema,
  type ProcessSessionList,
  type ProcessSessionObservation,
  type ProcessSessionSummary,
  processSessionSummarySchema as summarySchema,
} from '@tool-bridge/core/device'

/** Consumer validation stays portable without exposing the bundled validator's types. */
export interface ProcessSessionParser<T> {
  parse(value: unknown): T
  safeParse(value: unknown): { data: T, success: true } | { success: false }
}

function parser<T>(schema: { safeParse(value: unknown): { data: T, success: true } | { success: false } }): ProcessSessionParser<T> {
  return {
    parse(value) {
      const result = schema.safeParse(value)
      if (!result.success) throw new Error('invalid device process session response')
      return result.data
    },
    safeParse(value) {
      const result = schema.safeParse(value)
      return result.success ? { success: true, data: result.data } : { success: false }
    },
  }
}

export const processSessionListSchema: ProcessSessionParser<ProcessSessionList> = parser(listSchema)
export const processSessionObservationSchema: ProcessSessionParser<ProcessSessionObservation> = parser(observationSchema)
export const processSessionSummarySchema: ProcessSessionParser<ProcessSessionSummary> = parser(summarySchema)
