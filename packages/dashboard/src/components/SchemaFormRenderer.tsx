import type { ComponentProps } from 'react'
import { replaceStringParameters, TranslatableString } from '@rjsf/utils'
import validator from '@rjsf/validator-ajv8'
import Form from '@rjsf/shadcn'

type Props = Omit<ComponentProps<typeof Form>, 'validator'>
const TRANSLATIONS: Partial<Record<TranslatableString, string>> = {
  [TranslatableString.AddItemButton]: '添加一项', [TranslatableString.RemoveButton]: '删除',
}
const translateString = (key: TranslatableString, params?: string[]) =>
  replaceStringParameters(TRANSLATIONS[key] ?? key, params)

/** Dashboard 唯一的 RJSF/AJV 运行时边界。 */
export default function SchemaFormRenderer({ showErrorList = false, ...props }: Props) {
  return (
    <Form
      translateString={translateString}
      {...props}
      showErrorList={showErrorList}
      validator={validator}
    />
  )
}
