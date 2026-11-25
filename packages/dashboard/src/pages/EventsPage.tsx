import type { EventEnvelope } from '@tool-bridge/sdk/client'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useConn, useSession } from '@/lib/session-context'
import { PageHeader } from '@/components/PageHeader'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { withClient } from '@/lib/api'

function TopicStream({ path }: { path: string }) {
  const conn = useConn()
  const [items, setItems] = useState<EventEnvelope[]>([])
  const [status, setStatus] = useState('尚未订阅')
  const [observing, setObserving] = useState(false)
  const [gap, setGap] = useState<string>()
  const [type, setType] = useState('')
  const [body, setBody] = useState('{}')
  const [publishing, setPublishing] = useState(false)
  const [receipt, setReceipt] = useState('')
  const position = useRef<string | undefined>(undefined)
  const attempt = useRef<{ body: string, key: string, type: string } | undefined>(undefined)
  const observer = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => {
    observer.current?.abort()
  }, [])

  const follow = async (once: boolean, after = position.current) => {
    observer.current?.abort()
    const controller = new AbortController()
    observer.current = controller
    setObserving(true)
    setGap(undefined)
    setStatus(once ? '等待一条事件' : '正在跟随')
    try {
      do {
        const page = await withClient(conn, client => client.events.read(path, {
          after, limit: once ? 1 : 50, waitMs: 15_000,
        }, { signal: controller.signal }))
        if (controller.signal.aborted) return
        if (page.gap) {
          setGap(page.gap.earliestCursor)
          setStatus('上次位置的历史已过期，或主题已重建')
          return
        }
        after = page.nextCursor
        position.current = after
        if (page.events.length) {
          setItems((current) => {
            const merged = new Map(current.map(item => [item.id, item]))
            for (const item of page.events) merged.set(item.id, item)
            return [...merged.values()].slice(-100)
          })
        }
        if (once) setStatus(page.events.length ? '已收到事件' : '等待超时，可从当前位置继续')
      } while (!once && !controller.signal.aborted)
    } catch (error) {
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : '读取失败，可继续订阅')
    } finally {
      if (observer.current === controller) setObserving(false)
    }
  }

  const publish = async () => {
    setPublishing(true)
    setReceipt('')
    try {
      const data = JSON.parse(body)
      if (!attempt.current || attempt.current.body !== body || attempt.current.type !== type) {
        attempt.current = { body, type, key: crypto.randomUUID() }
      }
      const result = await withClient(conn, client => client.events.publish(path, {
        type: type.trim(), data, idempotencyKey: attempt.current!.key,
      }))
      attempt.current = undefined
      setReceipt(`已发布 · ${result.id}`)
    } catch (error) {
      setReceipt(error instanceof SyntaxError ? '事件内容需要有效的 JSON' : error instanceof Error ? error.message : '发布失败')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <section aria-label="事件流" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="mr-auto break-all font-mono text-sm">{path}</strong>
        {observing
          ? (
              <Button
                onClick={() => {
                  observer.current?.abort()
                  setStatus('已暂停')
                }}
                variant="outline"
              >
                暂停
              </Button>
            )
          : gap
            ? (
                <Button onClick={() => {
                  setItems([])
                  void follow(false, gap)
                }}
                >
                  从最早可用位置继续
                </Button>
              )
            : (
                <>
                  <Button onClick={() => void follow(true)} variant="outline">等待一条</Button>
                  <Button onClick={() => void follow(false)}>{position.current ? '继续跟随' : '开始跟随'}</Button>
                </>
              )}
      </div>
      <p aria-live="polite" className="text-sm text-muted-foreground">{status}</p>
      <div className="divide-y border-y">
        {items.length === 0 && <p className="py-6 text-sm text-muted-foreground">暂无已读取的事件</p>}
        {items.map(event => (
          <details className="py-2 text-sm" key={event.id}>
            <summary className="cursor-pointer break-all">
              <time className="mr-3 font-mono text-xs text-muted-foreground" dateTime={event.recordedAt}>{new Date(event.recordedAt).toLocaleTimeString()}</time>
              {event.type}
              {event.subject ? ` · ${event.subject}` : ''}
            </summary>
            <pre className="max-h-52 overflow-auto p-3 text-xs whitespace-pre-wrap break-all">{JSON.stringify(event, null, 2)}</pre>
          </details>
        ))}
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium">发布事件</summary>
        <form
          className="mt-3 max-w-xl space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            void publish()
          }}
        >
          <Label htmlFor="event-type">事件类型</Label>
          <Input disabled={publishing} id="event-type" onChange={e => setType(e.target.value)} placeholder="build.finished" required value={type} />
          <Label htmlFor="event-data">内容（JSON）</Label>
          <Textarea className="font-mono" disabled={publishing} id="event-data" onChange={e => setBody(e.target.value)} required value={body} />
          <Button disabled={publishing || !type.trim()} type="submit">发布</Button>
          <p aria-live="polite" className="text-xs break-all">{receipt}</p>
        </form>
      </details>
    </section>
  )
}

export function EventsPage() {
  const { revision } = useSession()
  const conn = useConn()
  const [params, setParams] = useSearchParams()
  const selected = params.get('topic') ?? ''
  const [input, setInput] = useState(selected)
  const [message, setMessage] = useState('')
  const [creating, setCreating] = useState(false)
  const topic = input.trim().replace(/^\/+|\/+$/g, '')
  const create = async () => {
    setCreating(true)
    try {
      await withClient(conn, client => client.events.create(topic))
      setParams({ topic })
      setMessage('主题已创建')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建失败')
    } finally { setCreating(false) }
  }
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <PageHeader title="事件" />
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setMessage('')
          setParams({ topic })
        }}
      >
        <div className="min-w-48 flex-1 space-y-2">
          <Label htmlFor="event-path">主题路径</Label>
          <Input id="event-path" onChange={e => setInput(e.target.value)} placeholder="project/builds" value={input} />
        </div>
        <Button disabled={!topic || creating} type="submit" variant="outline">打开主题</Button>
        <Button disabled={!topic || creating} onClick={() => void create()} type="button" variant="ghost">创建主题</Button>
      </form>
      {message && <p className="text-sm" role="status">{message}</p>}
      {selected && <TopicStream key={`${revision}/${selected}`} path={selected} />}
    </main>
  )
}
