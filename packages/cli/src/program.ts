import { Command } from 'commander'
import pkg from '../package.json' with { type: 'json' }
import { callCommand } from './commands/call'
import { connectCommand } from './commands/connect'
import { ctxCommand } from './commands/ctx'
import { deviceCommand } from './commands/device'
import { federationCommand } from './commands/federation'
import { feedbackCommand } from './commands/feedback'
import { helpCommand } from './commands/help'
import { loginCommand } from './commands/login'
import { lsCommand } from './commands/ls'
import { mountCommand } from './commands/mount'
import { noteCommand } from './commands/note'
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
 * - federation ls/add/rm:remote 联邦 host 白名单(运行时叠加 env 基线)。
 * - note ls/get/set/rm:Path 补充说明(展示在 ~help;set/rm 需 admin)。
 * - feedback ls/get/submit/vote/rm:Agent 使用反馈(头部条目进 ~help)。
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
    .description(
      'tool-bridge CLI — one gateway for tools, context stores and devices.\nStart with `tb login`, explore with `tb ls` / `tb help <path>`, invoke with `tb call <path>`.\nEvery command supports --json for parseable output.',
    )
    .helpCommand(false)
  // 尾部引导:把 feedback 变成 Agent 的使用习惯(用前查经验、踩坑后回馈)。
  program.addHelpText(
    'after',
    `
Agent feedback — every path carries experience from other agents:
  before using a tool:   tb feedback ls <path>    (top entries also show up in \`tb help <path>\`)
  hit a pitfall:         tb feedback submit <path> --title "<short summary>" --detail "<how to avoid>"
  rate what helped you:  tb feedback vote <path> <id> up|down`,
  )
  program.addCommand(statusCommand())
  program.addCommand(loginCommand())
  program.addCommand(whoamiCommand())
  program.addCommand(useCommand())
  program.addCommand(skCommand())
  program.addCommand(secretCommand())
  program.addCommand(federationCommand())
  program.addCommand(noteCommand())
  program.addCommand(feedbackCommand())
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
