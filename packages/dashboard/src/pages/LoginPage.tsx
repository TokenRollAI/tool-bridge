import { useMutation } from '@tanstack/react-query'
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
import { useState } from 'react'
import hero from '@/assets/hero.png'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type ApiError, validateConnection } from '@/lib/api'
import { useSession } from '@/lib/session'
import { useTheme } from '@/lib/theme'

const FEATURES = [
  { icon: Network, label: '渐进发现', text: '从 /~help 开始，按需展开整棵能力树' },
  { icon: Boxes, label: '统一调用', text: '工具、Context 与设备共用一个 BaseURL' },
  { icon: ShieldCheck, label: '最小权限', text: 'Secret Key 把路径与动作收敛到所需范围' },
] as const

/**
 * 登录门:SK + BaseURL(Case 6 / E2E-6 ①)。与 `tb login` 同一判据:
 * GET /~help 过认证即有效;BaseURL 留空时走与 Dashboard 同源的网关。
 */
export function LoginPage() {
  const { login, profiles, switchTo, removeProfile } = useSession()
  const [theme, toggleTheme] = useTheme()
  const [baseUrl, setBaseUrl] = useState('')
  const [sk, setSk] = useState('')
  const [name, setName] = useState('default')

  const mutation = useMutation({
    mutationFn: async () => {
      const normalized = baseUrl.trim().replace(/\/+$/, '')
      await validateConnection({ baseUrl: normalized, sk: sk.trim() })
      return { name: name.trim() || 'default', baseUrl: normalized, sk: sk.trim() }
    },
    onSuccess: (profile) => login(profile),
  })

  const error = mutation.error as ApiError | null

  return (
    <div className="relative h-svh overflow-x-hidden overflow-y-auto bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:44px_44px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-48 left-[18%] h-[34rem] w-[34rem] rounded-full bg-primary/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-[-12rem] bottom-[-14rem] h-[30rem] w-[30rem] rounded-full bg-violet-500/8 blur-3xl"
      />

      <header className="relative z-10 flex h-16 items-center justify-between px-5 sm:px-8 lg:px-12">
        <div className="flex items-center gap-3">
          <img src="/ui/icon-light.png" alt="" className="size-7 dark:invert" />
          <span className="font-mono text-sm tracking-tight">
            tool<span className="text-primary">-</span>bridge
          </span>
          <span className="hidden rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground sm:inline">
            HTBP CONTROL PLANE
          </span>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="切换主题" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>
      </header>

      <main className="relative z-10 mx-auto grid min-h-[calc(100svh-4rem)] w-full max-w-7xl items-center gap-12 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.72fr)] lg:px-12 lg:py-12">
        <section className="hidden min-w-0 lg:block" aria-labelledby="login-product-title">
          <p className="font-mono text-xs tracking-[0.22em] text-primary uppercase">
            One tree. One gateway.
          </p>
          <h1
            id="login-product-title"
            className="mt-4 max-w-2xl text-4xl leading-[1.08] font-medium tracking-[-0.035em] xl:text-5xl"
          >
            让每一个 Agent，
            <span className="text-muted-foreground">都能安全地找到并使用组织能力。</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
            用一个 Secret Key 连接自描述的 HTBP 树，在一个控制面中管理工具、上下文、设备与联邦服务。
          </p>

          <div className="mt-9 grid max-w-2xl grid-cols-3 gap-3">
            {FEATURES.map(({ icon: Icon, label, text }) => (
              <div key={label} className="rounded-lg border bg-card/45 p-4 backdrop-blur-sm">
                <Icon className="size-4 text-primary" />
                <p className="mt-3 text-sm font-medium">{label}</p>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>

          <div aria-hidden className="absolute bottom-6 left-[42%] opacity-70 xl:bottom-4">
            <img src={hero} alt="" className="w-44 xl:w-52" />
          </div>
        </section>

        <section className="mx-auto w-full max-w-md" aria-labelledby="login-title">
          <div className="relative overflow-hidden rounded-xl border bg-card/75 p-5 shadow-2xl shadow-black/10 backdrop-blur-xl sm:p-7">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
            <span
              aria-hidden
              className="absolute top-0 left-0 size-3 border-t-2 border-l-2 border-primary"
            />
            <span
              aria-hidden
              className="absolute top-0 right-0 size-3 border-t-2 border-r-2 border-primary"
            />

            <div className="mb-7">
              <div className="mb-4 grid size-11 place-items-center rounded-lg border bg-primary/8 text-primary">
                <KeyRound className="size-5" />
              </div>
              <h2 id="login-title" className="text-xl font-medium tracking-tight">
                接入网关
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                凭据仅保存在当前浏览器的本地档案中。
              </p>
            </div>

            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                if (!mutation.isPending) mutation.mutate()
              }}
            >
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="baseUrl">BaseURL</Label>
                  <span className="text-[11px] text-muted-foreground">留空使用当前网关</span>
                </div>
                <Input
                  id="baseUrl"
                  className="h-10 font-mono text-sm"
                  placeholder={window.location.origin}
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  autoComplete="url"
                  spellCheck={false}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="sk">Secret Key</Label>
                <Input
                  id="sk"
                  className="h-10 font-mono text-sm"
                  type="password"
                  placeholder="tbk_…"
                  value={sk}
                  onChange={(event) => setSk(event.target.value)}
                  autoComplete="off"
                  required
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'login-error' : undefined}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="profile">档案名</Label>
                <Input
                  id="profile"
                  className="h-10 font-mono text-sm"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">
                  对应 CLI 的 <code className="font-mono">tb --profile</code>
                </p>
              </div>

              {error && (
                <div
                  id="login-error"
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs leading-5 text-destructive"
                >
                  {error.status === 401
                    ? 'Secret Key 无法识别：可能无效、已禁用或已过期。'
                    : error.message}
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                className="mt-1 w-full"
                disabled={mutation.isPending || sk.trim() === ''}
              >
                {mutation.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
                {mutation.isPending ? '正在验证…' : '接入网关'}
                {!mutation.isPending && <ArrowRight className="ml-auto" />}
              </Button>
            </form>

            {profiles.length > 0 && (
              <div className="mt-7 border-t pt-5">
                <p className="mb-2.5 text-xs font-medium text-muted-foreground">已保存档案</p>
                <div className="grid gap-2">
                  {profiles.map((profile) => (
                    <div key={profile.id} className="group/profile flex min-w-0 items-stretch">
                      <Button
                        variant="outline"
                        className="min-w-0 flex-1 justify-start rounded-r-none px-3"
                        title={profile.baseUrl || '同源'}
                        onClick={() => switchTo(profile.name)}
                      >
                        <span className="size-1.5 rounded-full bg-ok" />
                        <span className="truncate font-mono text-xs">{profile.name}</span>
                        <span className="ml-auto hidden max-w-36 truncate text-[11px] font-normal text-muted-foreground sm:block">
                          {profile.baseUrl || '同源'}
                        </span>
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`删除档案 ${profile.name}`}
                        title="删除档案"
                        className="rounded-l-none border-l-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeProfile(profile.name)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <p className="mt-5 text-center font-mono text-[11px] text-muted-foreground">
            fetch-compatible · self-describing · credential-scoped
          </p>
        </section>
      </main>
    </div>
  )
}
