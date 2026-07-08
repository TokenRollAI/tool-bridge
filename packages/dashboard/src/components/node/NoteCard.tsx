import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil, StickyNote } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useInvoke } from '@/lib/queries'

/**
 * Path 补充说明卡片(system/annotation,对等 `tb note`):
 * 展示来自 ~help 注入的 note(零额外请求),编辑/清除走 system/annotation set/remove
 * (admin scope,无权时 403 toast)。
 */
export function NoteCard({ path, note }: { path: string; note?: string }) {
  if (note === undefined) {
    return (
      <div className="flex items-center gap-2">
        <NoteDialog path={path} current="" trigger={<AddNoteTrigger />} />
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
      <StickyNote className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">{note}</p>
      <NoteDialog
        path={path}
        current={note}
        trigger={
          <Button variant="ghost" size="icon-xs" aria-label="编辑补充说明" title="编辑补充说明">
            <Pencil />
          </Button>
        }
      />
    </div>
  )
}

function AddNoteTrigger() {
  return (
    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground">
      <StickyNote />
      添加补充说明
    </Button>
  )
}

function NoteDialog({
  path,
  current,
  trigger,
}: {
  path: string
  current: string
  trigger: React.ReactNode
}) {
  const invoke = useInvoke()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(current)
  const [err, setErr] = useState<string | null>(null)

  const done = (msg: string) => {
    toast.success(msg)
    setOpen(false)
    setErr(null)
    qc.invalidateQueries({ queryKey: ['tb'] })
  }

  const save = () => {
    if (text.trim() === '') {
      setErr('内容不能为空(清除请用「移除」)')
      return
    }
    invoke.mutate(
      { path: 'system/annotation', tool: 'set', args: { path, text: text.trim() } },
      { onSuccess: () => done('补充说明已保存'), onError: (e) => setErr(e.message) },
    )
  }

  const remove = () => {
    invoke.mutate(
      { path: 'system/annotation', tool: 'remove', args: { path } },
      { onSuccess: () => done('补充说明已移除'), onError: (e) => setErr(e.message) },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setText(current)
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-base">
            补充说明 · <code className="font-mono text-sm">{path === '' ? '/' : path}</code>
          </DialogTitle>
          <DialogDescription>
            展示在该路径 ~help 的 Notes 区块(admin scope;≤ 2000 字符)。
          </DialogDescription>
        </DialogHeader>
        <Textarea
          className="min-h-28 text-sm"
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="这个路径的使用要点、前置条件、已知坑……"
        />
        {err && <p className="text-xs text-destructive">{err}</p>}
        <DialogFooter>
          {current !== '' && (
            <Button variant="outline" disabled={invoke.isPending} onClick={remove}>
              移除
            </Button>
          )}
          <Button disabled={invoke.isPending} onClick={save}>
            {invoke.isPending && <Loader2 className="animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
