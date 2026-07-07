import { Download } from 'lucide-react'
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
          'rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2',
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
    <Tabs defaultValue="rendered" className={className}>
      <div className="flex items-center gap-1">
        <TabsList className="h-7">
          <TabsTrigger value="rendered" className="px-2.5 py-0.5 text-xs">
            {isJson ? 'JSON' : 'Markdown'}
          </TabsTrigger>
          <TabsTrigger value="raw" className="px-2.5 py-0.5 text-xs">
            原文
          </TabsTrigger>
        </TabsList>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums">
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
      <TabsContent value="rendered">
        {isJson ? (
          <pre className="max-h-96 overflow-auto rounded-sm border bg-card px-3 py-2 font-mono text-xs leading-relaxed">
            {pretty ?? result.text}
          </pre>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none rounded-sm border bg-card px-4 py-3 prose-pre:bg-background prose-pre:text-xs prose-code:font-mono">
            <Markdown remarkPlugins={[remarkGfm]}>{result.text}</Markdown>
          </div>
        )}
      </TabsContent>
      <TabsContent value="raw">
        <pre className="max-h-96 overflow-auto rounded-sm border bg-card px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {result.text}
        </pre>
      </TabsContent>
    </Tabs>
  )
}
