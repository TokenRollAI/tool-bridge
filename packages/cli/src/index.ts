import { defineCommand, runMain } from 'citty'
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
 */
const main = defineCommand({
  meta: {
    name: 'tb',
    version: pkg.version,
    description: 'tool-bridge CLI',
  },
  subCommands: {
    status: statusCommand,
    login: loginCommand,
    whoami: whoamiCommand,
    use: useCommand,
    sk: skCommand,
    secret: secretCommand,
    ls: lsCommand,
    tree: treeCommand,
    help: helpCommand,
    tool: toolCommand,
    server: serverCommand,
    call: callCommand,
    ctx: ctxCommand,
    connect: connectCommand,
    device: deviceCommand,
    mount: mountCommand,
    plugin: pluginCommand,
  },
})

runMain(main)
