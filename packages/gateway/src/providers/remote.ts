/**
 * remote 节点透传(Proto §3.4):把对 `<path>` 及其后代的 `~help`/`~skill`/`~tree`/`POST`
 * 请求,改写为对 `baseUrl` 下相对路径的**同形**请求。
 *
 * - `baseUrl` 白名单(env `TB_REMOTE_ALLOWLIST` 逗号分隔;空 = 拒一切)——注册时与调用时双重校验。
 * - `skRef` 解析出的凭证作为出站 `Authorization: Bearer`;**本地调用者的 SK 不外传**。
 * - `X-TB-Via`:入站链经 `checkVia` 判环/跳数(在追加自身之前);出站 `appendVia` 追加自身标识。
 * - 传输失败经 `normalizeUpstreamError` 归一;远端返回的响应(含其自身 TBError)原样透传。
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
const DEFAULT_MAX_HOPS = 4

export interface RemoteConfig {
  baseUrl: string
  skRef?: string
}

interface RemoteEnv {
  TB_REMOTE_ALLOWLIST?: string
  TB_MAX_HOPS?: string
  TB_INSTANCE_ID?: string
  TB_ALLOW_INSECURE_HTTP?: string
}

/** 部署配置的 remote 白名单(host 后缀,逗号分隔);缺省/空 = 空数组 = 拒一切 remote。 */
export function remoteAllowlist(env: RemoteEnv): string[] {
  return (env.TB_REMOTE_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** X-TB-Via 跳数上限:env `TB_MAX_HOPS` 为正数则用之,否则默认 4。 */
export function maxHops(env: RemoteEnv): number {
  const n = Number(env.TB_MAX_HOPS)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_HOPS
}

/**
 * 本实例的 X-TB-Via 标识:优先 env `TB_INSTANCE_ID`;缺省时用**入站请求 host** 派生
 * (同域自环可检出;跨实例联邦须各方显式配 `TB_INSTANCE_ID` 才能可靠去环——见 §3.4 已知局限)。
 */
export function instanceId(env: RemoteEnv, requestUrl: string): string {
  if (env.TB_INSTANCE_ID !== undefined && env.TB_INSTANCE_ID.length > 0) return env.TB_INSTANCE_ID
  try {
    return new URL(requestUrl).host
  } catch {
    return 'tool-bridge'
  }
}

/** 注册时的 remote baseUrl 白名单校验(不在白名单 → invalid_argument,Proto §3.4)。 */
export function assertRemoteAllowed(baseUrl: string, env: RemoteEnv): void {
  const secErr = assertSecureUrl(baseUrl, env.TB_ALLOW_INSECURE_HTTP === 'true')
  if (secErr) throw secErr
  if (!checkAllowlist(baseUrl, remoteAllowlist(env))) {
    throw new TBError('invalid_argument', `remote baseUrl 不在白名单:'${baseUrl}'`)
  }
}

/**
 * 执行透传。`requestPath` 是完整树路径(含尾部保留段,如 `server1/foo/~help`);
 * `nodePath` 是 remote 节点挂载前缀。本地 Auth 已在调用点判定,这里只做透传与环检测。
 */
export async function passthroughRemote(opts: {
  config: RemoteConfig
  nodePath: TreePath
  requestPath: TreePath
  method: string
  body?: string
  headers: Headers
  secrets: SecretStoreImpl
  env: RemoteEnv
  requestUrl: string
}): Promise<Response> {
  const secErr = assertSecureUrl(opts.config.baseUrl, opts.env.TB_ALLOW_INSECURE_HTTP === 'true')
  if (secErr) throw secErr
  // 调用时白名单再校验(配置漂移防线);不在白名单 → unavailable(不 retry)。
  if (!checkAllowlist(opts.config.baseUrl, remoteAllowlist(opts.env))) {
    throw new TBError('unavailable', `remote baseUrl 不在白名单:'${opts.config.baseUrl}'`, {
      retryable: false,
    })
  }

  const self = instanceId(opts.env, opts.requestUrl)
  const chain = parseVia(opts.headers.get(VIA_HEADER) ?? undefined)
  const viaErr = checkVia(chain, self, maxHops(opts.env))
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
  if (opts.config.skRef !== undefined) {
    const cred = await opts.secrets.resolve(opts.config.skRef)
    if (cred !== undefined) outHeaders.authorization = `Bearer ${cred}`
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
