import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { CatalogListItem } from '@/lib/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormSection } from '@/components/FormSection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  defaultMountPath,
  type IntegrationFormState,
  integrationPlan,
} from './integrationPlan'
import { ManagedCredentialFields } from './ManagedCredentialFields'
import { MountConfigFields } from './MountConfigFields'

/** Catalog 与添加工具向导共用的 descriptor → 表单投影；不承担 secret/registry/OAuth 编排。 */
export function CatalogIntegrationFields({
  catalog,
  catalogError = false,
  catalogPending = false,
  collapseSelection = false,
  form,
  idPrefix,
  onChange,
  secretNames,
  showDescription = false,
  showEmptyConfig = false,
  showPathWithoutProvider = false,
}: {
  catalog: CatalogListItem[]
  catalogError?: boolean
  catalogPending?: boolean
  collapseSelection?: boolean
  form: IntegrationFormState
  idPrefix: string
  onChange: (next: IntegrationFormState) => void
  secretNames: string[]
  showDescription?: boolean
  showEmptyConfig?: boolean
  showPathWithoutProvider?: boolean
}) {
  const [query, setQuery] = useState('')
  const entry = useMemo(
    () => catalog.find(item => item.id === form.provider),
    [catalog, form.provider],
  )
  const plan = integrationPlan(entry, form.exportId)
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase()
    return catalog
      .filter(item => value === ''
        || item.id.toLowerCase().includes(value)
        || (item.description ?? '').toLowerCase().includes(value))
      .slice(0, 50)
  }, [catalog, query])
  const selectProvider = (item: CatalogListItem) => {
    const exportId = item.exports.length === 1 ? item.exports[0]! : ''
    onChange({
      ...form,
      provider: item.id,
      path: form.path.trim() === '' ? defaultMountPath(item) : form.path,
      exportId,
      credentials: {},
      existingSecret: '',
      config: {},
      mode: integrationPlan(item, exportId).kind === 'none' ? 'none' : 'inline',
    })
  }
  const listVisible = !collapseSelection || form.provider === ''

  return (
    <>
      <FormSection
        description="平台自带的集成目录:每一项都是这个部署里现成可用的代码。"
        index="01"
        title="选择集成"
      >
        {listVisible && (
          <div className="grid gap-1.5">
            <Label className="text-xs" htmlFor={`${idPrefix}-search`}>搜索</Label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground"
              />
              <Input
                className="pl-8 text-sm"
                id={`${idPrefix}-search`}
                onChange={event => setQuery(event.target.value)}
                placeholder="tavily / jira / memos…"
                value={query}
              />
            </div>
          </div>
        )}
        {catalogPending && <p className="text-xs text-muted-foreground">正在读取目录…</p>}
        {catalogError && (
          <p className="text-xs text-muted-foreground">
            读不到内置目录(需要对 system/catalog 的 read 权限)。仍可用「挂载节点」手工填写。
          </p>
        )}
        {listVisible && !catalogPending && catalog.length > 0 && (
          <div className="grid max-h-64 gap-1 overflow-y-auto rounded-md border p-1">
            {filtered.map(item => (
              <button
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/60 ${
                  form.provider === item.id ? 'bg-muted' : ''
                }`}
                key={item.id}
                onClick={() => selectProvider(item)}
                type="button"
              >
                <code className="font-mono font-medium">{item.id}</code>
                <span className="truncate text-muted-foreground">{item.description}</span>
                {Object.values(item.exportDetails).some(detail => detail.auth.kind === 'oauth') && (
                  <Badge className="ml-auto px-1 py-0 text-[10px]" variant="outline">OAuth</Badge>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">无匹配集成</p>
            )}
          </div>
        )}
        {collapseSelection && form.provider !== '' && (
          <div className="flex items-center gap-2 rounded-lg border bg-card/50 px-3 py-2.5">
            <code className="font-mono text-sm font-medium">{form.provider}</code>
            <span className="truncate text-xs text-muted-foreground">{entry?.description}</span>
            <Button
              className="ml-auto"
              onClick={() => onChange({ ...form, provider: '', exportId: '' })}
              size="xs"
              variant="ghost"
            >
              更换
            </Button>
          </div>
        )}
        {(showPathWithoutProvider || form.provider !== '') && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs" htmlFor={`${idPrefix}-path`}>挂载路径 *</Label>
              <Input
                className="font-mono text-sm"
                id={`${idPrefix}-path`}
                onChange={event => onChange({ ...form, path: event.target.value })}
                placeholder="tools/tavily"
                value={form.path}
              />
            </div>
            {plan.needsExportChoice && (
              <div className="grid gap-1.5">
                <Label className="text-xs">export *</Label>
                <Select
                  onValueChange={(exportId) => {
                    const next = integrationPlan(entry, exportId)
                    onChange({
                      ...form,
                      exportId,
                      credentials: {},
                      existingSecret: '',
                      config: {},
                      mode: next.kind === 'none' ? 'none' : 'inline',
                    })
                  }}
                  value={form.exportId}
                >
                  <SelectTrigger className="font-mono text-xs">
                    <SelectValue placeholder="选一个 export" />
                  </SelectTrigger>
                  <SelectContent>
                    {(entry?.exports ?? []).map(id => (
                      <SelectItem className="font-mono text-xs" key={id} value={id}>{id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}
      </FormSection>

      {form.provider !== '' && (
        <FormSection
          description="平台自动加密保管，不写入节点配置，也不会回显。"
          index="02"
          title="凭证"
        >
          <ManagedCredentialFields
            idPrefix={`${idPrefix}-credential`}
            onChange={credential => onChange({
              ...form,
              credentials: credential.credentials,
              existingSecret: credential.existingSecret,
              mode: credential.mode,
            })}
            plan={plan}
            secretNames={secretNames}
            state={form}
          />
        </FormSection>
      )}

      {form.provider !== '' && (plan.mountConfigFields.length > 0 || showEmptyConfig || showDescription) && (
        <FormSection
          description="非密钥配置(如自建实例地址),明文存进节点记录。"
          index="03"
          title={plan.mountConfigFields.some(field => field.required === true) ? '配置' : '配置(可选)'}
        >
          {plan.mountConfigFields.length > 0
            ? (
                <MountConfigFields
                  fields={plan.mountConfigFields}
                  idPrefix={`${idPrefix}-config`}
                  onChange={config => onChange({ ...form, config })}
                  value={form.config}
                />
              )
            : showEmptyConfig && (
              <p className="rounded-md border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                该 export 无需额外的非密钥配置。
              </p>
            )}
          {showDescription && (
            <div className="grid gap-1.5">
              <Label className="text-xs" htmlFor={`${idPrefix}-description`}>描述</Label>
              <Input
                id={`${idPrefix}-description`}
                onChange={event => onChange({ ...form, description: event.target.value })}
                placeholder={`${form.provider} integration at ${form.path.trim() || '<path>'}`}
                value={form.description}
              />
            </div>
          )}
        </FormSection>
      )}
    </>
  )
}
