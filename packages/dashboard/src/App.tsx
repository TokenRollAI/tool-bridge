import { lazy, type ReactNode, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { useSession } from '@/lib/session-context'

// 路由级拆包:登录门不再下载 RJSF/AJV 与千行管理表单;进入某页时才加载对应能力。
// React Flow 画布也在 CanvasPage 里懒加载,登录门不含图库。
const WorkspaceShell = lazy(() =>
  import('@/canvas/WorkspaceShell').then(module => ({ default: module.WorkspaceShell })),
)
const LoginPage = lazy(() =>
  import('@/pages/LoginPage').then(module => ({ default: module.LoginPage })),
)
const CanvasPage = lazy(() =>
  import('@/canvas/CanvasPage').then(module => ({ default: module.CanvasPage })),
)
const SearchPage = lazy(() =>
  import('@/pages/SearchPage').then(module => ({ default: module.SearchPage })),
)
const DevicesPage = lazy(() =>
  import('@/pages/system/DevicesPage').then(module => ({ default: module.DevicesPage })),
)
const FederationPage = lazy(() =>
  import('@/pages/system/FederationPage').then(module => ({ default: module.FederationPage })),
)
const PluginsPage = lazy(() =>
  import('@/pages/system/PluginsPage').then(module => ({ default: module.PluginsPage })),
)
const RegistryPage = lazy(() =>
  import('@/pages/system/RegistryPage').then(module => ({ default: module.RegistryPage })),
)
const SecretsPage = lazy(() =>
  import('@/pages/system/SecretsPage').then(module => ({ default: module.SecretsPage })),
)
const SkPage = lazy(() =>
  import('@/pages/system/SkPage').then(module => ({ default: module.SkPage })),
)
const StorePage = lazy(() =>
  import('@/pages/system/StorePage').then(module => ({ default: module.StorePage })),
)

function AppBooting() {
  return (
    <div className="grid h-svh place-items-center bg-background text-foreground">
      <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
        <span className="size-2 animate-pulse rounded-full bg-primary shadow-[0_0_12px_var(--primary)]" />
        control plane / loading
      </div>
    </div>
  )
}

function PageLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="h-3 w-24 animate-pulse rounded-sm bg-muted" />
      <div className="mt-4 h-8 w-56 animate-pulse rounded-sm bg-muted" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <div className="h-28 animate-pulse rounded-lg border bg-card/50" />
        <div className="h-28 animate-pulse rounded-lg border bg-card/50" />
      </div>
    </div>
  )
}

function DeferredPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>
}

export default function App() {
  const { conn } = useSession()
  if (!conn) {
    return (
      <Suspense fallback={<AppBooting />}>
        <LoginPage />
      </Suspense>
    )
  }
  return (
    <Suspense fallback={<AppBooting />}>
      <Routes>
        <Route element={<WorkspaceShell />}>
          <Route
            element={(
              <DeferredPage>
                <StorePage />
              </DeferredPage>
            )}
            path="manage/store"
          />
          <Route
            element={(
              <DeferredPage>
                <SearchPage />
              </DeferredPage>
            )}
            path="search"
          />
          <Route
            element={(
              <DeferredPage>
                <CanvasPage />
              </DeferredPage>
            )}
            index
          />
          <Route
            element={(
              <DeferredPage>
                <CanvasPage />
              </DeferredPage>
            )}
            path="nodes/*"
          />
          <Route
            element={(
              <DeferredPage>
                <SkPage />
              </DeferredPage>
            )}
            path="manage/sk"
          />
          <Route
            element={(
              <DeferredPage>
                <SecretsPage />
              </DeferredPage>
            )}
            path="manage/secrets"
          />
          <Route
            element={(
              <DeferredPage>
                <RegistryPage />
              </DeferredPage>
            )}
            path="manage/registry"
          />
          <Route
            element={(
              <DeferredPage>
                <DevicesPage />
              </DeferredPage>
            )}
            path="manage/devices"
          />
          <Route
            element={(
              <DeferredPage>
                <PluginsPage />
              </DeferredPage>
            )}
            path="manage/plugins"
          />
          <Route
            element={(
              <DeferredPage>
                <FederationPage />
              </DeferredPage>
            )}
            path="manage/federation"
          />
          <Route element={<Navigate replace to="/" />} path="*" />
        </Route>
      </Routes>
    </Suspense>
  )
}
