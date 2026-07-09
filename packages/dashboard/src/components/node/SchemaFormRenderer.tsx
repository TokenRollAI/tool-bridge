import Form from '@rjsf/shadcn'
import type { RJSFSchema } from '@rjsf/utils'
import validator from '@rjsf/validator-ajv8'
import type { ReactNode } from 'react'

/**
 * RJSF 的惰性边界。表单引擎及 AJV 只在用户展开一个可表单化命令时下载；
 * CmdPanel 仍持有 formData 与提交语义，避免动态 chunk 改变现有交互状态。
 */
export default function SchemaFormRenderer({
  schema,
  formData,
  onChange,
  onSubmit,
  children,
}: {
  schema: RJSFSchema
  formData: unknown
  onChange: (formData: unknown) => void
  onSubmit: (formData: unknown) => void
  children: ReactNode
}) {
  return (
    <Form
      schema={schema}
      validator={validator}
      formData={formData}
      onChange={({ formData: next }) => onChange(next)}
      onSubmit={({ formData: next }) => onSubmit(next)}
      showErrorList={false}
    >
      {children}
    </Form>
  )
}
