/**
 * Authorizer.Check(Proto §2.3,行 218-224)。
 *
 * 唯一判定入口的纯 scope 判定包装;同步返回 { allow, reason? }(纯内存,不做 I/O)。
 * SK 的 disabled / expiresAt 属认证层(见 auth/sk.ts identify),不在此判定。
 */

import type { Action, CallContext, TreePath } from '../types'
import { checkScopes } from './scope'

export function check(
  ctx: CallContext,
  path: TreePath,
  action: Action,
): { allow: boolean; reason?: string } {
  if (checkScopes(ctx.scopes, path, action)) return { allow: true }
  return { allow: false, reason: `no scope grants '${action}' on '${path || '/'}'` }
}
