import { Loader2, MessageSquarePlus, Minus, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import type { FeedbackView } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { feedbackRemove, feedbackSubmit, feedbackVote } from '@/lib/api'
import { useFeedbackDetail, useFeedbackList } from '@/lib/queries'
import { ConfirmAction } from '@/components/ConfirmAction'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConn } from '@/lib/session'

/** 净分 ≤ 此值的条目不进 ~help 默认区块(与网关一致,仅作展示标注)。 */
const HIDE_SCORE = -3

/**
 * Agent 反馈面板(~feedback 保留段,对等 `tb feedback`):
 * 净分排序列表(含被隐藏条目,标注「已隐藏」)、点击展开 detail、投票(每身份一票,
 * 可改票)、提交与删除(删除需 admin)。头部条目会进该路径 ~help 的默认区块。
 */
export function FeedbackPanel({ path }: { path: string }) {
  const list = useFeedbackList(path)
  const [expanded, setExpanded] = useState<string | null>(null)
  const items = list.data?.items ?? []

  return (
    <div className="grid gap-3">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Agent 使用经验沉淀:头部条目会出现在该路径 ~help 的 feedback 区块里。
        </p>
        <SubmitDialog path={path} />
      </div>

      {list.isPending
        ? (
            <div className="grid gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-4/6" />
            </div>
          )
        : list.isError
          ? (
              <p className="text-sm text-destructive">{list.error.message}</p>
            )
          : items.length === 0
            ? (
                <EmptyState icon={MessageSquarePlus} title="还没有反馈">
                  <p>用过这个路径的工具后踩了坑?提交一条简短反馈,帮后来的 Agent 少走弯路。</p>
                </EmptyState>
              )
            : (
                <div className="grid gap-px overflow-hidden rounded-md border">
                  {items.map(f => (
                    <FeedbackRow
                      expanded={expanded === f.id}
                      item={f}
                      key={f.id}
                      onToggle={() => setExpanded(expanded === f.id ? null : f.id)}
                      path={path}
                    />
                  ))}
                </div>
              )}
    </div>
  )
}

function FeedbackRow({
  path,
  item,
  expanded,
  onToggle,
}: {
  expanded: boolean
  item: FeedbackView
  onToggle: () => void
  path: string
}) {
  const conn = useConn()
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['tb'] })

  const vote = useMutation({
    mutationFn: (value: 'up' | 'down' | 'clear') => feedbackVote(conn, path, item.id, value),
    onSuccess: refresh,
    onError: e => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: () => feedbackRemove(conn, path, item.id),
    onSuccess: () => {
      toast.success(`已删除 ${item.id}`)
      refresh()
    },
    onError: e => toast.error(e.message),
  })

  return (
    <div className="bg-card/60">
      <div className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:gap-2.5 sm:px-3.5">
        <button
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left sm:flex-nowrap sm:gap-2.5"
          onClick={onToggle}
          type="button"
        >
          <Badge
            className="font-mono tabular-nums"
            variant={item.score < 0 ? 'secondary' : 'outline'}
          >
            {item.score > 0 ? `+${item.score}` : item.score}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
          {item.score <= HIDE_SCORE && (
            <Badge className="text-[10px]" variant="secondary">
              已从 ~help 隐藏
            </Badge>
          )}
          <span className="w-full shrink-0 font-mono text-[11px] text-muted-foreground sm:ml-auto sm:w-auto">
            {item.by}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5 self-end sm:self-auto">
          <Button
            aria-label="有用"
            disabled={vote.isPending}
            onClick={() => vote.mutate('up')}
            size="icon-xs"
            title="有用(再点同向不叠加,改票覆盖)"
            variant="ghost"
          >
            <ThumbsUp />
          </Button>
          <Button
            aria-label="没用"
            disabled={vote.isPending}
            onClick={() => vote.mutate('down')}
            size="icon-xs"
            title="没用"
            variant="ghost"
          >
            <ThumbsDown />
          </Button>
          <Button
            aria-label="清除投票"
            disabled={vote.isPending}
            onClick={() => vote.mutate('clear')}
            size="icon-xs"
            title="清除我的投票"
            variant="ghost"
          >
            <Minus />
          </Button>
          <ConfirmAction
            actionLabel="删除"
            description={<p>删除后不可恢复(需 admin scope)。</p>}
            onConfirm={() => remove.mutateAsync()}
            title={`删除反馈 ${item.id}?`}
            trigger={(
              <Button aria-label="删除" size="icon-xs" title="删除(admin)" variant="ghost">
                <Trash2 className="text-destructive" />
              </Button>
            )}
          />
        </div>
      </div>
      {expanded && <FeedbackDetail id={item.id} path={path} />}
    </div>
  )
}

function FeedbackDetail({ path, id }: { id: string, path: string }) {
  const detail = useFeedbackDetail(path, id)
  if (detail.isPending) {
    return <Skeleton className="mx-3.5 mb-3 h-10" />
  }
  if (detail.isError) {
    return <p className="px-3.5 pb-3 text-xs text-destructive">{detail.error.message}</p>
  }
  return (
    <div className="min-w-0 border-t bg-background/40 px-3.5 py-2.5">
      <p className="whitespace-pre-wrap break-words text-sm">{detail.data.detail}</p>
      <p className="mt-1.5 break-all font-mono text-[11px] text-muted-foreground">
        {detail.data.id}
        {' '}
        · +
        {detail.data.up}
        /-
        {detail.data.down}
        {' '}
        ·
        {' '}
        {detail.data.at ? new Date(detail.data.at).toLocaleString() : '-'}
      </p>
    </div>
  )
}

function SubmitDialog({ path }: { path: string }) {
  const conn = useConn()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const submit = useMutation({
    mutationFn: () => feedbackSubmit(conn, path, { title: title.trim(), detail: detail.trim() }),
    onSuccess: (r) => {
      toast.success(`反馈 ${r.id} 已提交`)
      setOpen(false)
      setTitle('')
      setDetail('')
      setErr(null)
      qc.invalidateQueries({ queryKey: ['tb'] })
    },
    onError: e => setErr(e.message),
  })

  const doSubmit = () => {
    if (title.trim() === '' || detail.trim() === '') {
      setErr('title 与 detail 都必填')
      return
    }
    submit.mutate()
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <MessageSquarePlus />
          提交反馈
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            提交反馈 ·
            {' '}
            <code className="font-mono text-sm">{path}</code>
          </DialogTitle>
          <DialogDescription>
            保持简短:title 让别的 Agent 一眼判断是否相关,detail 给出关键细节。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs" htmlFor="fb-title">
              title(≤ 80 字符)
            </Label>
            <Input
              id="fb-title"
              maxLength={80}
              onChange={e => setTitle(e.target.value)}
              placeholder="如:create-doc 的 mode 参数必填"
              value={title}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs" htmlFor="fb-detail">
              detail(≤ 500 字符)
            </Label>
            <Textarea
              className="min-h-20 text-sm"
              id="fb-detail"
              maxLength={500}
              onChange={e => setDetail(e.target.value)}
              placeholder="报错、原因、绕过方式……"
              value={detail}
            />
          </div>
          {err && (
            <p className="text-xs text-destructive" role="alert">
              {err}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button disabled={submit.isPending} onClick={doSubmit}>
            {submit.isPending && <Loader2 className="animate-spin" />}
            提交
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
