import type { VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { Slot } from 'radix-ui'
import { buttonVariants } from '@/components/ui/button-variants'
import { cn } from '@/lib/utils'

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'>
  & VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      data-size={size}
      data-slot="button"
      data-variant={variant}
      {...props}
    />
  )
}

export { Button }
