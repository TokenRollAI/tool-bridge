import {
  ArrowRight,
  Boxes,
  KeyRound,
  Loader2,
  Moon,
  Network,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react'
import { createSetupClient, type SetupStatus } from '@tool-bridge/sdk/client'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Link } from 'react-router'
import { type ApiError, validateConnection } from '@/lib/api'
import { useSession } from '@/lib/session-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const FEATURES = [
  { icon: Network, label: '找到工具', text: '搜索可用能力，直接开始使用' },
  { icon: Boxes, label: '连接设备', text: '把电脑上的工具带入工作区' },
  { icon: ShieldCheck, label: '管理访问', text: '为每个连接设置合适的权限' },
] as const

function endpointLabel(baseUrl: string): string {
  if (baseUrl.trim() === '') return `同源 · ${window.location.host}`
  try {
    return new URL(baseUrl).host || baseUrl
  } catch {
    return baseUrl
  }
}

function connectionErrorMessage(error: ApiError | null): string {
  if (!error) return ''
  if (error.status === 401) return 'Secret Key 无法识别：它可能无效、已禁用或已过期。'
  if (error.status === 403) return '凭据已识别，但没有读取根节点 /~help 的权限。'
  if (error.code === 'network') {
    return '浏览器无法到达该网关。请检查地址和网络；跨域连接还需由网关允许 CORS。'
  }
  return error.message
}

/**
 * 登录门：GET /~help 通过即建立本地 profile。优先恢复已保存档案，
 * 同时保留同源与跨域 BaseURL 两种新连接方式。
 */
export function LoginPage() {
  const { login, profiles, switchTo, removeProfile } = useSession()
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'
  const [baseUrl, setBaseUrl] = useState('')
  const [sk, setSk] = useState('')
  const [name, setName] = useState('default')
  const [setupState, setSetupState] = useState<SetupStatus['state'] | null>(null)
  useEffect(() => {
    let active = true
    void createSetupClient({ baseUrl: '' }).status().then((value) => {
      if (active) setSetupState(value.state)
    }).catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const mutation = useMutation({
    mutationFn: async () => {
      const normalized = baseUrl.trim().replace(/\/+$/, '')
      await validateConnection({ baseUrl: normalized, sk: sk.trim() })
      return { name: name.trim() || 'default', baseUrl: normalized, sk: sk.trim() }
    },
    onSuccess: profile => login(profile),
  })

  const error = mutation.error as ApiError | null
  const usesSameOrigin = baseUrl.trim() === ''
  const target = usesSameOrigin ? window.location.origin : baseUrl.trim()

  return (
    <div className="relative h-svh overflow-x-hidden overflow-y-auto bg-panel">
      <header className="relative z-10 flex h-16 items-center justify-between px-5 sm:px-8 lg:px-12">
        <div className="flex items-center gap-3">
          <img alt="" className="size-7 dark:invert" src="/ui/icon-light.png" />
          <span className="font-mono text-sm tracking-tight">
            tool
            <span className="text-primary">-</span>
            bridge
          </span>

        </div>
        <Button
          aria-label="切换主题"
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          size="icon-sm"
          variant="ghost"
        >
          {isDark ? <Sun /> : <Moon />}
        </Button>
      </header>

      {setupState && setupState !== 'ready' && (
        <div className="relative z-10 mx-auto flex max-w-3xl items-center justify-between gap-4 rounded-lg border border-primary/30 bg-card p-4 text-sm">
          <p>{setupState === 'recovery' ? '此实例需要恢复，请检查部署状态。' : '此实例尚未完成安装，请先配对配置服务。'}</p>
          <Button asChild size="sm"><Link to="/setup">{setupState === 'recovery' ? '查看恢复说明' : '开始安装'}</Link></Button>
        </div>
      )}
      <main className="relative z-10 mx-auto grid min-h-[calc(100svh-4rem)] w-full max-w-7xl items-center gap-12 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.72fr)] lg:px-12 lg:py-12">
        <section aria-labelledby="login-product-title" className="hidden min-w-0 lg:block">
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
            你的工具工作台
          </p>
          <h1
            className="mt-4 max-w-2xl text-4xl leading-tight font-semibold tracking-tight"
            id="login-product-title"
          >
            工具与设备，
            <span className="block text-muted-foreground">在一处顺手使用。</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
            连接你的网关，找到需要的工具，继续上次的工作。
          </p>

          <div className="mt-9 grid max-w-2xl grid-cols-3 gap-6">
            {FEATURES.map(({ icon: Icon, label, text }) => (
              <div className="border-l border-border/80 pl-4" key={label}>
                <Icon className="size-4 text-primary" />
                <p className="mt-3 text-sm font-medium">{label}</p>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>

        </section>

        <section aria-labelledby="login-title" className="mx-auto w-full max-w-md">
          <div className="glass-raised relative overflow-hidden rounded-xl p-5 sm:p-7">

            <div className="mb-6">
              <div className="mb-4 grid size-10 place-items-center rounded-lg border bg-primary/[0.07] text-primary">
                <KeyRound className="size-4.5" />
              </div>
              <h2 className="text-xl font-semibold tracking-[-0.02em]" id="login-title">
                打开工作区
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                继续使用已有连接，或添加一个新网关。
              </p>
            </div>

            {profiles.length > 0 && (
              <section aria-labelledby="saved-profile-title" className="mb-6">
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <h3 className="text-xs font-medium" id="saved-profile-title">
                    继续使用
                  </h3>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                    {profiles.length}
                    {' '}
                    个本地档案
                  </span>
                </div>
                <div className="grid max-h-52 gap-2 overflow-y-auto pr-1">
                  {profiles.map(profile => (
                    <div
                      className="group/profile flex min-w-0 overflow-hidden rounded-md border bg-background/45"
                      key={profile.id}
                    >
                      <button
                        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-secondary/45 focus-visible:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
                        disabled={mutation.isPending}
                        onClick={() => switchTo(profile.name)}
                        title={`使用 ${profile.name} · ${profile.baseUrl || window.location.origin}`}
                        type="button"
                      >
                        <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-card text-muted-foreground">
                          <KeyRound className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-xs text-foreground">
                            {profile.name}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {endpointLabel(profile.baseUrl)}
                          </span>
                        </span>
                        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover/profile:translate-x-0.5 group-hover/profile:text-primary" />
                      </button>
                      <Button
                        aria-label={`删除档案 ${profile.name}`}
                        className="h-auto w-10 rounded-none border-l text-muted-foreground hover:text-destructive"
                        disabled={mutation.isPending}
                        onClick={() => removeProfile(profile.name)}
                        size="icon"
                        title="删除本地档案"
                        type="button"
                        variant="ghost"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section
              aria-labelledby="new-connection-title"
              className={profiles.length > 0 ? 'border-t pt-5' : undefined}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-xs font-medium" id="new-connection-title">
                  {profiles.length > 0 ? '添加新连接' : '建立第一条连接'}
                </h3>

              </div>

              <form
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!mutation.isPending) mutation.mutate()
                }}
              >
                <div className="grid gap-2">
                  <Label>连接目标</Label>
                  <div className="flex min-w-0 items-center gap-3 rounded-md border bg-background/45 p-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-primary">
                      <Network className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium">当前网关</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {window.location.origin}
                      </span>
                    </span>
                    <Button
                      disabled={mutation.isPending}
                      onClick={() => {
                        setBaseUrl('')
                        if (!mutation.isPending) mutation.reset()
                      }}
                      size="xs"
                      type="button"
                      variant={usesSameOrigin ? 'secondary' : 'outline'}
                    >
                      {usesSameOrigin ? <ShieldCheck /> : <ArrowRight />}
                      {usesSameOrigin ? '已选择' : '改用同源'}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="baseUrl">其他网关地址</Label>
                    <span className="text-xs text-muted-foreground">可选 · 适用于远程网关</span>
                  </div>
                  <Input
                    autoComplete="url"
                    className="h-10 font-mono text-sm"
                    disabled={mutation.isPending}
                    id="baseUrl"
                    onChange={(event) => {
                      setBaseUrl(event.target.value)
                      if (!mutation.isPending) mutation.reset()
                    }}
                    placeholder="https://gateway.example.com"
                    spellCheck={false}
                    value={baseUrl}
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="sk">访问密钥（Secret Key）</Label>
                  <Input
                    aria-describedby={error ? 'connection-note login-error' : 'connection-note'}
                    aria-invalid={Boolean(error)}
                    autoComplete="off"
                    className="h-10 font-mono text-sm"
                    disabled={mutation.isPending}
                    id="sk"
                    onChange={(event) => {
                      setSk(event.target.value)
                      if (!mutation.isPending) mutation.reset()
                    }}
                    placeholder="tbk_…"
                    required
                    type="password"
                    value={sk}
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="profile">档案名</Label>
                  <Input
                    autoComplete="off"
                    className="h-10 font-mono text-sm"
                    disabled={mutation.isPending}
                    id="profile"
                    onChange={(event) => {
                      setName(event.target.value)
                      if (!mutation.isPending) mutation.reset()
                    }}
                    value={name}
                  />
                  <p className="text-xs text-muted-foreground">为连接起一个易辨认的名称；同名档案会被更新。</p>
                </div>

                <div
                  className="flex items-start gap-2.5 rounded-md border border-primary/20 bg-primary/[0.045] px-3 py-2.5"
                  id="connection-note"
                >
                  {mutation.isPending
                    ? (
                        <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />
                      )
                    : (
                        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                      )}
                  <p
                    aria-live="polite"
                    className="min-w-0 text-xs leading-5 text-muted-foreground"
                  >
                    {mutation.isPending
                      ? (
                          <>
                            正在读取
                            {' '}
                            <span className="break-all font-mono text-foreground">
                              {target}
                              /~help
                            </span>
                            {' '}
                            验证连接与权限…
                          </>
                        )
                      : (
                          <>只读取 /~help 完成验证；凭据保存在本浏览器，请仅在受信任设备使用。</>
                        )}
                  </p>
                </div>

                {error && (
                  <div
                    className="rounded-md border border-destructive/40 bg-destructive/[0.07] px-3 py-2.5 text-xs leading-5 text-destructive"
                    id="login-error"
                    role="alert"
                  >
                    {connectionErrorMessage(error)}
                  </div>
                )}

                <Button
                  className="mt-1 w-full"
                  disabled={mutation.isPending || sk.trim() === ''}
                  size="lg"
                  type="submit"
                >
                  {mutation.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
                  {mutation.isPending ? '正在验证…' : '连接工作区'}
                  {!mutation.isPending && <ArrowRight className="ml-auto" />}
                </Button>
              </form>
            </section>
          </div>

          <p className="mt-5 text-center font-mono text-xs text-muted-foreground">
            凭据仅保存在当前浏览器，请在受信任的设备上使用。
          </p>
        </section>
      </main>
    </div>
  )
}
