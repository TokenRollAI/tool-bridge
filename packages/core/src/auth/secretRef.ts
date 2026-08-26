/**
 * Secret Reference 使用授权。
 *
 * NodeConfig 里的 `authRef`(mcp/http/context/tool/skillhub 上游凭证)、
 * `oauthClient.clientSecretRef`(mcp 预注册 OAuth client secret)与 `skRef`
 * (remote 出站凭证)都是对 SecretStore 已有条目的**引用**。凭证由管理员经
 * `system/secret`(admin scope)写入,但注册通道此前只判目标 path 的 register,
 * 不校验写入者是否有权"使用"这些引用——受限注册者据此可把平台已有 Secret 绑进自己
 * 的节点,形成 confused-deputy(2026-07-24 安全复核合入阻断项)。
 *
 * 授权模型:绑定任一 secret 引用 = 需要 `system/secret` 的 `admin`(与创建 Secret 同权)。
 * 这是刻意从严的能力边界——把"引用只能由能管理 Secret 的身份写入"变成代码不变量,
 * 而非依赖"管理员配置"的口头约定。更细的 per-secret ACL 是后续增强,非本次阻断修复。
 *
 * 纯逻辑,无 I/O:判定复用 auth/scope 的 checkScopes(唯一判定入口)。
 */

import type { Scope, TreePath } from '../types'
import { checkScopes } from './scope'
import { TBError } from '../errors'

/** Secret 保管库的挂载路径(引导物化,见 bootstrap)。绑定引用的授权资源。 */
export const SECRET_VAULT_PATH: TreePath = 'system/secret'

/**
 * 从 NodeConfig 抽取其引用的 Secret 名字(authRef / oauthClient.clientSecretRef / skRef)。
 * auth:'oauth' 的 mcp 挂载凭证由网关托管 OAuth 流程获取,authRef 被忽略——此时即便
 * 携带 authRef 也不计入(不因忽略字段误触发授权门)。config 非对象 → 空。
 */
export function secretRefsInConfig(config: unknown): string[] {
  if (config === null || typeof config !== 'object') return []
  const c = config as {
    auth?: unknown
    authRef?: unknown
    kind?: unknown
    oauthClient?: unknown
    skRef?: unknown
  }
  const refs: string[] = []
  // mcp 的 auth:'oauth' 忽略 authRef(见 NodeConfig 注释),不计入授权门。
  const oauthMcp = c.kind === 'mcp' && c.auth === 'oauth'
  if (!oauthMcp && typeof c.authRef === 'string' && c.authRef.length > 0) refs.push(c.authRef)
  if (oauthMcp && c.oauthClient !== null && typeof c.oauthClient === 'object') {
    const secretRef = (c.oauthClient as { clientSecretRef?: unknown }).clientSecretRef
    if (typeof secretRef === 'string' && secretRef.length > 0) refs.push(secretRef)
  }
  if (typeof c.skRef === 'string' && c.skRef.length > 0) refs.push(c.skRef)
  return refs
}

/**
 * 绑定 secret 引用的使用授权:config 引用了任一 authRef/skRef 时,写入者须对
 * `system/secret` 持 admin。无引用 → 直接放行。不满足 → permission_denied。
 *
 * 两条注册通道(`~register` 与 system/registry write/update)统一在权限判定后、
 * 落库前调用。资源刻意固定为 SECRET_VAULT_PATH(而非目标节点 path):引用的是
 * 平台级凭证,授权也应落在管理凭证的能力上。
 */
export function assertSecretRefUse(scopes: Scope[], config: unknown): void {
  const refs = secretRefsInConfig(config)
  if (refs.length === 0) return
  if (!checkScopes(scopes, SECRET_VAULT_PATH, 'admin')) {
    throw new TBError(
      'permission_denied',
      `binding secret reference(s) [${refs.join(', ')}] requires 'admin' on '${SECRET_VAULT_PATH}'`,
    )
  }
}
