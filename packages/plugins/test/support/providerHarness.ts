import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, vi } from 'vitest'

export type FetchMock = ReturnType<typeof vi.fn>

interface ProviderPlugin {
  fetch(request: Request, env: never): Promise<Response> | Response
}

export interface ProviderCallOptions {
  auth?: string | null
}

interface ProviderHarnessOptions<CallOptions extends object> {
  caller?: (options: CallOptions) => CallContext
  env?: Record<string, unknown>
  exportId?: string
  mountPath: string
  plugin: ProviderPlugin
  pluginToken?: string
  resolveUpstreamAuth?: (options: CallOptions) => string | null | undefined
  restoreMocks?: boolean
  upstreamAuth?: string
}

const NULL_BODY_STATUSES = new Set([204, 205, 304])

/**
 * Provider 迁移测试的真实 wire 脚手架。
 *
 * 它只收敛 plugin/v2 信封和全局 fetch 响应队列；调用仍会穿过真实 plugin handler、
 * schema 校验、凭证解码与 guardedFetch，避免把三道迁移闸门 mock 掉。
 */
export function createProviderHarness<CallOptions extends object = ProviderCallOptions>(
  options: ProviderHarnessOptions<CallOptions>,
) {
  const pluginToken = options.pluginToken
    ?? (typeof options.env?.PLUGIN_TOKEN === 'string' ? options.env.PLUGIN_TOKEN : 'tbp_test')
  const env = options.env ?? { PLUGIN_TOKEN: pluginToken }
  const defaultCaller: CallContext = {
    keyId: 'k1',
    owner: 'agent:tester',
    scopes: [],
    traceId: 't1',
    mountPath: options.mountPath,
    exportId: options.exportId ?? 'actions',
  }

  function envelope(body: unknown, callOptions: CallOptions = {} as CallOptions): Promise<Response> {
    const headers: Record<string, string> = {
      'authorization': `Bearer ${pluginToken}`,
      'content-type': 'application/json',
      [HEADER_TB_CONTEXT]: encodeCallContext(options.caller?.(callOptions) ?? defaultCaller),
    }
    const auth = (callOptions as ProviderCallOptions).auth
    const upstreamAuth = options.resolveUpstreamAuth === undefined
      ? (auth === undefined ? options.upstreamAuth : auth)
      : options.resolveUpstreamAuth(callOptions)
    if (upstreamAuth !== null && upstreamAuth !== undefined) {
      headers[HEADER_TB_UPSTREAM_AUTH] = base64urlEncode(new TextEncoder().encode(upstreamAuth))
    }
    return Promise.resolve(options.plugin.fetch(
      new Request('https://plugin.test/', { method: 'POST', headers, body: JSON.stringify(body) }),
      env as never,
    ))
  }

  function call(name: string, args: unknown, callOptions?: CallOptions): Promise<Response> {
    return envelope({ tool: 'Call', arguments: { name, args } }, callOptions)
  }

  function stubFetch<Args extends unknown[]>(
    responder: (...args: Args) => Promise<Response> | Response,
  ): FetchMock {
    const mock = vi.fn(responder)
    vi.stubGlobal('fetch', mock)
    return mock
  }

  function mockJson(status: number, payload: unknown, headers: HeadersInit = {}): FetchMock {
    return stubFetch(() => Promise.resolve(new Response(
      JSON.stringify(payload),
      { status, headers: { 'content-type': 'application/json', ...Object.fromEntries(new Headers(headers)) } },
    )))
  }

  function mockRaw(
    status: number,
    body: BodyInit | null,
    contentType?: string,
    headers: HeadersInit = {},
  ): FetchMock {
    const responseHeaders = new Headers(headers)
    if (contentType !== undefined) responseHeaders.set('content-type', contentType)
    return stubFetch(() => Promise.resolve(new Response(
      NULL_BODY_STATUSES.has(status) ? null : body,
      { status, headers: responseHeaders },
    )))
  }

  function mockJsonSequence(payloads: unknown[], status = 200): FetchMock {
    let index = 0
    return stubFetch(() => {
      const payload = payloads[Math.min(index, payloads.length - 1)]
      index += 1
      return Promise.resolve(new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }))
    })
  }

  function sent(mock: FetchMock, index = 0): Request {
    return (mock.mock.calls[index] as [Request])[0]
  }

  function sentUrl(mock: FetchMock, index = 0): URL {
    return new URL(sent(mock, index).url)
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    if (options.restoreMocks === true) vi.restoreAllMocks()
  })

  return {
    call,
    env,
    envelope,
    mockJson,
    mockJsonSequence,
    mockRaw,
    sent,
    sentUrl,
    stubFetch,
  }
}
