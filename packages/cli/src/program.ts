import { Command } from 'commander'
import pkg from '../package.json' with { type: 'json' }
import { callCommand } from './commands/call'
import { connectCommand } from './commands/connect'
import { ctxCommand } from './commands/ctx'
import { deviceCommand } from './commands/device'
import { helpCommand } from './commands/help'
import { loginCommand } from './commands/login'
import { lsCommand } from './commands/ls'
import { mountCommand } from './commands/mount'
import { pluginCommand } from './commands/plugin'
import { secretCommand } from './commands/secret'
import { serverCommand } from './commands/server'
import { skCommand } from './commands/sk'
import { statusCommand } from './commands/status'
import { toolCommand } from './commands/tool'
import { treeCommand } from './commands/tree'
import { useCommand } from './commands/use'
import { whoamiCommand } from './commands/whoami'

/**
 * `tb` —— tool-bridge CLI(纯 API 客户端)。命令族:
 * - status:部署健康摘要。
 * - login/whoami/use/sk/secret/ls/tree/help:档案、SK、密钥与工具树浏览。
 * - tool mount/rm、server add/ls/rm、call:挂载工具源与数据面调用。
 * - ctx ls/cat/put/patch/search/mount/unmount:Context Layer。
 * - connect、device ls、mount fs:设备反向注册。
 * - plugin register/list/get/health/rm:插件注册表。
 *
 * commander 严格解析:未知 flag / 多余 positional / 缺 required 一律报错退出,
 * 不静默吞掉(曾因 citty 把拼错的 `--alows` 当 positional 吞掉引发权限误配)。
 * `.helpCommand(false)`:`tb help [path]` 是业务命令(节点 ~help),须让位。
 */
export function buildProgram(): Command {
  const program = new Command('tb')
    .version(pkg.version)
    .description('tool-bridge CLI')
    .helpCommand(false)
  program.addCommand(statusCommand())
  program.addCommand(loginCommand())
  program.addCommand(whoamiCommand())
  program.addCommand(useCommand())
  program.addCommand(skCommand())
  program.addCommand(secretCommand())
  program.addCommand(lsCommand())
  program.addCommand(treeCommand())
  program.addCommand(helpCommand())
  program.addCommand(toolCommand())
  program.addCommand(serverCommand())
  program.addCommand(callCommand())
  program.addCommand(ctxCommand())
  program.addCommand(connectCommand())
  program.addCommand(deviceCommand())
  program.addCommand(mountCommand())
  program.addCommand(pluginCommand())
  return program
}
