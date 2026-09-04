import { type ConfigStatus, parseRuntimeConfig } from '@tool-bridge/sdk/client'
import { Play, RefreshCw, Save } from 'lucide-react'
import { useState } from 'react'
import { useConfigSchema, useManagedConfig } from '@/lib/management'
import { SchemaFields } from '@/components/SchemaFields'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { useConn } from '@/lib/session-context'
import { Badge } from '@/components/ui/badge'
import { invoke } from '@/lib/api'
import { configSchemaFields } from './forms/configSchema'

function ConfigEditor({ status, schema, refresh }: { refresh: () => Promise<unknown>, schema: Record<string, unknown>, status: ConfigStatus }) {
  const conn = useConn()
  const [settings, setSettings] = useState<Record<string, unknown>>(status.desired)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const fields = configSchemaFields(schema)
  const changed = fields.filter(field => JSON.stringify(status.desired[field.key as keyof typeof status.desired]) !== JSON.stringify(status.effective[field.key as keyof typeof status.effective]))
  const run = async (operation: 'update' | 'apply') => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (operation === 'update') {
        const parsed = parseRuntimeConfig(settings)
        await invoke(conn, 'system/config/validate', parsed)
        await invoke(conn, 'system/config/update', { expectedRevision: status.revision, settings: parsed })
        setMessage('配置已保存，请应用此版本。')
      } else {
        await invoke(conn, 'system/config/apply', { expectedRevision: status.revision })
        setMessage('配置已应用。')
      }
      await refresh()
    } catch {
      setError('操作失败。请检查字段；如果其他管理员已修改配置，请刷新后重试。')
    } finally { setBusy(false) }
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4 text-sm">
        <Badge variant="outline">{status.state}</Badge>
        <span>
          期望版本
          {status.revision}
        </span>
        <span>
          生效版本
          {status.appliedRevision}
        </span>
        <Button disabled={busy || status.state === 'applied'} onClick={() => void run('apply')} size="sm">
          <Play />
          应用已保存版本
        </Button>
      </div>
      {status.lastError && <p className="text-sm text-destructive" role="alert">上次应用失败，请检查服务状态后重试。</p>}
      {changed.length > 0 && (
        <section className="rounded-lg border p-4 text-sm">
          <h2 className="font-medium">等待生效的字段</h2>
          <ul className="mt-2 space-y-1 text-muted-foreground">{changed.map(field => <li key={field.key}>{field.label}</li>)}</ul>
        </section>
      )}
      <section className="rounded-xl border bg-card p-4 sm:p-6">
        <h2 className="mb-5 text-lg font-semibold">运行设置</h2>
        <SchemaFields disabled={busy} fields={fields} idPrefix="runtime-config" onChange={setSettings} value={settings} />
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-4">
          <Button disabled={busy} onClick={() => void run('update')}>
            <Save />
            保存配置
          </Button>
          <p className="text-xs text-muted-foreground">保存与应用分别执行；冲突时不会覆盖其他管理员的修改。</p>
        </div>
      </section>
      {message && <p className="text-sm text-ok" role="status">{message}</p>}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  )
}

export function ConfigPage() {
  const config = useManagedConfig()
  const schema = useConfigSchema()
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        actions={(
          <Button onClick={() => void config.refetch()} size="sm" variant="outline">
            <RefreshCw />
            刷新
          </Button>
        )}
        description="管理运行设置，并核对期望配置与实际生效版本。"
        title="实例设置"
      />
      {(config.isError || schema.isError) && <p role="alert">配置读取失败，需要部署管理员权限。</p>}
      {(config.isPending || schema.isPending) && <p role="status">正在读取配置…</p>}
      {config.data && schema.data && <ConfigEditor key={config.data.revision} refresh={config.refetch} schema={schema.data} status={config.data} />}
    </div>
  )
}
