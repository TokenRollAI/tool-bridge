import { KeyRound, ShieldCheck, TriangleAlert } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type CredentialInputPlan,
  type CredentialMode,
  type ManagedCredentialFormState,
  SINGLE_FIELD_KEY } from './managedCredential'

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
  const setField = (key: string, value: string) =>
    onChange({ ...state, credentials: { ...state.credentials, [key]: value } })

  if (plan.kind === 'none') {
    return (
      <p className="rounded-md border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
        该集成无需上游凭证。
      </p>
    )
  }

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

      {state.mode === 'inline' && plan.kind === 'oauth' && (
        <div className="grid gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <ShieldCheck className="size-3.5" />
            平台托管 OAuth2
          </p>
          <div className="grid gap-1.5">
            <Label className="text-xs" htmlFor={`${idPrefix}-client-id`}>clientId *</Label>
            <Input
              className="font-mono text-sm"
              id={`${idPrefix}-client-id`}
              onChange={event => setField('clientId', event.target.value)}
              value={state.credentials.clientId ?? ''}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs" htmlFor={`${idPrefix}-client-secret`}>clientSecret *</Label>
            <Input
              className="font-mono text-sm"
              id={`${idPrefix}-client-secret`}
              onChange={event => setField('clientSecret', event.target.value)}
              type="password"
              value={state.credentials.clientSecret ?? ''}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            到服务商后台注册应用后获得；挂载完成会继续打开授权页。
          </p>
        </div>
      )}

      {state.mode === 'inline' && plan.kind === 'fields' && (
        <div className="grid gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <KeyRound className="size-3.5" />
            需要
            {plan.fields.length}
            个服务商凭证字段
          </p>
          {plan.fields.map(field => (
            <div className="grid gap-1.5" key={field.key}>
              <Label className="text-xs" htmlFor={`${idPrefix}-${field.key}`}>
                {field.key}
                {field.required !== false && ' *'}
                {field.label !== undefined && (
                  <span className="ml-1.5 font-normal text-muted-foreground">{field.label}</span>
                )}
              </Label>
              <Input
                className="font-mono text-sm"
                id={`${idPrefix}-${field.key}`}
                onChange={event => setField(field.key, event.target.value)}
                type={field.secret === false ? 'text' : 'password'}
                value={state.credentials[field.key] ?? ''}
              />
              {field.description !== undefined && (
                <p className="text-[11px] text-muted-foreground">{field.description}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {state.mode === 'inline' && plan.kind === 'single' && (
        <div className="grid gap-1.5">
          <Label className="text-xs" htmlFor={`${idPrefix}-api-key`}>
            API key
            {plan.authRequired && !fallbackAvailable && ' *'}
          </Label>
          <Input
            className="font-mono text-sm"
            id={`${idPrefix}-api-key`}
            onChange={event => setField(SINGLE_FIELD_KEY, event.target.value)}
            type="password"
            value={state.credentials[SINGLE_FIELD_KEY] ?? ''}
          />
          <p className="text-[11px] text-muted-foreground">填写后由平台自动加密保管和绑定。</p>
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
