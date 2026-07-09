import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface State {
  error: Error | null
}

/**
 * 应用级故障边界:除了渲染异常,也承接路由 lazy chunk 在跨版本部署后加载失败。
 * Suspense 只处理“等待”,不处理 import reject;这里必须给出可恢复的整页刷新入口。
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[dashboard] uncaught render error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    const chunkFailure = /dynamically imported|importing a module|chunk/i.test(
      this.state.error.message,
    )
    return (
      <main className="grid h-svh place-items-center overflow-y-auto bg-background px-5 py-10 text-foreground">
        <section className="w-full max-w-lg rounded-xl border bg-card/75 p-6 shadow-2xl shadow-black/10 sm:p-8">
          <div className="grid size-11 place-items-center rounded-lg border border-destructive/35 bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </div>
          <p className="mt-5 font-mono text-[10px] tracking-[0.18em] text-destructive uppercase">
            Control plane interrupted
          </p>
          <h1 className="mt-2 text-xl font-medium">
            {chunkFailure ? '控制台已更新' : '这个页面未能完成渲染'}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {chunkFailure
              ? '当前标签页还在引用上一版资源，刷新后即可加载最新控制台。'
              : '已保留本机连接档案。请刷新重试；如问题持续，请检查浏览器控制台。'}
          </p>
          {!chunkFailure && (
            <pre className="mt-4 max-h-28 overflow-auto rounded-md border bg-background/70 px-3 py-2 font-mono text-xs whitespace-pre-wrap break-words text-muted-foreground">
              {this.state.error.message}
            </pre>
          )}
          <Button className="mt-6" onClick={() => window.location.reload()}>
            <RefreshCw />
            刷新控制台
          </Button>
        </section>
      </main>
    )
  }
}
