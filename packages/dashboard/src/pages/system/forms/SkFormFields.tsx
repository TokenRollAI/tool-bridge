import { type SchemaField, SchemaFields } from '@/components/SchemaFields'
import { FormSection } from '@/components/FormSection'
import { ACTIONS } from '@/lib/types'
import type { ScopeRow, SkFormState } from './skConfig'

const IDENTITY_FIELDS: SchemaField[] = [
  {
    key: 'owner',
    label: 'owner',
    required: true,
    description: '建议：user:alice / agent:bot / device:host',
    ui: {
      'ui:autocomplete': 'off',
      'ui:classNames': 'font-mono',
      'ui:placeholder': 'agent:researcher',
    },
  },
  {
    key: 'description',
    label: '用途说明',
    description: '用于列表识别和后续权限审计。',
    ui: { 'ui:placeholder': '只读知识库检索' },
  },
]

const PERMISSION_FIELDS: SchemaField[] = [
  {
    key: 'scopes',
    label: 'scope 规则',
    required: true,
    schema: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        default: { pattern: '', actions: ['read'], effect: 'allow' },
        properties: {
          pattern: { type: 'string', title: 'path pattern' },
          actions: {
            type: 'array',
            title: 'actions',
            minItems: 1,
            uniqueItems: true,
            items: { type: 'string', enum: [...ACTIONS] },
          },
          effect: {
            type: 'string',
            title: 'effect',
            oneOf: [
              { const: 'allow', title: 'allow' },
              { const: 'deny', title: 'deny（优先于 allow）' },
            ],
          },
        },
        required: ['pattern', 'actions', 'effect'],
      },
    },
    ui: {
      'ui:options': { orderable: false },
      'items': {
        'ui:options': { label: false },
        'pattern': { 'ui:classNames': 'font-mono', 'ui:placeholder': 'docs/**' },
        'actions': { 'ui:widget': 'checkboxes', 'ui:options': { inline: true } },
        'effect': {
          'ui:widget': 'radio',
          'ui:options': { inline: true, optionValueFormat: 'realValue' },
        },
      },
    },
  },
  {
    key: 'registerPaths',
    label: 'registerPaths（高级，可空）',
    description: '每行一条；只约束反向注册路径，不会自动授予 register action。',
    ui: {
      'ui:classNames': 'font-mono',
      'ui:placeholder': 'device/build-01/**\ndevice/build-02/**',
      'ui:widget': 'textarea',
      'ui:options': { rows: 3 },
    },
  },
]

const LIFECYCLE_FIELDS: SchemaField[] = [
  {
    key: 'expiresAt',
    label: '过期时间（可空）',
    ui: { 'ui:widget': 'datetime' },
  },
]

function scopeRows(value: unknown, fallback: ScopeRow[]): ScopeRow[] {
  if (!Array.isArray(value)) return fallback
  return value.map((item): ScopeRow => {
    const row = item as Partial<ScopeRow>
    return {
      pattern: typeof row.pattern === 'string' ? row.pattern : '',
      actions: Array.isArray(row.actions)
        ? row.actions.filter(action => ACTIONS.includes(action))
        : [],
      effect: row.effect === 'deny' ? 'deny' : 'allow',
    }
  })
}

export function SkFormFields({
  disabled,
  onChange,
  state,
}: {
  disabled: boolean
  onChange: (next: SkFormState) => void
  state: SkFormState
}) {
  return (
    <>
      <FormSection
        description="明确谁在使用这把钥匙，以及它承担的具体任务。"
        index="01"
        title="身份"
      >
        <SchemaFields
          disabled={disabled}
          fields={IDENTITY_FIELDS}
          idPrefix="sk-identity"
          onChange={next => onChange({
            ...state,
            owner: typeof next.owner === 'string' ? next.owner : '',
            description: typeof next.description === 'string' ? next.description : '',
          })}
          value={{ owner: state.owner, description: state.description }}
        />
      </FormSection>

      <FormSection
        description="每条规则由路径、动作和 allow / deny 共同构成。"
        index="02"
        title="权限"
      >
        <SchemaFields
          disabled={disabled}
          fields={PERMISSION_FIELDS}
          idPrefix="sk-permission"
          onChange={next => onChange({
            ...state,
            scopes: scopeRows(next.scopes, state.scopes),
            registerPaths: typeof next.registerPaths === 'string' ? next.registerPaths : '',
          })}
          value={{ scopes: state.scopes, registerPaths: state.registerPaths }}
        />
      </FormSection>

      <FormSection
        description="不填表示永久有效；短期自动化任务建议显式设置到期时间。"
        index="03"
        title="生命周期"
      >
        <SchemaFields
          disabled={disabled}
          fields={LIFECYCLE_FIELDS}
          idPrefix="sk-lifecycle"
          onChange={next => onChange({
            ...state,
            expiresAt: typeof next.expiresAt === 'string' ? next.expiresAt : '',
          })}
          value={{ expiresAt: state.expiresAt }}
        />
      </FormSection>
    </>
  )
}
