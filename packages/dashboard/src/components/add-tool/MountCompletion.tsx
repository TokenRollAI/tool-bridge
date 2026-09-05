import { ArrowRight, CheckCircle2, ExternalLink, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { encodeTreePath } from '@/lib/path'

export interface MountCompletion {
  authorization: 'not-required' | 'authorized' | 'pending' | 'failed'
  authorizationUrl?: string | null
  path: string
}

export function MountCompletionSummary({ result }: { result: MountCompletion }) {
  const needsAttention = result.authorization === 'pending' || result.authorization === 'failed'
  const Icon = needsAttention ? TriangleAlert : CheckCircle2
  return (
    <div className="space-y-4" role="status">
      <div className="flex items-start gap-3 rounded-xl border bg-muted/20 p-5">
        <Icon className={`mt-0.5 size-5 shrink-0 ${needsAttention ? 'text-warn' : 'text-ok'}`} />
        <div className="min-w-0">
          <h3 className="text-base font-semibold">
            {result.authorization === 'pending'
              ? '已添加，等待授权'
              : result.authorization === 'failed'
                ? '已添加，授权未完成'
                : '工具已添加'}
          </h3>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{result.path}</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {result.authorization === 'pending'
              ? result.authorizationUrl
                ? '请在授权页完成账号连接，再到工具详情查看授权状态。'
                : '尚未确认账号授权，请到工具详情中查看状态并继续授权。'
              : result.authorization === 'failed'
                ? '连接配置已保存，但发起授权失败。可在工具详情中重新授权，无需重复添加。'
                : result.authorization === 'authorized'
                  ? '授权已确认。打开工具详情，查看命令与调用所需参数。'
                  : '连接配置已保存。打开工具详情，查看命令与连接状态。'}
          </p>
        </div>
      </div>
      {result.authorizationUrl && (
        <Button asChild className="w-full" variant="outline">
          <a href={result.authorizationUrl} rel="noopener noreferrer" target="_blank">
            <ExternalLink />
            打开授权页完成授权
          </a>
        </Button>
      )}
    </div>
  )
}

export function MountCompletionActions({ result, onDone }: {
  onDone: () => void
  result: MountCompletion
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t bg-background px-5 py-4 sm:px-6">
      <Button onClick={onDone} variant="outline">完成</Button>
      <Button asChild>
        <Link onClick={onDone} to={`/nodes/${encodeTreePath(result.path)}?tab=invoke`}>
          查看可用工具
          <ArrowRight />
        </Link>
      </Button>
    </div>
  )
}
