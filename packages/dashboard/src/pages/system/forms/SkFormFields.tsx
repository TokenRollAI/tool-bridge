import { Plus, Trash2 } from 'lucide-react'
import { FormSection } from '@/components/FormSection'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ACTIONS } from '@/lib/types'
import type { SkFormState } from './skConfig'

export function SkFormFields({
  disabled,
  onChange,
  state,
}: {
  disabled: boolean
  onChange: (next: SkFormState) => void
  state: SkFormState
}) {
  const setScopes = (next: SkFormState['scopes']) => onChange({ ...state, scopes: next })
  return (
    <>
      <FormSection
        description="明确谁在使用这把钥匙，以及它承担的具体任务。"
        index="01"
        title="身份"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="sk-owner">owner *</Label>
            <Input
              autoComplete="off"
              className="font-mono text-sm"
              id="sk-owner"
              onChange={event => onChange({ ...state, owner: event.target.value })}
              placeholder="agent:researcher"
              value={state.owner}
            />
            <p className="text-[11px] text-muted-foreground">
              建议：user:alice / agent:bot / device:host
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sk-description">用途说明</Label>
            <Input
              id="sk-description"
              onChange={event => onChange({ ...state, description: event.target.value })}
              placeholder="只读知识库检索"
              value={state.description}
            />
            <p className="text-[11px] text-muted-foreground">用于列表识别和后续权限审计。</p>
          </div>
        </div>
      </FormSection>

      <FormSection
        description="每条规则由路径、动作和 allow / deny 共同构成。"
        index="02"
        title="权限"
      >
        <div className="grid gap-3">
          {state.scopes.map((row, index) => (
            <div
              className={`rounded-lg border p-3 ${
                row.effect === 'deny'
                  ? 'border-destructive/25 bg-destructive/[0.025]'
                  : 'bg-muted/10'
              }`}
              // biome-ignore lint/suspicious/noArrayIndexKey: scope 行在提交前没有稳定业务 id
              key={index}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    RULE
                    {' '}
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <Badge
                    className={
                      row.effect === 'deny'
                        ? 'border-destructive/30 text-destructive'
                        : 'border-ok/30 text-ok'
                    }
                    variant="outline"
                  >
                    {row.effect}
                  </Badge>
                </div>
                <Button
                  aria-label={`移除第 ${index + 1} 条 scope`}
                  disabled={disabled}
                  onClick={() => setScopes(state.scopes.filter((_, item) => item !== index))}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[minmax(180px,0.8fr)_1.6fr]">
                <div className="grid gap-1.5">
                  <Label className="text-xs" htmlFor={`scope-pattern-${index}`}>path pattern</Label>
                  <Input
                    className="h-9 font-mono text-xs"
                    id={`scope-pattern-${index}`}
                    onChange={event =>
                      setScopes(state.scopes.map((scope, item) =>
                        item === index ? { ...scope, pattern: event.target.value } : scope))}
                    placeholder="docs/**"
                    value={row.pattern}
                  />
                </div>
                <fieldset className="grid gap-1.5">
                  <legend className="text-xs font-medium">actions</legend>
                  <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2 rounded-md border bg-background/65 px-3 py-2">
                    {ACTIONS.map(action => (
                      // biome-ignore lint/a11y/noLabelWithoutControl: Radix Checkbox 在 label 内提供关联
                      <label className="flex items-center gap-1.5 font-mono text-xs" key={action}>
                        <Checkbox
                          checked={row.actions.includes(action)}
                          onCheckedChange={checked =>
                            setScopes(state.scopes.map((scope, item) =>
                              item === index
                                ? {
                                    ...scope,
                                    actions: checked
                                      ? [...scope.actions, action]
                                      : scope.actions.filter(value => value !== action),
                                  }
                                : scope))}
                        />
                        {action}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              <div className="mt-3 flex justify-end">
                {/* biome-ignore lint/a11y/noLabelWithoutControl: Radix Checkbox 在 label 内提供关联 */}
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={row.effect === 'deny'}
                    onCheckedChange={checked =>
                      setScopes(state.scopes.map((scope, item) =>
                        item === index
                          ? { ...scope, effect: checked ? 'deny' : 'allow' }
                          : scope))}
                  />
                  设为 deny 规则（优先于所有 allow）
                </label>
              </div>
            </div>
          ))}
          <Button
            className="justify-self-start"
            disabled={disabled}
            onClick={() => setScopes([
              ...state.scopes,
              { pattern: '', actions: ['read'], effect: 'allow' },
            ])}
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus />
            添加 scope 规则
          </Button>

          <div className="grid gap-1.5 border-t pt-4">
            <Label htmlFor="sk-register-paths">registerPaths（高级，可空）</Label>
            <Textarea
              className="font-mono text-xs"
              id="sk-register-paths"
              onChange={event => onChange({ ...state, registerPaths: event.target.value })}
              placeholder={'device/build-01/**\ndevice/build-02/**'}
              rows={3}
              value={state.registerPaths}
            />
            <p className="text-[11px] text-muted-foreground">
              每行一条；只约束反向注册路径，不会自动授予 register action。
            </p>
          </div>
        </div>
      </FormSection>

      <FormSection
        description="不填表示永久有效；短期自动化任务建议显式设置到期时间。"
        index="03"
        title="生命周期"
      >
        <div className="grid gap-1.5 sm:max-w-sm">
          <Label htmlFor="sk-expiry">过期时间（可空）</Label>
          <Input
            id="sk-expiry"
            onChange={event => onChange({ ...state, expiresAt: event.target.value })}
            type="datetime-local"
            value={state.expiresAt}
          />
        </div>
      </FormSection>
    </>
  )
}
