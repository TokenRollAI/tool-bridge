import { Loader2, Plus, TriangleAlert } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { RegistryNode } from '@/lib/types'
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
  useIntegrationCatalog,
  useInvalidate,
  useInvoke,
  useOAuthAuthorize,
  usePluginList,
  useSecretList,
} from '@/lib/queries'
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
import {
  buildRegistryMountCalls,
  catalogPluginsForMount,
  credentialPlanFor,
  existingManagedAuthRef,
  exportOptionsFor,
  INITIAL_REGISTRY_MOUNT_FORM,
  type MountKind,
  type RegistryMountFormState,
} from './registryConfig'
import { RegistryKindFields } from './RegistryKindFields'

export function MountDialog({
  existingNodes = [],
  existingPaths,
  hasUnloadedPaths = false,
  defaultPath,
  defaultKind,
  trigger,
}: {
  /** 打开时预选的 kind(向导按来源分流时用);缺省 mcp。 */
  defaultKind?: MountKind
  defaultPath?: string
  existingNodes?: RegistryNode[]
  existingPaths: string[]
  hasUnloadedPaths?: boolean
  trigger?: ReactNode
}) {
  const invoke = useInvoke()
  const oauth = useOAuthAuthorize()
  const invalidate = useInvalidate()
  const plugins = usePluginList()
  const catalog = useIntegrationCatalog()
  const secrets = useSecretList()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<RegistryMountFormState>(() => ({
    ...INITIAL_REGISTRY_MOUNT_FORM,
    ...(defaultKind !== undefined ? { kind: defaultKind } : {}),
    path: defaultPath ?? '',
  }))
  const [err, setErr] = useState<string | null>(null)
  const normalizedPath = form.path.trim()
  const existingNode = existingNodes.find(node => node.path === normalizedPath)
  const isReplacement = existingNode !== undefined || existingPaths.includes(normalizedPath)
  const mayReplaceUnloaded = normalizedPath !== '' && !isReplacement && hasUnloadedPaths
  const pluginItems = useMemo(() => {
    const byId = new Map(catalogPluginsForMount(catalog.data ?? []).map(item => [item.id, item]))
    // 显式注册的同名 external plugin 覆盖内置项,与网关 `https:` 契约优先级一致。
    for (const item of plugins.data?.items ?? []) byId.set(item.id, item)
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
  }, [catalog.data, plugins.data?.items])
  const toolExportOptions = exportOptionsFor(pluginItems, form.toolProvider, 'tools/v1')
  const contextExportOptions = exportOptionsFor(pluginItems, form.provider, 'context/v1')
  const toolBuiltin = pluginItems
    .find(item => item.id === form.toolProvider)
    ?.endpoint.startsWith('binding:') === true
  const contextBuiltin = pluginItems
    .find(item => item.id === form.provider)
    ?.endpoint.startsWith('binding:') === true
  const managedFallback = existingManagedAuthRef(existingNode, form, {
    context: contextExportOptions,
    tool: toolExportOptions,
  })

  const submit = async () => {
    let calls: ReturnType<typeof buildRegistryMountCalls>
    try {
      calls = buildRegistryMountCalls(
        form,
        { context: contextExportOptions, tool: toolExportOptions },
        { contextBuiltin, existing: existingNode, toolBuiltin },
      )
    } catch (buildError) {
      setErr((buildError as Error).message)
      return
    }

    let shouldDeleteOnFailure = false
    try {
      if (calls.secret !== undefined) {
        const knownSecret = (secrets.data?.items ?? []).some(item => item.name === calls.secret!.name)
        // secret set 是 upsert。替换/轮换已有槽时不能删除；列表未完整加载时也不能
        // 把“当前页没看到”当成“不存在”。只有确认是新路径的新槽才清理孤儿。
        shouldDeleteOnFailure = !isReplacement
          && secrets.data !== undefined
          && !secrets.hasNextPage
          && !knownSecret
        await invoke.mutateAsync({ path: 'system/secret', tool: 'set', args: calls.secret })
      }
      await invoke.mutateAsync({ path: 'system/registry', tool: 'write', args: calls.mount })
    } catch (error) {
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

    const mounted = calls.mount.path
    toast.success(
      isReplacement
        ? `已替换挂载 ${mounted}`
        : mayReplaceUnloaded
          ? `已写入挂载 ${mounted}`
          : `已挂载 ${mounted}`,
    )
    setOpen(false)
    setErr(null)
    setForm({ ...INITIAL_REGISTRY_MOUNT_FORM, path: '' })
    invalidate()
    const needsOAuth = form.kind === 'mcp'
      ? form.mcpAuthMode === 'oauth'
      : form.kind === 'tool'
        && credentialPlanFor(toolExportOptions, form.toolExport).kind === 'oauth'
    if (needsOAuth) {
      oauth.mutate(mounted, {
        onSuccess: (result) => {
          if (result.status === 'authorized') {
            toast.success(`${mounted} 已授权（凭证有效）`)
          } else if (result.authorizationUrl) {
            window.open(result.authorizationUrl, '_blank', 'noopener')
            toast.info('已打开授权页，完成授权后即可调用')
          }
        },
        onError: error =>
          toast.error(
            /redirect/i.test(error.message)
              ? `该上游只允许 localhost 回调，请用 CLI 完成授权：tb tool auth ${mounted} --local`
              : `发起授权失败：${error.message}`,
          ),
      })
    }
  }

  const changeOpen = (next: boolean) => {
    if (invoke.isPending) return
    setOpen(next)
    if (next) {
      setErr(null)
      if (defaultPath !== undefined || defaultKind !== undefined) {
        setForm(current => ({
          ...current,
          ...(defaultKind !== undefined ? { kind: defaultKind } : {}),
          ...(defaultPath !== undefined ? { path: defaultPath } : {}),
        }))
      }
    }
  }

  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus />
            挂载节点
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="top-0 right-0 bottom-0 left-auto flex h-dvh max-h-none w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-3xl"
        showCloseButton={!invoke.isPending}
      >
        <DialogHeader className="border-b px-5 py-5 sm:px-7">
          <DialogTitle className="pr-8 text-lg">
            {isReplacement ? '替换现有节点' : '挂载节点'}
          </DialogTitle>
          <DialogDescription>
            <code className="font-mono text-xs">system/registry write</code>
            {' '}
            是 upsert：同 path 会替换原记录。切换 kind 会保留各分支草稿。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          <div className="grid gap-5">
            <FormSection
              description="确定节点在能力树中的位置、类型与面向使用者的说明。"
              index="01"
              title="基础身份"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label className="text-xs">kind</Label>
                  <Select
                    onValueChange={value =>
                      setForm(current => ({ ...current, kind: value as MountKind }))}
                    value={form.kind}
                  >
                    <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem className="font-mono text-xs" value="mcp">mcp — MCP server</SelectItem>
                      <SelectItem className="font-mono text-xs" value="http">http — HTTP endpoint</SelectItem>
                      <SelectItem className="font-mono text-xs" value="context">context — 存储 namespace</SelectItem>
                      <SelectItem className="font-mono text-xs" value="skillhub">skillhub — Agent 技能目录</SelectItem>
                      <SelectItem className="font-mono text-xs" value="remote">remote — 联邦 HTBP 服务</SelectItem>
                      <SelectItem className="font-mono text-xs" value="tool">tool — plugin 工具源</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs" htmlFor="mount-path">path *</Label>
                  <Input
                    className="font-mono text-sm"
                    id="mount-path"
                    onChange={event =>
                      setForm(current => ({ ...current, path: event.target.value }))}
                    placeholder="docs/context7"
                    value={form.path}
                  />
                </div>
              </div>

              {(isReplacement || mayReplaceUnloaded) && (
                <div className="flex items-start gap-2.5 rounded-lg border border-warn/30 bg-warn/[0.045] px-3 py-2.5 text-xs">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warn" />
                  <p>
                    <span className="font-medium text-warn">
                      {isReplacement ? '这个 path 已存在。' : '列表还有未加载页，该 path 可能已经存在。'}
                    </span>
                    {' '}
                    继续写入会整体替换同 path 的 kind、描述、连接配置与虚拟化设置。
                  </p>
                </div>
              )}

              <div className="grid gap-1.5">
                <Label className="text-xs" htmlFor="mount-desc">描述 *</Label>
                <Input
                  className="text-sm"
                  id="mount-desc"
                  onChange={event =>
                    setForm(current => ({ ...current, description: event.target.value }))}
                  value={form.description}
                />
              </div>
            </FormSection>

            <RegistryKindFields
              fetchNextPlugins={() => void plugins.fetchNextPage()}
              hasExistingManagedCredential={managedFallback !== undefined}
              hasNextPlugins={plugins.hasNextPage}
              isFetchingNextPlugins={plugins.isFetchingNextPage}
              onChange={setForm}
              pluginItems={pluginItems}
              secretNames={(secrets.data?.items ?? []).map(item => item.name)}
              state={form}
            />

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
          <Button disabled={invoke.isPending} onClick={() => void submit()}>
            {invoke.isPending && <Loader2 className="animate-spin" />}
            {invoke.isPending
              ? '正在写入'
              : isReplacement || mayReplaceUnloaded
                ? `确认写入 ${form.path.trim() || form.kind}`
                : `挂载 ${form.path.trim() || form.kind}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
