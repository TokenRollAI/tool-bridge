import Form from '@rjsf/shadcn'
import type { RJSFSchema } from '@rjsf/utils'
import validator from '@rjsf/validator-ajv8'
import { useQueryClient } from '@tanstack/react-query'
import { Braces, ClipboardList, Loader2, Play, TriangleAlert } from 'lucide-react'
import { useId, useState } from 'react'
import { ResultView } from '@/components/node/ResultView'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { ApiError } from '@/lib/api'
import { useInvoke } from '@/lib/queries'
import { isFormFriendly, skeletonFromSchema } from '@/lib/schemaForm'
import type { HelpCmd } from '@/lib/types'
import { cn } from '@/lib/utils'

const SCOPE_STYLE: Record<string, string> = {
  read: 'text-sky-400/90 border-sky-400/30',
  write: 'text-amber-400/90 border-amber-400/30',
  call: 'text-emerald-400/90 border-emerald-400/30',
  register: 'text-violet-400/90 border-violet-400/30',
  admin: 'text-rose-400/90 border-rose-400/30',
}

/** 变更型 tool 名 → 调用成功后失效该 profile 的全部查询(树/列表可能已变)。 */
const MUTATING = /^(write|update|delete|set|rm|remove|unmount|mount)$/i

/**
 * device shell 的 allow 白名单只编码在 h 文案里(core describeAllow 的三种形态),
 * 解析出来以标签呈现;不匹配则原样当普通说明文字。
 */
function parseShellAllow(h: string): { lead: string; allow: string[] | 'all' | 'none' } | null {
  const m = /^(.*?)允许命令:\s*(.+?)(?:;其余拒绝)?$/.exec(h)
  if (!m) return null
  const lead = m[1].replace(/[;;]\s*$/, '').trim()
  const body = m[2].trim()
  if (body === '*') return { lead, allow: 'all' }
  if (body.startsWith('无')) return { lead, allow: 'none' }
  return { lead, allow: body.split(/[,,]\s*/).filter(Boolean) }
}

function CmdDoc({ h }: { h: string }) {
  const parsed = parseShellAllow(h)
  if (!parsed) {
    return <p className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto">{h}</p>
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 text-xs text-muted-foreground sm:ml-auto sm:w-auto">
      {parsed.lead && <span>{parsed.lead} ·</span>}
      <span className="text-[11px]">允许命令</span>
      {parsed.allow === 'all' && (
        <span className="inline-flex items-center rounded-sm border border-warn/40 px-1.5 font-mono text-[10px] leading-4 text-warn">
          *(全部放行)
        </span>
      )}
      {parsed.allow === 'none' && (
        <span className="inline-flex items-center rounded-sm border px-1.5 font-mono text-[10px] leading-4 text-muted-foreground">
          无(默认拒绝)
        </span>
      )}
      {Array.isArray(parsed.allow) &&
        parsed.allow.map((cmd) => (
          <code
            key={cmd}
            className="inline-flex items-center rounded-sm border border-emerald-400/30 bg-emerald-400/5 px-1.5 font-mono text-[10px] leading-4 text-emerald-400/90"
          >
            {cmd}
          </code>
        ))}
      {Array.isArray(parsed.allow) && <span className="text-[11px]">其余拒绝</span>}
    </div>
  )
}

/**
 * 单条 cmd 的调用面板(Proto §1.3 CmdSpec 的通用渲染器,Case 6):
 * inputSchema → rjsf 表单(可切 JSON 原文编辑);confirm=true 弹二次确认(§6.2 语义在客户端);
 * Accept 可选 markdown(默认表现)/JSON;返回经 ResultView 展示。
 */
export function CmdPanel({ path, cmd }: { path: string; cmd: HelpCmd }) {
  const hasSchema = cmd.inputSchema !== undefined && typeof cmd.inputSchema === 'object'
  // rjsf 渲染不了的形状(如缺 items 的 array)直接落 JSON 编辑,避免表单区出现错误文本。
  const formFriendly = hasSchema && isFormFriendly(cmd.inputSchema)
  const [mode, setMode] = useState<'form' | 'json'>(formFriendly ? 'form' : 'json')
  const [formData, setFormData] = useState<unknown>(undefined)
  const [rawArgs, setRawArgs] = useState(() =>
    hasSchema && !formFriendly
      ? JSON.stringify(skeletonFromSchema(cmd.inputSchema), null, 2)
      : '{}',
  )
  const [rawErr, setRawErr] = useState<string | null>(null)
  const [accept, setAccept] = useState<'markdown' | 'json'>('markdown')
  const [pendingArgs, setPendingArgs] = useState<unknown | null>(null)
  const invoke = useInvoke()
  const qc = useQueryClient()
  const acceptId = useId()

  const doInvoke = (args: unknown) => {
    invoke.mutate(
      { path, tool: cmd.name, args, accept },
      {
        onSuccess: () => {
          if (MUTATING.test(cmd.name)) qc.invalidateQueries({ queryKey: ['tb'] })
        },
      },
    )
  }

  const submit = (args: unknown) => {
    if (cmd.confirm) setPendingArgs(args ?? {})
    else doInvoke(args ?? {})
  }

  const submitRaw = () => {
    try {
      const parsed = rawArgs.trim() === '' ? {} : JSON.parse(rawArgs)
      setRawErr(null)
      submit(parsed)
    } catch {
      setRawErr('arguments 不是合法 JSON')
    }
  }

  const footer = (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
      <Button
        type={mode === 'form' ? 'submit' : 'button'}
        size="sm"
        disabled={invoke.isPending}
        onClick={mode === 'json' ? submitRaw : undefined}
      >
        {invoke.isPending ? <Loader2 className="animate-spin" /> : <Play />}
        调用
      </Button>
      <label htmlFor={acceptId} className="ml-2 text-xs text-muted-foreground">
        Accept
      </label>
      <Select value={accept} onValueChange={(v) => setAccept(v as 'markdown' | 'json')}>
        <SelectTrigger id={acceptId} size="sm" className="h-8 w-32 font-mono text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="markdown" className="font-mono text-xs">
            markdown
          </SelectItem>
          <SelectItem value="json" className="font-mono text-xs">
            json
          </SelectItem>
        </SelectContent>
      </Select>
      {formFriendly && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto text-xs text-muted-foreground"
          onClick={() => {
            if (mode === 'form') {
              setRawArgs(JSON.stringify(formData ?? {}, null, 2))
              setMode('json')
            } else {
              try {
                setFormData(rawArgs.trim() === '' ? {} : JSON.parse(rawArgs))
                setRawErr(null)
                setMode('form')
              } catch {
                setRawErr('arguments 不是合法 JSON,无法切回表单')
              }
            }
          }}
        >
          {mode === 'form' ? <Braces /> : <ClipboardList />}
          {mode === 'form' ? 'JSON 编辑' : '表单编辑'}
        </Button>
      )}
    </div>
  )

  return (
    <section id={`cmd-${cmd.name}`} className="rounded-md border bg-card/60">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <h3 className="font-mono text-sm text-foreground">{cmd.name}</h3>
        <span
          className={cn(
            'inline-flex items-center rounded-sm border px-1.5 font-mono text-[10px] leading-4',
            SCOPE_STYLE[cmd.scope] ?? SCOPE_STYLE.read,
          )}
        >
          {cmd.scope}
        </span>
        {cmd.effect && (
          <span className="inline-flex items-center gap-1 rounded-sm border border-warn/40 px-1.5 font-mono text-[10px] leading-4 text-warn">
            {cmd.effect === 'destructive' && <TriangleAlert className="size-2.5" />}
            {cmd.effect}
          </span>
        )}
        {cmd.confirm && (
          <span className="inline-flex items-center rounded-sm border border-destructive/40 px-1.5 font-mono text-[10px] leading-4 text-destructive">
            confirm
          </span>
        )}
        {cmd.h && <CmdDoc h={cmd.h} />}
      </header>

      <div className="px-4 py-3">
        {mode === 'form' && hasSchema ? (
          <Form
            schema={cmd.inputSchema as RJSFSchema}
            validator={validator}
            formData={formData}
            onChange={({ formData: fd }) => setFormData(fd)}
            onSubmit={({ formData: fd }) => submit(fd)}
            showErrorList={false}
          >
            {footer}
          </Form>
        ) : (
          <div>
            <Textarea
              value={rawArgs}
              onChange={(e) => setRawArgs(e.target.value)}
              spellCheck={false}
              rows={5}
              className="font-mono text-xs"
              aria-label="arguments JSON"
            />
            {rawErr && <p className="mt-1 text-xs text-destructive">{rawErr}</p>}
            {footer}
          </div>
        )}

        <ResultView
          className="mt-4"
          result={invoke.data}
          error={(invoke.error as ApiError | null) ?? null}
        />
      </div>

      <AlertDialog open={pendingArgs !== null} onOpenChange={(o) => !o && setPendingArgs(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono text-base">
              确认执行 {cmd.name}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="text-sm">
                  该命令声明了 <code className="font-mono">confirm</code>
                  {cmd.effect ? `(effect: ${cmd.effect})` : ''},执行前需二次确认。
                </p>
                <pre className="mt-2 max-h-40 overflow-auto rounded-sm border bg-background px-2 py-1.5 text-left font-mono text-xs">
                  {JSON.stringify(pendingArgs, null, 2)}
                </pre>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const args = pendingArgs
                setPendingArgs(null)
                doInvoke(args ?? {})
              }}
            >
              确认执行
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
