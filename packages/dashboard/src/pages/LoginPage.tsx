import { useMutation } from '@tanstack/react-query'
import { KeyRound, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type ApiError, validateConnection } from '@/lib/api'
import { useSession } from '@/lib/session'

/**
 * 登录门:SK + BaseURL(Case 6 / E2E-6 ①)。与 `tb login` 同一判据:GET /~help 过认证即有效。
 * BaseURL 缺省同源——生产形态 Dashboard 与 gateway 同 Worker。
 */
export function LoginPage() {
  const { login, profiles, switchTo } = useSession()
  const [baseUrl, setBaseUrl] = useState('')
  const [sk, setSk] = useState('')
  const [name, setName] = useState('default')

  const m = useMutation({
    mutationFn: async () => {
      const normalized = baseUrl.trim().replace(/\/+$/, '')
      await validateConnection({ baseUrl: normalized, sk: sk.trim() })
      return { name: name.trim() || 'default', baseUrl: normalized, sk: sk.trim() }
    },
    onSuccess: (profile) => login(profile),
  })

  const err = m.error as ApiError | null

  return (
    <div className="relative h-svh overflow-y-auto">
      {/* 背景:蓝图网格 + 顶部信号色光晕(工业面板氛围) */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.35] [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:44px_44px]"
      />
      <div
        aria-hidden
        className="absolute -top-40 left-1/2 h-80 w-[42rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="flex min-h-full items-center justify-center">
        <div className="relative w-full max-w-sm px-6 py-10">
          <header className="mb-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="mb-3 h-px w-10 bg-primary" />
            <h1 className="font-mono text-2xl tracking-tight">
              tool<span className="text-primary">-</span>bridge
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              HTBP 网关控制台 — 凭 Secret Key 接入
            </p>
          </header>

          <form
            className="grid gap-5 animate-in fade-in slide-in-from-bottom-2 duration-500 [animation-delay:120ms] [animation-fill-mode:backwards]"
            onSubmit={(e) => {
              e.preventDefault()
              if (!m.isPending) m.mutate()
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="baseUrl" className="text-xs text-muted-foreground">
                BaseURL
              </Label>
              <Input
                id="baseUrl"
                className="font-mono text-sm"
                placeholder={`${window.location.origin}(同源,默认)`}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sk" className="text-xs text-muted-foreground">
                Secret Key
              </Label>
              <Input
                id="sk"
                className="font-mono text-sm"
                type="password"
                placeholder="sk-…"
                value={sk}
                onChange={(e) => setSk(e.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="profile" className="text-xs text-muted-foreground">
                档案名(对等 tb --profile)
              </Label>
              <Input
                id="profile"
                className="font-mono text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {err && (
              <p className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground/90">
                {err.status === 401 ? 'SK 无法识别:无效、已禁用或已过期' : err.message}
              </p>
            )}

            <Button type="submit" disabled={m.isPending || sk.trim() === ''}>
              {m.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
              接入网关
            </Button>
          </form>

          {profiles.length > 0 && (
            <div className="mt-8 animate-in fade-in duration-500 [animation-delay:240ms] [animation-fill-mode:backwards]">
              <p className="mb-2 text-xs text-muted-foreground">已保存档案</p>
              <div className="flex flex-wrap gap-2">
                {profiles.map((p) => (
                  <Button
                    key={p.name}
                    variant="outline"
                    size="sm"
                    className="font-mono text-xs"
                    onClick={() => switchTo(p.name)}
                  >
                    {p.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
