import { type ProcessSessionList, processSessionListSchema, type ProcessSessionObservation, processSessionObservationSchema, type ProcessSessionSummary, processSessionSummarySchema } from '@tool-bridge/sdk/client'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { HelpCmd } from '@/lib/types'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { useConn, useSession } from '@/lib/session-context'
import { sessionCommands } from '@/lib/deviceSession'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { invoke } from '@/lib/api'

const running = (state: ProcessSessionSummary['state']) => state === 'running' || state === 'stopping'
const stateLabel: Record<ProcessSessionSummary['state'], string> = {
  running: '运行中', stopping: '正在停止，尚未确认退出', stopped: '已停止', exited: '已退出', timed_out: '运行超时',
}

function SessionPanel({ commands }: { commands: NonNullable<ReturnType<typeof sessionCommands>> }) {
  const conn = useConn()
  const inputId = useId()
  const readLifetime = useRef(new AbortController())
  const [page, setPage] = useState<ProcessSessionList | null>(null)
  const [input, setInput] = useState('{}')
  const [requestFilter, setRequestFilter] = useState('')
  const [startRequest, setStartRequest] = useState<string | null>(null)
  const [selected, setSelected] = useState<ProcessSessionSummary | null>(null)
  const [logs, setLogs] = useState('')
  const [gap, setGap] = useState(false)
  const [following, setFollowing] = useState(true)
  const [readError, setReadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<'start' | 'stop' | null>(null)
  const cursor = useRef(0)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    readLifetime.current = new AbortController()
    return () => {
      alive.current = false
      readLifetime.current.abort()
    }
  }, [])

  const request = useCallback(async <T extends ProcessSessionList | ProcessSessionObservation | ProcessSessionSummary>(command: HelpCmd, args: unknown, signal?: AbortSignal): Promise<T> => {
    const response = await invoke(conn, command.path, args, 'json', { signal: signal ?? (command.name === 'list' || command.name === 'observe' ? readLifetime.current.signal : undefined) })
    const schema = command.name === 'list' ? processSessionListSchema : command.name === 'observe' ? processSessionObservationSchema : processSessionSummarySchema
    const result = schema.safeParse(response.json)
    if (!result.success) throw new Error('invalid process session response')
    return result.data as T
  }, [conn])

  const load = useCallback(async (next?: string, signal?: AbortSignal) => {
    const result = await request<ProcessSessionList>(commands.list, {
      limit: 20,
      ...(next ? { cursor: next } : {}),
      ...(requestFilter.trim() ? { requestId: requestFilter.trim() } : {}),
    }, signal)
    if (!signal?.aborted && alive.current) setPage(result)
    return result
  }, [commands.list, request, requestFilter])

  useEffect(() => {
    const controller = new AbortController()
    void load(undefined, controller.signal).catch(() => {
      if (!controller.signal.aborted) setError('无法读取会话。设备可能离线，或当前连接没有访问权限。')
    })
    return () => controller.abort()
  }, [load])

  const sessionId = selected?.sessionId
  const runtimeId = selected?.runtimeId
  useEffect(() => {
    if (!sessionId || !following) return
    const controller = new AbortController()
    const observe = async () => {
      while (!controller.signal.aborted) {
        const result = await request<ProcessSessionObservation>(commands.observe, { sessionId, cursor: cursor.current, limitBytes: 65_536, waitMs: 20_000 }, controller.signal)
        if (controller.signal.aborted) return
        if (result.runtimeId !== runtimeId) throw new Error('runtime changed')
        const previous = cursor.current
        cursor.current = result.nextCursor
        setSelected(result)
        setLogs((current) => {
          const next = current + result.chunks.map(chunk => chunk.text).join('')
          return next.slice(-1_048_576)
        })
        if (result.gap) setGap(true)
        setReadError(null)
        if (!running(result.state) && previous === result.nextCursor) {
          setFollowing(false)
          return
        }
      }
    }
    void observe().catch(() => {
      if (!controller.signal.aborted) {
        setReadError('读取中断。连接恢复后可从当前日志位置继续；daemon 重启后旧会话失效。')
        setFollowing(false)
      }
    })
    return () => controller.abort()
  }, [commands.observe, following, request, runtimeId, sessionId])

  const choose = (session: ProcessSessionSummary) => {
    if (selected?.sessionId === session.sessionId) {
      setFollowing(true)
      return
    }
    cursor.current = 0
    setLogs('')
    setGap(false)
    setReadError(null)
    setSelected(session)
    setFollowing(true)
  }

  const execute = async (action: 'start' | 'stop') => {
    setPending(null)
    setBusy(true)
    setError(null)
    try {
      if (action === 'start') {
        const parsed: unknown = JSON.parse(input)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('input')
        const context = await request<ProcessSessionList>(commands.list, { limit: 1 })
        if (!alive.current) return
        const now = Date.parse(context.now)
        if (!Number.isFinite(now) || !context.runtimeId) throw new Error('runtime')
        const requestId = crypto.randomUUID()
        setStartRequest(requestId)
        const result = await request<ProcessSessionSummary>(commands.start, {
          input: parsed, requestId, expectedRuntimeId: context.runtimeId,
          startBefore: new Date(now + 60_000).toISOString(),
        })
        if (!alive.current) return
        setStartRequest(null)
        choose(result)
      } else if (selected) {
        const result = await request<ProcessSessionSummary>(commands.stop, { sessionId: selected.sessionId })
        if (!alive.current) return
        setSelected(result)
      }
      await load().catch(() => {
        if (alive.current) setError('操作结果已显示，但会话列表刷新失败。')
      })
    } catch {
      if (alive.current) setError(action === 'start'
        ? '未取得启动结果。请检查输入；若已有请求标识，请先用它查找原会话，避免重复启动。'
        : '未取得停止结果。请继续观察会话的实际状态。')
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const submit = (action: 'start' | 'stop') => {
    if (commands[action].confirm) setPending(action)
    else void execute(action)
  }

  return (
    <section aria-label="设备进程会话" className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
      <header>
        <h2 className="font-semibold">设备进程会话</h2>
        <p className="mt-1 text-sm text-muted-foreground">长命令可持续运行。关闭页面或暂停日志只停止查看；停止进程需显式操作。断线可恢复，daemon 重启后会话失效。</p>
      </header>
      <div className="space-y-2">
        <label className="text-sm" htmlFor={inputId}>命令输入（JSON）</label>
        <Textarea id={inputId} onChange={event => setInput(event.target.value)} rows={4} value={input} />
        <p className="text-xs text-muted-foreground">
          {commands.start.h}
          {' '}
          {commands.start.effect ? `操作类型：${commands.start.effect}` : ''}
        </p>
        <Button disabled={busy || startRequest !== null} onClick={() => submit('start')}>启动会话</Button>
      </div>
      {startRequest && (
        <div className="space-y-2 rounded border p-3 text-sm" role="status">
          <p className="break-all">
            启动请求：
            {startRequest}
            。结果尚未确认，请先查找原请求。
          </p>
          <Button onClick={() => setRequestFilter(startRequest)} size="sm" variant="outline">查找原请求</Button>
          <Button disabled={busy} onClick={() => setStartRequest(null)} size="sm" variant="outline">已核实结果，允许新的启动</Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Input aria-label="按启动请求标识查找" className="min-w-40 flex-1" onChange={event => setRequestFilter(event.target.value)} placeholder="按启动请求标识查找" value={requestFilter} />
        <Button onClick={() => void load().catch(() => setError('无法刷新会话列表。'))} variant="outline">刷新会话</Button>
      </div>
      {page && (
        <>
          <p className="break-all text-xs text-muted-foreground">
            运行实例：
            {page.runtimeId}
            {' '}
            · 报告时间：
            {page.now}
          </p>
          <div className="space-y-2">
            {page.items.map(item => (
              <button className="flex w-full min-w-0 flex-wrap justify-between gap-2 rounded border p-3 text-left text-sm" disabled={busy} key={item.sessionId} onClick={() => choose(item)} type="button">
                <span className="min-w-0 break-all font-mono">{item.sessionId}</span>
                <span>{stateLabel[item.state]}</span>
              </button>
            ))}
            {!page.items.length && <p className="text-sm text-muted-foreground">本页没有可见会话；这不能证明命令从未执行。</p>}
            {page.cursor && <Button onClick={() => void load(page.cursor).catch(() => setError('无法读取下一页。'))} variant="outline">下一页会话</Button>}
          </div>
        </>
      )}
      {selected && (
        <div className="space-y-3 border-t pt-4">
          <h3 className="break-all font-mono text-sm">{selected.sessionId}</h3>
          <p role="status">
            {stateLabel[selected.state]}
            {selected.exitCode !== undefined ? ` · 退出码 ${selected.exitCode}` : ''}
            {selected.signal ? ` · ${selected.signal}` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setFollowing(value => !value)} variant="outline">{following ? '暂停日志' : '继续读取日志'}</Button>
            <Button disabled={busy || !running(selected.state)} onClick={() => submit('stop')} variant="destructive">停止进程</Button>
          </div>
          {readError && <p className="text-sm text-destructive" role="alert">{readError}</p>}
          {gap && <p className="text-sm text-warn">设备日志已发生截断，以下内容不完整。</p>}
          <p className="text-xs text-muted-foreground">
            当前游标：
            {cursor.current}
            。页面仅保留最近约 100 万字符；日志按纯文本显示。
          </p>
          <pre aria-label="会话日志" className="max-h-96 min-h-24 overflow-auto rounded border bg-background p-3 font-mono text-xs whitespace-pre-wrap break-all">{logs || '暂无日志'}</pre>
        </div>
      )}
      <AlertDialog onOpenChange={open => !open && setPending(null)} open={pending !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              确认
              {pending === 'stop' ? '停止进程' : '启动会话'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              此命令要求确认。操作类型：
              {pending ? commands[pending].effect : ''}
              。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => pending && void execute(pending)}>确认执行</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

/** Keyed by connection: process parameters and logs stay in this mounted view only. */
export function DeviceSessionPanel({ cmds }: { cmds: HelpCmd[] }) {
  const commands = sessionCommands(cmds)
  const { active, revision } = useSession()
  return commands && <SessionPanel commands={commands} key={`${active?.id}:${active?.baseUrl}:${revision}:${commands.start.path}`} />
}
