/**
 * 树路径工具(纯函数)。
 *
 * 路径以 '/' 分隔、按段(segment)语义比较——不是字符串前缀。
 * 保留段(以 '~' 开头)不得作为普通路径段。
 */

import { TBError } from '../errors'
import type { TreePath } from '../types'

/**
 * 去首尾 '/'。内部空段(来自 '//')不在此折叠,交由 {@link validatePath} 判非法,
 * 以便调用方能拿到明确的 invalid_argument 而非静默吞掉。
 */
export function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '')
}

/** 规范化后按 '/' 拆段;根路径('' 或纯 '/')→ []。 */
export function segments(path: string): string[] {
  const p = normalizePath(path)
  return p === '' ? [] : p.split('/')
}

/**
 * 路径合法性:合法返回 null,否则返回对应 TBError(不抛)。
 * - 空路径 = 根:仅在 `opts.allowRoot` 时合法(如 ~tree 根视图);
 * - 任何段为空(内部 '//')→ invalid_argument;
 * - 任何段以 '~' 开头(保留段)→ invalid_argument。
 *
 * 注:此处只拒"保留段"。保留根(system/ui)的拒绝属认证/注册路径
 * 规则,不在 registry 的路径校验层——见 registry.ts 与注册路径规则。
 */
export function validatePath(path: TreePath, opts: { allowRoot?: boolean } = {}): TBError | null {
  const normalized = normalizePath(path)
  if (normalized === '') {
    return opts.allowRoot
      ? null
      : new TBError('invalid_argument', '路径不能为空(根路径仅特定操作合法)')
  }
  for (const seg of normalized.split('/')) {
    if (seg === '') {
      return new TBError('invalid_argument', `路径含空段:'${path}'`)
    }
    if (seg.startsWith('~')) {
      return new TBError('invalid_argument', `路径含保留段:'${seg}'`)
    }
  }
  return null
}

/**
 * 所有祖先路径(不含自身、不含根 '')。
 * `parentPaths('a/b/c')` → `['a', 'a/b']`;`parentPaths('a')` → `[]`。
 */
export function parentPaths(path: TreePath): TreePath[] {
  const segs = segments(path)
  const parents: TreePath[] = []
  for (let i = 1; i < segs.length; i++) {
    parents.push(segs.slice(0, i).join('/'))
  }
  return parents
}

/**
 * 按段的前缀判定(非字符串前缀):
 * `'a/b'` 是 `'a/b/c'` 的前缀;`'a/bx'` 不是 `'a/b/c'` 的前缀。
 * 空前缀('' 根)是任意路径的前缀;相等亦视为前缀。
 */
export function isPrefixOf(prefix: TreePath, path: TreePath): boolean {
  const p = segments(prefix)
  const q = segments(path)
  if (p.length > q.length) return false
  return p.every((seg, i) => seg === q[i])
}
