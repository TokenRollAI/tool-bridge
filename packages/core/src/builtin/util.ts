/**
 * builtin 模块共用小工具:cmd 路径拼装、参数校验、void 应答。
 *
 * 参数校验故意从简:只挡明显非法(缺必填 / 类型错),复杂 schema 校验
 * 留待后续。校验失败一律 invalid_argument。
 */

import type { ListOptions, TreePath } from '../types'
import type { CmdSpec } from '../htbp/model'
import { TBError } from '../errors'

/** void 语义 cmd(delete / set)的应答体:不回显任何值(secret.set 明确不回显 value)。 */
export const VOID_ACK = { ok: true } as const

/**
 * 把每个 cmd 的 `path` 统一钉成完整直连命令路径 `/<nodePath>/<cmd.name>`。
 * builtin 模块的 cmd 构造只关心 name/schema,path 由此处统一派生——命令是节点下的
 * 虚拟叶子,`POST /<nodePath>/<name>` 是唯一调用形态(body 即 arguments 本体)。
 */
export function withCommandPaths(nodePath: TreePath, cmds: CmdSpec[]): CmdSpec[] {
  return cmds.map(cmd => ({ ...cmd, path: `/${nodePath}/${cmd.name}` }))
}

/** list 类 cmd 的 `opts: ListOptions` 在 ~help 中的共用 schema(默认/上限对齐 types.ts)。 */
export const LIST_OPTS_SCHEMA = {
  type: 'object',
  description: 'pagination options',
  properties: {
    cursor: { type: 'string', description: 'opaque cursor returned by the previous page' },
    limit: { type: 'number', description: 'page size (default 50, max 200)' },
  },
} as const

/**
 * 命令所属**节点**的路径(带前导 '/')。CmdSpec.path 存节点路径;完整直连调用路径
 * `POST /<nodePath>/<cmd>` 由渲染/身份层统一派生(见 htbp/model.ts leafCmdPath)——
 * 命令是节点下的虚拟叶子,唯一调用形态是直连,没有 `{tool,arguments}` 信封。
 */
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
    throw new TBError('invalid_argument', 'field \'opts\' must be an object')
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
