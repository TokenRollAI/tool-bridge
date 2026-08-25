import { Command } from 'commander'
import { type CloudflareInitOptions, runCloudflareInit } from '../cloudflareInit'
import { printJson, printLine } from '../output'
import { withGlobalOpts } from '../args'

/** 首次部署向导；当前 Cloudflare 编排依赖源码仓库中的 provision/build 配置。 */
export function initCommand(): Command {
  const cloudflare = withGlobalOpts(new Command('cloudflare'))
    .description('Provision and deploy tool-bridge to Cloudflare from a source checkout')
    .option('--account-id <id>', 'Cloudflare account ID (required when more than one is available)')
    .option('--domain <hostname>', 'Custom domain hostname (default: workers.dev)')
    .option('--name-prefix <prefix>', 'KV/R2/D1 resource name prefix', 'tb')
    .option('--profile <name>', 'Local tb profile to create or verify', 'default')
    .option('--repo <path>', 'tool-bridge source checkout (default: search upward from cwd)')
    .option('--yes', 'Confirm Cloudflare resource creation and deployment', false)
    .addHelpText(
      'after',
      '\nSecurity: init never accepts an Admin SK via --sk; it generates one for a new Worker or verifies the saved --profile for an existing Worker.',
    )
    .action(async (opts: CloudflareInitOptions) => {
      const asJson = Boolean(opts.json)
      const result = await runCloudflareInit(opts, {
        onStep: asJson ? undefined : message => printLine(`→ ${message}`),
      })
      if (asJson) {
        printJson({ ok: true, platform: 'cloudflare', ...result })
        return
      }
      printLine(`deployed: ${result.baseUrl}`)
      printLine(`profile: ${result.profile}`)
      if (result.adminSk) {
        printLine('')
        printLine('Admin SK（仅显示这一次，请立即保存到密码管理器）:')
        printLine(result.adminSk)
      } else {
        printLine('existing Admin SK preserved; local profile verified')
      }
    })

  return new Command('init')
    .description('Initialize a new tool-bridge deployment')
    .addCommand(cloudflare)
}
