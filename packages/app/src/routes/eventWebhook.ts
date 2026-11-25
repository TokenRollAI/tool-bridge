import { canonicalizePath, eventPublishSchema, isTBError, TBError } from '@tool-bridge/core'
import type { TbAppDeps, TbHono } from '../deps'
import { ToolJsonSchemaValidator } from '../jsonSchemaValidator'
import { readRemoteResponseBody } from '../providers/remote'
import { callPlugin } from '../providers/pluginClient'
import { requirePluginExport } from '../toolNodes'
import { runHandler } from '../responses'
import { decodePath } from '../paths'

const PREFIX = '/~hooks/'
const MAX_BYTES = 256 * 1024

export function registerEventWebhooks(app: TbHono, deps: TbAppDeps): void {
  const repository = deps.eventRepository
  if (!repository) return
  let active = 0
  app.post(PREFIX + '*', c => runHandler(async () => {
    if (active >= 32) throw new TBError('rate_limited', 'too many webhook deliveries')
    active++
    try {
      await deps.ensureReady?.()
      const path = canonicalizePath(decodePath(new URL(c.req.url).pathname.slice(PREFIX.length)))
      const bound = await repository.binding(path)
      if (!bound) throw TBError.notFound()
      const { manifest, export: descriptor } = await requirePluginExport(deps, bound.provider, 'topic', 'topic', bound.export)
      if (!descriptor.eventSource) throw TBError.notFound()
      const source = `plugin:${manifest.id}/${descriptor.id}`
      const bytes = await readRemoteResponseBody(new Response(c.req.raw.body, { headers: c.req.raw.headers }), MAX_BYTES,
        AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(15_000)]))
      let rawBody: string
      try {
        rawBody = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      } catch {
        throw new TBError('invalid_argument', 'webhook requires valid UTF-8')
      }
      const headers: Record<string, string> = {}
      for (const name of descriptor.eventSource.headers) {
        const value = c.req.header(name)
        if (value !== undefined) headers[name] = value
      }
      let verified: unknown
      try {
        verified = await callPlugin({
          manifest, secrets: deps.secrets, bindings: deps.pluginBindings, upstreamAuthRef: bound.authRef,
          ctx: { mountPath: path, exportId: bound.export, keyId: source, owner: source, scopes: [], traceId: crypto.randomUUID() },
        }, 'Verify', { rawBody, headers })
      } catch (error) {
        // The unauthenticated sender must never receive a plugin error body or credential.
        if (isTBError(error) && error.code === 'unavailable') throw new TBError('unavailable', 'webhook verifier unavailable')
        throw TBError.unauthenticated()
      }
      if (verified === null) return c.body(null, 204)
      const parsed = eventPublishSchema.safeParse(verified)
      if (!parsed.success || !parsed.data.idempotencyKey) throw new TBError('invalid_argument', 'invalid verified event')
      const event = parsed.data
      const type = descriptor.eventSource.types.find(item => item.type === event.type && item.version === event.schemaVersion)
      if (!type) throw new TBError('invalid_argument', 'unknown webhook event type or version')
      const validator = new ToolJsonSchemaValidator()
      const validate = validator.getValidator(type.dataSchema as Parameters<typeof validator.getValidator>[0])
      if (!validate(event.data).valid) throw new TBError('invalid_argument', 'invalid webhook event data')
      await repository.publish(path, { keyId: source, owner: source }, event, bound)
      return c.body(null, 204)
    } finally { active-- }
  }))
}
