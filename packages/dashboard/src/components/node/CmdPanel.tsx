import type { RJSFSchema } from '@rjsf/utils'
import { useQueryClient } from '@tanstack/react-query'
import { Braces, ChevronRight, ClipboardList, Loader2, Play, TriangleAlert } from 'lucide-react'
import { lazy, Suspense, useEffect, useId, useState } from 'react'
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
import { useInvoke, useToolHelp } from '@/lib/queries'
import { isFormFriendly, skeletonFromSchema } from '@/lib/schemaForm'
import type { HelpCmd } from '@/lib/types'
import { cn } from '@/lib/utils'

const SchemaFormRenderer = lazy(() => import('@/components/node/SchemaFormRenderer'))

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
  const lead = (m[1] ?? '').replace(/[;;]\s*$/, '').trim()
  const body = (m[2] ?? '').trim()
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
  variant = 'accordion',
  onPendingChange,
}: {
  path: string
  cmd: HelpCmd
  defaultOpen?: boolean
  lazySchema?: boolean
  variant?: 'accordion' | 'workbench'
  /** 工作区用：调用存活期间阻止父级 remount 当前面板。 */
  onPendingChange?: (pending: boolean) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const workbench = variant === 'workbench'
  const effectiveOpen = workbench || open
  // 直连工具 cmd(mcp/http/tool):~help 宣告的 path 含工具段(协议判别规则)
  // → POST /<path>/<tool>,body 即 arguments;否则信封 POST /<path>。
  const direct = cmd.path === `/${path}/${cmd.name}`
  const lazyNeeded = lazySchema && cmd.inputSchema === undefined
  const toolHelp = useToolHelp(path, cmd.name, lazyNeeded && effectiveOpen)
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

  /** 当前编辑中的参数(CliHint 展示用;JSON 模式解析失败时回落 {})。 */
  const currentArgs = (() => {
    if (mode === 'form') return formData ?? {}
    try {
      return rawArgs.trim() === '' ? {} : JSON.parse(rawArgs)
    } catch {
      return {}
    }
  })()

  // 懒补水到位后一次性初始化编辑器形态(仅当用户尚未输入;guard 保证幂等)。
  useEffect(() => {
    if (!lazyNeeded || inputSchema === undefined) return
    const pristine = rawArgs === '{}' && formData === undefined
    if (!pristine) return
    if (isFormFriendly(inputSchema)) setMode('form')
    else setRawArgs(JSON.stringify(skeletonFromSchema(inputSchema), null, 2))
  }, [lazyNeeded, inputSchema, rawArgs, formData])

  useEffect(() => {
    onPendingChange?.(invoke.isPending)
  }, [invoke.isPending, onPendingChange])

  const doInvoke = async (args: unknown) => {
    try {
      await invoke.mutateAsync({ path, tool: cmd.name, args, accept, direct })
      if (MUTATING.test(cmd.name)) await qc.invalidateQueries({ queryKey: ['tb'] })
    } catch {
      // Mutation 错误由 useInvoke 保留给 ResultView；这里吞掉 Promise rejection，
      // 让卸载后的调用也能安全结算，不产生未处理拒绝。
    }
  }

  const submit = (args: unknown) => {
    if (cmd.confirm) setPendingArgs(args ?? {})
    else void doInvoke(args ?? {})
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
    <div
      className={cn(
        'mt-4 flex flex-wrap items-center gap-2 border-t pt-3',
        workbench && 'mt-5 bg-card/20 pt-4',
      )}
    >
      <Button
        type={mode === 'form' ? 'submit' : 'button'}
        size="sm"
        disabled={invoke.isPending}
        onClick={mode === 'json' ? submitRaw : undefined}
      >
        {invoke.isPending ? <Loader2 className="animate-spin" /> : <Play />}
        调用
      </Button>
      <label htmlFor={acceptId} className="text-xs text-muted-foreground sm:ml-2">
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
          className="text-xs text-muted-foreground sm:ml-auto"
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
    <Collapsible open={effectiveOpen} onOpenChange={workbench ? undefined : setOpen} asChild>
      <section
        id={`cmd-${cmd.name}`}
        className={cn(
          'border bg-card/60',
          workbench
            ? 'min-h-[30rem] overflow-hidden rounded-xl bg-card/45 shadow-sm'
            : 'rounded-md',
        )}
      >
        {/* 与 ~help 的层级观感对齐:默认只露 cmd 一行,schema 表单点开才展开 */}
        <header className={cn(workbench && 'border-b bg-background/28 px-4 py-4 sm:px-5')}>
          {workbench ? (
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-mono text-lg text-foreground sm:text-xl">{cmd.name}</span>
                <span
                  className={cn(
                    'inline-flex items-center rounded-md border px-2 font-mono text-[10px] leading-5 uppercase',
                    SCOPE_STYLE[cmd.scope] ?? SCOPE_STYLE.read,
                  )}
                >
                  {cmd.scope}
                </span>
                {cmd.effect && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-warn/40 bg-warn/5 px-2 font-mono text-[10px] leading-5 text-warn">
                    {cmd.effect === 'destructive' && <TriangleAlert className="size-2.5" />}
                    {cmd.effect}
                  </span>
                )}
                {cmd.confirm && (
                  <span className="inline-flex items-center rounded-md border border-destructive/40 bg-destructive/5 px-2 font-mono text-[10px] leading-5 text-destructive">
                    confirm
                  </span>
                )}
              </div>
              {cmd.h && <CmdDoc h={cmd.h} />}
            </div>
          ) : (
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex w-full cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5 text-left sm:px-4',
                  'hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset',
                  effectiveOpen && 'border-b',
                )}
              >
                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    'size-3.5 shrink-0 text-muted-foreground/60 transition-transform',
                    effectiveOpen && 'rotate-90',
                  )}
                />
                <span className="font-mono text-sm text-foreground">{cmd.name}</span>
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
              </button>
            </CollapsibleTrigger>
          )}
        </header>

        <CollapsibleContent>
          <div className={cn('min-w-0 px-3 py-3 sm:px-4', workbench && 'p-4 sm:p-5')}>
            {lazyNeeded && toolHelp.isPending ? (
              <div className="grid gap-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-2/3" />
              </div>
            ) : mode === 'form' && hasSchema ? (
              <Suspense
                fallback={
                  <div className="grid gap-2" role="status" aria-label="正在加载表单引擎">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-5/6" />
                    <Skeleton className="h-8 w-32" />
                  </div>
                }
              >
                <SchemaFormRenderer
                  schema={inputSchema as RJSFSchema}
                  formData={formData}
                  onChange={setFormData}
                  onSubmit={submit}
                >
                  {footer}
                </SchemaFormRenderer>
              </Suspense>
            ) : (
              <div>
                <Textarea
                  value={rawArgs}
                  onChange={(e) => setRawArgs(e.target.value)}
                  spellCheck={false}
                  rows={workbench ? 10 : 5}
                  className={cn(
                    'font-mono text-xs',
                    workbench && 'min-h-56 rounded-xl bg-background/55',
                  )}
                  aria-label="arguments JSON"
                />
                {rawErr && <p className="mt-1 text-xs text-destructive">{rawErr}</p>}
                {footer}
              </div>
            )}

            <CliHint path={path} tool={cmd.name} args={currentArgs} direct={direct} />

            <ResultView
              className="mt-5"
              result={invoke.data}
              error={(invoke.error as ApiError | null) ?? null}
            />
            {!invoke.data && !invoke.error && workbench && (
              <div className="mt-5 grid min-h-32 place-items-center rounded-xl border border-dashed bg-background/25 px-5 py-8 text-center">
                <div>
                  <p className="text-sm font-medium text-foreground/80">等待调用结果</p>
                  <p className="mt-1.5 max-w-sm text-xs leading-5 text-muted-foreground">
                    填写参数并执行后，响应、耗时以及复制和下载操作会显示在这里。
                  </p>
                </div>
              </div>
            )}
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
                  <pre className="mt-2 max-h-40 max-w-full overflow-auto rounded-sm border bg-background px-2 py-1.5 text-left font-mono text-xs whitespace-pre-wrap break-words">
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
                  void doInvoke(args ?? {})
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
