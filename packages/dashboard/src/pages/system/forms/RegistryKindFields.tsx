import { Loader2, Plus, X } from 'lucide-react'
import { Link } from 'react-router'
import type { PluginExport, PluginManifest } from '@/lib/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { type SchemaField, SchemaFields } from '@/components/SchemaFields'
import { FormSection } from '@/components/FormSection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  credentialPlanFor,
  exportOptionsFor,
  pluginsForProfile,
  type RegistryMountFormState,
} from './registryConfig'
import { ManagedCredentialFields } from './ManagedCredentialFields'
import { initialManagedCredential } from './managedCredential'
import { MountConfigFields } from './MountConfigFields'
import { CredentialHint } from './CredentialHint'

function textField(
  key: string,
  label: string,
  options: { placeholder?: string, required?: boolean, rows?: number } = {},
): SchemaField {
  return {
    key, label, required: options.required,
    ui: {
      'ui:classNames': 'font-mono text-xs',
      ...(options.placeholder === undefined ? {} : { 'ui:placeholder': options.placeholder }),
      ...(options.rows === undefined
        ? {}
        : { 'ui:widget': 'textarea', 'ui:options': { rows: options.rows } }),
    },
  }
}

const choiceField = (
  key: string, label: string, options: Array<[value: string, title: string]>,
): SchemaField => ({
  key, label, required: true,
  schema: { type: 'string', oneOf: options.map(([value, title]) => ({ const: value, title })) },
  ui: { 'ui:classNames': 'font-mono text-xs', 'ui:widget': 'select' },
})

function RegistrySchemaFields({ fields, idPrefix, onChange, state }: {
  fields: SchemaField[]
  idPrefix: string
  onChange: (next: RegistryMountFormState) => void
  state: RegistryMountFormState
}) {
  return (
    <SchemaFields
      fields={fields}
      idPrefix={idPrefix}
      onChange={(values) => {
        const patch: Record<string, unknown> = {}
        for (const field of fields) {
          const value = values[field.key]
          const current = state[field.key as keyof RegistryMountFormState]
          if (typeof value === typeof current && ['string', 'boolean'].includes(typeof value)) {
            patch[field.key] = value
          }
        }
        onChange({ ...state, ...patch } as RegistryMountFormState)
      }}
      value={state as unknown as Record<string, unknown>}
    />
  )
}

const AUTH_SCHEMES: Array<[string, string]> = [
  ['bearer', 'Bearer（默认）'], ['raw', '无前缀（原样注入）'], ['custom', '自定义前缀'],
]

function mcpFields(state: RegistryMountFormState): SchemaField[] {
  return [
    textField('mcpUrl', 'url', { placeholder: 'https://mcp.example.com/mcp', required: true }),
    choiceField('mcpAuthMode', '上游认证', [
      ['none', '无（公开上游）'], ['authRef', 'authRef — 静态凭证'],
      ['oauth', 'oauth — 网关托管 OAuth'],
    ]),
    ...(state.mcpAuthMode === 'authRef'
      ? [
          textField('mcpAuthRef', 'authRef', { required: true }),
          textField('mcpAuthHeader', 'authHeader（可空）', { placeholder: 'Authorization' }),
          choiceField('mcpSchemeMode', 'authScheme', AUTH_SCHEMES),
          ...(state.mcpSchemeMode === 'custom'
            ? [textField('mcpAuthScheme', '自定义 scheme 前缀', { placeholder: 'Token' })]
            : []),
        ]
      : []),
    textField('mcpHeadersSpec', '静态 headers（每行 Name=value）', {
      placeholder: 'X-Lark-MCP-Allowed-Tools=search-doc,fetch-doc',
      rows: 3,
    }),
  ]
}

function httpFields(state: RegistryMountFormState): SchemaField[] {
  return [
    textField('endpoint', 'endpoint', { placeholder: 'https://postman-echo.com', required: true }),
    textField('toolsJson', 'tools（HttpToolDef[] JSON）', { required: true, rows: 7 }),
    textField('httpAuthRef', 'authRef（可空）'),
    textField('authHeader', 'authHeader（可空）', { placeholder: 'Authorization' }),
    choiceField('httpSchemeMode', 'authScheme', AUTH_SCHEMES),
    ...(state.httpSchemeMode === 'custom'
      ? [textField('authScheme', '自定义 scheme 前缀', { placeholder: 'Token' })]
      : []),
  ]
}

const ADVANCED_FIELDS = [
  textField('prefix', '工具名前缀（纯拼接）', { placeholder: 'gh__' }),
  textField('hideSpec', 'hide（原名，逗号分隔）', { placeholder: 'dangerous_tool' }),
  textField('renameSpec', 'rename（每行 from=to）', { rows: 2 }),
  textField('describeSpec', 'describe（每行 from=描述）', { rows: 2 }),
]
const S3_FIELDS = [
  textField('s3Endpoint', 'endpoint', { placeholder: 'https://….r2.cloudflarestorage.com', required: true }),
  textField('s3Bucket', 'bucket', { required: true }),
  textField('s3Region', 'region（可空，缺省 auto）'),
  textField('ctxAuthRef', 'authRef', { placeholder: 's3-main', required: true }),
]
const policyFields = (label: string): SchemaField[] => [
  textField('ttl', 'ttl 秒（可空，到期整节点回收）', { placeholder: '86400' }),
  { key: 'readOnly', label, schema: { type: 'boolean' } },
]
const REMOTE_FIELDS = [
  textField('baseUrl', 'baseUrl（须在白名单内）', { placeholder: 'https://tb.example.com', required: true }),
  textField('skRef', 'skRef（远端 SK 的 authRef，可空）'),
]

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
  const field = options.length === 0
    ? textField('value', 'export（可空；无 ~describe 缓存时可手填）')
    : {
        ...choiceField(
          'value',
          required ? 'export（该 plugin 有多个 export）' : 'export（单 export 可留空）',
          options.map(item => [item.id, `${item.id}${item.description ? ` — ${item.description}` : ''}`]),
        ),
        required,
        ui: {
          'ui:classNames': 'font-mono text-xs',
          'ui:placeholder': required ? '选择 export…' : `${options[0]?.id}（默认）`,
          'ui:widget': 'select',
        },
      }
  return (
    <SchemaFields
      fields={[field]}
      idPrefix={id}
      onChange={next => onChange(typeof next.value === 'string' ? next.value : '')}
      value={{ value }}
    />
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

function PluginMountConfigFields({
  allowArbitrary,
  exportId,
  exports,
  onChange,
  value,
}: {
  allowArbitrary: boolean
  exportId: string
  exports: PluginExport[]
  onChange: (next: Record<string, string>) => void
  value: Record<string, string>
}) {
  const target = exportId.trim() === ''
    ? exports[0]
    : exports.find(item => item.id === exportId.trim())
  const fields = target?.mountConfigFields
  if (fields === undefined) {
    if (!allowArbitrary) {
      return <p className="text-[11px] text-muted-foreground">该 export 无需额外挂载配置。</p>
    }
    return (
      <div className="grid gap-2">
        <Label className="text-xs">providerConfig（兼容模式）</Label>
        {Object.entries(value).map(([key, val], index) => (
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2" key={`${key}-${index}`}>
            <Input
              aria-label={`providerConfig key ${index + 1}`}
              className="font-mono text-xs"
              onChange={(event) => {
                const next = { ...value }
                delete next[key]
                next[event.target.value] = val
                onChange(next)
              }}
              placeholder="baseUrl"
              value={key}
            />
            <Input
              aria-label={`providerConfig value ${index + 1}`}
              className="font-mono text-xs"
              onChange={event => onChange({ ...value, [key]: event.target.value })}
              placeholder="https://plugin.example.com"
              value={val}
            />
            <Button
              aria-label={`删除 providerConfig 第 ${index + 1} 行`}
              onClick={() => {
                const next = { ...value }
                delete next[key]
                onChange(next)
              }}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          </div>
        ))}
        <Button
          className="justify-self-start"
          disabled={Object.hasOwn(value, '')}
          onClick={() => onChange({ ...value, '': '' })}
          size="xs"
          type="button"
          variant="outline"
        >
          <Plus />
          添加配置
        </Button>
        <p className="text-[11px] text-muted-foreground">
          此 external plugin 未声明字段；这里只作兼容输入。密钥仍须放在 authRef 指向的 secret。
        </p>
      </div>
    )
  }
  return (
    <MountConfigFields
      fields={fields}
      idPrefix="plugin-config"
      onChange={onChange}
      value={value}
    />
  )
}

export function RegistryKindFields({
  fetchNextPlugins,
  hasNextPlugins,
  hasExistingManagedCredential,
  isFetchingNextPlugins,
  onChange,
  pluginItems,
  secretNames,
  state,
}: {
  fetchNextPlugins: () => void
  hasExistingManagedCredential: boolean
  hasNextPlugins: boolean
  isFetchingNextPlugins: boolean
  onChange: (next: RegistryMountFormState) => void
  pluginItems: PluginManifest[]
  secretNames: string[]
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
  const toolPlugin = pluginItems.find(plugin => plugin.id === state.toolProvider)
  const contextPlugin = pluginItems.find(plugin => plugin.id === state.provider)
  const toolAuth = credentialPlanFor(toolExports, state.toolExport)
  const contextAuth = credentialPlanFor(contextExports, state.ctxExport)
  const toolBuiltin = toolPlugin?.endpoint.startsWith('binding:') === true
  const contextBuiltin = contextPlugin?.endpoint.startsWith('binding:') === true

  return (
    <>
      <FormSection
        description="配置 Provider、端点与认证；内置集成的敏感凭证由平台自动保管。"
        index="02"
        title="连接与认证"
      >
        {state.kind === 'mcp' && (
          <>
            <RegistrySchemaFields
              fields={mcpFields(state)}
              idPrefix="mcp"
              onChange={onChange}
              state={state}
            />
            {state.mcpAuthMode === 'oauth' && (
              <p className="text-[11px] text-muted-foreground">
                挂载后自动打开上游授权页；token 由网关保管并自动续期。
              </p>
            )}
          </>
        )}

        {state.kind === 'http' && (
          <RegistrySchemaFields
            fields={httpFields(state)}
            idPrefix="http"
            onChange={onChange}
            state={state}
          />
        )}

        {state.kind === 'context' && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs">provider</Label>
                <Select
                  onValueChange={(value) => {
                    const nextExports = exportOptionsFor(pluginItems, value, 'context/v1')
                    onChange({
                      ...state,
                      provider: value,
                      ctxExport: '',
                      ctxAuthRef: '',
                      ctxCredential: initialManagedCredential(credentialPlanFor(nextExports, '')),
                      pluginConfig: {},
                    })
                  }}
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
                <ExportField
                  id="ctx-export"
                  onChange={value => onChange({
                    ...state,
                    ctxExport: value,
                    ctxAuthRef: '',
                    ctxCredential: initialManagedCredential(credentialPlanFor(contextExports, value)),
                    pluginConfig: {},
                  })}
                  options={contextExports}
                  value={state.ctxExport}
                />
                {contextBuiltin
                  ? (
                      <ManagedCredentialFields
                        fallbackAvailable={hasExistingManagedCredential}
                        idPrefix="context-credential"
                        onChange={value => update('ctxCredential', value)}
                        plan={{
                          authRequired: contextAuth.authRequired,
                          fields: contextAuth.secretFields,
                          kind: contextAuth.kind,
                        }}
                        secretNames={secretNames}
                        state={state.ctxCredential}
                      />
                    )
                  : (
                      <>
                        <CredentialHint exportId={state.ctxExport} exports={contextExports} pluginId={state.provider} />
                        {contextAuth.kind !== 'none' && (
                          <Field
                            id="ctx-plugin-auth"
                            label={`authRef${contextAuth.authRequired ? ' *' : '（可空）'}`}
                            onChange={value => update('ctxAuthRef', value)}
                            value={state.ctxAuthRef}
                          />
                        )}
                      </>
                    )}
                <PluginMountConfigFields
                  allowArbitrary={contextPlugin?.endpoint.startsWith('binding:') === false}
                  exportId={state.ctxExport}
                  exports={contextExports}
                  onChange={value => update('pluginConfig', value)}
                  value={state.pluginConfig}
                />
              </>
            )}
            {state.provider === 's3' && (
              <RegistrySchemaFields fields={S3_FIELDS} idPrefix="context-s3" onChange={onChange} state={state} />
            )}
            <RegistrySchemaFields
              fields={policyFields('readOnly（拒绝 write/update/delete）')}
              idPrefix="context-policy"
              onChange={onChange}
              state={state}
            />
          </>
        )}

        {state.kind === 'skillhub' && (
          <>
            <RegistrySchemaFields
              fields={[
                choiceField('skillProvider', 'provider', [
                  ['r2', 'r2（实例自带桶）'], ['s3', 's3（外部兼容端点）'],
                ]),
                textField('ctxPrefix', 'key 前缀（可空）'),
              ]}
              idPrefix="skill-provider"
              onChange={onChange}
              state={state}
            />
            {state.skillProvider === 's3' && (
              <RegistrySchemaFields fields={S3_FIELDS} idPrefix="skill-s3" onChange={onChange} state={state} />
            )}
            <RegistrySchemaFields
              fields={policyFields('readOnly（隐藏 publish/remove）')}
              idPrefix="skill-policy"
              onChange={onChange}
              state={state}
            />
          </>
        )}

        {state.kind === 'remote' && (
          <RegistrySchemaFields
            fields={REMOTE_FIELDS}
            idPrefix="remote"
            onChange={onChange}
            state={state}
          />
        )}

        {state.kind === 'tool' && (
          <>
            <div className="grid gap-1.5">
              <Label className="text-xs">provider *（内置或已注册 plugin）</Label>
              <Select
                onValueChange={(value) => {
                  const nextExports = exportOptionsFor(pluginItems, value, 'tools/v1')
                  onChange({
                    ...state,
                    toolProvider: value,
                    toolExport: '',
                    toolAuthRef: '',
                    toolCredential: initialManagedCredential(credentialPlanFor(nextExports, '')),
                    pluginConfig: {},
                  })
                }}
                value={state.toolProvider}
              >
                <SelectTrigger className="font-mono text-xs">
                  <SelectValue placeholder={toolPlugins.length === 0 ? '无可用 plugin' : '选择 plugin…'} />
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
                  当前部署没有内置 tool plugin；也可以先在
                  {' '}
                  <Link className="underline underline-offset-2" to="/manage/plugins">Plugin</Link>
                  {' '}
                  注册一个导出 tools/v1 的 plugin。
                </p>
              )}
            </div>
            <ExportField
              id="tool-export"
              onChange={value => onChange({
                ...state,
                toolExport: value,
                toolAuthRef: '',
                toolCredential: initialManagedCredential(credentialPlanFor(toolExports, value)),
                pluginConfig: {},
              })}
              options={toolExports}
              value={state.toolExport}
            />
            {toolPlugin !== undefined && (toolBuiltin
              ? (
                  <ManagedCredentialFields
                    fallbackAvailable={hasExistingManagedCredential}
                    idPrefix="tool-credential"
                    onChange={value => update('toolCredential', value)}
                    plan={{
                      authRequired: toolAuth.authRequired,
                      fields: toolAuth.secretFields,
                      kind: toolAuth.kind,
                    }}
                    secretNames={secretNames}
                    state={state.toolCredential}
                  />
                )
              : (
                  <>
                    {/* external plugin 无 catalog 编排面时保留底层兼容入口。 */}
                    <CredentialHint exportId={state.toolExport} exports={toolExports} pluginId={state.toolProvider} />
                    {toolAuth.kind !== 'none' && (
                      <Field
                        id="tool-auth"
                        label={`authRef${toolAuth.authRequired ? ' *' : '（可空，上游凭证引用）'}`}
                        onChange={value => update('toolAuthRef', value)}
                        value={state.toolAuthRef}
                      />
                    )}
                  </>
                ))}
            {state.toolProvider !== '' && (
              <PluginMountConfigFields
                allowArbitrary={toolPlugin?.endpoint.startsWith('binding:') === false}
                exportId={state.toolExport}
                exports={toolExports}
                onChange={value => update('pluginConfig', value)}
                value={state.pluginConfig}
              />
            )}
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
          <RegistrySchemaFields
            fields={ADVANCED_FIELDS}
            idPrefix="virtualize"
            onChange={onChange}
            state={state}
          />
        </FormSection>
      )}
    </>
  )
}
