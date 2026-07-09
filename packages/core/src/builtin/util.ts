/**
 * builtin 模块共用小工具:cmd 路径拼装、参数校验、void 应答。
 *
 * 参数校验故意从简:只挡明显非法(缺必填 / 类型错),复杂 schema 校验
 * 留待后续。校验失败一律 invalid_argument。
 */

import { TBError } from '../errors'
import type { ListOptions, TreePath } from '../types'

/** void 语义 cmd(delete / set)的应答体:不回显任何值(secret.set 明确不回显 value)。 */
export const VOID_ACK = { ok: true } as const

/** list 类 cmd 的 `opts: ListOptions` 在 ~help 中的共用 schema(默认/上限对齐 types.ts)。 */
export const LIST_OPTS_SCHEMA = {
  type: 'object',
  description: 'pagination options',
  properties: {
    cursor: { type: 'string', description: 'opaque cursor returned by the previous page' },
    limit: { type: 'number', description: 'page size (default 50, max 200)' },
  },
} as const

/** 节点数据面调用的 HTTP 路径(带前导 '/'):cmd 行的 `POST /<nodePath>`。 */
export function cmdPath(nodePath: TreePath): string {
  return `/${nodePath}`
}

/** 取必填非空字符串字段,否则 invalid_argument。 */
export function requireString(args: Record<string, unknown>, field: string): string {
  const v = args[field]
  if (typeof v !== 'string' || v.length === 0) {
    throw new TBError('invalid_argument', `field '${field}' must be a non-empty string`)
  }
  return v
}

/** 取可选字符串字段(缺省 undefined);出现但非字符串 → invalid_argument。 */
export function optString(args: Record<string, unknown>, field: string): string | undefined {
  const v = args[field]
  if (v === undefined) return undefined
  if (typeof v !== 'string') {
    throw new TBError('invalid_argument', `field '${field}' must be a string`)
  }
  return v
}

/** 取可选 `opts: ListOptions`(整体对象传入,不平铺)。 */
export function optListOptions(args: Record<string, unknown>): ListOptions | undefined {
  const opts = args.opts
  if (opts === undefined) return undefined
  if (typeof opts !== 'object' || opts === null) {
    throw new TBError('invalid_argument', "field 'opts' must be an object")
  }
  return opts as ListOptions
}

/** 取必填对象字段(如 update 的 patch),否则 invalid_argument。 */
export function requireObject(
  args: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const v = args[field]
  if (typeof v !== 'object' || v === null) {
    throw new TBError('invalid_argument', `field '${field}' must be an object`)
  }
  return v as Record<string, unknown>
}
