import type { RJSFSchema } from '@rjsf/utils'
import { Braces, ChevronRight, ClipboardList, Loader2, Play, TriangleAlert } from 'lucide-react'
import { lazy, Suspense, useEffect, useId, useState } from 'react'
import type { HelpCmd } from '@/lib/types'
import type { ApiError } from '@/lib/api'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { isFormFriendly, skeletonFromSchema } from '@/lib/schemaForm'
import { useInvalidate, useInvoke, useToolHelp } from '@/lib/queries'
import { ResultView } from '@/components/node/ResultView'
import { CliHint } from '@/components/node/CliHint'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { isPathSegmentSafe } from '@/lib/path'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const SchemaFormRenderer = lazy(() => import('@/components/SchemaFormRenderer'))

/** 变更型 tool 名 → 调用成功后失效该 profile 的全部查询(树/列表可能已变)。 */
const MUTATING = /^(write|update|delete|set|rm|remove|unmount|mount)$/i

/**
 * device shell 的 allow 白名单只编码在 h 文案里(core describeAllow 的三种形态),
 * 解析出来以标签呈现;不匹配则原样当普通说明文字。
 */
function parseShellAllow(h: string): { allow: string[] | 'all' | 'none', lead: string } | null {
  const m = /^(.*?)允许命令:\s*(.+?)(?:;其余拒绝)?$/.exec(h)
  if (!m) return null
  const lead = (m[1] ?? '').replace(/[;;]\s*$/, '').trim()
  const body = (m[2] ?? '').trim()
  if (body === '*') return { lead, allow: 'all' }
  if (body.startsWith('无')) return { lead, allow: 'none' }
  return { lead, allow: body.split(/[,,]\s*/).filter(Boolean) }
}

function CmdDoc({ h, standalone = false }: { h: string, standalone?: boolean }) {
  const parsed = parseShellAllow(h)
  if (!parsed) {
    return <p className={cn('w-full text-sm leading-6 text-muted-foreground', !standalone && 'sm:ml-auto sm:w-auto')}>{h}</p>
  }
  return (
    <div className={cn('flex w-full flex-wrap items-center gap-1.5 text-sm text-muted-foreground', !standalone && 'sm:ml-auto sm:w-auto')}>
      {parsed.lead && (
        <span>
          {parsed.lead}
          {' '}
          ·
        </span>
      )}
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
      {Array.isArray(parsed.allow)
        && parsed.allow.map(cmd => (
          <code
            className="inline-flex items-center rounded-sm border border-emerald-400/30 bg-emerald-400/5 px-1.5 font-mono text-[10px] leading-4 text-emerald-400/90"
            key={cmd}
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
}: {
  cmd: HelpCmd
  defaultOpen?: boolean
  lazySchema?: boolean
  path: string
  variant?: 'accordion' | 'dialog' | 'page'
}) {
  const [open, setOpen] = useState(defaultOpen)
  // dialog(弹窗)用"常开大编辑器"形态,DialogContent 已提供外框;accordion 仍是可折叠行。
  const page = variant === 'page'
  const dialog = variant !== 'accordion'
  const effectiveOpen = dialog || open
  // 唯一调用形态:~help 宣告的 cmd.path 是完整命令路径(含命令/工具叶子段),
  // 直接 POST 到它,body 即 arguments。
  const commandPath = cmd.path.replace(/^\/+/, '')
  const segmentSafe = isPathSegmentSafe(cmd.name)
  const lazyNeeded = segmentSafe && lazySchema && cmd.inputSchema === undefined
  const toolHelp = useToolHelp(path, cmd.name, lazyNeeded && effectiveOpen)
  const deliveryCapability = cmd.delivery ?? toolHelp.data?.cmds[0]?.delivery ?? 'realtime'
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
  const [delivery, setDelivery] = useState<'fallback' | 'mailbox' | 'realtime'>(
    deliveryCapability === 'mailbox' ? 'mailbox' : 'realtime',
  )
  const [deliveryError, setDeliveryError] = useState<string | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [ttl, setTtl] = useState('')
  const [pendingArgs, setPendingArgs] = useState<unknown | null>(null)
  const invoke = useInvoke()
  const invalidate = useInvalidate()
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
    if (deliveryCapability === 'mailbox') setDelivery('mailbox')
    if (deliveryCapability === 'realtime') setDelivery('realtime')
  }, [deliveryCapability])

  const doInvoke = async (args: unknown) => {
    const ttlSeconds = ttl.trim() === '' ? undefined : Number(ttl)
    if (ttlSeconds !== undefined && (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1)) {
      setDeliveryError('TTL 必须是正整数秒数')
      return
    }
    setDeliveryError(null)
    try {
      await invoke.mutateAsync({
        commandPath,
        historyIdentity: { path, tool: cmd.name },
        args,
        accept,
        ...(deliveryCapability === 'realtime' ? {} : { delivery }),
        ...(delivery === 'realtime' || idempotencyKey.trim() === ''
          ? {}
          : { idempotencyKey: idempotencyKey.trim() }),
        ...(delivery === 'realtime' || ttlSeconds === undefined ? {} : { ttlSeconds }),
      })
      if (MUTATING.test(cmd.name)) await invalidate()
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
        dialog && 'mt-5 pt-4',
        page && 'sticky bottom-0 z-10 bg-card pb-2',
      )}
    >
      <Button
        disabled={invoke.isPending}
        onClick={mode === 'json' ? submitRaw : undefined}
        size="sm"
        type={mode === 'form' ? 'submit' : 'button'}
      >
        {invoke.isPending ? <Loader2 className="animate-spin" /> : <Play />}
        调用
      </Button>
      <label className="text-xs text-muted-foreground sm:ml-2" htmlFor={acceptId}>
        结果格式
      </label>
      <Select onValueChange={v => setAccept(v as 'markdown' | 'json')} value={accept}>
        <SelectTrigger className="h-8 w-32 font-mono text-xs" id={acceptId} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem className="font-mono text-xs" value="markdown">
            markdown
          </SelectItem>
          <SelectItem className="font-mono text-xs" value="json">
            json
          </SelectItem>
        </SelectContent>
      </Select>
      {deliveryCapability !== 'realtime' && (
        <>
          <label className="text-xs text-muted-foreground sm:ml-2" htmlFor={`${acceptId}-delivery`}>
            执行方式
          </label>
          <Select
            onValueChange={value => setDelivery(value as typeof delivery)}
            value={delivery}
          >
            <SelectTrigger
              className="h-8 w-32 font-mono text-xs"
              id={`${acceptId}-delivery`}
              size="sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {deliveryCapability === 'both' && (
                <SelectItem className="font-mono text-xs" value="realtime">realtime</SelectItem>
              )}
              {deliveryCapability === 'both' && (
                <SelectItem className="font-mono text-xs" value="fallback">fallback</SelectItem>
              )}
              <SelectItem className="font-mono text-xs" value="mailbox">mailbox</SelectItem>
            </SelectContent>
          </Select>
          {delivery !== 'realtime' && (
            <>
              <Input
                aria-label="Mailbox TTL seconds"
                className="h-8 w-24 font-mono text-xs"
                min="1"
                onChange={event => setTtl(event.target.value)}
                placeholder="TTL"
                type="number"
                value={ttl}
              />
              <Input
                aria-label="Mailbox idempotency key"
                className="h-8 min-w-36 flex-1 font-mono text-xs sm:max-w-56"
                onChange={event => setIdempotencyKey(event.target.value)}
                placeholder="idempotency key"
                value={idempotencyKey}
              />
            </>
          )}
        </>
      )}
      {formFriendly && (
        <Button
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
          size="sm"
          type="button"
          variant="ghost"
        >
          {mode === 'form' ? <Braces /> : <ClipboardList />}
          {mode === 'form' ? 'JSON 编辑' : '表单编辑'}
        </Button>
      )}
    </div>
  )

  return (
    <Collapsible asChild onOpenChange={dialog ? undefined : setOpen} open={effectiveOpen}>
      <section
        className={cn(
          dialog
            ? 'flex min-h-0 flex-1 flex-col'
            : 'rounded-md border bg-card/60',
        )}
        id={`cmd-${cmd.name}`}
      >
        {/* 与 ~help 的层级观感对齐:默认只露 cmd 一行,schema 表单点开才展开 */}
        <header className={cn(dialog && 'shrink-0')}>
          {dialog
            ? (
                <div className={cn('flex min-w-0 flex-col gap-2', page && 'mb-5')}>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {!page && <span className="font-mono text-lg text-foreground sm:text-xl">{cmd.name}</span>}
                    <span
                      className="inline-flex items-center rounded-md border bg-muted/35 px-2 text-xs leading-5 text-muted-foreground"
                    >
                      {{ read: '读取', write: '写入', call: '执行', register: '注册', admin: '管理' }[cmd.scope]}
                    </span>
                    {cmd.effect && cmd.effect !== cmd.scope && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-warn/40 bg-warn/5 px-2 text-xs leading-5 text-warn">
                        {cmd.effect === 'destructive' && <TriangleAlert className="size-2.5" />}
                        {{ read: '读取操作', write: '写入操作', destructive: '破坏性操作' }[cmd.effect] ?? cmd.effect}
                      </span>
                    )}
                    {cmd.confirm && (
                      <span className="inline-flex items-center rounded-md border border-destructive/40 bg-destructive/5 px-2 text-xs leading-5 text-destructive">
                        需要确认
                      </span>
                    )}
                  </div>
                  {cmd.h && <CmdDoc h={cmd.h} standalone={dialog} />}
                </div>
              )
            : (
                <CollapsibleTrigger asChild>
                  <button
                    className={cn(
                      'flex w-full cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5 text-left sm:px-4',
                      'hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset',
                      effectiveOpen && 'border-b',
                    )}
                    type="button"
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
                      className="inline-flex items-center rounded-md border bg-muted/35 px-2 text-xs leading-5 text-muted-foreground"
                    >
                      {{ read: '读取', write: '写入', call: '执行', register: '注册', admin: '管理' }[cmd.scope]}
                    </span>
                    {cmd.effect && cmd.effect !== cmd.scope && (
                      <span className="inline-flex items-center gap-1 rounded-sm border border-warn/40 px-1.5 font-mono text-[10px] leading-4 text-warn">
                        {cmd.effect === 'destructive' && <TriangleAlert className="size-2.5" />}
                        {{ read: '读取操作', write: '写入操作', destructive: '破坏性操作' }[cmd.effect] ?? cmd.effect}
                      </span>
                    )}
                    {cmd.confirm && (
                      <span className="inline-flex items-center rounded-sm border border-destructive/40 px-1.5 font-mono text-[10px] leading-4 text-destructive">
                        需要确认
                      </span>
                    )}
                    {cmd.h && <CmdDoc h={cmd.h} standalone={dialog} />}
                  </button>
                </CollapsibleTrigger>
              )}
        </header>

        <CollapsibleContent className={cn(dialog && !page && 'min-h-0 flex-1 overflow-y-auto')}>
          <div className={cn('min-w-0', page && 'grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]')}>
            <div className={cn('min-w-0 px-3 py-3 sm:px-4', dialog && 'px-1 py-4', page && 'rounded-xl border bg-card p-5 sm:p-6')}>
              {page && <h2 className="mb-5 text-base font-semibold">输入参数</h2>}
              {lazyNeeded && toolHelp.isPending
                ? (
                    <div className="grid gap-2">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-2/3" />
                    </div>
                  )
                : lazyNeeded && toolHelp.isError
                  ? (
                      <div className="rounded-lg border border-destructive/25 p-4 text-sm" role="alert">
                        <p>无法加载此命令的参数说明，请重试后再调用。</p>
                        <Button className="mt-3" onClick={() => void toolHelp.refetch()} size="sm" variant="outline">重新加载参数</Button>
                      </div>
                    )
                  : mode === 'form' && hasSchema
                    ? (
                        <Suspense
                          fallback={(
                            <div aria-label="正在加载表单引擎" className="grid gap-2" role="status">
                              <Skeleton className="h-9 w-full" />
                              <Skeleton className="h-9 w-5/6" />
                              <Skeleton className="h-8 w-32" />
                            </div>
                          )}
                        >
                          <SchemaFormRenderer
                            formData={formData}
                            onChange={({ formData: next }) => setFormData(next)}
                            onSubmit={({ formData: next }) => submit(next)}
                            schema={inputSchema as RJSFSchema}
                          >
                            {footer}
                          </SchemaFormRenderer>
                        </Suspense>
                      )
                    : (
                        <div>
                          <Textarea
                            aria-label="arguments JSON"
                            className={cn(
                              'font-mono text-xs',
                              dialog && 'min-h-56 rounded-xl bg-background/55',
                            )}
                            onChange={e => setRawArgs(e.target.value)}
                            rows={dialog ? 10 : 5}
                            spellCheck={false}
                            value={rawArgs}
                          />
                          {rawErr && <p className="mt-1 text-xs text-destructive">{rawErr}</p>}
                          {footer}
                        </div>
                      )}

              {deliveryError && <p className="mt-2 text-xs text-destructive">{deliveryError}</p>}

              <CliHint
                args={currentArgs}
                commandPath={commandPath}
                delivery={deliveryCapability === 'realtime' ? undefined : delivery}
                idempotencyKey={delivery === 'realtime' || idempotencyKey.trim() === ''
                  ? undefined
                  : idempotencyKey.trim()}
                ttlSeconds={delivery === 'realtime' || ttl.trim() === '' ? undefined : Number(ttl)}
              />
            </div>
            <div aria-label="调用结果" className={cn('min-w-0', page && 'min-h-80 rounded-xl border bg-card p-5 sm:p-6 lg:sticky lg:top-6')}>
              {page && <h2 className="mb-5 text-base font-semibold">执行结果</h2>}
              {invoke.isPending && (
                <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  <Loader2 className="size-4 animate-spin" />
                  正在执行，请稍候…
                </p>
              )}
              <ResultView
                className={page ? '' : 'mt-5 px-3 sm:px-4'}
                error={(invoke.error as ApiError | null) ?? null}
                result={invoke.data}
              />
              {!invoke.data && !invoke.error && !invoke.isPending && dialog && (
                <div className="mt-5 grid min-h-32 place-items-center px-5 py-8 text-center">
                  <div>
                    <p className="text-sm font-medium text-foreground/80">等待调用结果</p>
                    <p className="mt-1.5 max-w-sm text-xs leading-5 text-muted-foreground">
                      填写参数并执行后，响应、耗时以及复制和下载操作会显示在这里。
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CollapsibleContent>

        <AlertDialog onOpenChange={o => !o && setPendingArgs(null)} open={pendingArgs !== null}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-mono text-base">
                确认执行
                {' '}
                {cmd.name}
                ?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div>
                  <p className="text-sm">
                    该命令声明了
                    {' '}
                    <code className="font-mono">confirm</code>
                    {cmd.effect ? `(effect: ${cmd.effect})` : ''}
                    ,执行前需二次确认。
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
