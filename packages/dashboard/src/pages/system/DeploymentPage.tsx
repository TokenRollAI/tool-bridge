import type { DeploymentStatus } from '@tool-bridge/sdk/client'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { SchemaFields } from '@/components/SchemaFields'
import { PageHeader } from '@/components/PageHeader'
import { useConn } from '@/lib/session-context'
import { Button } from '@/components/ui/button'
import { useKeyBase } from '@/lib/queries'
import { invoke } from '@/lib/api'
import { configSchemaFields } from './forms/configSchema'

function DeploymentEditor({ status, schema, refresh }: { refresh: () => Promise<unknown>, schema: Record<string, unknown>, status: DeploymentStatus }) {
  const conn = useConn()
  const [settings, setSettings] = useState<Record<string, unknown>>({ ...status.desired })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await invoke(conn, 'system/deployment/update', { expectedRevision: status.revision, settings })
      await refresh()
    } catch {
      setError('部署任务未创建。请检查设置、当前任务和配置版本后重试。')
    } finally {
      setBusy(false)
    }
  }
  const running = status.job?.state === 'queued' || status.job?.state === 'claimed'
  const effective = status.effective
  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap gap-4 text-sm">
          <span>
            状态：
            {status.state}
          </span>
          <span>
            执行器：
            {status.agentConnected ? '已连接' : '未连接'}
          </span>
          <span>
            期望版本
            {status.revision}
            {' '}
            / 生效版本
            {status.appliedRevision}
          </span>
        </div>
        {status.job && (
          <p className="mt-3 text-sm">
            最近任务：
            {status.job.state}
            {status.job.error ? ` · ${status.job.error}` : ''}
          </p>
        )}
        {effective && (
          <p className="mt-3 break-all text-sm text-muted-foreground">
            当前运行：
            {effective.image}
            {' '}
            ·
            {effective.bindAddress}
            :
            {effective.hostPort}
          </p>
        )}
      </section>
      {!status.agentConnected && (
        <section className="space-y-3 rounded-lg border p-5">
          <h2 className="font-semibold">连接部署主机上的执行器</h2>
          <p className="text-sm text-muted-foreground">先用 tb login 保存此实例的管理员档案，再在部署主机执行：</p>
          <code className="block overflow-x-auto rounded bg-muted p-3 text-xs">tb deployment agent --compose ./docker-compose.yml</code>
          <p className="text-xs text-muted-foreground">执行器只更新 app 服务。挂载目录必须位于所选 Compose 文件目录内。</p>
        </section>
      )}
      {effective && (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-5 text-lg font-semibold">应用部署设置</h2>
          <SchemaFields disabled={busy || running} fields={configSchemaFields(schema)} idPrefix="deployment" onChange={setSettings} value={settings} />
          <p className="mt-4 text-sm text-muted-foreground">新数据目录必须为空。执行器会停止应用并复制原实例引导数据、保留密钥与权限；实例身份不一致或健康检查失败时恢复旧配置。修改访问端口后，请通过新端口重新打开管理界面。</p>
          <Button className="mt-5" disabled={busy || running} onClick={() => void save()}>保存并提交部署任务</Button>
        </section>
      )}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  )
}

export function DeploymentPage() {
  const conn = useConn()
  const base = useKeyBase()
  const status = useQuery({ queryKey: [...base, 'deployment-status'], queryFn: async () => (await invoke(conn, 'system/deployment/get', {})).json as DeploymentStatus, refetchInterval: 3000 })
  const schema = useQuery({ queryKey: [...base, 'deployment-schema'], queryFn: async () => (await invoke(conn, 'system/deployment/schema', {})).json as Record<string, unknown> })
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        actions={(
          <Button onClick={() => void status.refetch()} size="sm" variant="outline">
            <RefreshCw />
            刷新
          </Button>
        )}
        description="由部署主机上的受限执行器应用镜像、端口与挂载设置，并验证实际运行的实例。"
        title="应用部署"
      />
      {(status.isError || schema.isError) && <p role="alert">无法读取部署状态，请确认管理员权限及当前服务地址。</p>}
      {status.data && schema.data && <DeploymentEditor key={`${status.data.revision}:${Boolean(status.data.effective)}`} refresh={status.refetch} schema={schema.data} status={status.data} />}
    </div>
  )
}
