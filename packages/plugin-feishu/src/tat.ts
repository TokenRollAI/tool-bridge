/**
 * 飞书 tenant_access_token(TAT)换发与进程内缓存。
 *
 * - 凭证(app_id/app_secret)不由 plugin 自持:每次调用由平台经 X-TB-Upstream-Auth
 *   传入(挂载 config.authRef 平台代解析)——同一 plugin 部署可服务不同凭证的挂载,
 *   故缓存**按 app_id 键控**。
 * - 缓存在 isolate 内存(无 KV):TAT 最长 2h,isolate 回收即重换发;换发是幂等轻请求
 *   (app_id/app_secret → token),不值得引入持久层。
 * - 刷新余量 5min:调用时刻剩余不足余量即懒换发(飞书剩余 <30min 时会签发新 token,
 *   新旧同时有效,换发无竞态风险)。
 * - `force` 绕过缓存直接换发——上游 401 的纠错路径不得回读缓存(教训同网关 mcp
 *   会话空列表防御:凡纠错路径都绕开缓存读)。
 */

import { TBError } from '@tool-bridge/core'

export const DEFAULT_AUTH_URL =
  'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'

const REFRESH_MARGIN_MS = 5 * 60_000

interface CachedTat {
  token: string
  expiresAtMs: number
}

const cache = new Map<string, CachedTat>()

/** 测试用:清空进程内 TAT 缓存。 */
export function clearTatCache(): void {
  cache.clear()
}

export interface TatConfig {
  appId: string
  appSecret: string
  /** 换发端点 override(测试/私有化部署);缺省飞书公网端点。 */
  authUrl?: string
}

interface TatResponse {
  code?: number
  msg?: string
  tenant_access_token?: string
  expire?: number
}

/** 取可用 TAT:该 app_id 的缓存余量充足直接返回,否则换发并回填。 */
export async function tenantAccessToken(cfg: TatConfig, force = false): Promise<string> {
  const cached = cache.get(cfg.appId)
  if (!force && cached !== undefined && cached.expiresAtMs - Date.now() > REFRESH_MARGIN_MS) {
    return cached.token
  }
  let resp: Response
  try {
    resp = await fetch(cfg.authUrl ?? DEFAULT_AUTH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret }),
    })
  } catch (err) {
    throw new TBError(
      'unavailable',
      `飞书 TAT 换发网络失败:${err instanceof Error ? err.message : String(err)}`,
      { retryable: true },
    )
  }
  const body = (await resp.json().catch(() => null)) as TatResponse | null
  if (
    !resp.ok ||
    body === null ||
    body.code !== 0 ||
    typeof body.tenant_access_token !== 'string'
  ) {
    throw new TBError(
      'unavailable',
      `飞书 TAT 换发失败:HTTP ${resp.status} code=${body?.code ?? '?'} ${body?.msg ?? ''}`.trim(),
      { retryable: false },
    )
  }
  const expireSec = typeof body.expire === 'number' ? body.expire : 0
  cache.set(cfg.appId, {
    token: body.tenant_access_token,
    expiresAtMs: Date.now() + expireSec * 1000,
  })
  return body.tenant_access_token
}
