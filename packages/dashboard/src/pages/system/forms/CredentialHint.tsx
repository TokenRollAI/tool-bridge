import { KeyRound, Settings2, ShieldCheck } from 'lucide-react'
import type { PluginCredentialField, PluginExport } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { credentialPlanFor } from './registryConfig'

function FieldList({
  fields,
  hint,
  title,
}: {
  fields: PluginCredentialField[]
  hint: React.ReactNode
  title: string
}) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase">
        {title === '配置字段' && <Settings2 className="size-3" />}
        {title}
      </p>
      <ul className="space-y-1">
        {fields.map(field => (
          <li className="flex flex-wrap items-baseline gap-1.5" key={field.key}>
            <code className="font-mono text-foreground">{field.key}</code>
            {field.required !== false && (
              <Badge className="px-1 py-0 text-[10px]" variant="outline">必填</Badge>
            )}
            <span className="text-muted-foreground">
              {field.label}
              {field.description !== undefined && ` — ${field.description}`}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  )
}

/** 探针是挂载时的**前置校验**:凭证配错会在这一步就被拒,而不是等第一次调用。 */
function ProbeNote({ probe }: { probe: string }) {
  return (
    <p className="text-[11px] text-muted-foreground">
      挂载时平台会用这份凭证真实调一次
      <code className="mx-1 font-mono">{probe}</code>
      验证可用 —— 配错的话这一步就会失败,不用等到第一次业务调用。
    </p>
  )
}

/**
 * 挂载 plugin tool 时告诉用户"凭证要配什么"。
 *
 * 数据本来就有 —— 平台在注册时把 plugin 的 `~describe` 缓存进 manifest,里面带
 * `credentialFields`(key/label/description/required/secret)、`credentialProbe`、`oauth`。
 * 但 Dashboard 的 `PluginExport` 类型漏了这几个字段,于是挂载表单只给一个空的 authRef
 * 输入框:用户看不到该填什么、有几个字段、哪些是密钥,只能去翻插件源码。
 * `credentialFields` 的设计注释里写着"管理面也没法提示该填哪些字段"是它要解决的问题,
 * 这个组件才是那句话的兑现。
 */
export function CredentialHint({
  exports,
  exportId,
  pluginId,
}: {
  exportId: string
  exports: PluginExport[]
  pluginId: string
}) {
  if (pluginId.trim() === '' || exports.length === 0) return null
  const plan = credentialPlanFor(exports, exportId)

  return (
    <div className="rounded-md border bg-muted/25 px-3 py-2.5 text-xs">
      {plan.kind === 'oauth' && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 font-medium">
            <ShieldCheck className="size-3.5" />
            这个 export 走平台托管的 OAuth2
          </p>
          <p className="text-muted-foreground">
            authRef 指向的 secret 要存**两个字段**:
            <code className="mx-1 font-mono">clientId</code>
            与
            <code className="mx-1 font-mono">clientSecret</code>
            —— 到 provider 后台自行注册应用后拿到。
          </p>
          {plan.oauth?.scopes !== undefined && plan.oauth.scopes.length > 0 && (
            <p className="text-muted-foreground">
              申请 scope:
              <span className="font-mono">{plan.oauth.scopes.join(' ')}</span>
            </p>
          )}
          <p className="text-muted-foreground">
            挂载完成后还要**授权一步**(本页节点行的「授权」按钮,或
            <code className="mx-1 font-mono">tb tool auth &lt;path&gt;</code>
            )。
          </p>
        </div>
      )}

      {plan.kind === 'single' && (
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 font-medium">
            <KeyRound className="size-3.5" />
            单值凭证
          </p>
          <p className="text-muted-foreground">
            authRef 指向的 secret 存**一个字符串**(该 provider 的 API key)。用
            <code className="mx-1 font-mono">tb secret set &lt;name&gt; --value &lt;key&gt;</code>
            或本控制台的 Secrets 页创建。
          </p>
          {plan.probe !== undefined && <ProbeNote probe={plan.probe} />}
        </div>
      )}

      {plan.kind === 'fields' && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 font-medium">
            <KeyRound className="size-3.5" />
            这个 export 需要多字段凭证
          </p>
          {plan.secretFields.length > 0 && (
            <FieldList
              fields={plan.secretFields}
              hint={(
                <>
                  存进 authRef 指向的 secret(JSON 对象):
                  <code className="mx-1 font-mono">
                    tb secret set &lt;name&gt;
                    {plan.secretFields.map(f => ` --field ${f.key}=…`).join('')}
                  </code>
                </>
              )}
              title="密钥字段"
            />
          )}
          {plan.configFields.length > 0 && (
            <FieldList
              fields={plan.configFields}
              hint={(
                <>
                  这些**不是密钥**,填在下面的
                  <span className="mx-1 font-medium">providerConfig</span>
                  里(明文存,
                  <code className="mx-1 font-mono">system/registry get</code>
                  会回显)。
                </>
              )}
              title="配置字段"
            />
          )}
          {plan.probe !== undefined && <ProbeNote probe={plan.probe} />}
        </div>
      )}
    </div>
  )
}
