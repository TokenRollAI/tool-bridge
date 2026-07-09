import { Check, Copy } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** 复制按钮:点击后短暂显示对勾反馈(不弹 toast,避免高频操作刷屏)。 */
export function CopyButton({
  value,
  label = '复制',
  size = 'icon-xs',
  variant = 'ghost',
  className,
}: {
  value: string
  label?: string
  size?: 'icon-xs' | 'icon-sm'
  variant?: 'ghost' | 'outline'
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1200)
    } catch {
      toast.error('复制失败，请手动选中内容')
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      aria-label={label}
      title={label}
      className={cn(
        'text-muted-foreground hover:text-foreground focus-visible:opacity-100 group-focus-within:opacity-100',
        className,
      )}
      onClick={copy}
    >
      {copied ? <Check className="text-ok" /> : <Copy />}
    </Button>
  )
}
