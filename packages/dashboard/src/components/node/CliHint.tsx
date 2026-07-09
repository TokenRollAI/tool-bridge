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
  path: string
  tool: string
  args: unknown
  direct?: boolean
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
    <div className="mt-3 min-w-0 max-w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground/70',
          'hover:text-foreground',
        )}
      >
        <SquareTerminal className="size-3" />
        {open ? '收起' : '等价 CLI / curl'}
      </button>
      {open && (
        <div className="mt-2 grid min-w-0 gap-1.5">
          {[
            { label: 'tb', cmd: tb },
            { label: 'curl', cmd: curl },
          ].map(({ label, cmd }) => (
            <div
              key={label}
              className="grid min-w-0 max-w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-1 rounded-sm border bg-background/60 sm:gap-1.5"
            >
              <span className="shrink-0 border-r px-2 py-1.5 font-mono text-[10px] text-primary/80">
                {label}
              </span>
              <pre className="min-w-0 max-w-full self-center overflow-x-auto px-1 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
                {cmd}
              </pre>
              <CopyButton value={cmd} className="m-1 shrink-0" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
