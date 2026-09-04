import type { RJSFSchema } from '@rjsf/utils'
import type { SchemaField } from '@/components/SchemaFields'

export function configSchemaFields(schema: Record<string, unknown>): SchemaField[] {
  const properties = schema.properties as Record<string, RJSFSchema> | undefined
  return Object.entries(properties ?? {}).map(([key, property]) => ({
    key,
    label: typeof property.description === 'string' ? property.description : key,
    schema: property,
    required: Array.isArray(schema.required) && schema.required.includes(key),
  }))
}
