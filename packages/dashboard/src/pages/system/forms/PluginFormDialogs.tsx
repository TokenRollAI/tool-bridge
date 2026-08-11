import { Check, FileCheck2, Loader2, Plus } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import type { PluginManifest, PluginRegistration } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useInvoke } from '@/lib/queries'
import {
  buildPluginManifestFields,
  INITIAL_MANIFEST_FORM,
  manifestFormState,
  type ManifestFormState,
} from './pluginManifest'
import { PluginManifestFields } from './PluginManifestFields'

export function RegisterPluginDialog({
  onToken,
  onRegistered,
}: {
  onRegistered: (id: string) => void
  onToken: (value: { id: string, token: string }) => void
}) {
  const invoke = useInvoke()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [id, setId] = useState('')
  const [form, setForm] = useState<ManifestFormState>(INITIAL_MANIFEST_FORM)
  const [error, setError] = useState<string | null>(null)

  const changeOpen = (next: boolean) => {
    if (invoke.isPending) return
    setOpen(next)
    if (!next) {
      setError(null)
      invoke.reset()
    }
  }

  const submit = () => {
    if (id.trim() === '') {
      setError('Plugin id 必填。')
      return
    }
    let fields: ReturnType<typeof buildPluginManifestFields>
    try {
      fields = buildPluginManifestFields(form)
    } catch (buildError) {
      setError((buildError as Error).message)
      return
    }
    invoke.mutate(
      {
        path: 'system/plugin',
        tool: 'write',
        args: { id: id.trim(), ...fields },
      },
      {
        onSuccess: (response) => {
          const registration = response.json as PluginRegistration
          toast.success(`Plugin ${registration.id} 已通过探活与契约校验`)
          setOpen(false)
          setError(null)
          setId('')
          setForm(INITIAL_MANIFEST_FORM)
          onRegistered(registration.id)
          if (registration.pluginToken) {
            onToken({ id: registration.id, token: registration.pluginToken })
            setTimeout(() => invoke.reset(), 0)
          }
          qc.invalidateQueries({ queryKey: ['tb'] })
        },
        onError: submitError => setError(submitError.message),
      },
    )
  }

  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus />
          注册 Plugin
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[90svh] overflow-y-auto p-4 sm:max-w-2xl sm:p-6"
        onEscapeKeyDown={event => invoke.isPending && event.preventDefault()}
        onPointerDownOutside={event => invoke.isPending && event.preventDefault()}
        showCloseButton={!invoke.isPending}
      >
        <DialogHeader>
          <DialogTitle className="text-base">注册 Plugin</DialogTitle>
          <DialogDescription>
            Write 会先探活，再验证 ~describe；任一步失败都不会写入注册表。同 id
            重注册会换发并吊销上一代 platform-token。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <section className="rounded-lg border bg-card/30">
            <div className="flex items-start gap-3 border-b px-4 py-3">
              <span className="mt-0.5 font-mono text-[10px] text-primary">00</span>
              <div>
                <h3 className="text-xs font-medium">Identity</h3>
                <p className="mt-0.5 text-[10px] leading-5 text-muted-foreground">
                  稳定的注册表主键，也会被节点配置以 plugin:&lt;id&gt; 引用。
                </p>
              </div>
            </div>
            <div className="grid gap-1.5 p-4">
              <Label className="text-xs" htmlFor="register-plugin-id">
                Plugin id *
              </Label>
              <Input
                aria-describedby={error ? 'register-plugin-error' : undefined}
                className="font-mono text-sm"
                disabled={invoke.isPending}
                id="register-plugin-id"
                onChange={(event) => {
                  setId(event.target.value)
                  setError(null)
                }}
                placeholder="my-provider"
                value={id}
              />
              <p className="text-[10px] text-muted-foreground">
                允许 A–Z、a–z、0–9、点、下划线和短横线，且不能以标点开头。
              </p>
            </div>
          </section>

          <PluginManifestFields
            disabled={invoke.isPending}
            idPrefix="register-plugin"
            onChange={(next) => {
              setForm(next)
              setError(null)
            }}
            state={form}
          />

          {error && (
            <p
              className="rounded-md border border-destructive/35 bg-destructive/[0.05] px-3 py-2.5 text-xs leading-5 text-destructive"
              id="register-plugin-error"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="border-t pt-4">
          <Button disabled={invoke.isPending} onClick={() => changeOpen(false)} variant="outline">
            取消
          </Button>
          <Button disabled={invoke.isPending} onClick={submit}>
            {invoke.isPending ? <Loader2 className="animate-spin" /> : <FileCheck2 />}
            {invoke.isPending ? '正在探活并校验…' : '验证并注册'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** update 会整体重校验；认证切到 platform-token 时，响应含一次性 token。 */
export function EditPluginDialog({
  plugin,
  onClose,
  onToken,
  onUpdated,
}: {
  onClose: () => void
  onToken: (value: { id: string, token: string }) => void
  onUpdated: (id: string) => void
  plugin: PluginManifest
}) {
  const invoke = useInvoke()
  const qc = useQueryClient()
  const [form, setForm] = useState<ManifestFormState>(() => manifestFormState(plugin))
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (invoke.isPending) return
    invoke.reset()
    onClose()
  }

  const submit = () => {
    let fields: ReturnType<typeof buildPluginManifestFields>
    try {
      fields = buildPluginManifestFields(form)
    } catch (buildError) {
      setError((buildError as Error).message)
      return
    }
    invoke.mutate(
      {
        path: 'system/plugin',
        tool: 'update',
        args: { id: plugin.id, patch: fields },
      },
      {
        onSuccess: (response) => {
          const registration = response.json as PluginRegistration
          toast.success(`Plugin ${plugin.id} 已更新`)
          onUpdated(plugin.id)
          onClose()
          if (registration.pluginToken) {
            onToken({ id: plugin.id, token: registration.pluginToken })
            setTimeout(() => invoke.reset(), 0)
          }
          qc.invalidateQueries({ queryKey: ['tb'] })
        },
        onError: submitError => setError(submitError.message),
      },
    )
  }

  return (
    <Dialog onOpenChange={open => !open && close()} open>
      <DialogContent
        className="max-h-[90svh] overflow-y-auto p-4 sm:max-w-2xl sm:p-6"
        onEscapeKeyDown={event => invoke.isPending && event.preventDefault()}
        onPointerDownOutside={event => invoke.isPending && event.preventDefault()}
        showCloseButton={!invoke.isPending}
      >
        <DialogHeader>
          <DialogTitle className="font-mono text-base">
            编辑
            {plugin.id}
          </DialogTitle>
          <DialogDescription>
            Endpoint、healthPath 或协议版本变化时会重新探活并校验 ~describe；失败不会覆盖当前
            manifest。enabled 与认证引用变更不触发远端契约刷新。
          </DialogDescription>
        </DialogHeader>

        <PluginManifestFields
          disabled={invoke.isPending}
          idPrefix={`edit-plugin-${plugin.id}`}
          onChange={(next) => {
            setForm(next)
            setError(null)
          }}
          state={form}
        />

        {error && (
          <p
            className="rounded-md border border-destructive/35 bg-destructive/[0.05] px-3 py-2.5 text-xs leading-5 text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}

        <DialogFooter className="border-t pt-4">
          <Button disabled={invoke.isPending} onClick={close} variant="outline">
            取消
          </Button>
          <Button disabled={invoke.isPending} onClick={submit}>
            {invoke.isPending ? <Loader2 className="animate-spin" /> : <Check />}
            {invoke.isPending ? '正在验证变更…' : '保存 Manifest'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
