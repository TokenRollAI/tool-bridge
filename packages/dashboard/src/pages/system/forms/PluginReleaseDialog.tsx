import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { PluginManifest, PluginUpgradePreview } from '@/lib/types'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useInvoke } from '@/lib/queries'
import { ApiError } from '@/lib/api'

type PreviewArgs = { id: string, source?: string }
type ReleaseRequest
  = | { args: { origin?: string, secretRef: string, source: string }, operation: 'install' }
    | { args: PreviewArgs, operation: 'preview' }
    | { args: PreviewArgs & { candidateDigest: string }, operation: 'upgrade' }
    | { args: { digest: string, id: string }, operation: 'rollback' }

const pendingLabels = {
  install: '正在安装插件…',
  preview: '正在检查候选版本和挂载…',
  rollback: '正在回滚插件…',
  upgrade: '正在切换插件版本…',
}

function UpgradePreview({ preview }: { preview: PluginUpgradePreview }) {
  const { addedExports, changedExports, removedExports, affectedMounts, incompatibleMounts } = preview
  const exportChanges = [
    { label: '新增', exports: addedExports },
    { label: '变更', exports: changedExports },
    { label: '移除', exports: removedExports },
  ].filter(change => change.exports.length > 0)
  const incompatible = new Set(incompatibleMounts)

  return (
    <div aria-label="升级预览结果" className="space-y-4 border-t pt-4" role="region">
      <div role="status">
        <h3 className="font-medium">
          <span className="sr-only">升级预览已就绪。</span>
          {preview.currentVersion}
          <span aria-hidden="true">{' → '}</span>
          <span className="sr-only"> 升级至 </span>
          {preview.candidateVersion}
        </h3>
        {preview.requiresRunner && <p className="mt-1 text-sm text-muted-foreground">候选版本由隔离运行器托管。</p>}
      </div>
      <section className="space-y-1 text-sm">
        <h4 className="font-medium">导出变化</h4>
        {exportChanges.length === 0
          ? <p className="text-muted-foreground">导出契约无变化。</p>
          : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {exportChanges.map(change => (
                  <div className="contents" key={change.label}>
                    <dt className="text-muted-foreground">{change.label}</dt>
                    <dd className="min-w-0 font-mono text-xs break-all">{change.exports.join('、')}</dd>
                  </div>
                ))}
              </dl>
            )}
      </section>
      <section className="space-y-1 text-sm">
        <h4 className="font-medium">
          可见挂载（
          {affectedMounts.length}
          ）
        </h4>
        {incompatible.size > 0 && (
          <p className="font-medium text-destructive" role="alert">
            {incompatible.size}
            {' 个挂载与候选版本不兼容。升级后，这些挂载将无法解析导出。'}
          </p>
        )}
        {affectedMounts.length === 0
          ? <p className="text-muted-foreground">当前账号看不到引用此插件的挂载。</p>
          : (
              <ul className="space-y-1">
                {affectedMounts.map(path => (
                  <li className="flex items-baseline gap-2" key={path}>
                    {incompatible.has(path) && <span className="shrink-0 text-xs text-destructive">不兼容</span>}
                    <code className="min-w-0 text-xs break-all">{path}</code>
                  </li>
                ))}
              </ul>
            )}
      </section>
    </div>
  )
}

export function PluginReleaseDialog({
  plugin,
  onApplied,
}: {
  onApplied: (plugin: PluginManifest) => Promise<void>
  plugin?: PluginManifest
}) {
  const invoke = useInvoke()
  const fieldId = useId()
  const inFlight = useRef(false)
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState('')
  const [secretRef, setSecretRef] = useState('')
  const [origin, setOrigin] = useState('')
  const [preview, setPreview] = useState<{ args: PreviewArgs, data: PluginUpgradePreview } | null>(null)
  const [pending, setPending] = useState<ReleaseRequest['operation'] | null>(null)
  const [message, setMessage] = useState('')
  const installed = plugin?.distribution
  const previous = installed?.previous

  const run = async ({ operation, args }: ReleaseRequest) => {
    if (inFlight.current) return
    inFlight.current = true
    setPending(operation)
    setMessage('')
    setPreview(null)
    try {
      const response = await invoke.mutateAsync({ commandPath: `system/plugin/${operation}`, args })
      if (operation === 'preview') {
        const data = response.json as PluginUpgradePreview | null
        if (data?.id !== args.id || !/^sha256:[0-9a-f]{64}$/.test(data.candidateDigest)) {
          throw new Error('网关未返回有效的升级预览，请重新预览。')
        }
        setPreview({ args, data })
      } else {
        const updated = response.json as PluginManifest
        await onApplied(updated)
        setSource('')
        setSecretRef('')
        setOrigin('')
        setOpen(false)
        const version = updated.distribution?.active.version
        const action = { install: '已安装', rollback: '已回滚至', upgrade: '已升级至' }[operation]
        toast.success(`${updated.id} ${action}${version ? ` ${version}` : ''}`)
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : '请求失败'
      if (operation === 'upgrade' && error instanceof ApiError && error.status === 409) {
        setMessage(`升级预览已失效，请重新预览。${detail}`)
      } else if (operation === 'rollback' && error instanceof ApiError && error.status === 409) {
        setMessage(`回滚目标已变更，请关闭窗口并重新打开插件详情。${detail}`)
      } else {
        setMessage(detail)
      }
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  return (
    <Dialog
      onOpenChange={(value) => {
        if (inFlight.current) return
        setMessage('')
        setPreview(null)
        setOpen(value)
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={plugin ? 'outline' : 'default'}>
          {plugin ? '管理版本' : '从发布源安装'}
        </Button>
      </DialogTrigger>
      <DialogContent className="overflow-y-auto" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{plugin ? `管理 ${plugin.id} 的版本` : '从发布源安装插件'}</DialogTitle>
          <DialogDescription>
            {installed
              ? `当前版本 ${installed.active.version}。升级前可查看候选版本的导出变化与挂载影响。`
              : '安装会校验发布清单并注册插件。安装后可前往节点注册，将插件导出挂载到能力树。'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const releaseSource = source.trim()
            if (plugin) {
              void run({ operation: 'preview', args: { id: plugin.id, ...(releaseSource ? { source: releaseSource } : {}) } })
            } else if (releaseSource && secretRef.trim()) {
              void run({
                operation: 'install',
                args: { source: releaseSource, secretRef: secretRef.trim(), ...(origin.trim() ? { origin: origin.trim() } : {}) },
              })
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-source`}>{plugin ? '候选发布源（可选）' : '发布源'}</Label>
            <Input
              aria-describedby={`${fieldId}-source-help`}
              disabled={Boolean(pending)}
              id={`${fieldId}-source`}
              onChange={(event) => {
                setSource(event.target.value)
                setPreview(null)
                setMessage('')
              }}
              placeholder="npm:@example/plugin@1.2.0"
              required={!plugin}
              value={source}
            />
            <p className="text-xs text-muted-foreground" id={`${fieldId}-source-help`}>
              支持 HTTPS 清单、带固定版本的 npm 包和 GitHub Release。
              {installed && (
                <>
                  {' 留空会重新读取当前发布源 '}
                  <code className="break-all">{installed.active.source}</code>
                  。
                </>
              )}
            </p>
          </div>
          {!plugin && (
            <>
              <div className="space-y-2">
                <Label htmlFor={`${fieldId}-secret`}>插件 Bearer Secret 名称</Label>
                <Input disabled={Boolean(pending)} id={`${fieldId}-secret`} onChange={event => setSecretRef(event.target.value)} required value={secretRef} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${fieldId}-origin`}>批准的托管域（按需填写）</Label>
                <Input
                  aria-describedby={`${fieldId}-origin-help`}
                  disabled={Boolean(pending)}
                  id={`${fieldId}-origin`}
                  onChange={event => setOrigin(event.target.value)}
                  placeholder="https://plugin.example.org"
                  type="url"
                  value={origin}
                />
                <p className="text-xs text-muted-foreground" id={`${fieldId}-origin-help`}>
                  托管版使用 npm 或 GitHub Release 安装时须填写。直接使用 HTTPS 清单时默认采用清单所在域。
                </p>
              </div>
            </>
          )}
          {preview && <UpgradePreview preview={preview.data} />}
          {message && <p className="text-sm text-destructive" role="alert">{message}</p>}
          {pending && <p className="text-sm text-muted-foreground" role="status">{pendingLabels[pending]}</p>}
          <DialogFooter>
            {plugin && previous?.digest && !preview && (
              <Button
                disabled={Boolean(pending)}
                onClick={() => void run({ operation: 'rollback', args: { id: plugin.id, digest: previous.digest } })}
                type="button"
                variant="outline"
              >
                {`回滚至 ${previous.version}`}
              </Button>
            )}
            <Button
              disabled={Boolean(pending) || (!plugin && (!source.trim() || !secretRef.trim()))}
              type="submit"
              variant={preview ? 'outline' : 'default'}
            >
              {plugin ? (preview ? '重新预览' : '预览升级') : '安装插件'}
            </Button>
            {preview && (
              <Button
                disabled={Boolean(pending)}
                onClick={() => void run({
                  operation: 'upgrade',
                  args: { ...preview.args, candidateDigest: preview.data.candidateDigest },
                })}
                type="button"
              >
                {preview.data.incompatibleMounts.length > 0 ? '仍然升级' : '确认升级'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
