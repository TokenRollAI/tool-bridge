/**
 * 反向注册路径规则(Proto §2.4,行 248-255,TB.md 注意 2/3)。
 *
 * 对 NodeRegistry.Write/Delete(含 ~register、WS 反向注册)在 §2.2 通用规则之上叠加:
 *   a. 声明了 registerPaths → 目标须落在某前缀之下,否则 permission_denied;
 *   b. 未声明 registerPaths → 拒保留根(RESERVED_ROOTS + 部署追加)下的注册,其余放行;
 *   c. 两种情形都仍需 (path, 'register') scope 通过——registerPaths 是收紧,不是授权来源;
 *   d. 目标已存在且非本 SK 所注册(且非 system:auto 物化)→ conflict;同 SK 同路径幂等。
 * 保留段(~ 开头段)出现在路径中 → invalid_argument(输入非法,先于其余判定)。
 */

import { TBError } from '../errors'
import type { SecretKey, TreePath } from '../types'
import { RESERVED_ROOTS, SYSTEM_AUTO } from '../types'
import { checkScopes } from './scope'

export interface CheckRegisterPathInput {
  sk: Pick<SecretKey, 'scopes' | 'registerPaths' | 'id'>
  targetPath: TreePath
  action: 'write' | 'delete'
  /** 目标路径当前占用者;null / 缺省表示不存在。 */
  existing?: { registeredBy: string } | null
  /** 部署配置追加的保留根(叠加在 RESERVED_ROOTS 之上)。 */
  reservedRoots?: string[]
}

export type CheckRegisterPathResult = { allow: true } | { allow: false; error: TBError }

const segments = (path: string): string[] => path.split('/').filter((s) => s.length > 0)

/** target 的段序列以 prefix 的段序列为前缀(段级,含相等)。 */
function isUnderPrefix(target: string[], prefix: string[]): boolean {
  if (prefix.length > target.length) return false
  return prefix.every((seg, i) => seg === target[i])
}

const deny = (message: string): CheckRegisterPathResult => ({
  allow: false,
  error: new TBError('permission_denied', message),
})

export function checkRegisterPath(input: CheckRegisterPathInput): CheckRegisterPathResult {
  const { sk, targetPath, existing, reservedRoots = [] } = input
  const target = segments(targetPath)

  // 保留段:~ 开头段不可作普通路径段(输入非法,先判)。
  if (target.some((seg) => seg.startsWith('~'))) {
    return {
      allow: false,
      error: new TBError('invalid_argument', `reserved segment in path '${targetPath}'`),
    }
  }

  if (sk.registerPaths !== undefined) {
    // a:声明后必须落在某前缀之下。
    const ok = sk.registerPaths.some((p) => isUnderPrefix(target, segments(p)))
    if (!ok) {
      return deny(`path '${targetPath}' is outside declared registerPaths`)
    }
  } else {
    // b:未声明 → 拒保留根。
    const roots = new Set([...RESERVED_ROOTS, ...reservedRoots])
    const head = target[0]
    if (head !== undefined && roots.has(head)) {
      return deny(`cannot register under reserved root '${head}'`)
    }
  }

  // c:两种情形都仍需 (path, 'register') scope 判定通过。
  if (!checkScopes(sk.scopes, targetPath, 'register')) {
    return deny(`no scope grants 'register' on '${targetPath}'`)
  }

  // d:占用冲突——已存在且非本 SK、非 system:auto 物化。
  if (existing && existing.registeredBy !== sk.id && existing.registeredBy !== SYSTEM_AUTO) {
    return {
      allow: false,
      error: new TBError('conflict', `path '${targetPath}' is registered by another key`),
    }
  }

  return { allow: true }
}
