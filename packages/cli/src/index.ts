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
import { secretCommand } from './commands/secret'
import { serverCommand } from './commands/server'
import { skCommand } from './commands/sk'
import { statusCommand } from './commands/status'
import { toolCommand } from './commands/tool'
import { treeCommand } from './commands/tree'
import { useCommand } from './commands/use'
import { whoamiCommand } from './commands/whoami'

/**
 * `tb` —— tool-bridge CLI(纯 API 客户端,随各 Phase 生长;DOD.md:17)。
 * Phase 0:`tb status`。Phase 1(DOD.md:48):login/whoami/use/sk/secret/ls/tree/help。
 * Phase 2(DOD.md:62):tool mount/rm、server add/ls/rm、call。
 * Phase 3(DOD.md:79):ctx ls/cat/put/patch/search/mount/unmount。
 * Phase 4(DOD.md:93):connect、device ls、mount fs。
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
  },
})

runMain(main)
