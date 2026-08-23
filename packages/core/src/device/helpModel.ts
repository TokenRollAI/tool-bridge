/**
 * device 节点的静态 HelpModel(网关 helpModelFor 的 device 分支数据源)。
 *
 * shell 节点:单 cmd `exec`,effect destructive + confirm,allow 白名单进 `h` 行;
 * fs 节点:复用 context 的静态 help(file provider 语义,不复制 cmd 表);
 * directory(mountPath)节点:description 呈现三态 presence(online/stale/offline)。
 */

import type { ChildRef, CmdSpec, HelpModel } from '../htbp/model'
import type { Presence } from './presence'
import type { TreePath } from '../types'
import { contextHelpModel, type ContextHelpOptions } from '../context/help'
import { cmdPath, withCommandPaths } from '../builtin/util'
import { describeAllow } from './shellAllow'

const SHELL_DESCRIPTION = 'device shell (remote command execution)'

/** `<mountPath>/shell` 工具节点的 ~help;h 行含 allow 白名单描述。 */
export function deviceShellHelpModel(
  nodePath: TreePath,
  shell: { allow?: string[], description?: string } = {},
): HelpModel {
  const exec: CmdSpec = {
    name: 'exec',
    method: 'POST',
    path: cmdPath(nodePath),
    h: `run a shell command on the device; ${describeAllow(shell.allow)}`,
    inputSchema: {
      type: 'object',
      required: ['command'],
      properties: {
        command: { type: 'string', description: 'command line to run' },
        cwd: { type: 'string', description: 'working directory on the device' },
        timeoutMs: { type: 'number', description: 'kill the command after this many ms' },
      },
    },
    returns: '{ stdout, stderr, exitCode }',
    scope: 'call',
    effect: 'destructive',
    confirm: true,
  }
  return {
    node: { path: nodePath, kind: 'device', description: shell.description ?? SHELL_DESCRIPTION },
    // exec 是节点下的虚拟命令叶子；HelpModel 必须宣告完整直连路径，Dashboard、CLI
    // 与 Agent 都直接消费该字段，不能退回只指向 shell 节点的旧信封语义。
    cmds: withCommandPaths(nodePath, [exec]),
  }
}

/** `<mountPath>/fs` context 节点的 ~help:即 file provider,复用 context 静态 help。 */
export function deviceFsHelpModel(
  node: { description: string, path: TreePath },
  opts: ContextHelpOptions = {},
): HelpModel {
  return contextHelpModel(node, opts)
}

/** `<mountPath>` directory 节点的 ~help;description 附三态 presence(online/stale/offline)。 */
export function deviceDirectoryHelpModel(
  node: { description: string, path: TreePath, presence: Presence },
  children: ChildRef[] = [],
): HelpModel {
  return {
    node: {
      path: node.path,
      kind: 'directory',
      description: `${node.description} (${node.presence.state})`,
    },
    cmds: [],
    children,
  }
}
