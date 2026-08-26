/**
 * remote 节点透传:把对 `<path>` 及其后代的 `~help`/`~skill`/`~tree`/`POST`
 * 请求,改写为对 `baseUrl` 下相对路径的**同形**请求。
 *
 * - `baseUrl` 白名单(空 = 拒一切)——注册时与调用时双重校验。
 * - `skRef` 解析出的凭证作为出站 `Authorization: Bearer`;**本地调用者的 SK 不外传**。
 * - `X-TB-Via`:入站链经 `checkVia` 判环/跳数(在追加自身之前);出站 `appendVia` 追加自身标识。
 * - 传输失败经 `normalizeUpstreamError` 归一;远端返回的响应(含其自身 TBError)原样透传。
 *
 * 宿主中立(核心零分叉):部署配置以解析后的 {@link RemoteSettings} 注入,
 * env 解析(TB_REMOTE_ALLOWLIST 等)在宿主适配层(gateway app.ts / SDK config)。
 */

import {
  appendVia,
  assertSecureUrl,
  checkAllowlist,
  checkVia,
  normalizeUpstreamError,
  parseVia,
  rewriteRemotePath,
  type SecretStoreImpl,
  TBError,
  type TreePath,
} from '@tool-bridge/core'

const VIA_HEADER = 'x-tb-via'

function remoteAbortError(): TBError {
  return new TBError('unavailable', 'remote request aborted', { retryable: true })
}

function remoteResponseTooLarge(maxBytes: number): TBError {
  return new TBError(
    'unavailable',
    `remote response body exceeds ${maxBytes} bytes`,
    { retryable: false },
  )
}

function isAbortError(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')
}

function signalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

function declaredContentLength(response: Response): number | undefined {
  const value = response.headers.get('content-length')
  if (value === null || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY
}

async function readRemoteResponseBody(
  response: Response,
  maxBytes: number | undefined,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  if (signal?.aborted === true) throw remoteAbortError()
  const declared = declaredContentLength(response)
  if (maxBytes !== undefined && declared !== undefined && declared > maxBytes) {
    void response.body?.cancel().catch(() => {})
    throw remoteResponseTooLarge(maxBytes)
  }
  if (response.body === null) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let abortListener: (() => void) | undefined
  const abortPromise = signal === undefined
    ? undefined
    : new Promise<never>((_resolve, reject) => {
        abortListener = () => {
          reject(remoteAbortError())
          void reader.cancel().catch(() => {})
        }
        signal.addEventListener('abort', abortListener, { once: true })
        if (signal.aborted) abortListener()
      })

  try {
    while (true) {
      const result = await (abortPromise === undefined
        ? reader.read()
        : Promise.race([reader.read(), abortPromise]))
      // cancel() 可能让在途 read 以 done=true 先于 abort promise 落定；
      // signal 仍是权威结果，不得把截断的部分 body 当成成功响应。
      if (signalAborted(signal)) throw remoteAbortError()
      if (result.done) break
      total += result.value.byteLength
      if (maxBytes !== undefined && total > maxBytes) {
        void reader.cancel().catch(() => {})
        throw remoteResponseTooLarge(maxBytes)
      }
      chunks.push(result.value)
    }
  } catch (error) {
    if (error instanceof TBError) throw error
    if (isAbortError(error, signal)) throw remoteAbortError()
    throw normalizeUpstreamError({
      kind: 'network',
      message: 'failed to read remote response body',
    })
  } finally {
    if (abortListener !== undefined) signal?.removeEventListener('abort', abortListener)
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

export interface RemoteConfig {
  baseUrl: string
  skRef?: string
}

/** remote 透传的部署配置(宿主解析后注入)。 */
export interface RemoteSettings {
  /** 放行 http:// 上游(仅本地开发)。 */
  allowInsecure: boolean
  /** baseUrl 的 host 后缀白名单;空数组 = 拒一切 remote。 */
  allowlist: string[]
  /** 联邦 search 的部署级硬上限；客户端与下游 header 只能进一步收紧。 */
  federatedSearch?: Partial<FederatedSearchSettings>
  /** 本实例 X-TB-Via 标识;缺省用**入站请求 host** 派生(跨实例联邦须显式配置才能可靠去环)。 */
  instanceId?: string
  /** X-TB-Via 跳数上限(缺省 4,由宿主适配层落默认)。 */
  maxHops: number
}

export interface FederatedSearchSettings {
  maxConcurrency: number
  maxResponseBodyBytes: number
  maxSources: number
  minChildWorkMs: number
  perHopReturnReserveMs: number
  sessionTtlMs: number
  totalDeadlineMs: number
}

export const DEFAULT_FEDERATED_SEARCH_SETTINGS: Readonly<FederatedSearchSettings> = {
  maxConcurrency: 4,
  maxResponseBodyBytes: 512 * 1024,
  maxSources: 16,
  minChildWorkMs: 200,
  perHopReturnReserveMs: 100,
  sessionTtlMs: 5 * 60 * 1000,
  totalDeadlineMs: 2500,
}

export function federatedSearchSettings(settings: RemoteSettings): FederatedSearchSettings {
  const configured = settings.federatedSearch ?? {}
  const positive = (value: number | undefined, fallback: number): number =>
    value !== undefined && Number.isFinite(value) && Number.isInteger(value) && value > 0
      ? value
      : fallback
  return {
    maxConcurrency: positive(
      configured.maxConcurrency,
      DEFAULT_FEDERATED_SEARCH_SETTINGS.maxConcurrency,
    ),
    maxResponseBodyBytes: positive(
      configured.maxResponseBodyBytes,
      DEFAULT_FEDERATED_SEARCH_SETTINGS.maxResponseBodyBytes,
    ),
    maxSources: positive(configured.maxSources, DEFAULT_FEDERATED_SEARCH_SETTINGS.maxSources),
    minChildWorkMs: positive(
      configured.minChildWorkMs,
      DEFAULT_FEDERATED_SEARCH_SETTINGS.minChildWorkMs,
    ),
    perHopReturnReserveMs: positive(
      configured.perHopReturnReserveMs,
      DEFAULT_FEDERATED_SEARCH_SETTINGS.perHopReturnReserveMs,
    ),
    sessionTtlMs: positive(
      configured.sessionTtlMs,
      DEFAULT_FEDERATED_SEARCH_SETTINGS.sessionTtlMs,
    ),
    totalDeadlineMs: positive(
      configured.totalDeadlineMs,
      DEFAULT_FEDERATED_SEARCH_SETTINGS.totalDeadlineMs,
    ),
  }
}

/** 本实例的 X-TB-Via 标识:显式配置优先;缺省用入站请求 host 派生(已知局限)。 */
function selfInstanceId(settings: RemoteSettings, requestUrl: string): string {
  if (settings.instanceId !== undefined && settings.instanceId.length > 0) {
    return settings.instanceId
  }
  try {
    return new URL(requestUrl).host
  } catch {
    return 'tool-bridge'
  }
}

/** 注册时的 remote baseUrl 白名单校验(不在白名单 → invalid_argument)。 */
export function assertRemoteAllowed(baseUrl: string, settings: RemoteSettings): void {
  const secErr = assertSecureUrl(baseUrl, settings.allowInsecure)
  if (secErr) throw secErr
  if (!checkAllowlist(baseUrl, settings.allowlist)) {
    throw new TBError('invalid_argument', `remote baseUrl 不在白名单:'${baseUrl}'`)
  }
}

/**
 * 执行透传。`requestPath` 是完整树路径(含尾部保留段,如 `server1/foo/~help`);
 * `nodePath` 是 remote 节点挂载前缀。本地 Auth 已在调用点判定,这里只做透传与环检测。
 */
export async function passthroughRemote(opts: {
  actor: { keyId: string, owner: string, traceId: string }
  body?: string
  config: RemoteConfig
  headers: Headers
  /** 响应 body 硬上限；省略时保留旧的无上限行为。 */
  maxResponseBodyBytes?: number
  method: string
  nodePath: TreePath
  requestPath: TreePath
  requestUrl: string
  secrets: SecretStoreImpl
  settings: RemoteSettings
  /** 可选请求 deadline/cancellation；支持 `AbortSignal.timeout(...)`。 */
  signal?: AbortSignal
}): Promise<Response> {
  if (
    opts.maxResponseBodyBytes !== undefined
    && (!Number.isSafeInteger(opts.maxResponseBodyBytes) || opts.maxResponseBodyBytes < 0)
  ) {
    throw new TBError(
      'invalid_argument',
      'maxResponseBodyBytes must be a non-negative safe integer',
    )
  }
  if (opts.signal?.aborted === true) throw remoteAbortError()
  const secErr = assertSecureUrl(opts.config.baseUrl, opts.settings.allowInsecure)
  if (secErr) throw secErr
  // 调用时白名单再校验(配置漂移防线);不在白名单 → unavailable(不 retry)。
  if (!checkAllowlist(opts.config.baseUrl, opts.settings.allowlist)) {
    throw new TBError('unavailable', `remote baseUrl 不在白名单:'${opts.config.baseUrl}'`, {
      retryable: false,
    })
  }

  const self = selfInstanceId(opts.settings, opts.requestUrl)
  const chain = parseVia(opts.headers.get(VIA_HEADER) ?? undefined)
  const viaErr = checkVia(chain, self, opts.settings.maxHops)
  if (viaErr) throw viaErr

  // 改写目标 URL,并把入站 query(如 ~tree 的 ?depth=)原样带过去。
  const rewritten = rewriteRemotePath(opts.nodePath, opts.requestPath, opts.config.baseUrl)
  let search = ''
  try {
    search = new URL(opts.requestUrl).search
  } catch {
    search = ''
  }
  const target = `${rewritten}${search}`
  const outHeaders: Record<string, string> = { [VIA_HEADER]: appendVia(chain, self) }
  const accept = opts.headers.get('accept')
  if (accept !== null) outHeaders.accept = accept
  const contentType = opts.headers.get('content-type')
  if (contentType !== null) outHeaders['content-type'] = contentType
  // 只透传固定的联邦预算头；child route 仍会与自己的部署上限取 min，
  // 因此外部调用者伪造这些头也只能进一步收紧，不能扩大预算。
  for (const name of [
    'x-tb-search-remaining-ms',
    'x-tb-search-session-ttl-ms',
    'x-tb-search-source-budget',
    'x-tb-search-validate-snapshot',
    'x-tb-search-want-snapshot',
  ]) {
    const value = opts.headers.get(name)
    if (value !== null) outHeaders[name] = value
  }
  // skRef 换发出站凭证;本地调用者 SK 不外传。
  // 安全属性:被引用的 skRef 可能拥有远超本地调用者的远端权限——本地只校验调用者对
  // 该 remote 节点路径的 read+call。这是刻意的"代理凭证"模型(对齐服务账号),但为可审计,
  // 此处记录一条不含凭证明文的结构化审计行(谁经哪个节点、用哪个 skRef、发往何处)。
  if (opts.config.skRef !== undefined) {
    const cred = await opts.secrets.resolve(opts.config.skRef)
    // fail closed:配置声明了 skRef 却解析不到(Secret 被删/主密钥缺失)→ unavailable,
    // 不得静默匿名出站(旧行为把凭证降级为无 Authorization,可能以本实例默认身份触达远端)。
    if (cred === undefined) {
      throw new TBError('unavailable', `remote skRef '${opts.config.skRef}' 无法解析`, {
        retryable: false,
      })
    }
    outHeaders.authorization = `Bearer ${cred}`
    console.log(
      JSON.stringify({
        event: 'remote_skref_proxy',
        actorKeyId: opts.actor.keyId,
        actorOwner: opts.actor.owner,
        traceId: opts.actor.traceId,
        nodePath: opts.nodePath,
        skRef: opts.config.skRef,
        method: opts.method,
        target: rewritten,
        via: self,
      }),
    )
  }

  let resp: Response
  try {
    resp = await fetch(target, {
      method: opts.method,
      headers: outHeaders,
      // remote 请求可能携带高权 service credential 与敏感 arguments。禁止自动跟随任何
      // 30x，避免 redirect 绕过初始 baseUrl 的 allowlist/HTTPS 校验或把 body 发往另一目标。
      redirect: 'error',
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      ...(opts.body !== undefined && opts.body.length > 0 ? { body: opts.body } : {}),
    })
  } catch (err) {
    if (isAbortError(err, opts.signal)) throw remoteAbortError()
    throw normalizeUpstreamError({
      kind: 'network',
      message: err instanceof Error ? err.message : String(err),
    })
  }

  // 远端响应原样透传(状态/内容类型/体):两级权限中远端的判定属远端职责。
  const respBody = await readRemoteResponseBody(
    resp,
    opts.maxResponseBodyBytes,
    opts.signal,
  )
  const respCt = resp.headers.get('content-type') ?? 'application/octet-stream'
  return new Response(respBody.buffer as ArrayBuffer, {
    status: resp.status,
    headers: { 'content-type': respCt },
  })
}
