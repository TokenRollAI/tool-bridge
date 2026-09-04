import { createSetupClient, type RecoveryResult, type SetupDefaults, type SetupResult, type SetupStatus } from '@tool-bridge/sdk/client'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { useEffect, useState } from 'react'
import { useSession } from '@/lib/session-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StorageConnectionFields } from './system/forms/StorageConnectionFields'
import { EMPTY_STORAGE_CONNECTION } from './system/forms/storageConnection'

/** Pairing and infrastructure credentials live only in short-lived component state. */
export function SetupPage() {
  const navigate = useNavigate()
  const { login } = useSession()
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [defaults, setDefaults] = useState<SetupDefaults | null>(null)
  const [token, setToken] = useState('')
  const [externalDatabase, setExternalDatabase] = useState(false)
  const [externalStorage, setExternalStorage] = useState(false)
  const [databaseUrl, setDatabaseUrl] = useState('')
  const [storage, setStorage] = useState(EMPTY_STORAGE_CONNECTION)
  const [redisUrl, setRedisUrl] = useState('')
  const [canonicalOrigin, setCanonicalOrigin] = useState('')
  const [result, setResult] = useState<SetupResult | RecoveryResult | null>(null)
  const [saved, setSaved] = useState(false)
  const [backup, setBackup] = useState<unknown>(undefined)
  const recovering = status?.state === 'recovery'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const client = () => createSetupClient({ baseUrl: '', timeoutMs: 120000 })
  useEffect(() => {
    let active = true
    void createSetupClient({ baseUrl: '' }).status().then((value) => {
      if (active) setStatus(value)
    }).catch(() => {
      if (active) setError('无法读取安装状态，请检查服务是否已启动。')
    })
    return () => {
      active = false
    }
  }, [])
  const pair = async () => {
    setBusy(true)
    setError('')
    try {
      const value = await client().defaults(token)
      setDefaults(value)
      setExternalDatabase(!value.databaseConfigured)
      setExternalStorage(!recovering && !value.storageConfigured)
    } catch {
      setError('配对失败，请使用此实例当前的一次性配对凭证。')
    } finally {
      setBusy(false)
    }
  }
  const configure = async () => {
    setBusy(true)
    setError('')
    try {
      const input = {
        ...(externalDatabase ? { databaseUrl } : {}),
        ...(externalStorage ? { storage } : {}),
        ...(redisUrl ? { redisUrl } : {}),
        settings: { canonicalOrigin },
      }
      const configured = recovering
        ? await client().recover(token, { ...input, ...(backup === undefined ? {} : { backup }) })
        : await client().configure(token, input)
      setResult(configured)
      setBackup(undefined)
      setToken('')
      setDatabaseUrl('')
      setStorage(EMPTY_STORAGE_CONNECTION)
      setRedisUrl('')
    } catch {
      setError('安装未完成。请检查连接地址、凭证与服务状态，修正后继续。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="min-h-svh bg-background px-4 py-8 text-foreground sm:py-12">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link className="font-mono text-sm text-primary" to="/">tool-bridge</Link>
        <header className="space-y-3">
          <ShieldCheck className="size-9 text-primary" />
          <h1 className="text-3xl font-semibold">安装你的 Tool Bridge</h1>
          <p className="text-sm leading-6 text-muted-foreground">连接持久化服务并创建管理员。内置服务的凭证由安装器管理。</p>
        </header>
        {error && <p className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive" role="alert">{error}</p>}
        {!status && !error && <p role="status">正在读取安装状态…</p>}
        {status?.state === 'recovery' && (
          <section className="rounded-xl border p-6">
            <h2 className="font-semibold">实例需要恢复</h2>
            <p className="mt-2 text-sm text-muted-foreground">已初始化实例无法重新安装。请从部署控制台检查数据库、持久卷和根密钥，再恢复服务。</p>
          </section>
        )}
        {status?.state === 'ready' && !result && (
          <section className="rounded-xl border p-6">
            <p>实例已安装完成。</p>
            <Button asChild className="mt-4"><Link to="/">前往登录</Link></Button>
          </section>
        )}
        {status?.state === 'installing' && !result && <p role="status">安装正在执行，请等待完成后刷新状态。</p>}
        {(status?.state === 'setup' || recovering) && !result && !defaults && (
          <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6">
            <h2 className="text-lg font-semibold">1. 配对实例</h2>
            <p className="text-sm leading-6 text-muted-foreground">在部署主机执行以下命令读取一次性配对凭证，然后粘贴到此处。</p>
            <code className="block overflow-x-auto rounded-md bg-muted p-3 text-xs">
              {`docker compose exec -T app node /app/dist/admin.js ${recovering ? 'recover' : 'pair'}`}
            </code>
            <p className="text-xs text-muted-foreground">
              {`使用 npm 安装时：tb setup pair --directory /data/bootstrap${recovering ? ' --recovery' : ''}`}
            </p>
            <div className="grid gap-2">
              <Label htmlFor="setup-token">一次性配对凭证</Label>
              <Input autoComplete="off" disabled={busy} id="setup-token" onChange={event => setToken(event.target.value)} type="password" value={token} />
            </div>
            <Button disabled={busy || !token} onClick={() => void pair()}>
              {busy && <Loader2 className="animate-spin" />}
              配对并读取服务
            </Button>
          </section>
        )}
        {defaults && !result && (
          <section className="space-y-6 rounded-xl border bg-card p-5 sm:p-6">
            <h2 className="text-lg font-semibold">2. 配置服务</h2>
            {defaults.databaseConfigured && (
              <label className="flex items-center gap-2 text-sm">
                <input checked={externalDatabase} disabled={busy} onChange={event => setExternalDatabase(event.target.checked)} type="checkbox" />
                使用外部 PostgreSQL（默认使用内置服务）
              </label>
            )}
            {externalDatabase
              ? (
                  <div className="grid gap-2">
                    <Label htmlFor="setup-database">PostgreSQL 连接地址</Label>
                    <Input autoComplete="off" disabled={busy} id="setup-database" onChange={event => setDatabaseUrl(event.target.value)} placeholder="postgresql://user:password@host:5432/toolbridge" type="password" value={databaseUrl} />
                  </div>
                )
              : (
                  <p className="text-sm text-muted-foreground">
                    PostgreSQL：
                    {defaults.databaseHost ?? '内置服务已就绪'}
                  </p>
                )}
            {!recovering && (
              <div className="border-t pt-5">
                {defaults.storageConfigured && (
                  <label className="mb-4 flex items-center gap-2 text-sm">
                    <input checked={externalStorage} disabled={busy} onChange={event => setExternalStorage(event.target.checked)} type="checkbox" />
                    使用外部 S3（默认使用内置服务）
                  </label>
                )}
                {externalStorage
                  ? <StorageConnectionFields disabled={busy} onChange={setStorage} value={storage} />
                  : (
                      <p className="text-sm text-muted-foreground">
                        S3：
                        {defaults.storage?.endpoint}
                        {' '}
                        /
                        {defaults.storage?.bucket}
                      </p>
                    )}
              </div>
            )}
            {recovering && (
              <div className="grid gap-2 border-t pt-5">
                <Label htmlFor="recovery-backup">根密钥备份文件（根文件损坏时使用）</Label>
                <Input
                  accept="application/json,.json"
                  disabled={busy}
                  id="recovery-backup"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    setBackup(undefined)
                    if (!file) return
                    if (file.size > 1048576) {
                      setError('备份文件过大。')
                      return
                    }
                    void file.text().then(text => setBackup(JSON.parse(text))).catch(() => setError('备份文件不是有效 JSON。'))
                  }}
                  type="file"
                />
                <p className="text-xs text-muted-foreground">备份只在内存中读取；服务会核对实例身份。原 S3 后端与管理员身份保持不变。</p>
              </div>
            )}
            <div className="grid gap-2 border-t pt-5">
              <Label htmlFor="setup-origin">公开访问地址（可选）</Label>
              <Input disabled={busy} id="setup-origin" onChange={event => setCanonicalOrigin(event.target.value)} placeholder="https://tools.example.com" value={canonicalOrigin} />
            </div>
            <details>
              <summary className="cursor-pointer text-sm">多副本设置</summary>
              <div className="mt-4 grid gap-2">
                <Label htmlFor="setup-redis">Redis 连接地址（单副本可留空）</Label>
                <Input autoComplete="off" disabled={busy} id="setup-redis" onChange={event => setRedisUrl(event.target.value)} placeholder="redis://..." type="password" value={redisUrl} />
              </div>
            </details>
            <Button disabled={busy} onClick={() => void configure()}>
              {busy && <Loader2 className="animate-spin" />}
              {busy ? '正在验证…' : recovering ? '验证连接并恢复实例' : '验证连接并完成安装'}
            </Button>
          </section>
        )}
        {result && (
          <section className="space-y-4 rounded-xl border border-primary/40 bg-card p-5 sm:p-6">
            <h2 className="text-xl font-semibold">{recovering ? '恢复完成' : '安装完成'}</h2>
            {result.adminSk
              ? (
                  <>
                    <p className="text-sm text-muted-foreground">保存管理员 Secret Key。关闭此页面后无法重新读取。</p>
                    <div className="grid gap-2">
                      <Label htmlFor="setup-admin">管理员 Secret Key</Label>
                      <Input autoComplete="off" id="setup-admin" readOnly type="password" value={result.adminSk} />
                      <Button onClick={() => { if (result.adminSk) void navigator.clipboard.writeText(result.adminSk) }} variant="outline">复制管理员密钥</Button>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input checked={saved} onChange={event => setSaved(event.target.checked)} type="checkbox" />
                      我已将管理员密钥保存到密码管理器
                    </label>
                  </>
                )
              : <p className="text-sm text-muted-foreground">实例已恢复，请使用原管理员凭据登录。</p>}
            <Button
              disabled={Boolean(result.adminSk) && !saved}
              onClick={() => {
                if (result.adminSk) login({ name: 'default', baseUrl: '', sk: result.adminSk })
                setResult(null)
                navigate('/')
              }}
            >
              进入管理界面
            </Button>
          </section>
        )}
      </div>
    </main>
  )
}
