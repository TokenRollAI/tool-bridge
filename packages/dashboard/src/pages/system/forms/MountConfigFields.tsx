import type { PluginMountConfigField } from '@/lib/types'
import { type SchemaField, SchemaFields } from '@/components/SchemaFields'

function mountFieldModel(fields: PluginMountConfigField[]): SchemaField[] {
  return fields.map(field => ({
    key: field.key,
    label: field.label === undefined ? field.key : `${field.key} — ${field.label}`,
    required: field.required,
    description: field.description,
    ui: { 'ui:classNames': 'font-mono' },
  }))
}

/** catalog/plugin descriptor 声明的非密钥 providerConfig 字段。 */
export function MountConfigFields({ disabled, fields, idPrefix, onChange, value }: {
  disabled?: boolean
  fields: PluginMountConfigField[]
  idPrefix: string
  onChange: (next: Record<string, string>) => void
  value: Record<string, string>
}) {
  return (
    <SchemaFields
      disabled={disabled}
      fields={mountFieldModel(fields)}
      idPrefix={idPrefix}
      onChange={next => onChange(next as Record<string, string>)}
      value={value}
    />
  )
}
