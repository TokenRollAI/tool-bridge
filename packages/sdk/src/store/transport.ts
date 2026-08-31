import {
  TBError,
  type TBErrorBody,
} from '@tool-bridge/core/device'
import { parseTbErrorBody, statusFallback } from '../shared/transport'

export function resolveStoreFetcher(fetcher?: typeof fetch): typeof fetch {
  const resolved = fetcher ?? globalThis.fetch
  if (typeof resolved !== 'function') {
    throw TBError.unimplemented('fetch is unavailable; provide a Store fetcher')
  }
  return resolved
}

export function storeCommandUrl(baseUrl: string, command: string): string {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new TBError('invalid_argument', 'baseUrl must be an absolute HTTP(S) URL')
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username !== ''
    || url.password !== ''
  ) {
    throw new TBError('invalid_argument', 'baseUrl must be an HTTP(S) URL without userinfo')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/system/store/${command}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function errorFromBody(body: TBErrorBody, status: number): TBError | null {
  try {
    return new TBError(body.code, body.message, {
      retryable: body.retryable,
      ...(status === 401 && body.code === 'permission_denied' ? { httpStatus: 401 } : {}),
    })
  } catch {
    return null
  }
}

/** 无规范 TBError body 时按共享 status 映射归一;消息保持 status-only,不回显未识别 body。 */
function fallbackErrorBody(status: number): TBErrorBody {
  return {
    ...statusFallback(status),
    message: `gateway returned an invalid TBError response (HTTP ${status})`,
  }
}

function sensitiveParts(values: readonly string[]): string[] {
  return values.flatMap((value) => {
    const bearer = /^Bearer\s+(.+)$/i.exec(value)
    return bearer?.[1] === undefined ? [value] : [value, bearer[1]]
  })
}

export function sanitizedGatewayMessage(
  message: string,
  status: number,
  sensitiveValues: readonly string[] = [],
): string {
  if (
    /https?:\/\/[^\s"'<>]+/i.test(message)
    || sensitiveParts(sensitiveValues).some(value => value !== '' && message.includes(value))
  ) return `gateway returned a redacted error (HTTP ${status})`
  return message
}

export function abortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

export async function tbResponseError(
  response: Response,
  sensitiveValues: readonly string[] = [],
  signal?: AbortSignal,
): Promise<{ body: TBErrorBody, error: TBError }> {
  let decoded: unknown
  try {
    decoded = await response.json()
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw abortError()
    }
    // A status-only fallback cannot echo signed URLs from an unrecognized body.
  }
  const known = parseTbErrorBody(decoded)
  const body = known !== undefined && errorFromBody(known, response.status) !== null
    ? {
        ...known,
        message: sanitizedGatewayMessage(known.message, response.status, sensitiveValues),
      }
    : fallbackErrorBody(response.status)
  const error = errorFromBody(body, response.status)
  if (error !== null) return { body, error }

  const fallback = fallbackErrorBody(response.status)
  return {
    body: fallback,
    error: new TBError(fallback.code, fallback.message, { retryable: fallback.retryable }),
  }
}

export async function decodeStoreJson(
  response: Response,
  message: string,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw abortError()
    }
    throw new TBError('internal', message, { retryable: true })
  }
}

export function sensitiveHeaderValues(headers: Headers): string[] {
  const values: string[] = []
  for (const [name, value] of headers.entries()) {
    if (
      name === 'authorization'
      || name === 'proxy-authorization'
      || name === 'cookie'
      || /(?:token|secret|signature|credential|proof|capability|api-key)/i.test(name)
    ) values.push(value)
  }
  return values
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}

export function networkError(error: unknown, message: string, signal: AbortSignal): never {
  if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
    throw abortError()
  }
  // Raw fetch errors often embed a signed URL, so never forward them.
  throw new TBError('unavailable', message, { retryable: true })
}

export function uploadRequestInit(
  body: NonNullable<RequestInit['body']>,
  init: Omit<RequestInit, 'body'>,
): RequestInit {
  const request: RequestInit & { duplex?: 'half' } = { ...init, body }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    // Required by Node fetch; ignored as an unknown dictionary field elsewhere.
    request.duplex = 'half'
  }
  return request
}
