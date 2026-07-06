import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ApiError, InvokeResult } from '@/lib/api'
import { cn } from '@/lib/utils'

/** 调用返回展示:markdown 渲染(默认表现)/ 原文切换;错误渲染 TBError。 */
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
      <TabsList className="h-7">
        <TabsTrigger value="rendered" className="px-2.5 py-0.5 text-xs">
          {isJson ? 'JSON' : 'Markdown'}
        </TabsTrigger>
        <TabsTrigger value="raw" className="px-2.5 py-0.5 text-xs">
          原文
        </TabsTrigger>
      </TabsList>
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
