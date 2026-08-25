import { KeyRound, ShieldCheck, TriangleAlert } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { type SchemaField, SchemaFields } from '@/components/SchemaFields'
import { Label } from '@/components/ui/label'
import { type CredentialInputPlan,
  type CredentialMode,
  type ManagedCredentialFormState,
  SINGLE_FIELD_KEY } from './managedCredential'

function credentialFieldModel(
  plan: CredentialInputPlan,
  fallbackAvailable: boolean,
): SchemaField[] {
  if (plan.kind === 'oauth') {
    return [
      { key: 'clientId', label: 'clientId', required: true, ui: { 'ui:classNames': 'font-mono text-sm' } },
      { key: 'clientSecret', label: 'clientSecret', required: true, ui: { 'ui:classNames': 'font-mono text-sm', 'ui:widget': 'password' } },
    ]
  }
  if (plan.kind === 'fields') {
    return plan.fields.map(field => ({
      key: field.key,
      label: field.label === undefined ? field.key : `${field.key} — ${field.label}`,
      required: field.required !== false,
      description: field.description,
      ui: {
        'ui:classNames': 'font-mono text-sm',
        ...(field.secret === false ? {} : { 'ui:widget': 'password' }),
      },
    }))
  }
  if (plan.kind === 'single') return [{
    key: SINGLE_FIELD_KEY,
    label: 'API key',
    required: plan.authRequired && !fallbackAvailable,
    ui: { 'ui:classNames': 'font-mono text-sm', 'ui:widget': 'password' },
  }]
  return []
}

function credentialValues(fields: SchemaField[], value: Record<string, unknown>): Record<string, string> {
  const projected: Record<string, string> = {}
  for (const field of fields) {
    const item = value[field.key]
    if (typeof item === 'string') projected[field.key] = item
  }
  return projected
}

/**
 * 内置集成共用的凭证输入面。它只讲服务商凭证，不暴露 SecretStore/authRef 的实现术语。
 */
export function ManagedCredentialFields({
  fallbackAvailable = false,
  idPrefix,
  onChange,
  plan,
  secretNames,
  state,
}: {
  /** 同 provider/export 替换已有挂载时，可留空保留原凭证。 */
  fallbackAvailable?: boolean
  idPrefix: string
  onChange: (next: ManagedCredentialFormState) => void
  plan: CredentialInputPlan
  secretNames: string[]
  state: ManagedCredentialFormState
}) {
  if (plan.kind === 'none') {
    return (
      <p className="rounded-md border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
        该集成无需上游凭证。
      </p>
    )
  }

  const fields = credentialFieldModel(plan, fallbackAvailable)

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label className="text-xs">凭证方式</Label>
        <Select
          onValueChange={value => onChange({
            credentials: {},
            existingSecret: '',
            mode: value as CredentialMode,
          })}
          value={state.mode}
        >
          <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem className="text-xs" value="inline">填写凭证（推荐）</SelectItem>
            <SelectItem className="text-xs" value="existing">使用已保存凭证</SelectItem>
            {!plan.authRequired && (
              <SelectItem className="text-xs" value="none">暂不配置</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {state.mode === 'existing' && (
        <div className="grid gap-1.5">
          <Label className="text-xs">已保存凭证</Label>
          <Select
            onValueChange={value => onChange({ ...state, existingSecret: value })}
            value={state.existingSecret}
          >
            <SelectTrigger className="font-mono text-xs">
              <SelectValue placeholder="选择凭证…" />
            </SelectTrigger>
            <SelectContent>
              {secretNames.map(name => (
                <SelectItem className="font-mono text-xs" key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {secretNames.length === 0 && (
            <p className="text-[11px] text-muted-foreground">当前没有可复用的已保存凭证。</p>
          )}
        </div>
      )}

      {state.mode === 'inline' && fallbackAvailable && (
        <p className="rounded-md border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
          此挂载已有凭证。全部留空会保留原值；填写新值会由平台安全轮换。
        </p>
      )}

      {state.mode === 'inline' && (
        <div className="grid gap-2">
          {plan.kind === 'oauth' && (
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <ShieldCheck className="size-3.5" />
              平台托管 OAuth2
            </p>
          )}
          {plan.kind === 'fields' && (
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <KeyRound className="size-3.5" />
              需要
              {plan.fields.length}
              个服务商凭证字段
            </p>
          )}
          <SchemaFields
            fields={fields}
            idPrefix={`${idPrefix}-${plan.kind}`}
            onChange={value => onChange({
              ...state,
              credentials: credentialValues(fields, value),
            })}
            value={state.credentials}
          />
          {plan.kind === 'oauth' && (
            <p className="text-[11px] text-muted-foreground">
              到服务商后台注册应用后获得；挂载完成会继续打开授权页。
            </p>
          )}
          {plan.kind === 'single' && (
            <p className="text-[11px] text-muted-foreground">填写后由平台自动加密保管和绑定。</p>
          )}
        </div>
      )}

      {state.mode === 'none' && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warn/30 bg-warn/[0.045] px-3 py-2.5 text-xs">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warn" />
          <p>暂不配置服务商凭证；需要认证的操作可能无法调用。</p>
        </div>
      )}
    </div>
  )
}
