import { Loader2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
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
  pending = false,
  onConfirm,
}: {
  trigger: ReactNode
  title: string
  description?: ReactNode
  actionLabel?: string
  pending?: boolean
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
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
          <AlertDialogCancel>取消</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => {
              onConfirm()
              setOpen(false)
            }}
          >
            {pending && <Loader2 className="animate-spin" />}
            {actionLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
