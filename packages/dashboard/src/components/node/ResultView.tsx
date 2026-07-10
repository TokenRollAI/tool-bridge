import { CheckCircle2, Download } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CopyButton } from '@/components/CopyButton'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ApiError, InvokeResult } from '@/lib/api'
import { cn } from '@/lib/utils'

function download(text: string, contentType: string) {
  const ext = contentType.includes('json')
    ? 'json'
    : contentType.includes('markdown')
      ? 'md'
      : 'txt'
  const url = URL.createObjectURL(new Blob([text], { type: contentType || 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `tb-result.${ext}`
  a.click()
  URL.revokeObjectURL(url)
}

/** 调用返回展示:markdown 渲染(默认表现)/ 原文切换;耗时 + 复制/下载;错误渲染 TBError。 */
export function ResultView({
  result,
  error,
  className,
}: {
  result?: InvokeResult
  error?: ApiError | null
  className?: string
}) {
  if (error) {
    return (
      <div
        className={cn(
          'rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3.5',
          className,
        )}
      >
        <p className="font-mono text-xs text-destructive-foreground/90">
          {error.code} · HTTP {error.status}
          {error.retryable ? ' · retryable' : ''}
        </p>
        <p className="mt-1 text-sm">{error.message}</p>
      </div>
    )
  }
  if (!result) return null

  const isJson = result.contentType.includes('application/json')
  const pretty = isJson && result.json !== undefined ? JSON.stringify(result.json, null, 2) : null

  return (
    <Tabs
      defaultValue="rendered"
      className={cn(
        'min-w-0 max-w-full gap-0 overflow-hidden rounded-xl border bg-background/25',
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b bg-card/35 px-3 py-2.5 sm:px-4">
        <span className="mr-1 inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-ok">
          <CheckCircle2 className="size-3.5" />
          RESPONSE
        </span>
        <TabsList className="h-7">
          <TabsTrigger value="rendered" className="px-2.5 py-0.5 text-xs">
            {isJson ? 'JSON' : 'Markdown'}
          </TabsTrigger>
          <TabsTrigger value="raw" className="px-2.5 py-0.5 text-xs">
            原文
          </TabsTrigger>
        </TabsList>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
          {result.ms} ms
        </span>
        <CopyButton value={pretty ?? result.text} label="复制返回值" />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="下载返回值"
          title="下载返回值"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => download(pretty ?? result.text, result.contentType)}
        >
          <Download />
        </Button>
      </div>
      <TabsContent value="rendered" className="m-0 p-3 sm:p-4">
        {isJson ? (
          <pre className="max-h-[32rem] max-w-full overflow-auto rounded-lg border bg-card/60 px-3 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
            {pretty ?? result.text}
          </pre>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto rounded-lg border bg-card/60 px-3 py-3 break-words prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:bg-background prose-pre:text-xs prose-code:font-mono sm:px-4">
            <Markdown remarkPlugins={[remarkGfm]}>{result.text}</Markdown>
          </div>
        )}
      </TabsContent>
      <TabsContent value="raw" className="m-0 p-3 sm:p-4">
        <pre className="max-h-[32rem] max-w-full overflow-auto rounded-lg border bg-card/60 px-3 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
          {result.text}
        </pre>
      </TabsContent>
    </Tabs>
  )
}
