export type JsonObject = Record<string, unknown>

export function asJsonObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

export function trimmedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function integerValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

export function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export function compactDefined<T>(input: Record<string, T | undefined>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, T] => entry[1] !== undefined),
  )
}

export function messageFrom(
  value: unknown,
  fields: readonly string[],
  fallback: string,
): string {
  const direct = trimmedText(value)
  if (direct !== undefined) return direct
  const object = asJsonObject(value)
  if (object !== undefined) {
    for (const field of fields) {
      const candidate = trimmedText(object[field])
      if (candidate !== undefined) return candidate
    }
  }
  return fallback
}
