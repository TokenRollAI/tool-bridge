import { type ReactNode, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import type { CatalogListItem } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useIntegrationCatalog, useInvoke, useOAuthAuthorize, useSecretList } from '@/lib/queries'
import { FormSection } from '@/components/FormSection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  buildIntegrationCalls,
  defaultMountPath,
  INITIAL_INTEGRATION_FORM,
  type IntegrationFormState,
  integrationPlan,
} from './integrationPlan'
import { ManagedCredentialFields } from './ManagedCredentialFields'

/**
 * 集成挂载向导 —— 选集成 → 填凭证 → 挂载(需要时授权),一屏走完。
 *
 * 与 `MountDialog` 的分工:那个是**协议面的通用挂载器**(六个 kind、虚拟化、替换语义,
 * 面向知道自己在干什么的 admin);这个只做最常见那件事 —— 挂一个 provider,而且
 * 由 catalog 驱动:该填哪些字段、要不要授权、能挂成什么 kind 都从 descriptor 来,
 * 用户不必去翻插件源码,authRef 也不再是两处要打对的自由文本。
 */
export function IntegrationDialog({
  defaultPath,
  defaultProvider,
  trigger,
}: {
  defaultPath?: string
  /** 从目录某一行直接"添加"时预选的 provider —— 省得用户在向导里再搜一次。 */
  defaultProvider?: string
  trigger?: ReactNode
}) {
  const invoke = useInvoke()
  const oauth = useOAuthAuthorize()
  const qc = useQueryClient()
  const catalog = useIntegrationCatalog()
  const secrets = useSecretList()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<IntegrationFormState>(() => ({
    ...INITIAL_INTEGRATION_FORM,
    path: defaultPath ?? '',
  }))
  const [err, setErr] = useState<string | null>(null)

  // `?? []` 要包进 useMemo:裸写在渲染体里每次都是新数组引用,下面两个 useMemo 的
  // 依赖因此每次渲染都变,等于没有 memo(输入框每敲一下都重算整张目录的过滤)。
  const items = useMemo(() => catalog.data ?? [], [catalog.data])
  const entry: CatalogListItem | undefined = useMemo(
    () => items.find(i => i.id === form.provider),
    [items, form.provider],
  )
  const plan = integrationPlan(entry, form.exportId)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return items.slice(0, 50)
    return items
      .filter(i => i.id.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q))
      .slice(0, 50)
  }, [items, query])

  const submit = async () => {
    let calls: ReturnType<typeof buildIntegrationCalls>
    try {
      calls = buildIntegrationCalls(form, entry)
    } catch (buildError) {
      setErr((buildError as Error).message)
      return
    }

    let shouldDeleteOnFailure = false
    try {
      // 先写凭证再挂载:挂载时平台会用凭证跑 credentialProbe,顺序反了探针必失败。
      if (calls.secret !== undefined) {
        const knownSecret = (secrets.data?.items ?? []).some(item => item.name === calls.secret!.name)
        // secret set 是 upsert。只有列表已完整加载且确认名字此前不存在，失败时才可删除；
        // 否则可能把同名的既有凭证当成“本轮新建”误删。
        shouldDeleteOnFailure = secrets.data !== undefined && !secrets.hasNextPage && !knownSecret
        await invoke.mutateAsync({ path: 'system/secret', tool: 'set', args: calls.secret })
      }
      await invoke.mutateAsync({ path: 'system/registry', tool: 'write', args: calls.mount })
    } catch (error) {
      // 仅清理由本轮创建的 secret;复用已有凭证不动。即使回滚失败也保留原挂载错误。
      if (shouldDeleteOnFailure && calls.secret !== undefined) {
        await invoke.mutateAsync({
          path: 'system/secret',
          tool: 'delete',
          args: { name: calls.secret.name },
        }).catch(() => {})
      }
      setErr((error as Error).message)
      return
    }

    toast.success(`已挂载 ${form.provider} → ${calls.mount.path}`)
    setOpen(false)
    setErr(null)
    setForm({ ...INITIAL_INTEGRATION_FORM, path: '' })
    qc.invalidateQueries({ queryKey: ['tb'] })
    if (calls.needsAuthorize) {
      oauth.mutate(calls.mount.path, {
        onSuccess: (result) => {
          if (result.status === 'authorized') {
            toast.success(`${calls.mount.path} 已授权`)
          } else if (result.authorizationUrl) {
            window.open(result.authorizationUrl, '_blank', 'noopener')
            toast.info('已打开授权页,完成后即可调用')
          }
        },
        onError: error =>
          toast.error(
            /redirect/i.test(error.message)
              ? `该上游只允许 localhost 回调,请用 CLI:tb integration auth ${calls.mount.path} --local`
              : `发起授权失败:${error.message}`,
          ),
      })
    }
  }

  const changeOpen = (next: boolean) => {
    if (invoke.isPending) return
    setOpen(next)
    if (next) {
      setErr(null)
      // 从目录某行直接"添加":预选该 provider 并派生默认路径,用户落到已填好 provider 的向导。
      if (defaultProvider !== undefined) {
        const preset = items.find(i => i.id === defaultProvider)
        const exportId = preset?.exports.length === 1 ? preset.exports[0]! : ''
        setForm({
          ...INITIAL_INTEGRATION_FORM,
          provider: defaultProvider,
          path: defaultPath ?? defaultMountPath(preset),
          exportId,
          mode: integrationPlan(preset, exportId).kind === 'none' ? 'none' : 'inline',
        })
      }
    }
  }

  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus />
            添加集成
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="top-0 right-0 bottom-0 left-auto flex h-dvh max-h-none w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-3xl"
        showCloseButton={!invoke.isPending}
      >
        <DialogHeader className="border-b px-5 py-5 sm:px-7">
          <DialogTitle className="pr-8 text-lg">添加集成</DialogTitle>
          <DialogDescription>
            凭证与挂载一步完成。对等 CLI 的
            <code className="mx-1 font-mono text-xs">tb integration add</code>
            ;需要虚拟化或其他 kind 时用「挂载节点」。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          <div className="grid gap-5">
            <FormSection
              description="平台自带的集成目录:每一项都是这个部署里现成可用的代码。"
              index="01"
              title="选择集成"
            >
              <div className="grid gap-1.5">
                <Label className="text-xs" htmlFor="int-search">搜索</Label>
                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground"
                  />
                  <Input
                    className="pl-8 text-sm"
                    id="int-search"
                    onChange={event => setQuery(event.target.value)}
                    placeholder="tavily / jira / memos…"
                    value={query}
                  />
                </div>
              </div>
              {catalog.isPending && (
                <p className="text-xs text-muted-foreground">正在读取目录…</p>
              )}
              {catalog.isError && (
                <p className="text-xs text-muted-foreground">
                  读不到内置目录(需要对 system/catalog 的 read 权限)。仍可用「挂载节点」手工填写。
                </p>
              )}
              {!catalog.isPending && items.length > 0 && (
                <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border p-1">
                  {filtered.map(item => (
                    <button
                      className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/60 ${
                        form.provider === item.id ? 'bg-muted' : ''
                      }`}
                      key={item.id}
                      onClick={() => {
                        const exportId = item.exports.length === 1 ? item.exports[0]! : ''
                        const nextPlan = integrationPlan(item, exportId)
                        setForm(current => ({
                          ...current,
                          provider: item.id,
                          // path 尚空则给个默认(tools/<id> 或 notes/<id>),用户可改;不覆盖已输入的。
                          path: current.path.trim() === '' ? defaultMountPath(item) : current.path,
                          exportId,
                          // 换 provider 要清掉上一个的凭证与配置残留(字段名多半不同)。
                          credentials: {},
                          existingSecret: '',
                          config: {},
                          mode: nextPlan.kind === 'none' ? 'none' : 'inline',
                        }))
                      }}
                      type="button"
                    >
                      <code className="font-mono font-medium">{item.id}</code>
                      <span className="truncate text-muted-foreground">{item.description}</span>
                      {item.needsOAuth && (
                        <Badge className="ml-auto px-1 py-0 text-[10px]" variant="outline">
                          OAuth
                        </Badge>
                      )}
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">无匹配集成</p>
                  )}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label className="text-xs" htmlFor="int-path">挂载路径 *</Label>
                  <Input
                    className="font-mono text-sm"
                    id="int-path"
                    onChange={event =>
                      setForm(current => ({ ...current, path: event.target.value }))}
                    placeholder="tools/tavily"
                    value={form.path}
                  />
                </div>
                {plan.needsExportChoice && (
                  <div className="grid gap-1.5">
                    <Label className="text-xs">export *</Label>
                    <Select
                      onValueChange={(value) => {
                        const nextPlan = integrationPlan(entry, value)
                        setForm(current => ({
                          ...current,
                          exportId: value,
                          credentials: {},
                          existingSecret: '',
                          config: {},
                          mode: nextPlan.kind === 'none' ? 'none' : 'inline',
                        }))
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
              <p className="text-[11px] text-muted-foreground">
                同一个集成挂两次 = 两个独立实例(两个账号、两把 key),路径不同即可。
              </p>
            </FormSection>

            {form.provider !== '' && (
              <FormSection
                description="平台自动加密保管，不写入节点配置，也不会回显。"
                index="02"
                title="凭证"
              >
                <ManagedCredentialFields
                  idPrefix="integration-credential"
                  onChange={credential => setForm(current => ({
                    ...current,
                    credentials: credential.credentials,
                    existingSecret: credential.existingSecret,
                    mode: credential.mode,
                  }))}
                  plan={plan}
                  secretNames={(secrets.data?.items ?? []).map(item => item.name)}
                  state={{
                    credentials: form.credentials,
                    existingSecret: form.existingSecret,
                    mode: form.mode,
                  }}
                />
              </FormSection>
            )}

            {form.provider !== '' && (
              <FormSection
                description="非密钥配置(如自建实例地址),明文存进节点记录。"
                index="03"
                title={plan.mountConfigFields.some(f => f.required === true) ? '配置' : '配置(可选)'}
              >
                {/* catalog 声明了要配什么 → 渲染带标签的字段;无声明就明确告知无需配置。 */}
                {plan.mountConfigFields.length > 0
                  ? (
                      <div className="grid gap-2">
                        {plan.mountConfigFields.map(field => (
                          <div className="grid gap-1.5" key={field.key}>
                            <Label className="text-xs" htmlFor={`int-mc-${field.key}`}>
                              {field.key}
                              {field.required === true && ' *'}
                              {field.label !== undefined && (
                                <span className="ml-1.5 font-normal text-muted-foreground">
                                  {field.label}
                                </span>
                              )}
                            </Label>
                            <Input
                              className="font-mono text-sm"
                              id={`int-mc-${field.key}`}
                              onChange={event =>
                                setForm(current => ({
                                  ...current,
                                  config: { ...current.config, [field.key]: event.target.value },
                                }))}
                              value={form.config[field.key] ?? ''}
                            />
                            {field.description !== undefined && (
                              <p className="text-[11px] text-muted-foreground">{field.description}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )
                  : (
                      <p className="rounded-md border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                        该 export 无需额外的非密钥配置。
                      </p>
                    )}
                <div className="grid gap-1.5">
                  <Label className="text-xs" htmlFor="int-desc">描述</Label>
                  <Input
                    className="text-sm"
                    id="int-desc"
                    onChange={event =>
                      setForm(current => ({ ...current, description: event.target.value }))}
                    placeholder={`${form.provider} integration at ${form.path.trim() || '<path>'}`}
                    value={form.description}
                  />
                </div>
              </FormSection>
            )}

            {err && (
              <p
                className="rounded-md border border-destructive/30 bg-destructive/[0.045] px-3 py-2.5 text-xs text-destructive"
                role="alert"
              >
                {err}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="border-t bg-background px-5 py-4 sm:px-7">
          <Button disabled={invoke.isPending || form.provider === ''} onClick={submit}>
            {invoke.isPending && <Loader2 className="animate-spin" />}
            {invoke.isPending ? '正在写入' : `添加 ${form.provider || '集成'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
