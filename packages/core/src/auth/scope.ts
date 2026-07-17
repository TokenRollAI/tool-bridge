/**
 * Scope 判定。
 *
 * 纯逻辑,无 I/O:SK 记录由认证层预取入 CallContext.scopes。
 * 判定序(规范性,按序):
 *   1. 任一 `deny` scope 匹配 (path, action) → deny;
 *   2. 任一 `allow` scope 匹配 → allow;
 *   3. 无匹配 → deny(默认拒绝)。
 * glob 语义:`*` 匹配单段,`**` 匹配任意层级(含零段);匹配对象是不含保留段的树路径。
 */

import type { Action, Scope, TreePath } from '../types'

/** 归一路径为段数组:'/' 分隔,丢弃空段(容忍前后/重复斜杠);根路径 → []。 */
function segments(path: string): string[] {
  return path.split('/').filter(s => s.length > 0)
}

function matchFrom(pat: string[], pi: number, seg: string[], si: number): boolean {
  if (pi === pat.length) return si === seg.length
  const token = pat[pi]
  if (token === '**') {
    // 尝试让 ** 吞掉 0..剩余 段(含零段)。
    for (let k = si; k <= seg.length; k++) {
      if (matchFrom(pat, pi + 1, seg, k)) return true
    }
    return false
  }
  if (si === seg.length) return false
  if (token === '*' || token === seg[si]) {
    return matchFrom(pat, pi + 1, seg, si + 1)
  }
  return false
}

/**
 * 段级 glob 匹配。`*` 恰好匹配一段,`**` 匹配零或多段,其余段字面比较。
 * pattern 与 path 都按 '/' 归一为段序列;空 path(根)以零段参与匹配。
 */
export function matchGlob(pattern: string, path: TreePath): boolean {
  return matchFrom(segments(pattern), 0, segments(path), 0)
}

const effectOf = (scope: Scope): 'allow' | 'deny' => scope.effect ?? 'allow'

const matches = (scope: Scope, path: TreePath, action: Action): boolean =>
  scope.actions.includes(action) && matchGlob(scope.pattern, path)

/** 判定序:deny 优先 → allow → 默认拒。 */
export function checkScopes(scopes: Scope[], path: TreePath, action: Action): boolean {
  for (const scope of scopes) {
    if (effectOf(scope) === 'deny' && matches(scope, path, action)) return false
  }
  for (const scope of scopes) {
    if (effectOf(scope) === 'allow' && matches(scope, path, action)) return true
  }
  return false
}
