import { createSetupClient, type MaintenanceStatus } from '@tool-bridge/sdk/client'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ConfirmAction } from '@/components/ConfirmAction'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { useConn } from '@/lib/session-context'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useKeyBase } from '@/lib/queries'
import { invoke } from '@/lib/api'

export function MaintenancePage() {
  const conn = useConn()
  const base = useKeyBase()
  const status = useQuery({ queryKey: [...base, 'maintenance-status'], queryFn: async () => (await invoke(conn, 'system/maintenance/status', {})).json as MaintenanceStatus, refetchInterval: 3000 })
  const identity = useQuery({ queryKey: [...base, 'instance-identity'], queryFn: () => createSetupClient({ baseUrl: conn.baseUrl }).status() })
  const [databaseUrl, setDatabaseUrl] = useState('')
  const [password, setPassword] = useState('')
  const [databaseAdminUrl, setDatabaseAdminUrl] = useState('')
  const [redisUrl, setRedisUrl] = useState('')
  const [disableRedis, setDisableRedis] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const run = async (operation: string, value: Record<string, unknown>) => {
    if (!status.data || !identity.data) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await invoke(conn, `system/maintenance/${operation}`, { ...value, expectedRevision: status.data.revision, ...(operation === 'redis' ? {} : { expectedInstanceId: identity.data.instanceId }) })
      setDatabaseUrl('')
      setPassword('')
      setDatabaseAdminUrl('')
      setRedisUrl('')
      await status.refetch()
      setNotice('维护操作已完成。')
    } catch {
      setError('维护失败，请检查连接和权限，并根据维护状态恢复；凭证不会显示在错误中。')
    } finally {
      setBusy(false)
    }
  }
  const blocked = busy || status.data?.journal?.phase === 'running' || !status.data || !identity.data
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader description="管理数据库迁移、登录凭证与 Redis。维护时暂停受影响的业务，验证完成后再切换。" title="数据库与连接维护" />
      {status.isError && <p role="alert">读取维护状态失败，需要管理员权限。</p>}
      {status.data && (
        <section className="rounded-xl border bg-card p-5 text-sm">
          <h2 className="font-semibold">当前数据库</h2>
          <p className="mt-2 break-all">
            {status.data.database.user}
            @
            {status.data.database.host}
            :
            {status.data.database.port}
            /
            {status.data.database.name}
          </p>
          <p className="mt-2 text-muted-foreground">
            配置版本
            {status.data.revision}
            {' '}
            · Redis
            {status.data.redisConfigured ? '已配置' : '未配置'}
          </p>
          {status.data.journal && (
            <p className="mt-3">
              最近维护：
              {status.data.journal.operation}
              {' '}
              /
              {status.data.journal.phase}
              {' '}
              /
              {status.data.journal.step}
            </p>
          )}
        </section>
      )}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {notice && <p className="text-sm text-ok" role="status">{notice}</p>}
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">迁移 PostgreSQL</h2>
        <p className="text-sm text-muted-foreground">目标必须是空数据库。服务会停写、备份、迁移并核对实例身份；失败保留原连接。</p>
        <div className="grid gap-2">
          <Label htmlFor="maintenance-database">目标 PostgreSQL 连接地址</Label>
          <Input autoComplete="off" disabled={blocked} id="maintenance-database" onChange={event => setDatabaseUrl(event.target.value)} type="password" value={databaseUrl} />
        </div>
        <ConfirmAction actionLabel="停写并迁移" description={<p>迁移期间业务暂时不可用。开始前请确认目标数据库为空并有足够空间。</p>} onConfirm={() => run('database', { databaseUrl })} title="开始数据库迁移？" trigger={<Button disabled={blocked || !databaseUrl}>开始迁移</Button>} />
      </section>
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">轮换数据库登录凭证</h2>
        <p className="text-sm text-muted-foreground">创建并验证新的登录身份后停用旧登录，数据库内容保持不变。</p>
        <div className="grid gap-2">
          <Label htmlFor="maintenance-password">新密码（至少 24 个字符）</Label>
          <Input autoComplete="new-password" disabled={blocked} id="maintenance-password" onChange={event => setPassword(event.target.value)} type="password" value={password} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="maintenance-db-admin">数据库管理连接（外置数据库可选）</Label>
          <Input autoComplete="off" disabled={blocked} id="maintenance-db-admin" onChange={event => setDatabaseAdminUrl(event.target.value)} type="password" value={databaseAdminUrl} />
          <p className="text-xs text-muted-foreground">仅本次使用，不保存。内置数据库自动使用受保护的管理凭证。</p>
        </div>
        <ConfirmAction actionLabel="验证并轮换" description={<p>保存新密码后继续。旧登录将停用，所有服务副本需使用新凭证重新连接。</p>} onConfirm={() => run('rotate_database_credentials', { password, ...(databaseAdminUrl ? { databaseAdminUrl } : {}) })} title="轮换数据库凭证？" trigger={<Button disabled={blocked || password.length < 24}>轮换凭证</Button>} />
      </section>
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">Redis 连接</h2>
        <p className="text-sm text-muted-foreground">用于设备跨副本路由。停用前先确保服务只有一个副本。</p>
        <label className="flex items-center gap-2 text-sm">
          <input checked={disableRedis} disabled={blocked} onChange={event => setDisableRedis(event.target.checked)} type="checkbox" />
          停用 Redis
        </label>
        {!disableRedis && (
          <div className="grid gap-2">
            <Label htmlFor="maintenance-redis">Redis 连接地址</Label>
            <Input autoComplete="off" disabled={blocked} id="maintenance-redis" onChange={event => setRedisUrl(event.target.value)} type="password" value={redisUrl} />
          </div>
        )}
        <Button disabled={blocked || (!disableRedis && !redisUrl)} onClick={() => void run('redis', { redisUrl: disableRedis ? null : redisUrl })}>验证并保存 Redis 配置</Button>
      </section>
    </div>
  )
}
