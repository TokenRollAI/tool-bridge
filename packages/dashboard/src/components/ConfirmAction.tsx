import { type ReactNode, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

/** 危险动作的二次确认按钮(吊销 SK / 卸载节点 / 删除凭证)。 */
export function ConfirmAction({
  trigger,
  title,
  description,
  actionLabel = '确认执行',
  pending: externalPending = false,
  onConfirm,
}: {
  actionLabel?: string
  description?: ReactNode
  onConfirm: () => void | Promise<void>
  pending?: boolean
  title: string
  trigger: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [internalPending, setInternalPending] = useState(false)
  const pending = externalPending || internalPending

  const confirm = async () => {
    if (pending) return
    setInternalPending(true)
    try {
      await onConfirm()
      setOpen(false)
    } catch {
      // 调用方负责 toast/错误呈现；失败时保留弹窗，允许用户重试或取消。
    } finally {
      setInternalPending(false)
    }
  }

  return (
    <AlertDialog onOpenChange={next => !pending && setOpen(next)} open={open}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription asChild>
              <div className="text-sm">{description}</div>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <Button disabled={pending} onClick={() => void confirm()} variant="destructive">
            {pending && <Loader2 className="animate-spin" />}
            {actionLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
