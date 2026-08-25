import { type ReactNode, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useIntegrationCatalog, useInvalidate, useInvoke, useOAuthAuthorize, useSecretList } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import {
  buildIntegrationCalls,
  defaultMountPath,
  INITIAL_INTEGRATION_FORM,
  type IntegrationFormState,
  integrationPlan,
} from './integrationPlan'
import { CatalogIntegrationFields } from './CatalogIntegrationFields'

/**
 * 集成挂载向导 —— 选集成 → 填凭证 → 挂载(需要时授权),一屏走完。
 *
 * 与 `MountDialog` 的分工:那个是**协议面的通用挂载器**(全部 kind、虚拟化、替换语义,
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
  const invalidate = useInvalidate()
  const catalog = useIntegrationCatalog()
  const secrets = useSecretList()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<IntegrationFormState>(() => ({
    ...INITIAL_INTEGRATION_FORM,
    path: defaultPath ?? '',
  }))
  const [err, setErr] = useState<string | null>(null)
  const items = catalog.data ?? []
  const entry = items.find(item => item.id === form.provider)

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
        await invoke.mutateAsync({ commandPath: 'system/secret/set', args: calls.secret })
      }
      await invoke.mutateAsync({ commandPath: 'system/registry/write', args: calls.mount })
    } catch (error) {
      // 仅清理由本轮创建的 secret;复用已有凭证不动。即使回滚失败也保留原挂载错误。
      if (shouldDeleteOnFailure && calls.secret !== undefined) {
        await invoke.mutateAsync({
          commandPath: 'system/secret/delete',
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
    invalidate()
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
            <CatalogIntegrationFields
              catalog={items}
              catalogError={catalog.isError}
              catalogPending={catalog.isPending}
              form={form}
              idPrefix="integration"
              onChange={setForm}
              secretNames={(secrets.data?.items ?? []).map(item => item.name)}
              showDescription
              showEmptyConfig
              showPathWithoutProvider
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
          <Button disabled={invoke.isPending || form.provider === ''} onClick={submit}>
            {invoke.isPending && <Loader2 className="animate-spin" />}
            {invoke.isPending ? '正在写入' : `添加 ${form.provider || '集成'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
