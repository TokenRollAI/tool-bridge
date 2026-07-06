import { defineCommand, runMain } from 'citty'
import pkg from '../package.json' with { type: 'json' }
import { helpCommand } from './commands/help'
import { loginCommand } from './commands/login'
import { lsCommand } from './commands/ls'
import { secretCommand } from './commands/secret'
import { skCommand } from './commands/sk'
import { statusCommand } from './commands/status'
import { treeCommand } from './commands/tree'
import { useCommand } from './commands/use'
import { whoamiCommand } from './commands/whoami'

/**
 * `tb` —— tool-bridge CLI(纯 API 客户端,随各 Phase 生长;DOD.md:17)。
 * Phase 0:`tb status`。Phase 1(DOD.md:48):login/whoami/use/sk/secret/ls/tree/help。
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
  },
})

runMain(main)
