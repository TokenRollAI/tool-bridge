/** Context 节点 Help 与动态能力裁剪。命令定义真源在 commands.ts。 */

import type { CmdSpec, HelpModel } from '../htbp/model'
import type { TreePath } from '../types'
import { contextCommands } from './commands'

export {
  contextScopeForCmd,
  dispatchContextCmd,
  dispatchContextUploadCmd,
  parseContextCmdArgs,
} from './commands'

/** ~describe 声明的可选能力(本实现提供 Search 与 Delete)。 */
export const CONTEXT_CAPABILITIES: readonly string[] = ['search', 'delete']
/** 内置对象存储可选扩展:定路径、限时 PUT 直传。 */
export const CONTEXT_DIRECT_UPLOAD_CAPABILITY = 'direct-upload'

/** 对象存储直传扩展；仅在底层具备签名能力时由宿主追加。 */
export function contextUploadCmd(nodePath: TreePath): CmdSpec {
  return contextCommands.command('create_upload', nodePath)!
}

export interface ContextHelpOptions {
  /** provider 真实支持的动词集(按 handler 存在性推导)。 */
  methods?: ReadonlySet<string>
  /** readOnly 挂载额外隐藏 Write/Update/Delete。 */
  readOnly?: boolean
}

export function contextHelpModel(
  node: { description: string, path: TreePath },
  opts: ContextHelpOptions = {},
): HelpModel {
  return contextCommands.helpModel(
    { path: node.path, kind: 'context', description: node.description },
    (command) => {
      // create_upload 是宿主按 driver 能力追加的扩展，不进基础动词表。
      if (command.name === 'create_upload') return false
      if (opts.methods !== undefined && !opts.methods.has(command.name)) return false
      return opts.readOnly !== true || command.scope === 'read'
    },
  )
}
