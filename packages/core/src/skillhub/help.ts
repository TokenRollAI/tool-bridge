/** Skillhub 节点 Help 与 readOnly 能力裁剪。命令定义真源在 commands.ts。 */

import type { HelpModel } from '../htbp/model'
import type { TreePath } from '../types'
import { skillhubCommands } from './commands'

export { dispatchSkillhubCmd, skillhubScopeForCmd } from './commands'

/** ~describe 声明的可选能力(本实现提供 Search)。 */
export const SKILLHUB_CAPABILITIES: readonly string[] = ['search']

export interface SkillhubHelpOptions {
  /** readOnly 挂载隐藏 Publish/Remove。 */
  readOnly?: boolean
}

export function skillhubHelpModel(
  node: { description: string, path: TreePath },
  opts: SkillhubHelpOptions = {},
): HelpModel {
  return skillhubCommands.helpModel(
    { path: node.path, kind: 'skillhub', description: node.description },
    command => opts.readOnly !== true || command.scope === 'read',
  )
}
