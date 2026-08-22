/**
 * 树路径工具(纯函数)。
 *
 * 路径以 '/' 分隔、按段(segment)语义比较——不是字符串前缀。
 * 保留段(以 '~' 开头)不得作为普通路径段。
 *
 * 标识符规范化(canonicalize):tool-bridge 自有的**标识符**(路径段、命令/工具名、
 * export id、scope pattern 字面段、device 暴露路径)一律小写。输入大小写不敏感,
 * 存储与对外输出恒小写。MCP/HTTP 上游的原始工具名是外部身份,由适配器维护
 * `公开小写名 → 上游原名` 映射,不走本模块规范化。
 */

import type { TreePath } from '../types'
import { TBError } from '../errors'

/**
 * 去首尾 '/'。内部空段(来自 '//')不在此折叠,交由 {@link validatePath} 判非法,
 * 以便调用方能拿到明确的 invalid_argument 而非静默吞掉。
 */
export function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '')
}

/**
 * 单个标识符段的合法性:合法返回 null,否则返回 TBError(不抛)。
 * 规范化**之前**校验形状(段已按 '/' 拆出,故此处不含 '/')。
 * - 空段 → invalid_argument;
 * - 以 '~' 开头(保留段)→ invalid_argument;
 * - '.' 或 '..'(相对路径导航)→ invalid_argument。
 */
export function validateSegment(seg: string): TBError | null {
  if (seg === '') return new TBError('invalid_argument', '标识符段不能为空')
  if (seg.startsWith('~')) return new TBError('invalid_argument', `标识符段不能以 '~' 开头:'${seg}'`)
  if (seg === '.' || seg === '..') {
    return new TBError('invalid_argument', `标识符段不能是 '.' 或 '..':'${seg}'`)
  }
  return null
}

/**
 * 规范化单个标识符段:先校验形状,再小写化。非法段抛 TBError。
 * command/tool 名、export id 等单段标识符统一经此。
 */
export function canonicalizeSegment(seg: string): string {
  const invalid = validateSegment(seg)
  if (invalid) throw invalid
  return seg.toLowerCase()
}

/**
 * 规范化整条路径:去首尾 '/'、逐段校验并小写。根路径('')原样返回。
 * 任一段非法(空段 / 保留段 / '.' / '..')抛 TBError。
 *
 * 这是路径进入 registry、resolve、scope 判定、search key 前的唯一入口:
 * 存储侧只见小写路径,故大小写不同的输入天然折叠到同一节点。折叠导致的重复
 * (上游同时暴露 Foo 与 foo)由调用方在物化/列举点检测并拒绝(见 assertNoCollision)。
 */
export function canonicalizePath(path: string): TreePath {
  const norm = normalizePath(path)
  if (norm === '') return ''
  return norm
    .split('/')
    .map(seg => canonicalizeSegment(seg))
    .join('/')
}

/**
 * 大小写折叠冲突检测:一组标识符(如上游工具名、同级子节点名)规范化后若出现重复,
 * 抛 invalid_argument 且不选其一(fail closed)。names 为**原始**标识符集合。
 */
export function assertNoCollision(names: readonly string[], context: string): void {
  const seen = new Map<string, string>()
  for (const name of names) {
    const lower = name.toLowerCase()
    const prev = seen.get(lower)
    if (prev !== undefined && prev !== name) {
      throw new TBError(
        'invalid_argument',
        `${context}:标识符 '${prev}' 与 '${name}' 小写规范化后冲突`,
      )
    }
    seen.set(lower, name)
  }
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
    if (seg === '.' || seg === '..') {
      return new TBError('invalid_argument', `路径含相对导航段:'${seg}'`)
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
