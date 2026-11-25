import { createPlugin, TBError } from '@tool-bridge/plugin-sdk'
import { verify } from '@octokit/webhooks-methods'
import { z } from 'zod/v4'

const dataSchema = z.object({ repository: z.string(), ref: z.string(), after: z.string() })
const pushSchema = z.object({
  repository: z.object({ full_name: z.string() }), ref: z.string(), after: z.string(),
})
const plugin = createPlugin<{ PLUGIN_TOKEN?: string }>({ token: env => env.PLUGIN_TOKEN })
plugin.events('pushes', {
  description: 'Signed GitHub push events',
  headers: ['x-hub-signature-256'],
  types: { 'github.push': { version: 1, schema: dataSchema } },
  async verify({ headers, rawBody }, ctx) {
    const signature = headers['x-hub-signature-256']
    if (!signature || !ctx.upstreamAuth || !await verify(ctx.upstreamAuth, rawBody, signature)) {
      throw TBError.unauthenticated()
    }
    const body: unknown = JSON.parse(rawBody)
    if (z.object({ zen: z.string(), hook_id: z.number() }).safeParse(body).success) return null
    const result = pushSchema.safeParse(body)
    if (!result.success) throw new TBError('invalid_argument', 'expected a GitHub push payload')
    const { repository, ref, after } = result.data
    // Redeliveries use the same signed payload. Delivery headers are outside the signature.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody))
    const idempotencyKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    return { type: 'github.push', data: { repository: repository.full_name, ref, after }, subject: repository.full_name, idempotencyKey }
  },
})
export default plugin
