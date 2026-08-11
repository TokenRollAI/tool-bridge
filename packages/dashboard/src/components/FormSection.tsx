import type { ReactNode } from 'react'

export function FormSection({
  index,
  title,
  description,
  children,
}: {
  children: ReactNode
  description: string
  index: string
  title: string
}) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card/45">
      <div className="flex items-start gap-3 border-b bg-muted/10 px-4 py-3.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-md border bg-background font-mono text-[10px] text-primary">
          {index}
        </span>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="grid gap-4 p-4 sm:p-5">{children}</div>
    </section>
  )
}
