import type { KeyBackup, KeyStatus, KeyTarget } from '@tool-bridge/sdk/client'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ConfirmAction } from '@/components/ConfirmAction'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { useConn } from '@/lib/session-context'
import { useKeyBase } from '@/lib/queries'
import { invoke } from '@/lib/api'

export function KeysPage() {
  const conn = useConn()
  const base = useKeyBase()
  const status = useQuery({ queryKey: [...base, 'key-status'], queryFn: async () => (await invoke(conn, 'system/keys/status', {})).json as KeyStatus, refetchInterval: 3000 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revoke, setRevoke] = useState(false)
  const run = async (operation: string, input: Record<string, unknown>) => {
    setBusy(true)
    setError('')
    try {
      await invoke(conn, `system/keys/${operation}`, input)
      await status.refetch()
    } catch {
      setError('密钥操作失败，请检查任务状态、配置版本、引用数和保留期限后重试。')
    } finally {
      setBusy(false)
    }
  }
  const backup = async () => {
    setBusy(true)
    setError('')
    try {
      const value = (await invoke(conn, 'system/keys/backup', {})).json as KeyBackup
      const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
      try {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `tool-bridge-key-backup-${value.instanceId}.json`
        anchor.click()
      } finally { URL.revokeObjectURL(url) }
    } catch {
      setError('备份下载失败，请重试。')
    } finally {
      setBusy(false)
    }
  }
  const keySection = (target: KeyTarget, title: string) => {
    const ring = status.data?.[target]
    if (!ring || !status.data) return null
    const revision = status.data.revision
    return (
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <ConfirmAction actionLabel="开始轮换" description={<p>{target === 'encryption' ? '创建新根密钥并启动有界重加密任务。旧根在没有引用前继续保留。' : revoke ? '所有现有上传与分享令牌将立即失效。' : '旧签名根至少保留七天，现有令牌在原有效期内继续可用。'}</p>} onConfirm={() => run('rotate', { expectedRevision: revision, target, ...(target === 'signing' && revoke ? { revokeExisting: true } : {}) })} title={`轮换${title}？`} trigger={<Button disabled={busy} size="sm">轮换</Button>} />
        </div>
        {target === 'signing' && (
          <label className="flex items-center gap-2 text-sm">
            <input checked={revoke} disabled={busy} onChange={event => setRevoke(event.target.checked)} type="checkbox" />
            轮换时立即撤销现有令牌
          </label>
        )}
        <div className="space-y-3">
          {ring.keys.map(key => (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm" key={key.keyId}>
              <div>
                <p className="font-mono">
                  {key.keyId}
                  {' '}
                  {key.active ? '· 当前使用' : ''}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  引用数：
                  {key.references}
                  {key.retireAfter ? ` · 最早退役：${new Date(key.retireAfter).toLocaleString()}` : ''}
                </p>
              </div>
              {!key.active && <ConfirmAction actionLabel="退役密钥" description={<p>密钥退役后无法从此实例导出，请先保存备份。服务端仍会验证引用数和保留期限。</p>} onConfirm={() => run('retire', { expectedRevision: revision, keyId: key.keyId, target })} title={`退役 ${key.keyId}？`} trigger={<Button disabled={busy || key.references > 0 || Boolean(key.retireAfter && Date.parse(key.retireAfter) > Date.now())} size="sm" variant="outline">退役</Button>} />}
            </div>
          ))}
        </div>
      </section>
    )
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader actions={<Button disabled={busy || !status.data} onClick={() => void backup()}>下载密钥备份</Button>} description="查看加密与签名根的引用和保留期限，分步执行轮换，下载用于恢复的密钥备份。" title="实例密钥" />
      <p className="text-sm text-muted-foreground">备份包含敏感根密钥，请保存在离线加密位置。页面不显示根密钥内容。</p>
      {(error || status.isError) && <p className="text-sm text-destructive" role="alert">{error || '无法读取密钥状态，需要管理员权限。'}</p>}
      {keySection('encryption', '加密根')}
      {keySection('signing', '签名根')}
      {(status.data?.jobs.length ?? 0) > 0 && (
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="text-lg font-semibold">轮换任务</h2>
          {status.data?.jobs.map(job => (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm" key={job.id}>
              <div>
                <p className="font-mono">{job.id}</p>
                <p className="mt-1 text-muted-foreground">
                  {job.phase}
                  {' '}
                  ·
                  {' '}
                  {job.status}
                  {' '}
                  · 已处理
                  {' '}
                  {job.changed}
                  {' '}
                  条
                </p>
              </div>
              {job.status !== 'completed' && <Button disabled={busy} onClick={() => void run('resume', { jobId: job.id })} size="sm">继续处理下一批</Button>}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
