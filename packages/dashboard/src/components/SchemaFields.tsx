import {
  type RJSFSchema,
  type UiSchema,
} from '@rjsf/utils'
import { lazy, Suspense } from 'react'

const SchemaFormRenderer = lazy(() => import('@/components/SchemaFormRenderer'))

export interface SchemaField {
  description?: string
  key: string
  label: string
  required?: boolean
  /** 大部分 Dashboard 配置是字符串；只有非字符串或有约束时需声明 schema。 */
  schema?: RJSFSchema
  ui?: UiSchema
}

function project(fields: SchemaField[], input: Record<string, unknown> = {}) {
  return Object.fromEntries(fields.flatMap(({ key }) =>
    Object.hasOwn(input, key) ? [[key, input[key]]] : []))
}

/**
 * Dashboard 的 schema 字段边界。只把 model 声明的 key 交给 RJSF，也只把这些 key
 * 传回业务状态；未知字段、credential 与 authRef 不会因表单展开而渗透。
 */
export function SchemaFields({
  disabled = false,
  fields,
  idPrefix,
  onChange,
  value,
}: {
  disabled?: boolean
  fields: SchemaField[]
  idPrefix: string
  onChange: (next: Record<string, unknown>) => void
  value: Record<string, unknown>
}) {
  const schema: RJSFSchema = {
    additionalProperties: false,
    properties: Object.fromEntries(fields.map(field => [field.key, {
      ...(field.schema ?? { type: 'string' }),
      title: field.label,
      ...(field.description === undefined ? {} : { description: field.description }),
    }])),
    required: fields.filter(field => field.required).map(field => field.key),
    type: 'object',
  }

  return (
    <Suspense fallback={<p className="text-xs text-muted-foreground" role="status">正在加载表单…</p>}>
      <SchemaFormRenderer
        disabled={disabled}
        formData={project(fields, value)}
        idPrefix={idPrefix}
        liveOmit
        noHtml5Validate
        omitExtraData
        onChange={({ formData }) => onChange(project(fields, formData))}
        schema={schema}
        tagName="div"
        uiSchema={Object.fromEntries(fields.map(field => [field.key, field.ui ?? {}]))}
      >
        <></>
      </SchemaFormRenderer>
    </Suspense>
  )
}
