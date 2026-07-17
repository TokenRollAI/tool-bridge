import { SquareTerminal } from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from '@/components/CopyButton'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

/** shell 单引号安全包裹。 */
function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * 三入口对照:当前表单参数的等价 `tb call` 与 curl 命令(可复制)。
 * SK 一律以 $TB_SK 占位,不落明文——Dashboard 能做的 CLI/API 必须能做。
 * `direct`(mcp/http/tool 工具)生成直连形态:`tb call <path>/<tool>`、
 * `curl POST /<path>/<tool>` body 即 arguments;否则信封形态。
 */
export function CliHint({
  path,
  tool,
  args,
  direct = false,
}: {
  args: unknown
  direct?: boolean
  path: string
  tool: string
}) {
  const [open, setOpen] = useState(false)
  const { active } = useSession()
  const base = active?.baseUrl || window.location.origin

  const argsJson = JSON.stringify(args ?? {})
  const argsFlag = argsJson === '{}' ? '' : ` --args ${sq(argsJson)}`
  const tb = direct
    ? `tb call ${path}/${tool}${argsFlag}`
    : `tb call ${path} --tool ${tool}${argsFlag}`
  const curl = [
    `curl -X POST ${sq(`${base}/${path}${direct ? `/${tool}` : ''}`)}`,
    `-H "Authorization: Bearer $TB_SK"`,
    `-H 'Content-Type: application/json'`,
    `-d ${sq(direct ? argsJson : JSON.stringify({ tool, arguments: args ?? {} }))}`,
  ].join(' \\\n  ')

  return (
    <div className="mt-4 min-w-0 max-w-full rounded-lg border border-dashed bg-background/20 px-3 py-2.5">
      <button
        className={cn(
          'inline-flex w-full items-center gap-1.5 text-left font-mono text-[11px] text-muted-foreground/75',
          'hover:text-foreground',
        )}
        onClick={() => setOpen(v => !v)}
        type="button"
      >
        <SquareTerminal className="size-3" />
        等价 CLI / curl
        <span className="ml-auto font-sans text-[10px]">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="mt-2 grid min-w-0 gap-1.5">
          {[
            { label: 'tb', cmd: tb },
            { label: 'curl', cmd: curl },
          ].map(({ label, cmd }) => (
            <div
              className="grid min-w-0 max-w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-1 rounded-lg border bg-background/60 sm:gap-1.5"
              key={label}
            >
              <span className="shrink-0 border-r px-2 py-1.5 font-mono text-[10px] text-primary/80">
                {label}
              </span>
              <pre className="min-w-0 max-w-full self-center overflow-x-auto px-1 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
                {cmd}
              </pre>
              <CopyButton className="m-1 shrink-0" value={cmd} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
