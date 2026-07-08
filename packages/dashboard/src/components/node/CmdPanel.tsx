import Form from '@rjsf/shadcn'
import type { RJSFSchema } from '@rjsf/utils'
import validator from '@rjsf/validator-ajv8'
import { useQueryClient } from '@tanstack/react-query'
import {
  Braces,
  ChevronRight,
  ClipboardList,
  History,
  Loader2,
  Play,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { CliHint } from '@/components/node/CliHint'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { ApiError } from '@/lib/api'
import { lastArgsFor } from '@/lib/history'
import { useInvoke, useToolHelp } from '@/lib/queries'
import { isFormFriendly, skeletonFromSchema } from '@/lib/schemaForm'
import { useSession } from '@/lib/session'
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
 * 单条 cmd 的调用面板(CmdSpec 的通用渲染器):
 * inputSchema → rjsf 表单(可切 JSON 原文编辑);confirm=true 弹二次确认(语义在客户端);
 * Accept 可选 markdown(默认表现)/JSON;返回经 ResultView 展示。
 * `lazySchema`(mcp/http 节点):节点级 ~help 是索引形态(无 inputSchema),
 * 面板展开时经工具级 ~help 按需补水(两级披露)。
 */
export function CmdPanel({
  path,
  cmd,
  defaultOpen = false,
  lazySchema = false,
}: {
  path: string
  cmd: HelpCmd
  defaultOpen?: boolean
  lazySchema?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  // 直连工具 cmd(mcp/http/tool):~help 宣告的 path 含工具段(协议判别规则)
  // → POST /<path>/<tool>,body 即 arguments;否则信封 POST /<path>。
  const direct = cmd.path === `/${path}/${cmd.name}`
  const lazyNeeded = lazySchema && cmd.inputSchema === undefined
  const toolHelp = useToolHelp(path, cmd.name, lazyNeeded && open)
  const inputSchema = cmd.inputSchema ?? toolHelp.data?.cmds[0]?.inputSchema
  const hasSchema = inputSchema !== undefined && typeof inputSchema === 'object'
  // rjsf 渲染不了的形状(如缺 items 的 array)直接落 JSON 编辑,避免表单区出现错误文本。
  const formFriendly = hasSchema && isFormFriendly(inputSchema)
  const [mode, setMode] = useState<'form' | 'json'>(formFriendly ? 'form' : 'json')
  const [formData, setFormData] = useState<unknown>(undefined)
  const [rawArgs, setRawArgs] = useState(() =>
    hasSchema && !formFriendly ? JSON.stringify(skeletonFromSchema(inputSchema), null, 2) : '{}',
  )
  const [rawErr, setRawErr] = useState<string | null>(null)
  const [accept, setAccept] = useState<'markdown' | 'json'>('markdown')
  const [pendingArgs, setPendingArgs] = useState<unknown | null>(null)
  const invoke = useInvoke()
  const qc = useQueryClient()
  const acceptId = useId()
  const { active } = useSession()
  const lastArgs = lastArgsFor(active?.name ?? '', path, cmd.name)

  /** 当前编辑中的参数(CliHint 展示用;JSON 模式解析失败时回落 {})。 */
  const currentArgs = (() => {
    if (mode === 'form') return formData ?? {}
    try {
      return rawArgs.trim() === '' ? {} : JSON.parse(rawArgs)
    } catch {
      return {}
    }
  })()

  const restoreLast = () => {
    if (lastArgs === undefined) return
    setRawArgs(JSON.stringify(lastArgs, null, 2))
    if (formFriendly) {
      setFormData(lastArgs)
      setMode('form')
    } else {
      setMode('json')
    }
  }

  // 懒补水到位后一次性初始化编辑器形态(仅当用户尚未输入;guard 保证幂等)。
  useEffect(() => {
    if (!lazyNeeded || inputSchema === undefined) return
    const pristine = rawArgs === '{}' && formData === undefined
    if (!pristine) return
    if (isFormFriendly(inputSchema)) setMode('form')
    else setRawArgs(JSON.stringify(skeletonFromSchema(inputSchema), null, 2))
  }, [lazyNeeded, inputSchema, rawArgs, formData])

  const doInvoke = (args: unknown) => {
    invoke.mutate(
      { path, tool: cmd.name, args, accept, direct },
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
      {lastArgs !== undefined && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('text-xs text-muted-foreground', !formFriendly && 'ml-auto')}
          title="填入最近一次调用的参数"
          onClick={restoreLast}
        >
          <History />
          上次参数
        </Button>
      )}
    </div>
  )

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section id={`cmd-${cmd.name}`} className="rounded-md border bg-card/60">
        {/* 与 ~help 的层级观感对齐:默认只露 cmd 一行,schema 表单点开才展开 */}
        <CollapsibleTrigger asChild>
          <header
            className={cn(
              'flex w-full cursor-pointer flex-wrap items-center gap-2 px-4 py-2.5 text-left',
              'hover:bg-secondary/40',
              open && 'border-b',
            )}
          >
            <ChevronRight
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground/60 transition-transform',
                open && 'rotate-90',
              )}
            />
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
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 py-3">
            {lazyNeeded && toolHelp.isPending ? (
              <div className="grid gap-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-2/3" />
              </div>
            ) : mode === 'form' && hasSchema ? (
              <Form
                schema={inputSchema as RJSFSchema}
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

            <CliHint path={path} tool={cmd.name} args={currentArgs} direct={direct} />

            <ResultView
              className="mt-4"
              result={invoke.data}
              error={(invoke.error as ApiError | null) ?? null}
            />
          </div>
        </CollapsibleContent>

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
    </Collapsible>
  )
}
