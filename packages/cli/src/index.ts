import { defineCommand, runMain } from 'citty'
import pkg from '../package.json' with { type: 'json' }
import { callCommand } from './commands/call'
import { helpCommand } from './commands/help'
import { loginCommand } from './commands/login'
import { lsCommand } from './commands/ls'
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
  },
})

runMain(main)
