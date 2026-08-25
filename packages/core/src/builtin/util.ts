/**
 * builtin 与其他 Help 生成器共用的路径、分页 schema 与 void 应答。
 * builtin 的命令级校验由 commandRegistry 统一执行。
 */

export { HTBP_LIST_OPTIONS_SCHEMA as LIST_OPTS_ZOD_SCHEMA } from '../operation/htbpCommandRegistry'
import type { CmdSpec } from '../htbp/model'
import type { TreePath } from '../types'

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

/**
 * 静态命令表构造时共用的节点路径占位符(带前导 `/`)。
 * 调用方必须在返回 HelpModel 前经过 `withCommandPaths`,由它把每条 `CmdSpec.path`
 * 统一替换为 `/<nodePath>/<cmd.name>`；渲染层不会再补命令名。
 */
export function cmdPath(nodePath: TreePath): string {
  return `/${nodePath}`
}
