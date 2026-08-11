import { KeyRound } from 'lucide-react'
import { Link } from 'react-router'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormSection } from '@/components/FormSection'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  type ManifestFormState,
} from './pluginManifest'

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
  const endpointId = `${idPrefix}-endpoint`
  const healthId = `${idPrefix}-health`
  const authId = `${idPrefix}-auth`
  const secretId = `${idPrefix}-secret`
  const enabledId = `${idPrefix}-enabled`

  return (
    <div className="grid gap-3">
      <FormSection
        description="平台访问 Plugin 与健康端点的位置；生产环境使用 HTTPS，或填写平台 service binding。"
        index="01"
        title="Endpoint"
      >
        <div className="grid gap-1.5">
          <Label className="text-xs" htmlFor={endpointId}>Plugin endpoint *</Label>
          <Input
            className="font-mono text-xs"
            disabled={disabled}
            id={endpointId}
            onChange={event => onChange({ ...state, endpoint: event.target.value })}
            placeholder="https://plugin.example.com 或 binding:MY_PLUGIN"
            value={state.endpoint}
          />
        </div>
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label className="text-xs" htmlFor={healthId}>Health path *</Label>
          <Input
            className="font-mono text-xs"
            disabled={disabled}
            id={healthId}
            onChange={event => onChange({ ...state, healthPath: event.target.value })}
            placeholder="/healthz"
            value={state.healthPath}
          />
          <p className="text-[10px] leading-5 text-muted-foreground">
            必须以 / 开头；注册时和手动检查都会请求它。
          </p>
        </div>
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
        <div className="grid gap-1.5 sm:max-w-sm">
          <Label className="text-xs" htmlFor={authId}>Auth mode *</Label>
          <Select
            disabled={disabled}
            onValueChange={value =>
              onChange({ ...state, authKind: value as 'platform-token' | 'bearer' })}
            value={state.authKind}
          >
            <SelectTrigger className="font-mono text-xs" id={authId}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem className="font-mono text-xs" value="platform-token">
                platform-token — 平台签发
              </SelectItem>
              <SelectItem className="font-mono text-xs" value="bearer">
                bearer — 引用已存凭证
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {state.authKind === 'bearer'
          ? (
              <div className="grid gap-1.5">
                <Label className="text-xs" htmlFor={secretId}>Secret reference *</Label>
                <Input
                  className="font-mono text-xs"
                  disabled={disabled}
                  id={secretId}
                  onChange={event => onChange({ ...state, secretRef: event.target.value })}
                  placeholder="my-plugin-token"
                  value={state.secretRef}
                />
                <p className="text-[10px] leading-5 text-muted-foreground">
                  这里只填写
                  <Link className="mx-1 text-foreground underline underline-offset-2" to="/manage/secrets">
                    凭证保管
                  </Link>
                  中的名字，明文不会进入 manifest。
                </p>
              </div>
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
        <div className="flex items-start gap-3 rounded-md border bg-background/55 px-3 py-3">
          <Checkbox
            checked={state.enabled}
            disabled={disabled}
            id={enabledId}
            onCheckedChange={value => onChange({ ...state, enabled: value === true })}
          />
          <Label className="grid cursor-pointer gap-1 text-xs leading-5" htmlFor={enabledId}>
            <span>注册后启用调用</span>
            <span className="font-normal text-[10px] text-muted-foreground">
              关闭后 manifest 仍保留，但挂载节点调用会返回 unavailable，可随时重新启用。
            </span>
          </Label>
        </div>
      </FormSection>
    </div>
  )
}
