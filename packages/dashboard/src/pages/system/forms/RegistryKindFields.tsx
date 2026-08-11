import { Loader2 } from 'lucide-react'
import { Link } from 'react-router'
import type { PluginExport, PluginManifest } from '@/lib/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormSection } from '@/components/FormSection'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  exportOptionsFor,
  pluginsForProfile,
  type RegistryMountFormState,
} from './registryConfig'

function ExportField({
  id,
  options,
  value,
  onChange,
}: {
  id: string
  onChange: (next: string) => void
  options: PluginExport[]
  value: string
}) {
  const required = options.length > 1
  if (options.length === 0) {
    return (
      <div className="grid gap-1.5">
        <Label className="text-xs" htmlFor={id}>
          export（可空；无 ~describe 缓存时可手填）
        </Label>
        <Input className="font-mono text-xs" id={id} onChange={event => onChange(event.target.value)} value={value} />
      </div>
    )
  }
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs" htmlFor={id}>
        export
        {' '}
        {required ? '*（该 plugin 有多个 export）' : '（单 export 可留空）'}
      </Label>
      <Select onValueChange={onChange} value={value}>
        <SelectTrigger className="font-mono text-xs" id={id}>
          <SelectValue placeholder={required ? '选择 export…' : `${options[0]?.id}（默认）`} />
        </SelectTrigger>
        <SelectContent>
          {options.map(item => (
            <SelectItem className="font-mono text-xs" key={item.id} value={item.id}>
              {item.id}
              {item.description ? ` — ${item.description}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function Field({
  id,
  label,
  onChange,
  placeholder,
  value,
}: {
  id: string
  label: string
  onChange: (next: string) => void
  placeholder?: string
  value: string
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs" htmlFor={id}>{label}</Label>
      <Input
        className="font-mono text-xs"
        id={id}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </div>
  )
}

function S3Fields({
  onChange,
  prefix,
  state,
}: {
  onChange: (next: RegistryMountFormState) => void
  prefix: string
  state: RegistryMountFormState
}) {
  const update = <K extends keyof RegistryMountFormState>(key: K, value: RegistryMountFormState[K]) =>
    onChange({ ...state, [key]: value })
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${prefix}-s3-endpoint`} label="endpoint *" onChange={value => update('s3Endpoint', value)} placeholder="https://….r2.cloudflarestorage.com" value={state.s3Endpoint} />
        <Field id={`${prefix}-s3-bucket`} label="bucket *" onChange={value => update('s3Bucket', value)} value={state.s3Bucket} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${prefix}-s3-region`} label="region（可空，缺省 auto）" onChange={value => update('s3Region', value)} value={state.s3Region} />
        <Field id={`${prefix}-auth`} label="authRef *" onChange={value => update('ctxAuthRef', value)} placeholder="s3-main" value={state.ctxAuthRef} />
      </div>
    </>
  )
}

function ContentPolicyFields({
  onChange,
  readOnlyLabel,
  state,
}: {
  onChange: (next: RegistryMountFormState) => void
  readOnlyLabel: string
  state: RegistryMountFormState
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
      <Field id={`${state.kind}-ttl`} label="ttl 秒（可空，到期整节点回收）" onChange={ttl => onChange({ ...state, ttl })} placeholder="86400" value={state.ttl} />
      {/* biome-ignore lint/a11y/noLabelWithoutControl: Radix Checkbox 是 label 内可交互控件 */}
      <label className="flex items-center gap-2 pb-2 text-xs">
        <Checkbox checked={state.readOnly} onCheckedChange={value => onChange({ ...state, readOnly: value === true })} />
        {readOnlyLabel}
      </label>
    </div>
  )
}

export function RegistryKindFields({
  fetchNextPlugins,
  hasNextPlugins,
  isFetchingNextPlugins,
  onChange,
  pluginItems,
  state,
}: {
  fetchNextPlugins: () => void
  hasNextPlugins: boolean
  isFetchingNextPlugins: boolean
  onChange: (next: RegistryMountFormState) => void
  pluginItems: PluginManifest[]
  state: RegistryMountFormState
}) {
  const update = <K extends keyof RegistryMountFormState>(
    key: K,
    value: RegistryMountFormState[K],
  ) => onChange({ ...state, [key]: value })
  const toolPlugins = pluginsForProfile(pluginItems, 'tools/v1')
  const contextPlugins = pluginsForProfile(pluginItems, 'context/v1')
  const toolExports = exportOptionsFor(pluginItems, state.toolProvider, 'tools/v1')
  const contextExports = exportOptionsFor(pluginItems, state.provider, 'context/v1')

  return (
    <>
      <FormSection
        description="配置 Provider、端点与凭证引用；认证材料本体始终留在凭证保管中。"
        index="02"
        title="连接与认证"
      >
        {state.kind === 'mcp' && (
          <>
            <Field
              id="mcp-url"
              label="url *（Streamable HTTP）"
              onChange={value => update('mcpUrl', value)}
              placeholder="https://mcp.example.com/mcp"
              value={state.mcpUrl}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs">上游认证</Label>
                <Select
                  onValueChange={value => update('mcpAuthMode', value as RegistryMountFormState['mcpAuthMode'])}
                  value={state.mcpAuthMode}
                >
                  <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem className="font-mono text-xs" value="none">无（公开上游）</SelectItem>
                    <SelectItem className="font-mono text-xs" value="authRef">authRef — 静态凭证</SelectItem>
                    <SelectItem className="font-mono text-xs" value="oauth">oauth — 网关托管 OAuth</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {state.mcpAuthMode === 'authRef' && (
                <Field id="mcp-auth" label="authRef *" onChange={value => update('mcpAuthRef', value)} value={state.mcpAuthRef} />
              )}
            </div>
            {state.mcpAuthMode === 'authRef' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  id="mcp-auth-header"
                  label="authHeader（可空）"
                  onChange={value => update('mcpAuthHeader', value)}
                  placeholder="Authorization"
                  value={state.mcpAuthHeader}
                />
                <div className="grid gap-1.5">
                  <Label className="text-xs">authScheme</Label>
                  <Select
                    onValueChange={value => update('mcpSchemeMode', value as RegistryMountFormState['mcpSchemeMode'])}
                    value={state.mcpSchemeMode}
                  >
                    <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem className="font-mono text-xs" value="bearer">Bearer（默认）</SelectItem>
                      <SelectItem className="font-mono text-xs" value="raw">无前缀（原样注入）</SelectItem>
                      <SelectItem className="font-mono text-xs" value="custom">自定义前缀</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {state.mcpAuthMode === 'authRef' && state.mcpSchemeMode === 'custom' && (
              <Field
                id="mcp-auth-scheme"
                label="自定义 scheme 前缀"
                onChange={value => update('mcpAuthScheme', value)}
                placeholder="Token"
                value={state.mcpAuthScheme}
              />
            )}
            <div className="grid gap-1.5">
              <Label className="text-xs" htmlFor="mcp-headers">静态 headers（每行 Name=value）</Label>
              <Textarea
                className="font-mono text-xs"
                id="mcp-headers"
                onChange={event => update('mcpHeadersSpec', event.target.value)}
                placeholder="X-Lark-MCP-Allowed-Tools=search-doc,fetch-doc"
                rows={3}
                spellCheck={false}
                value={state.mcpHeadersSpec}
              />
            </div>
            {state.mcpAuthMode === 'oauth' && (
              <p className="text-[11px] text-muted-foreground">
                挂载后自动打开上游授权页；token 由网关保管并自动续期。
              </p>
            )}
          </>
        )}

        {state.kind === 'http' && (
          <>
            <Field
              id="http-endpoint"
              label="endpoint *"
              onChange={value => update('endpoint', value)}
              placeholder="https://postman-echo.com"
              value={state.endpoint}
            />
            <div className="grid gap-1.5">
              <Label className="text-xs" htmlFor="http-tools">tools *（HttpToolDef[] JSON）</Label>
              <Textarea
                className="font-mono text-xs"
                id="http-tools"
                onChange={event => update('toolsJson', event.target.value)}
                rows={7}
                spellCheck={false}
                value={state.toolsJson}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="http-auth" label="authRef（可空）" onChange={value => update('httpAuthRef', value)} value={state.httpAuthRef} />
              <Field id="http-auth-header" label="authHeader（可空）" onChange={value => update('authHeader', value)} placeholder="Authorization" value={state.authHeader} />
              <div className="grid gap-1.5">
                <Label className="text-xs">authScheme</Label>
                <Select
                  onValueChange={value => update('httpSchemeMode', value as RegistryMountFormState['httpSchemeMode'])}
                  value={state.httpSchemeMode}
                >
                  <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem className="font-mono text-xs" value="bearer">Bearer（默认）</SelectItem>
                    <SelectItem className="font-mono text-xs" value="raw">无前缀（原样注入）</SelectItem>
                    <SelectItem className="font-mono text-xs" value="custom">自定义前缀</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {state.httpSchemeMode === 'custom' && (
              <Field id="http-auth-scheme" label="自定义 scheme 前缀" onChange={value => update('authScheme', value)} placeholder="Token" value={state.authScheme} />
            )}
          </>
        )}

        {state.kind === 'context' && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs">provider</Label>
                <Select
                  onValueChange={value => onChange({ ...state, provider: value, ctxExport: '' })}
                  value={state.provider}
                >
                  <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem className="font-mono text-xs" value="r2">r2（实例自带桶）</SelectItem>
                    <SelectItem className="font-mono text-xs" value="s3">s3（外部兼容端点）</SelectItem>
                    {contextPlugins.map(plugin => (
                      <SelectItem className="font-mono text-xs" key={plugin.id} value={plugin.id}>
                        {plugin.id}
                        （plugin）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(state.provider === 'r2' || state.provider === 's3') && (
                <Field id="ctx-prefix" label="key 前缀（可空）" onChange={value => update('ctxPrefix', value)} value={state.ctxPrefix} />
              )}
            </div>
            {state.provider !== 'r2' && state.provider !== 's3' && (
              <>
                <ExportField id="ctx-export" onChange={value => update('ctxExport', value)} options={contextExports} value={state.ctxExport} />
                <Field id="ctx-plugin-auth" label="authRef（可空）" onChange={value => update('ctxAuthRef', value)} value={state.ctxAuthRef} />
              </>
            )}
            {state.provider === 's3' && <S3Fields onChange={onChange} prefix="ctx" state={state} />}
            <ContentPolicyFields onChange={onChange} readOnlyLabel="readOnly（拒绝 Write/Update/Delete）" state={state} />
          </>
        )}

        {state.kind === 'skillhub' && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs">provider</Label>
                <Select onValueChange={value => update('skillProvider', value as 'r2' | 's3')} value={state.skillProvider}>
                  <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem className="font-mono text-xs" value="r2">r2（实例自带桶）</SelectItem>
                    <SelectItem className="font-mono text-xs" value="s3">s3（外部兼容端点）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Field id="skill-prefix" label="key 前缀（可空）" onChange={value => update('ctxPrefix', value)} value={state.ctxPrefix} />
            </div>
            {state.skillProvider === 's3' && <S3Fields onChange={onChange} prefix="skill" state={state} />}
            <ContentPolicyFields onChange={onChange} readOnlyLabel="readOnly（隐藏 Publish/Remove）" state={state} />
          </>
        )}

        {state.kind === 'remote' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="remote-url" label="baseUrl *（须在白名单内）" onChange={value => update('baseUrl', value)} placeholder="https://tb.example.com" value={state.baseUrl} />
            <Field id="remote-skref" label="skRef（远端 SK 的 authRef，可空）" onChange={value => update('skRef', value)} value={state.skRef} />
          </div>
        )}

        {state.kind === 'tool' && (
          <>
            <div className="grid gap-1.5">
              <Label className="text-xs">provider *（已注册 plugin）</Label>
              <Select
                onValueChange={value => onChange({ ...state, toolProvider: value, toolExport: '' })}
                value={state.toolProvider}
              >
                <SelectTrigger className="font-mono text-xs">
                  <SelectValue placeholder={toolPlugins.length === 0 ? '无已注册 plugin' : '选择 plugin…'} />
                </SelectTrigger>
                <SelectContent>
                  {toolPlugins.map(plugin => (
                    <SelectItem className="font-mono text-xs" key={plugin.id} value={plugin.id}>
                      {plugin.id}
                      {plugin.enabled ? '' : '（disabled）'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {toolPlugins.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  先在
                  {' '}
                  <Link className="underline underline-offset-2" to="/manage/plugins">Plugin</Link>
                  {' '}
                  注册一个导出 tools/v1 的 plugin。
                </p>
              )}
            </div>
            <ExportField id="tool-export" onChange={value => update('toolExport', value)} options={toolExports} value={state.toolExport} />
            <Field id="tool-auth" label="authRef（可空，上游凭证引用）" onChange={value => update('toolAuthRef', value)} value={state.toolAuthRef} />
          </>
        )}

        {hasNextPlugins && (state.kind === 'context' || state.kind === 'tool') && (
          <Button
            className="justify-self-start"
            disabled={isFetchingNextPlugins}
            onClick={fetchNextPlugins}
            size="xs"
            type="button"
            variant="ghost"
          >
            {isFetchingNextPlugins && <Loader2 className="animate-spin" />}
            继续加载 Plugin（已加载
            {' '}
            {pluginItems.length}
            ）
          </Button>
        )}
      </FormSection>

      {(state.kind === 'mcp' || state.kind === 'http' || state.kind === 'tool') && (
        <FormSection
          description="可选：按 hide → rename → prefix → describe 顺序重塑工具暴露面。"
          index="03"
          title="高级虚拟化"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="virt-prefix" label="工具名前缀（纯拼接）" onChange={value => update('prefix', value)} placeholder="gh__" value={state.prefix} />
            <Field id="virt-hide" label="hide（原名，逗号分隔）" onChange={value => update('hideSpec', value)} placeholder="dangerous_tool" value={state.hideSpec} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs" htmlFor="virt-rename">rename（每行 from=to）</Label>
              <Textarea className="font-mono text-xs" id="virt-rename" onChange={event => update('renameSpec', event.target.value)} rows={2} spellCheck={false} value={state.renameSpec} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs" htmlFor="virt-describe">describe（每行 from=描述）</Label>
              <Textarea className="font-mono text-xs" id="virt-describe" onChange={event => update('describeSpec', event.target.value)} rows={2} spellCheck={false} value={state.describeSpec} />
            </div>
          </div>
        </FormSection>
      )}
    </>
  )
}
