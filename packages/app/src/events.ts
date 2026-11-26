import { check, EVENT_MAX_BYTES, eventCommands, type EventReadInput, type EventReadResult, type EventRepository, negotiate, TBError } from '@tool-bridge/core'
import type { AppContext } from './deps'
import { mailboxJsonObject } from './routes/deviceMailbox'
import { renderResult } from './responses'

async function readEvents(repository: EventRepository, path: string, input: EventReadInput, keyId: string, signal: AbortSignal, authorize: () => Promise<void>): Promise<EventReadResult> {
  const waitMs = input.waitMs ?? 0
  const deadline = performance.now() + waitMs
  const release = waitMs > 0 ? await repository.acquireWait(keyId) : undefined
  // Subscribe before the first snapshot. Latch wakes arriving during authorization or query.
  let notified = false
  let resume: (() => void) | undefined
  const wake = () => {
    notified = true
    resume?.()
  }
  const stop = repository.watch(path, wake)
  signal.addEventListener('abort', wake)
  let after = input.after
  try {
    for (;;) {
      signal.throwIfAborted()
      notified = false
      await authorize()
      const page = await repository.read(path, { ...input, after })
      await authorize()
      signal.throwIfAborted()
      if (page.events.length || page.gap || waitMs === 0) return page
      const remaining = deadline - performance.now()
      if (remaining <= 0) return { ...page, timedOut: true }
      after = page.nextCursor
      if (!notified) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, Math.min(1000, remaining))
          resume = () => {
            clearTimeout(timer)
            resolve()
          }
        })
        resume = undefined
      }
    }
  } finally {
    stop()
    signal.removeEventListener('abort', wake)
    await release?.()
  }
}

export async function invokeEvent(c: AppContext, repository: EventRepository | undefined, path: string, command: string): Promise<Response> {
  const ctx = c.get('ctx')
  const scope = eventCommands.scopeFor(command)
  if (!scope) throw TBError.notFound()
  if (!check(ctx, path, scope).allow) throw new TBError('permission_denied', 'event command is not permitted')
  if (!repository) throw new TBError('unavailable', 'event repository is unavailable')
  const args = await mailboxJsonObject(c, { maxBytes: EVENT_MAX_BYTES, allowEmpty: true })
  const result = await eventCommands.invoke(command, args, {
    publish: input => repository.publish(path, ctx, input),
    read: input => readEvents(repository, path, input, ctx.keyId, c.req.raw.signal, async () => {
      const current = await c.get('authenticate')()
      if (!current || current.keyId !== ctx.keyId || current.owner !== ctx.owner) throw TBError.unauthenticated()
      if (!check(current, path, 'read').allow) throw TBError.notFound()
    }),
  })
  return renderResult(result, negotiate(c.req.header('accept')))
}
