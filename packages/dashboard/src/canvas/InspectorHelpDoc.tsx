import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Skeleton } from '@/components/ui/skeleton'
import { useHelpMarkdown } from '@/lib/queries'

/** ~help 的可读 Markdown 表现(协议默认表现,对等 `tb help <path>`)。 */
export function InspectorHelpDoc({ path }: { path: string }) {
  const md = useHelpMarkdown(path)
  if (md.isPending) return <Skeleton className="h-40 w-full" />
  if (md.isError) return <p className="text-sm text-destructive">{md.error.message}</p>
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto rounded-lg border bg-card/60 px-3 py-3 break-words prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:bg-background prose-pre:text-xs prose-code:font-mono sm:px-4">
      <Markdown remarkPlugins={[remarkGfm]}>{md.data}</Markdown>
    </div>
  )
}
