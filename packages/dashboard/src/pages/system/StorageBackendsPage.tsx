import { parseStorageWrite, type StorageBackendView } from '@tool-bridge/sdk/client'
import { Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { ConfirmAction } from '@/components/ConfirmAction'
import { useStorageBackends } from '@/lib/management'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { useConn } from '@/lib/session-context'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { invoke } from '@/lib/api'
import { StorageConnectionFields } from './forms/StorageConnectionFields'
import { EMPTY_STORAGE_CONNECTION } from './forms/storageConnection'

export function StorageBackendsPage() {
  const conn = useConn()
  const backends = useStorageBackends()
  const [editing, setEditing] = useState<StorageBackendView | 'new' | null>(null)
  const [name, setName] = useState('')
  const [connection, setConnection] = useState(EMPTY_STORAGE_CONNECTION)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const reset = () => {
    setEditing(null)
    setConnection(EMPTY_STORAGE_CONNECTION)
    setName('')
  }
  const run = async (command: string, args: unknown) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await invoke(conn, `system/storage/${command}`, args)
      reset()
      await backends.refetch()
      setNotice(command === 'activate' ? '默认后端已切换。旧对象继续从原后端读取。' : '操作完成。')
    } catch {
      setError('操作失败。请检查连接和权限，刷新版本后重试；仍被引用的后端无法删除。')
    } finally { setBusy(false) }
  }
  const submit = async () => {
    try {
      if (editing === 'new') await run('write', parseStorageWrite({ name, connection }))
      else if (editing) await run('update', { id: editing.id, expectedRevision: editing.revision, accessKeyId: connection.accessKeyId, secretAccessKey: connection.secretAccessKey })
    } catch { setError('请填写完整的连接信息。凭证仅用于本次保存。') }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        actions={(
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void backends.refetch()} size="sm" variant="outline">
              <RefreshCw />
              刷新
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                reset()
                setEditing('new')
              }}
              size="sm"
            >
              <Plus />
              添加后端
            </Button>
          </div>
        )}
        description="验证 S3 连接后设为新上传的默认目标。已有对象与 Context 保留原后端。"
        title="存储后端"
      />
      {editing && (
        <section className="rounded-xl border bg-card p-4 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">{editing === 'new' ? '新建 S3 后端' : `轮换凭证 · ${editing.name}`}</h2>
          {editing === 'new' && (
            <div className="mb-4 grid gap-2">
              <Label htmlFor="backend-name">名称</Label>
              <Input id="backend-name" onChange={event => setName(event.target.value)} value={name} />
            </div>
          )}
          <StorageConnectionFields credentialsOnly={editing !== 'new'} disabled={busy} onChange={setConnection} value={connection} />
          <p className="mt-4 text-xs text-muted-foreground">凭证加密保存，不会回显。存储位置创建后不可修改；更换位置请添加新后端。</p>
          <div className="mt-5 flex gap-2">
            <Button disabled={busy} onClick={() => void submit()}>保存</Button>
            <Button disabled={busy} onClick={reset} variant="outline">取消</Button>
          </div>
        </section>
      )}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {notice && <p className="text-sm text-ok" role="status">{notice}</p>}
      {backends.isError && <p role="alert">读取失败，需要部署管理员权限。</p>}
      {backends.isPending && <p role="status">正在读取存储后端…</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {backends.data?.items.map(backend => (
          <section className="min-w-0 rounded-xl border bg-card p-5" key={backend.id}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{backend.name}</h2>
              {backend.active && <Badge>新上传默认</Badge>}
              <Badge variant="outline">{backend.validated ? '已验证' : '待验证'}</Badge>
            </div>
            <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">服务地址</dt>
              <dd className="break-all">{backend.endpoint}</dd>
              <dt className="text-muted-foreground">Bucket</dt>
              <dd className="break-all">{backend.bucket}</dd>
              <dt className="text-muted-foreground">Region</dt>
              <dd>{backend.region}</dd>
              <dt className="text-muted-foreground">配置版本</dt>
              <dd>
                {backend.revision}
                {' '}
                · 凭证
                {' '}
                {backend.credentialGeneration}
              </dd>
            </dl>
            {backend.validation && (
              <p className="mt-3 text-xs text-muted-foreground">
                最近验证：
                {new Date(backend.validation.at).toLocaleString()}
                {' '}
                · 清理
                {backend.validation.cleanupSucceeded ? '完成' : '失败'}
              </p>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void run('test', { id: backend.id, expectedRevision: backend.revision })} size="sm" variant="outline">测试读写</Button>
              <Button
                disabled={busy}
                onClick={() => {
                  reset()
                  setEditing(backend)
                }}
                size="sm"
                variant="outline"
              >
                轮换凭证
              </Button>
              {!backend.active && <Button disabled={busy || !backend.validated} onClick={() => void run('activate', { id: backend.id, expectedRevision: backend.revision, expectedActiveRevision: backend.activeRevision })} size="sm">用于新上传</Button>}
              {!backend.active && <ConfirmAction actionLabel="删除" description={<p>只有没有对象、会话和 Context 引用的后端可以删除。</p>} onConfirm={() => run('delete', { id: backend.id, expectedRevision: backend.revision })} title={`删除 ${backend.name}？`} trigger={<Button disabled={busy} size="sm" variant="outline">删除</Button>} />}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
