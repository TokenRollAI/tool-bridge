import { KeyRound } from 'lucide-react'
import { Link } from 'react-router'
import { type SchemaField, SchemaFields } from '@/components/SchemaFields'
import { FormSection } from '@/components/FormSection'
import type { ManifestFormState } from './pluginManifest'

const ENDPOINT_FIELDS: SchemaField[] = [
  {
    key: 'endpoint',
    label: 'Plugin endpoint',
    required: true,
    ui: {
      'ui:classNames': 'font-mono text-xs',
      'ui:placeholder': 'https://plugin.example.com 或 binding:MY_PLUGIN',
    },
  },
  {
    key: 'healthPath',
    label: 'Health path',
    required: true,
    description: '必须以 / 开头；注册时和手动检查都会请求它。',
    ui: { 'ui:placeholder': '/healthz' },
  },
]

const AUTH_KIND_FIELD: SchemaField = {
  key: 'authKind',
  label: 'Auth mode',
  required: true,
  schema: {
    type: 'string',
    oneOf: [
      { const: 'platform-token', title: 'platform-token — 平台签发' },
      { const: 'bearer', title: 'bearer — 引用已存凭证' },
    ],
  },
  ui: {
    'ui:widget': 'radio',
    'ui:options': { inline: true, optionValueFormat: 'realValue' },
  },
}

const SECRET_REF_FIELD: SchemaField = {
  key: 'secretRef',
  label: 'Secret reference',
  required: true,
  ui: { 'ui:placeholder': 'my-plugin-token' },
}

const ENABLED_FIELD: SchemaField = {
  key: 'enabled',
  label: '注册后启用调用',
  description: '关闭后 manifest 仍保留，但挂载节点调用会返回 unavailable，可随时重新启用。',
  schema: { type: 'boolean' },
}

export function PluginManifestFields({
  state,
  onChange,
  idPrefix,
  disabled = false,
}: {
  disabled?: boolean
  idPrefix: string
  onChange: (next: ManifestFormState) => void
  state: ManifestFormState
}) {
  return (
    <div className="grid gap-3">
      <FormSection
        description="平台访问 Plugin 与健康端点的位置；生产环境使用 HTTPS，或填写平台 service binding。"
        index="01"
        title="Endpoint"
      >
        <SchemaFields
          disabled={disabled}
          fields={ENDPOINT_FIELDS}
          idPrefix={`${idPrefix}-endpoint`}
          onChange={next => onChange({
            ...state,
            endpoint: typeof next.endpoint === 'string' ? next.endpoint : '',
            healthPath: typeof next.healthPath === 'string' ? next.healthPath : '',
          })}
          value={{ endpoint: state.endpoint, healthPath: state.healthPath }}
        />
      </FormSection>

      <FormSection
        description="plugin/v2 的 manifest 不声明能力；平台注册时抓取 ~describe，由 plugin 自报 exports。"
        index="02"
        title="Interface"
      >
        <div className="rounded-md border bg-background/55 px-3 py-2.5">
          <p className="font-mono text-[10px] text-muted-foreground">plugin/v2</p>
          <p className="mt-1.5 text-[10px] leading-5 text-muted-foreground">
            注册时平台会 GET
            {' '}
            <span className="font-mono">~describe</span>
            ，要求 protocolVersion 一致且至少一个 export；每个 export 自报
            <span className="font-mono"> profile </span>
            （tools/v1 或 context/v1）与动词集合。注册成功后回到本页即可看到它们，
            挂载时在「注册表」里选择要挂哪一个 export。
          </p>
        </div>
      </FormSection>

      <FormSection
        description="选择平台签发的一次性 Token，或引用凭证保管中的 bearer secret。"
        index="03"
        title="Authentication"
      >
        <SchemaFields
          disabled={disabled}
          fields={[AUTH_KIND_FIELD, ...(state.authKind === 'bearer' ? [SECRET_REF_FIELD] : [])]}
          idPrefix={`${idPrefix}-auth`}
          onChange={next => onChange({
            ...state,
            authKind: next.authKind === 'bearer' ? 'bearer' : 'platform-token',
            ...(typeof next.secretRef === 'string' ? { secretRef: next.secretRef } : {}),
          })}
          value={{ authKind: state.authKind, secretRef: state.secretRef }}
        />

        {state.authKind === 'bearer'
          ? (
              <p className="text-[10px] leading-5 text-muted-foreground">
                这里只填写
                <Link className="mx-1 text-foreground underline underline-offset-2" to="/manage/secrets">
                  凭证保管
                </Link>
                中的名字，明文不会进入 manifest。
              </p>
            )
          : (
              <div className="flex items-start gap-2.5 rounded-md border border-primary/20 bg-primary/[0.045] px-3 py-2.5">
                <KeyRound className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <p className="text-[10px] leading-5 text-muted-foreground">
                  注册成功，或从 bearer 切换到 platform-token 后，Token
                  只在该次响应显示。页面会阻止关闭，直到你明确确认已保存。
                </p>
              </div>
            )}
      </FormSection>

      <FormSection
        description="决定注册完成后是否立即允许挂载节点调用；它不代表远端当前健康。"
        index="04"
        title="Lifecycle"
      >
        <SchemaFields
          disabled={disabled}
          fields={[ENABLED_FIELD]}
          idPrefix={`${idPrefix}-lifecycle`}
          onChange={next => onChange({ ...state, enabled: next.enabled === true })}
          value={{ enabled: state.enabled }}
        />
      </FormSection>
    </div>
  )
}
