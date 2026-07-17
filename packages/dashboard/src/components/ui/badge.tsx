import type { VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { Slot } from 'radix-ui'
import { badgeVariants } from '@/components/ui/badge-variants'
import { cn } from '@/lib/utils'

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span'

  return (
    <Comp
      className={cn(badgeVariants({ variant }), className)}
      data-slot="badge"
      data-variant={variant}
      {...props}
    />
  )
}

export { Badge }
