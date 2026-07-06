import { defineCommand, runMain } from 'citty'
import pkg from '../package.json' with { type: 'json' }
import { statusCommand } from './commands/status'

/**
 * `tb` —— tool-bridge CLI(纯 API 客户端,随各 Phase 生长;DOD.md:17)。
 * Phase 0 只交付 `tb status`;后续 Phase 增补 login/ls/tree/call/ctx/... 等子命令。
 */
const main = defineCommand({
  meta: {
    name: 'tb',
    version: pkg.version,
    description: 'tool-bridge CLI',
  },
  subCommands: {
    status: statusCommand,
  },
})

runMain(main)
