/** Store capability-only control routes and bearer data plane. */
import { isTBError, type StoreObject, type StoreUploadInput, storeUri, TBError } from '@tool-bridge/core'
import type { AppContext, TbHono } from '../deps'
import {
  abortCapabilityUpload,
  beginCapabilityUpload,
  completeCapabilityUpload,
  defaultStoreRuntime,
  relayStoreUpload,
  resolveStoreRequestOrigin,
  STORE_CALL_CAPABILITY_HEADER,
  STORE_UPLOAD_HEADER,
  storeObjectResponse,
} from '../store'
import { verifyStoreRefToken } from '../storeRefToken'
import { runHandler } from '../responses'

const SECRET_BODY_FIELDS = [
  'callCapability',
  'capability',
  'uploadToken',
  'shareToken',
] as const

function hideCapabilityFailure(error: unknown): never {
  if (
    isTBError(error)
    && error.code !== 'permission_denied'
    && error.code !== 'not_found'
  ) throw error
  throw TBError.notFound('not found')
}

async function jsonObject(c: AppContext): Promise<Record<string, unknown>> {
  const parsed = (await c.req.json().catch(() => null)) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TBError('invalid_argument', 'body must be a JSON object')
  }
  const body = parsed as Record<string, unknown>
  for (const field of SECRET_BODY_FIELDS) {
    if (field in body) {
      throw new TBError(
        'invalid_argument',
        `${field} is not accepted in the request body; use the dedicated capability header`,
      )
    }
  }
  return body
}

function requiredHeader(c: AppContext, name: string): string {
  const value = c.req.header(name)
  if (value === undefined || value.trim() === '') {
    throw new TBError('permission_denied', 'Store capability is missing or invalid')
  }
  return value
}

function uploadId(body: Record<string, unknown>): string {
  if (typeof body.uploadId !== 'string' || body.uploadId.trim() === '') {
    throw new TBError('invalid_argument', 'uploadId must be a non-empty string')
  }
  return body.uploadId
}

/**
 * Register before the global SK middleware. Missing capability headers call
 * `next()` so the same fixed command paths continue through ordinary auth.
 */
export function registerStoreCapabilityRoutes(app: TbHono, deps: Parameters<
  typeof defaultStoreRuntime
>[0]): void {
  app.post('/system/store/create_upload', async (c, next) => {
    if (c.req.header(STORE_CALL_CAPABILITY_HEADER) === undefined) return await next()
    return await runHandler(async () => {
      await deps.ensureReady?.()
      const body = await jsonObject(c)
      const capability = requiredHeader(c, STORE_CALL_CAPABILITY_HEADER)
      const result = await beginCapabilityUpload(
        deps,
        body as unknown as StoreUploadInput,
        capability,
        resolveStoreRequestOrigin(c.req.url, deps.canonicalOrigin),
      )
      return c.json(result)
    })
  })

  for (const command of ['complete_upload', 'abort_upload'] as const) {
    app.post(`/system/store/${command}`, async (c, next) => {
      if (c.req.header(STORE_UPLOAD_HEADER) === undefined) return await next()
      return await runHandler(async () => {
        await deps.ensureReady?.()
        const body = await jsonObject(c)
        const token = requiredHeader(c, STORE_UPLOAD_HEADER)
        const result = command === 'complete_upload'
          ? await completeCapabilityUpload(deps, uploadId(body), token)
          : await abortCapabilityUpload(deps, uploadId(body), token)
        return c.json(result)
      })
    })
  }

  app.put('/~store/uploads/:uploadId', c =>
    runHandler(async () => {
      await deps.ensureReady?.()
      const descriptor = await relayStoreUpload(
        deps,
        c.req.param('uploadId'),
        requiredHeader(c, STORE_UPLOAD_HEADER),
        c.req.raw.body,
      )
      return c.json(descriptor)
    }),
  )

  // Owner refs use an independent HMAC domain/payload. Any verification,
  // expiry, state or byte miss collapses to 404 to avoid an object oracle.
  app.get('/~store/refs/:token', c =>
    runHandler(async () => {
      await deps.ensureReady?.()
      const store = await defaultStoreRuntime(deps)
      const payload = await verifyStoreRefToken(c.req.param('token'), store.tokenSecret)
      if (payload === null || payload.exp * 1000 <= Date.now()) {
        throw TBError.notFound('not found')
      }
      let object: StoreObject
      try {
        object = await store.service.authorizeRead(storeUri(payload.objectId), {
          admin: true,
        })
      } catch (error) {
        hideCapabilityFailure(error)
      }
      return await storeObjectResponse(store.objects, object)
    }),
  )

  // Share tokens are stateful in core, so revocation and expiry take effect
  // immediately even if the URL has already been handed out.
  app.get('/~store/shares/:token', c =>
    runHandler(async () => {
      await deps.ensureReady?.()
      const token = c.req.param('token')
      const store = await defaultStoreRuntime(deps)
      let object: StoreObject
      try {
        const grant = await store.service.verifyShareToken(token)
        const uri = storeUri(grant.objectId)
        object = await store.service.authorizeSharedRead(uri, token)
      } catch (error) {
        hideCapabilityFailure(error)
      }
      return await storeObjectResponse(store.objects, object)
    }),
  )
}

export function rejectStoreCapabilityBodyFields(
  module: string,
  args: Record<string, unknown>,
): void {
  if (module !== 'store') return
  for (const field of SECRET_BODY_FIELDS) {
    if (field in args) {
      throw new TBError(
        'invalid_argument',
        `${field} is not accepted in the request body; use the dedicated capability header`,
      )
    }
  }
}
