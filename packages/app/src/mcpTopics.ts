import type { ServerEventBus } from '@modelcontextprotocol/server'
import { canonicalizePath, check, type EventRepository, identify, NodeRegistryStore, TBError } from '@tool-bridge/core'
import { SubscriptionsListenRequestSchema } from '@modelcontextprotocol/core'
import type { AppContext } from './deps'

const URI_PREFIX = 'tb-event://topics/'
const MAX_TOPICS = 16
const active = new WeakMap<EventRepository, Map<string, number>>()

function topicPath(uri: string): string {
  if (!uri.startsWith(URI_PREFIX) || uri.length > 2048) throw TBError.notFound()
  try {
    const path = canonicalizePath(uri.slice(URI_PREFIX.length).split('/').map(decodeURIComponent).join('/'))
    if (path && uri === URI_PREFIX + path.split('/').map(encodeURIComponent).join('/')) return path
  } catch { /* Invalid and invisible resources have the same public response. */ }
  throw TBError.notFound()
}

export function mcpTopicResources(c: AppContext, repository: EventRepository, shutdown?: AbortSignal) {
  const keyId = c.get('ctx').keyId
  const state = c.get('store')
  const registry = new NodeRegistryStore(state)
  async function authorize(uri: string): Promise<string> {
    const path = topicPath(uri)
    const ctx = await identify(state, c.req.header('authorization'), new Date().toISOString())
    if (!ctx || ctx.keyId !== keyId || !check(ctx, path, 'read').allow) throw TBError.notFound()
    if ((await registry.get(path)).kind !== 'topic') throw TBError.notFound()
    return path
  }

  return {
    async read(uri: string) {
      const path = await authorize(uri)
      const tail = await repository.read(path, {})
      await authorize(uri)
      return { path, cursor: tail.nextCursor, readCommand: path + '/read' }
    },
    async prepareListen(request: Request, close: () => void) {
      if (shutdown?.aborted) throw new TBError('unavailable', 'gateway is stopping')
      const parsed = SubscriptionsListenRequestSchema.safeParse(await request.clone().json().catch(() => null))
      const uris = [...new Set(parsed.data?.params.notifications.resourceSubscriptions ?? [])]
      if (!parsed.success || !uris.length || uris.length > MAX_TOPICS) {
        throw new TBError('invalid_argument', 'listen requires between 1 and 16 event resource URIs')
      }
      const paths = await Promise.all(uris.map(authorize))
      const counts = active.get(repository) ?? new Map<string, number>()
      if ((counts.get(keyId) ?? 0) >= 8 || (counts.size >= 128 && !counts.has(keyId))) {
        throw new TBError('rate_limited', 'too many open event subscriptions')
      }
      active.set(repository, counts)
      counts.set(keyId, (counts.get(keyId) ?? 0) + 1)
      let ended = false
      const stops: Array<() => void> = []
      const release = () => {
        if (ended) return
        ended = true
        for (const stop of stops) stop()
        const left = (counts.get(keyId) ?? 1) - 1
        if (left) counts.set(keyId, left)
        else counts.delete(keyId)
      }
      const bus: ServerEventBus = {
        publish() {},
        subscribe(listener) {
          const touched = new Set<string>()
          let checking = false
          let nextFullCheck = Date.now() + 15_000
          const recheck = async () => {
            const fullCheck = Date.now() >= nextFullCheck
            if (checking || ended || (!fullCheck && touched.size === 0)) return
            checking = true
            const changed = new Set(touched)
            touched.clear()
            try {
              if (fullCheck) nextFullCheck = Date.now() + 15_000
              for (const uri of fullCheck ? uris : changed) {
                await authorize(uri)
                if (!ended && changed.has(uri)) listener({ kind: 'resource_updated', uri })
              }
            } catch {
              close()
            } finally {
              checking = false
            }
          }
          for (const [index, path] of paths.entries()) {
            stops.push(repository.watch(path, () => touched.add(uris[index]!)))
          }
          // Coalesce bursts, recheck revocation while idle and bound the life of a slow consumer.
          const tick = setInterval(() => {
            void recheck()
          }, 1000)
          shutdown?.addEventListener('abort', close, { once: true })
          if (shutdown?.aborted) queueMicrotask(close)
          const lifetime = setTimeout(close, 10 * 60_000)
          stops.push(() => {
            shutdown?.removeEventListener('abort', close)
            clearTimeout(lifetime)
            clearInterval(tick)
          })
          return release
        },
      }
      return { bus, release }
    },
  }
}
export type McpTopicResources = ReturnType<typeof mcpTopicResources>
