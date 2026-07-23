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
  /** 本实例 X-TB-Via 标识;缺省用**入站请求 host** 派生(跨实例联邦须显式配置才能可靠去环)。 */
  instanceId?: string
  /** X-TB-Via 跳数上限(缺省 4,由宿主适配层落默认)。 */
  maxHops: number
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
  method: string
  nodePath: TreePath
  requestPath: TreePath
  requestUrl: string
  secrets: SecretStoreImpl
  settings: RemoteSettings
}): Promise<Response> {
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
  // skRef 换发出站凭证;本地调用者 SK 不外传。
  // 安全属性:被引用的 skRef 可能拥有远超本地调用者的远端权限——本地只校验调用者对
  // 该 remote 节点路径的 read+call。这是刻意的"代理凭证"模型(对齐服务账号),但为可审计,
  // 此处记录一条不含凭证明文的结构化审计行(谁经哪个节点、用哪个 skRef、发往何处)。
  if (opts.config.skRef !== undefined) {
    const cred = await opts.secrets.resolve(opts.config.skRef)
    if (cred !== undefined) {
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
  }

  let resp: Response
  try {
    resp = await fetch(target, {
      method: opts.method,
      headers: outHeaders,
      ...(opts.body !== undefined && opts.body.length > 0 ? { body: opts.body } : {}),
    })
  } catch (err) {
    throw normalizeUpstreamError({
      kind: 'network',
      message: err instanceof Error ? err.message : String(err),
    })
  }

  // 远端响应原样透传(状态/内容类型/体):两级权限中远端的判定属远端职责。
  const respBody = await resp.text()
  const respCt = resp.headers.get('content-type') ?? 'application/octet-stream'
  return new Response(respBody, { status: resp.status, headers: { 'content-type': respCt } })
}
